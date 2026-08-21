import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKSPACE_ACCESS_PROBE_MARKER = 'crawshrimp-workspace-access-probe-v1'
const WELCOME_NOTICE_PATCH_MARKER = 'crawshrimp-disable-dsh-welcome-notice-v1'
const LLM_PI_AI_PROVIDER_ORDER_PATCH_MARKER = 'crawshrimp-llm-pi-ai-provider-order-v1'
const OLD_SDK_JSONRPC_IMAGE_ADMISSION_PATCH_MARKER = 'crawshrimp-sdk-jsonrpc-image-admission-v1'
const SDK_JSONRPC_IMAGE_ADMISSION_PATCH_MARKER = 'crawshrimp-sdk-jsonrpc-image-admission-v2'
const OLD_DEEPSEEK_MULTIMODAL_FALLBACK_PATCH_MARKER = 'crawshrimp-deepseek-multimodal-fallback-v1'
const DEEPSEEK_MULTIMODAL_FALLBACK_PATCH_MARKER = 'crawshrimp-deepseek-multimodal-fallback-v2'
const OLD_DEEPSEEK_MULTIMODAL_AUDIT_PATCH_MARKER = 'crawshrimp-deepseek-multimodal-audit-v1'
const DEEPSEEK_MULTIMODAL_AUDIT_PATCH_MARKER = 'crawshrimp-deepseek-multimodal-audit-v2'
const DEEPSEEK_VISION_REASONING_GUARD_PATCH_MARKER = 'crawshrimp-deepseek-vision-reasoning-guard-v1'
const HOST_APIPROXY_DEEPSEEK_IMAGE_SELECTION_PATCH_MARKER = 'crawshrimp-host-apiproxy-deepseek-image-selection-v1'

function deepseekPackageEntryPaths(runtimeRoot, packageName, ...segments) {
  const root = resolve(runtimeRoot)
  const candidates = [join(root, 'node_modules', '@deepseek-ai', packageName)]
  const pnpmRoot = join(root, 'node_modules', '.pnpm')
  if (existsSync(pnpmRoot)) {
    for (const entry of readdirSync(pnpmRoot)) {
      if (entry.startsWith(`@deepseek-ai+${packageName}@`)) {
        candidates.push(join(pnpmRoot, entry, 'node_modules', '@deepseek-ai', packageName))
      }
    }
  }
  const seen = new Set()
  return candidates
    .map((candidate) => resolve(candidate, ...segments))
    .filter((candidate) => {
      if (seen.has(candidate) || !existsSync(candidate)) return false
      seen.add(candidate)
      return true
    })
}

export function patchRuntimeDependencies(runtimeRoot) {
  const workspaceResult = patchWorkspaceAccessProbe(runtimeRoot)
  const welcomeNoticeResult = patchWelcomeNotice(runtimeRoot)
  const piAiProviderOrderResult = patchPiAiProviderOrder(runtimeRoot)
  const sdkJsonrpcImageAdmissionResult = patchSdkJsonrpcImageAdmission(runtimeRoot)
  const piAiDeepSeekMultimodalFallbackResult = patchPiAiDeepSeekMultimodalFallback(runtimeRoot)
  const hostApiProxyDeepSeekImageSelectionResult = patchHostApiProxyDeepSeekImageSelection(runtimeRoot)
  return {
    patched: workspaceResult.patched || welcomeNoticeResult.patched || piAiProviderOrderResult.patched || sdkJsonrpcImageAdmissionResult.patched || piAiDeepSeekMultimodalFallbackResult.patched || hostApiProxyDeepSeekImageSelectionResult.patched,
    workspaceEntry: workspaceResult.workspaceEntry,
    welcomeNoticeEntry: welcomeNoticeResult.welcomeNoticeEntry,
    piAiProviderOrderEntry: piAiProviderOrderResult.piAiProviderOrderEntry,
    sdkJsonrpcImageAdmissionEntry: sdkJsonrpcImageAdmissionResult.sdkJsonrpcImageAdmissionEntry,
    piAiDeepSeekMultimodalFallbackEntry: piAiDeepSeekMultimodalFallbackResult.piAiDeepSeekMultimodalFallbackEntry,
    hostApiProxyDeepSeekImageSelectionEntry: hostApiProxyDeepSeekImageSelectionResult.hostApiProxyDeepSeekImageSelectionEntry,
    workspacePatched: workspaceResult.patched,
    welcomeNoticePatched: welcomeNoticeResult.patched,
    piAiProviderOrderPatched: piAiProviderOrderResult.patched,
    sdkJsonrpcImageAdmissionPatched: sdkJsonrpcImageAdmissionResult.patched,
    piAiDeepSeekMultimodalFallbackPatched: piAiDeepSeekMultimodalFallbackResult.patched,
    hostApiProxyDeepSeekImageSelectionPatched: hostApiProxyDeepSeekImageSelectionResult.patched,
  }
}

function patchWorkspaceAccessProbe(runtimeRoot) {
  const workspaceEntry = join(
    resolve(runtimeRoot),
    'node_modules',
    '@deepseek-ai',
    'dsh-workspace',
    'lib',
    'index.js',
  )
  let source = readFileSync(workspaceEntry, 'utf8')
  if (source.includes(WORKSPACE_ACCESS_PROBE_MARKER)) return { patched: false, workspaceEntry }

  source = replaceExact(
    source,
    'import { realpath, stat } from "node:fs/promises";',
    'import { open, readdir, realpath, rename, stat, unlink } from "node:fs/promises";',
    'workspace fs imports',
  )
  source = replaceExact(
    source,
    'import { basename } from "node:path";',
    'import { basename, join } from "node:path";',
    'workspace path imports',
  )
  source = replaceExact(
    source,
    'async function realpathNormalize(path) {\n\treturn await realpath(path);\n}',
    `async function realpathNormalize(path) {
\treturn await realpath(path);
}
// ${WORKSPACE_ACCESS_PROBE_MARKER}
async function probeWorkspaceDirectoryAccess(directory) {
\tawait readdir(directory);
\tconst temporary = join(directory, \`.dsh-workspace-probe-\${process.pid}-\${randomUUID()}\`);
\tconst renamed = \`\${temporary}.renamed\`;
\tlet handle;
\ttry {
\t\thandle = await open(temporary, "wx", 384);
\t\tawait handle.writeFile("workspace-probe", "utf8");
\t\tawait handle.sync();
\t\tawait handle.close();
\t\thandle = void 0;
\t\tawait rename(temporary, renamed);
\t\tif (!(await stat(renamed)).isFile()) throw new Error("workspace probe target is not a file");
\t\tawait unlink(renamed);
\t} finally {
\t\tif (handle) await handle.close().catch(() => {});
\t\tawait unlink(temporary).catch(() => {});
\t\tawait unlink(renamed).catch(() => {});
\t}
}`,
    'workspace access probe helper',
  )
  source = replaceExact(
    source,
    '\tasync status() {\n\t\ttry {\n\t\t\treturn (await stat(this.record.path)).isDirectory() ? "ok" : "missing-dir";\n\t\t} catch {\n\t\t\treturn "missing-dir";\n\t\t}\n\t}',
    '\tasync status() {\n\t\ttry {\n\t\t\tif (!(await stat(this.record.path)).isDirectory()) return "missing-dir";\n\t\t\tawait probeWorkspaceDirectoryAccess(this.record.path);\n\t\t\treturn "ok";\n\t\t} catch {\n\t\t\treturn "missing-dir";\n\t\t}\n\t}',
    'workspace status access probe',
  )
  source = replaceExact(
    source,
    '\tasync create(path, title) {\n\t\tconst canonical = await realpathNormalize(path);\n\t\tif (!(await stat(canonical)).isDirectory()) throw new Error(`cannot create a workspace at \'${canonical}\': path is not a directory`);\n\t\treturn await this.enqueueOperation(() => this.createCanonical(canonical, title));\n\t}',
    '\tasync create(path, title) {\n\t\tconst canonical = await realpathNormalize(path);\n\t\tif (!(await stat(canonical)).isDirectory()) throw new Error(`cannot create a workspace at \'${canonical}\': path is not a directory`);\n\t\tawait probeWorkspaceDirectoryAccess(canonical);\n\t\treturn await this.enqueueOperation(() => this.createCanonical(canonical, title));\n\t}',
    'workspace create access probe',
  )
  writeFileSync(workspaceEntry, source, 'utf8')
  return { patched: true, workspaceEntry }
}

function patchWelcomeNotice(runtimeRoot) {
  const welcomeNoticeEntry = join(
    resolve(runtimeRoot),
    'node_modules',
    '@deepseek-ai',
    'dsh-client-ui-settings-models',
    'lib',
    'client.js',
  )
  let source = readFileSync(welcomeNoticeEntry, 'utf8')
  if (source.includes(WELCOME_NOTICE_PATCH_MARKER)) return { patched: false, welcomeNoticeEntry }

  source = replaceExact(
    source,
    '\t\t\tctx.slots.inject("settings.onboarding", () => ctx.slots.register({\n\t\t\t\tname: "settings.onboarding",\n\t\t\t\tid: "welcome-notice",\n\t\t\t\torder: -100,\n\t\t\t\tinject: welcomeInjected\n\t\t\t}, WelcomeNotice));',
    `\t\t\t/* ${WELCOME_NOTICE_PATCH_MARKER}: Crawshrimp removes the upstream internal testing notice. */`,
    'welcome notice onboarding registration',
  )
  writeFileSync(welcomeNoticeEntry, source, 'utf8')
  return { patched: true, welcomeNoticeEntry }
}

function patchPiAiProviderOrder(runtimeRoot) {
  const piAiProviderOrderEntry = join(
    resolve(runtimeRoot),
    'node_modules',
    '@deepseek-ai',
    'dsh-llm-pi-ai',
    'lib',
    'index.js',
  )
  let source = readFileSync(piAiProviderOrderEntry, 'utf8')
  if (source.includes(LLM_PI_AI_PROVIDER_ORDER_PATCH_MARKER)) {
    return { patched: false, piAiProviderOrderEntry }
  }

  source = replaceExact(
    source,
    '\t\tconst routes = [...profiles().keys()];',
    `\t\tconst routes = [...profiles().keys()].map((provider, index) => ({ provider, index })).sort((left, right) => {
\t\t\t/* ${LLM_PI_AI_PROVIDER_ORDER_PATCH_MARKER}: Crawshrimp keeps the official DeepSeek route first when multiple keys are configured. */
\t\t\tconst rank = (provider) => provider === "crawshrimp-deepseek-official" ? 0 : 1;
\t\t\treturn rank(left.provider) - rank(right.provider) || left.index - right.index;
\t\t}).map(({ provider }) => provider);`,
    'llm-pi-ai provider registration order',
  )
  writeFileSync(piAiProviderOrderEntry, source, 'utf8')
  return { patched: true, piAiProviderOrderEntry }
}

function patchPiAiDeepSeekLatestImageTurnBridge(source) {
  if (!source.includes(OLD_DEEPSEEK_MULTIMODAL_FALLBACK_PATCH_MARKER)) return { source, patched: false }
  source = replaceRange(
    source,
    'const CRAWSHRIMP_DEEPSEEK_OFFICIAL_PROVIDER = "crawshrimp-deepseek-official";',
    'async function toPiContextWithImages(options, attachments, onReplayDegrade, maxRequestImageBytes) {',
    `const CRAWSHRIMP_DEEPSEEK_OFFICIAL_PROVIDER = "crawshrimp-deepseek-official";
const CRAWSHRIMP_DEEPSEEK_VISION_MODEL = "deepseek-v4-flash-vision-exp";
function crawshrimpDeepSeekTextModelCanUseVisionBridge(provider, model) {
\treturn provider === CRAWSHRIMP_DEEPSEEK_OFFICIAL_PROVIDER && (model === "deepseek-v4-flash" || model === "deepseek-v4-pro");
}
function crawshrimpTextFromPiMessage(message) {
\treturn message.content.filter((block) => block.type === "text").map((block) => block.text).join("").trim();
}
function crawshrimpContentWithoutImages(blocks, replacementText) {
\tconst content = [];
\tfor (const block of blocks) {
\t\tif (block.type === "image") {
\t\t\tif (replacementText) content.push({ type: "text", text: replacementText });
\t\t\tcontinue;
\t\t}
\t\tif (block.type === "tool-result") {
\t\t\tcontent.push({
\t\t\t\t...block,
\t\t\t\tcontent: crawshrimpContentWithoutImages(block.content, replacementText)
\t\t\t});
\t\t\tcontinue;
\t\t}
\t\tcontent.push(block);
\t}
\treturn content;
}
function crawshrimpContentWithVisionForLatestImage(blocks, visionText) {
\tconst content = [];
\tlet injected = false;
\tfor (const block of blocks) {
\t\tif (block.type === "image") {
\t\t\tcontent.push({
\t\t\t\ttype: "text",
\t\t\t\ttext: injected ? "\\n[同一轮其余图片已在上方 DeepSeek Vision 识别结果中归纳]\\n" : "\\n\\n[DeepSeek Vision 识别结果]\\n" + visionText + "\\n\\n[兼容说明]\\n原始图片已经由 DeepSeek Vision 转写成以上文字；当前 DeepSeek 文本模型应直接基于这些文字继续回答，不要因为原始会话含图而要求用户切换到视觉模型。\\n\\n"
\t\t\t});
\t\t\tinjected = true;
\t\t\tcontinue;
\t\t}
\t\tif (block.type === "tool-result") {
\t\t\tconst nested = crawshrimpContentWithVisionForLatestImage(block.content, visionText);
\t\t\tcontent.push({
\t\t\t\t...block,
\t\t\t\tcontent: nested.content
\t\t\t});
\t\t\tinjected = injected || nested.injected;
\t\t\tcontinue;
\t\t}
\t\tcontent.push(block);
\t}
\treturn { content, injected };
}
function crawshrimpLatestImageUserMessageIndex(messages) {
\tfor (let index = messages.length - 1; index >= 0; index--) {
\t\tconst message = messages[index];
\t\tif (message.role === "user" && contentHasImage(message.content)) return index;
\t}
\treturn -1;
}
function crawshrimpVisionOptionsForMessage(options, targetIndex) {
\tconst target = options.messages[targetIndex];
\tif (target === void 0) return void 0;
\treturn {
\t\t...options,
\t\tmessages: [{ ...target, timestamp: 0 }],
\t\ttools: void 0
\t};
}
function crawshrimpTextOnlyOptionsFromVision(options, visionText, targetIndex) {
\tlet injected = false;
\tconst messages = options.messages.map((message, index) => {
\t\tif (!contentHasImage(message.content)) return message;
\t\tif (index === targetIndex) {
\t\t\tconst result = crawshrimpContentWithVisionForLatestImage(message.content, visionText);
\t\t\tinjected = injected || result.injected;
\t\t\treturn { ...message, content: result.content };
\t\t}
\t\treturn {
\t\t\t...message,
\t\t\tcontent: crawshrimpContentWithoutImages(message.content, "\\n[历史图片已省略，避免与本轮图片识别混淆]\\n")
\t\t};
\t});
\tif (!injected) messages.push({
\t\trole: "user",
\t\tcontent: [{ type: "text", text: "[DeepSeek Vision 识别结果]\\n" + visionText + "\\n\\n[兼容说明]\\n原始图片已经由 DeepSeek Vision 转写成以上文字；当前 DeepSeek 文本模型应直接基于这些文字继续回答，不要因为原始会话含图而要求用户切换到视觉模型。\\n" }],
\t\ttimestamp: 0
\t});
\treturn { ...options, messages };
}
async function crawshrimpBridgeDeepSeekImages(snapshot, profile, options, apiKey, upstream, onReplayDegrade) {
\t// ${DEEPSEEK_MULTIMODAL_FALLBACK_PATCH_MARKER}: let DeepSeek text models consume image sessions via the official vision model first.
\tif (!crawshrimpDeepSeekTextModelCanUseVisionBridge(options.provider, options.model)) return void 0;
\tconst attachments = this.config.resolveAttachments?.();
\tif (attachments === void 0) return void 0;
\tconst targetIndex = crawshrimpLatestImageUserMessageIndex(options.messages);
\tconst visionOptions = targetIndex < 0 ? void 0 : crawshrimpVisionOptionsForMessage(options, targetIndex);
\tif (visionOptions === void 0) return void 0;
\tconst visionModel = snapshot.models.getModel(options.provider, CRAWSHRIMP_DEEPSEEK_VISION_MODEL);
\tif (visionModel === void 0 || !visionModel.input.includes("image")) return void 0;
\tconst visionSystem = [
\t\toptions.system,
\t\t"你是抓虾 Harness 的图片识别前置模型。请只识别最新一条用户消息里的图片，并转写成准确、可供后续 DeepSeek 文本模型继续处理的中文描述。不要引用、比较或描述历史图片。保留界面文字、数字、按钮、错误码、商品/页面结构、用户可能关心的关键事实；不要执行任务，不要给操作建议。"
\t].filter((part) => typeof part === "string" && part.trim()).join("\\n\\n");
\tconst visionContext = await toPiContext({
\t\t...visionOptions,
\t\t...visionSystem ? { system: visionSystem } : {},
\t\ttools: void 0
\t}, attachments, onReplayDegrade, profile.maxRequestImageBytes);
\tconst visionMessage = await snapshot.models.completeSimple(visionModel, visionContext, {
\t\t...profileOptions(profile, void 0, apiKey),
\t\tmaxTokens: 2048,
\t\t...options.sessionId === void 0 ? {} : { sessionId: \`\${options.sessionId}:vision\` },
\t\tsignal: upstream,
\t\theaders: requestHeaders(profile.headers)
\t});
\tif (visionMessage.stopReason === "error") throw new LlmError(\`DeepSeek vision preflight failed: \${visionMessage.errorMessage ?? "unknown error"}\`, "UNSUPPORTED_CONTENT");
\tconst visionText = crawshrimpTextFromPiMessage(visionMessage) || "DeepSeek Vision 未返回可用图片描述。";
\treturn crawshrimpTextOnlyOptionsFromVision(options, visionText, targetIndex);
}
`,
    'llm-pi-ai DeepSeek latest image-turn bridge upgrade',
  )
  return { source, patched: true }
}

function patchPiAiDeepSeekMultimodalFallback(runtimeRoot) {
  const piAiDeepSeekMultimodalFallbackEntry = join(
    resolve(runtimeRoot),
    'node_modules',
    '@deepseek-ai',
    'dsh-llm-pi-ai',
    'lib',
    'index.js',
  )
  let source = readFileSync(piAiDeepSeekMultimodalFallbackEntry, 'utf8')
  if (source.includes(DEEPSEEK_MULTIMODAL_FALLBACK_PATCH_MARKER)) {
    const audit = patchPiAiDeepSeekVisionAudit(source)
    const guard = patchPiAiDeepSeekVisionReasoningGuard(audit.source)
    if (audit.patched || guard.patched) {
      writeFileSync(piAiDeepSeekMultimodalFallbackEntry, guard.source, 'utf8')
      return { patched: true, piAiDeepSeekMultimodalFallbackEntry }
    }
    return { patched: false, piAiDeepSeekMultimodalFallbackEntry }
  }
  if (source.includes(OLD_DEEPSEEK_MULTIMODAL_FALLBACK_PATCH_MARKER)) {
    const upgrade = patchPiAiDeepSeekLatestImageTurnBridge(source)
    const audit = patchPiAiDeepSeekVisionAudit(upgrade.source)
    const guard = patchPiAiDeepSeekVisionReasoningGuard(audit.source)
    if (upgrade.patched || audit.patched || guard.patched) {
      writeFileSync(piAiDeepSeekMultimodalFallbackEntry, guard.source, 'utf8')
      return { patched: true, piAiDeepSeekMultimodalFallbackEntry }
    }
    return { patched: false, piAiDeepSeekMultimodalFallbackEntry }
  }

  source = replaceExact(
    source,
    'function toPiContext(options, attachments, onReplayDegrade, maxRequestImageBytes) {\n\treturn attachments === void 0 ? textOnlyContext(options, onReplayDegrade) : toPiContextWithImages(options, attachments, onReplayDegrade, maxRequestImageBytes);\n}',
    `function toPiContext(options, attachments, onReplayDegrade, maxRequestImageBytes) {
\treturn attachments === void 0 ? textOnlyContext(options, onReplayDegrade) : toPiContextWithImages(options, attachments, onReplayDegrade, maxRequestImageBytes);
}
const CRAWSHRIMP_DEEPSEEK_OFFICIAL_PROVIDER = "crawshrimp-deepseek-official";
const CRAWSHRIMP_DEEPSEEK_VISION_MODEL = "deepseek-v4-flash-vision-exp";
function crawshrimpDeepSeekTextModelCanUseVisionBridge(provider, model) {
\treturn provider === CRAWSHRIMP_DEEPSEEK_OFFICIAL_PROVIDER && (model === "deepseek-v4-flash" || model === "deepseek-v4-pro");
}
function crawshrimpTextFromPiMessage(message) {
\treturn message.content.filter((block) => block.type === "text").map((block) => block.text).join("").trim();
}
function crawshrimpContentWithoutImages(blocks, replacementText) {
\tconst content = [];
\tfor (const block of blocks) {
\t\tif (block.type === "image") {
\t\t\tif (replacementText) content.push({ type: "text", text: replacementText });
\t\t\tcontinue;
\t\t}
\t\tif (block.type === "tool-result") {
\t\t\tcontent.push({
\t\t\t\t...block,
\t\t\t\tcontent: crawshrimpContentWithoutImages(block.content, replacementText)
\t\t\t});
\t\t\tcontinue;
\t\t}
\t\tcontent.push(block);
\t}
\treturn content;
}
function crawshrimpContentWithVisionForLatestImage(blocks, visionText) {
\tconst content = [];
\tlet injected = false;
\tfor (const block of blocks) {
\t\tif (block.type === "image") {
\t\t\tcontent.push({
\t\t\t\ttype: "text",
\t\t\t\ttext: injected ? "\\n[同一轮其余图片已在上方 DeepSeek Vision 识别结果中归纳]\\n" : "\\n\\n[DeepSeek Vision 识别结果]\\n" + visionText + "\\n\\n[兼容说明]\\n原始图片已经由 DeepSeek Vision 转写成以上文字；当前 DeepSeek 文本模型应直接基于这些文字继续回答，不要因为原始会话含图而要求用户切换到视觉模型。\\n\\n"
\t\t\t});
\t\t\tinjected = true;
\t\t\tcontinue;
\t\t}
\t\tif (block.type === "tool-result") {
\t\t\tconst nested = crawshrimpContentWithVisionForLatestImage(block.content, visionText);
\t\t\tcontent.push({
\t\t\t\t...block,
\t\t\t\tcontent: nested.content
\t\t\t});
\t\t\tinjected = injected || nested.injected;
\t\t\tcontinue;
\t\t}
\t\tcontent.push(block);
\t}
\treturn { content, injected };
}
function crawshrimpLatestImageUserMessageIndex(messages) {
\tfor (let index = messages.length - 1; index >= 0; index--) {
\t\tconst message = messages[index];
\t\tif (message.role === "user" && contentHasImage(message.content)) return index;
\t}
\treturn -1;
}
function crawshrimpVisionOptionsForMessage(options, targetIndex) {
\tconst target = options.messages[targetIndex];
\tif (target === void 0) return void 0;
\treturn {
\t\t...options,
\t\tmessages: [{ ...target, timestamp: 0 }],
\t\ttools: void 0
\t};
}
function crawshrimpTextOnlyOptionsFromVision(options, visionText, targetIndex) {
\tlet injected = false;
\tconst messages = options.messages.map((message, index) => {
\t\tif (!contentHasImage(message.content)) return message;
\t\tif (index === targetIndex) {
\t\t\tconst result = crawshrimpContentWithVisionForLatestImage(message.content, visionText);
\t\t\tinjected = injected || result.injected;
\t\t\treturn { ...message, content: result.content };
\t\t}
\t\treturn {
\t\t\t...message,
\t\t\tcontent: crawshrimpContentWithoutImages(message.content, "\\n[历史图片已省略，避免与本轮图片识别混淆]\\n")
\t\t};
\t});
\tif (!injected) messages.push({
\t\trole: "user",
\t\tcontent: [{ type: "text", text: "[DeepSeek Vision 识别结果]\\n" + visionText + "\\n\\n[兼容说明]\\n原始图片已经由 DeepSeek Vision 转写成以上文字；当前 DeepSeek 文本模型应直接基于这些文字继续回答，不要因为原始会话含图而要求用户切换到视觉模型。\\n" }],
\t\ttimestamp: 0
\t});
\treturn { ...options, messages };
}
async function crawshrimpBridgeDeepSeekImages(snapshot, profile, options, apiKey, upstream, onReplayDegrade) {
\t// ${DEEPSEEK_MULTIMODAL_FALLBACK_PATCH_MARKER}: let DeepSeek text models consume image sessions via the official vision model first.
\tif (!crawshrimpDeepSeekTextModelCanUseVisionBridge(options.provider, options.model)) return void 0;
\tconst attachments = this.config.resolveAttachments?.();
\tif (attachments === void 0) return void 0;
\tconst targetIndex = crawshrimpLatestImageUserMessageIndex(options.messages);
\tconst visionOptions = targetIndex < 0 ? void 0 : crawshrimpVisionOptionsForMessage(options, targetIndex);
\tif (visionOptions === void 0) return void 0;
\tconst visionModel = snapshot.models.getModel(options.provider, CRAWSHRIMP_DEEPSEEK_VISION_MODEL);
\tif (visionModel === void 0 || !visionModel.input.includes("image")) return void 0;
\tconst visionSystem = [
\t\toptions.system,
\t\t"你是抓虾 Harness 的图片识别前置模型。请只识别最新一条用户消息里的图片，并转写成准确、可供后续 DeepSeek 文本模型继续处理的中文描述。不要引用、比较或描述历史图片。保留界面文字、数字、按钮、错误码、商品/页面结构、用户可能关心的关键事实；不要执行任务，不要给操作建议。"
\t].filter((part) => typeof part === "string" && part.trim()).join("\\n\\n");
\tconst visionContext = await toPiContext({
\t\t...visionOptions,
\t\t...visionSystem ? { system: visionSystem } : {},
\t\ttools: void 0
\t}, attachments, onReplayDegrade, profile.maxRequestImageBytes);
\tconst visionMessage = await snapshot.models.completeSimple(visionModel, visionContext, {
\t\t...profileOptions(profile, void 0, apiKey),
\t\tmaxTokens: 2048,
\t\t...options.sessionId === void 0 ? {} : { sessionId: \`\${options.sessionId}:vision\` },
\t\tsignal: upstream,
\t\theaders: requestHeaders(profile.headers)
\t});
\tif (visionMessage.stopReason === "error") throw new LlmError(\`DeepSeek vision preflight failed: \${visionMessage.errorMessage ?? "unknown error"}\`, "UNSUPPORTED_CONTENT");
\tconst visionText = crawshrimpTextFromPiMessage(visionMessage) || "DeepSeek Vision 未返回可用图片描述。";
\treturn crawshrimpTextOnlyOptionsFromVision(options, visionText, targetIndex);
}`,
    'llm-pi-ai DeepSeek multimodal fallback helpers',
  )
  source = replaceExact(
    source,
    '\t\t\t\tconst containsImage = options.messages.some((message) => contentHasImage(message.content));\n\t\t\t\tif (containsImage && !model.input.includes("image")) throw new LlmError(`pi-ai model "${model.id}" does not support image input`, "UNSUPPORTED_CONTENT");\n\t\t\t\tconst attachments = containsImage ? this.config.resolveAttachments?.() : void 0;\n\t\t\t\tif (containsImage && attachments === void 0) throw new LlmError("pi-ai image input requires the durable attachment service", "UNSUPPORTED_CONTENT");\n\t\t\t\tconst onReplayDegrade = (reason) => {\n\t\t\t\t\tthis.config.onReplayDegrade?.({\n\t\t\t\t\t\tprovider: options.provider,\n\t\t\t\t\t\tmodel: options.model,\n\t\t\t\t\t\treason\n\t\t\t\t\t});\n\t\t\t\t};',
    '\t\t\t\tconst onReplayDegrade = (reason) => {\n\t\t\t\t\tthis.config.onReplayDegrade?.({\n\t\t\t\t\t\tprovider: options.provider,\n\t\t\t\t\t\tmodel: options.model,\n\t\t\t\t\t\treason\n\t\t\t\t\t});\n\t\t\t\t};\n\t\t\t\tconst containsImage = options.messages.some((message) => contentHasImage(message.content));\n\t\t\t\tlet requestOptions = options;\n\t\t\t\tif (containsImage && !model.input.includes("image")) {\n\t\t\t\t\trequestOptions = await crawshrimpBridgeDeepSeekImages.call(this, snapshot, profile, options, apiKey, watchdog.signal, onReplayDegrade) ?? options;\n\t\t\t\t\tif (requestOptions === options) throw new LlmError(`pi-ai model "${model.id}" does not support image input`, "UNSUPPORTED_CONTENT");\n\t\t\t\t}\n\t\t\t\tconst requestContainsImage = requestOptions.messages.some((message) => contentHasImage(message.content));\n\t\t\t\tconst attachments = requestContainsImage ? this.config.resolveAttachments?.() : void 0;\n\t\t\t\tif (requestContainsImage && attachments === void 0) throw new LlmError("pi-ai image input requires the durable attachment service", "UNSUPPORTED_CONTENT");',
    'llm-pi-ai DeepSeek image bridge dispatch',
  )
  source = replaceExact(
    source,
    '\t\t\t\tconst context = attachments === void 0 ? toPiContext(options, void 0, onReplayDegrade) : await toPiContext(options, attachments, onReplayDegrade, profile.maxRequestImageBytes);\n\t\t\t\tconst iterator = toStreamChunks(snapshot.models.streamSimple(model, context, {\n\t\t\t\t\t...profileOptions(profile, reasoning, apiKey),\n\t\t\t\t\t...options.temperature === void 0 ? {} : { temperature: options.temperature },\n\t\t\t\t\t...options.maxTokens === void 0 ? {} : { maxTokens: options.maxTokens },\n\t\t\t\t\t...options.sessionId === void 0 ? {} : { sessionId: String(options.sessionId) },\n\t\t\t\t\tsignal: watchdog.signal,\n\t\t\t\t\theaders: requestHeaders(profile.headers)\n\t\t\t\t}), model.contextWindow)[Symbol.asyncIterator]();',
    '\t\t\t\tconst context = attachments === void 0 ? toPiContext(requestOptions, void 0, onReplayDegrade) : await toPiContext(requestOptions, attachments, onReplayDegrade, profile.maxRequestImageBytes);\n\t\t\t\tconst iterator = toStreamChunks(snapshot.models.streamSimple(model, context, {\n\t\t\t\t\t...profileOptions(profile, reasoning, apiKey),\n\t\t\t\t\t...requestOptions.temperature === void 0 ? {} : { temperature: requestOptions.temperature },\n\t\t\t\t\t...requestOptions.maxTokens === void 0 ? {} : { maxTokens: requestOptions.maxTokens },\n\t\t\t\t\t...requestOptions.sessionId === void 0 ? {} : { sessionId: String(requestOptions.sessionId) },\n\t\t\t\t\tsignal: watchdog.signal,\n\t\t\t\t\theaders: requestHeaders(profile.headers)\n\t\t\t\t}), model.contextWindow)[Symbol.asyncIterator]();',
    'llm-pi-ai DeepSeek bridged context use',
  )
  source = patchPiAiDeepSeekVisionAudit(source).source
  source = patchPiAiDeepSeekVisionReasoningGuard(source).source
  writeFileSync(piAiDeepSeekMultimodalFallbackEntry, source, 'utf8')
  return { patched: true, piAiDeepSeekMultimodalFallbackEntry }
}

function patchPiAiDeepSeekVisionReasoningGuard(source) {
  if (source.includes(DEEPSEEK_VISION_REASONING_GUARD_PATCH_MARKER)) {
    return { source, patched: false }
  }
  source = replaceExact(
    source,
    'function resolveReasoningLevel(model, effort) {\n\tif (effort === void 0) return void 0;\n\tif (getSupportedThinkingLevels(model).some((level) => level === effort)) return effort;\n\tthrow new LlmError(`pi-ai provider "${model.provider}" model "${model.id}" does not support reasoning effort "${effort}"`, "UNSUPPORTED_REASONING_EFFORT");\n}',
    `function resolveReasoningLevel(model, effort) {
\tif (effort === void 0) return void 0;
\tif (getSupportedThinkingLevels(model).some((level) => level === effort)) return effort;
\tthrow new LlmError(\`pi-ai provider "\${model.provider}" model "\${model.id}" does not support reasoning effort "\${effort}"\`, "UNSUPPORTED_REASONING_EFFORT");
}
function crawshrimpReasoningEffortForModel(model, effort) {
\t// ${DEEPSEEK_VISION_REASONING_GUARD_PATCH_MARKER}: the official DeepSeek provider mixes text reasoning models with the same-key vision model.
\tif (model.provider === CRAWSHRIMP_DEEPSEEK_OFFICIAL_PROVIDER && model.id === CRAWSHRIMP_DEEPSEEK_VISION_MODEL && effort !== void 0 && !getSupportedThinkingLevels(model).includes(effort)) return void 0;
\treturn effort;
}`,
    'llm-pi-ai DeepSeek vision reasoning guard helper',
  )
  source = replaceExact(
    source,
    'const reasoning = resolveReasoningLevel(model, options.reasoningEffort ?? profile.reasoning);',
    'const reasoning = resolveReasoningLevel(model, crawshrimpReasoningEffortForModel(model, options.reasoningEffort ?? profile.reasoning));',
    'llm-pi-ai DeepSeek vision reasoning guard dispatch',
  )
  return { source, patched: true }
}

function patchPiAiDeepSeekVisionAudit(source) {
  const hasAuditLogger = source.includes('onVisionPreflight: ({ provider, model, visionModel, sessionId }) =>')
  if (source.includes(DEEPSEEK_MULTIMODAL_AUDIT_PATCH_MARKER)) {
    if (!hasAuditLogger) {
      source = replaceExact(
        source,
        '\t\tresolveAttachments: () => ctx.get("attachments"),\n\t\tonReplayDegrade: ({ provider, model, reason }) => {',
        `\t\tresolveAttachments: () => ctx.get("attachments"),
\t\tonVisionPreflight: ({ provider, model, visionModel, sessionId }) => {
\t\t\tconst record = {
\t\t\t\tevent: "deepseek_vision_preflight",
\t\t\t\tvision_preflight: true,
\t\t\t\tprovider,
\t\t\t\tmodel,
\t\t\t\toriginal_model: model,
\t\t\t\tvision_model: visionModel,
\t\t\t\tsession_id: sessionId ?? null
\t\t\t};
\t\t\tctx.logger.info("crawshrimp.audit " + JSON.stringify(record));
\t\t\tprocess.stderr.write("crawshrimp.audit " + JSON.stringify(record) + "\\n");
\t\t},
\t\tonReplayDegrade: ({ provider, model, reason }) => {`,
        'llm-pi-ai DeepSeek vision preflight audit logger',
      )
      return { source, patched: true }
    }
    return { source, patched: false }
  }
  if (source.includes(OLD_DEEPSEEK_MULTIMODAL_AUDIT_PATCH_MARKER)) {
    source = replaceExact(
      source,
      OLD_DEEPSEEK_MULTIMODAL_AUDIT_PATCH_MARKER,
      DEEPSEEK_MULTIMODAL_AUDIT_PATCH_MARKER,
      'llm-pi-ai DeepSeek vision preflight audit marker upgrade',
    )
    source = replaceExact(
      source,
      '\t\t\tctx.logger.info("crawshrimp.audit " + JSON.stringify(record));',
      '\t\t\tctx.logger.info("crawshrimp.audit " + JSON.stringify(record));\n\t\t\tprocess.stderr.write("crawshrimp.audit " + JSON.stringify(record) + "\\n");',
      'llm-pi-ai DeepSeek vision preflight stderr audit upgrade',
    )
    return { source, patched: true }
  }
  source = replaceExact(
    source,
    '\tif (visionModel === void 0 || !visionModel.input.includes("image")) return void 0;\n\tconst visionSystem = [',
    `\tif (visionModel === void 0 || !visionModel.input.includes("image")) return void 0;
\tthis.config.onVisionPreflight?.({
\t\t/* ${DEEPSEEK_MULTIMODAL_AUDIT_PATCH_MARKER}: structured local audit for image-only DeepSeek vision preflight. */
\t\tvision_preflight: true,
\t\tprovider: options.provider,
\t\tmodel: options.model,
\t\tvisionModel: CRAWSHRIMP_DEEPSEEK_VISION_MODEL,
\t\tsessionId: options.sessionId === void 0 ? void 0 : String(options.sessionId)
\t});
\tconst visionSystem = [`,
    'llm-pi-ai DeepSeek vision preflight audit emit',
  )
  if (!hasAuditLogger) {
    source = replaceExact(
      source,
      '\t\tresolveAttachments: () => ctx.get("attachments"),\n\t\tonReplayDegrade: ({ provider, model, reason }) => {',
      `\t\tresolveAttachments: () => ctx.get("attachments"),
\t\tonVisionPreflight: ({ provider, model, visionModel, sessionId }) => {
\t\t\tconst record = {
\t\t\t\tevent: "deepseek_vision_preflight",
\t\t\t\tvision_preflight: true,
\t\t\t\tprovider,
\t\t\t\tmodel,
\t\t\t\toriginal_model: model,
\t\t\t\tvision_model: visionModel,
\t\t\t\tsession_id: sessionId ?? null
\t\t\t};
\t\t\tctx.logger.info("crawshrimp.audit " + JSON.stringify(record));
\t\t\tprocess.stderr.write("crawshrimp.audit " + JSON.stringify(record) + "\\n");
\t\t},
\t\tonReplayDegrade: ({ provider, model, reason }) => {`,
      'llm-pi-ai DeepSeek vision preflight audit logger',
    )
  }
  return { source, patched: true }
}

function patchHostApiProxyDeepSeekImageSelection(runtimeRoot) {
  const indexEntries = deepseekPackageEntryPaths(runtimeRoot, 'dsh-host-apiproxy', 'lib', 'index.js')
  const typedEntries = deepseekPackageEntryPaths(runtimeRoot, 'dsh-host-apiproxy', 'lib', 'types', 'api-proxy.js')
  let patched = false

  for (const entry of indexEntries) {
    let source = readFileSync(entry, 'utf8')
    if (source.includes(HOST_APIPROXY_DEEPSEEK_IMAGE_SELECTION_PATCH_MARKER)) continue
    source = replaceExact(
      source,
      'function messagesHaveImage(messages) {\n\treturn messages.some((message) => contentHasImage(message.content));\n}',
      `function messagesHaveImage(messages) {
\treturn messages.some((message) => contentHasImage(message.content));
}
// ${HOST_APIPROXY_DEEPSEEK_IMAGE_SELECTION_PATCH_MARKER}: DeepSeek official text models are image-compatible through Crawshrimp's vision preflight.
function crawshrimpDeepSeekTextModelCanUseVisionBridge(provider, model) {
\treturn provider === "crawshrimp-deepseek-official" && (model === "deepseek-v4-flash" || model === "deepseek-v4-pro");
}`,
      'host-apiproxy DeepSeek image selection helper',
    )
    source = replaceExact(
      source,
      'if (info.inputModalities !== void 0 && !info.inputModalities.includes("image")) return err(request, {\n\t\t\t\t\t\t\t\tcode: "model-unavailable",\n\t\t\t\t\t\t\t\tmessage: `Model "${resolved.model}" does not accept image input, but this session already contains images; select an image-capable model.`,',
      'if (info.inputModalities !== void 0 && !info.inputModalities.includes("image") && !crawshrimpDeepSeekTextModelCanUseVisionBridge(resolved.provider, resolved.model)) return err(request, {\n\t\t\t\t\t\t\t\tcode: "model-unavailable",\n\t\t\t\t\t\t\t\tmessage: `Model "${resolved.model}" does not accept image input, but this session already contains images; select an image-capable model.`,',
      'host-apiproxy DeepSeek model switch image allowance',
    )
    source = replaceExact(
      source,
      'if (modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image")) return err(request, {\n\t\t\t\t\t\t\t\tcode: "attachment-error",\n\t\t\t\t\t\t\t\tmessage: `Model "${current.model}" does not support image input.`,\n\t\t\t\t\t\t\t\tdetails: { reason: "MODEL_DOES_NOT_SUPPORT_IMAGES" }\n\t\t\t\t\t\t\t});',
      'if (modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image") && !crawshrimpDeepSeekTextModelCanUseVisionBridge(current.provider, current.model)) return err(request, {\n\t\t\t\t\t\t\t\tcode: "attachment-error",\n\t\t\t\t\t\t\t\tmessage: `Model "${current.model}" does not support image input.`,\n\t\t\t\t\t\t\t\tdetails: { reason: "MODEL_DOES_NOT_SUPPORT_IMAGES" }\n\t\t\t\t\t\t\t});',
      'host-apiproxy DeepSeek prompt image allowance',
    )
    writeFileSync(entry, source, 'utf8')
    patched = true
  }

  for (const entry of typedEntries) {
    let typedSource = readFileSync(entry, 'utf8')
    if (typedSource.includes(HOST_APIPROXY_DEEPSEEK_IMAGE_SELECTION_PATCH_MARKER)) continue
    typedSource = replaceExact(
      typedSource,
      'function messagesHaveImage(messages) {\n    return messages.some(message => contentHasImage(message.content));\n}',
      `function messagesHaveImage(messages) {
    return messages.some(message => contentHasImage(message.content));
}
// ${HOST_APIPROXY_DEEPSEEK_IMAGE_SELECTION_PATCH_MARKER}: DeepSeek official text models are image-compatible through Crawshrimp's vision preflight.
function crawshrimpDeepSeekTextModelCanUseVisionBridge(provider, model) {
    return provider === 'crawshrimp-deepseek-official' && (model === 'deepseek-v4-flash' || model === 'deepseek-v4-pro');
}`,
      'host-apiproxy typed DeepSeek image selection helper',
    )
    typedSource = replaceExact(
      typedSource,
      "if (info.inputModalities !== undefined && !info.inputModalities.includes('image')) {",
      "if (info.inputModalities !== undefined && !info.inputModalities.includes('image') && !crawshrimpDeepSeekTextModelCanUseVisionBridge(resolved.provider, resolved.model)) {",
      'host-apiproxy typed DeepSeek model switch image allowance',
    )
    typedSource = replaceExact(
      typedSource,
      "if (modelInfo.inputModalities !== undefined && !modelInfo.inputModalities.includes('image')) {",
      "if (modelInfo.inputModalities !== undefined && !modelInfo.inputModalities.includes('image') && !crawshrimpDeepSeekTextModelCanUseVisionBridge(current.provider, current.model)) {",
      'host-apiproxy typed DeepSeek prompt image allowance',
    )
    writeFileSync(entry, typedSource, 'utf8')
    patched = true
  }
  return { patched, hostApiProxyDeepSeekImageSelectionEntry: [...indexEntries, ...typedEntries].join(',') }
}

function patchSdkJsonrpcImageAdmission(runtimeRoot) {
  const sdkJsonrpcImageAdmissionEntry = join(
    resolve(runtimeRoot),
    'node_modules',
    '@deepseek-ai',
    'dsh-sdk-jsonrpc-server',
    'lib',
    'index.js',
  )
  let source = readFileSync(sdkJsonrpcImageAdmissionEntry, 'utf8')
  if (source.includes(SDK_JSONRPC_IMAGE_ADMISSION_PATCH_MARKER)) {
    return { patched: false, sdkJsonrpcImageAdmissionEntry }
  }
  if (source.includes(OLD_SDK_JSONRPC_IMAGE_ADMISSION_PATCH_MARKER)) {
    source = replaceExact(
      source,
      OLD_SDK_JSONRPC_IMAGE_ADMISSION_PATCH_MARKER,
      SDK_JSONRPC_IMAGE_ADMISSION_PATCH_MARKER,
      'sdk-jsonrpc image admission marker upgrade',
    )
    source = replaceExact(
      source,
      '\tconst attachments = ctx.attachments;',
      '\tconst attachments = ctx.get("attachments");',
      'sdk-jsonrpc optional attachment lookup',
    )
    writeFileSync(sdkJsonrpcImageAdmissionEntry, source, 'utf8')
    return { patched: true, sdkJsonrpcImageAdmissionEntry }
  }

  source = replaceExact(
    source,
    'import { createUserMessage } from "@deepseek-ai/dsh-llm";',
    'import { createUserMessage } from "@deepseek-ai/dsh-llm";\nimport { admitEncodedImages } from "@deepseek-ai/dsh-attachment";',
    'sdk-jsonrpc image admission import',
  )
  source = replaceExact(
    source,
    'function successStatus(reason, options) {\n\tif (reason === "completed") return "ok";\n\treturn reason === "max-tokens" && options.maxTokensAsSuccess === true ? "ok" : "error";\n}',
    `function successStatus(reason, options) {
\tif (reason === "completed") return "ok";
\treturn reason === "max-tokens" && options.maxTokensAsSuccess === true ? "ok" : "error";
}
// ${SDK_JSONRPC_IMAGE_ADMISSION_PATCH_MARKER}: mirror host-api image admission for SDK prompts.
async function durableSdkPromptContent(ctx, content) {
\tif (content.every((part) => part.type === "text")) return content.map((part) => ({
\t\ttype: "text",
\t\ttext: part.text
\t}));
\tconst attachments = ctx.get("attachments");
\tif (attachments === void 0) throw new Error("image attachments are unavailable in this SDK runtime");
\tconst refs = await admitEncodedImages(attachments, content.filter((part) => part.type === "image"));
\tlet next = 0;
\treturn content.map((part) => part.type === "text" ? {
\t\ttype: "text",
\t\ttext: part.text
\t} : {
\t\ttype: "image",
\t\tattachment: refs[next++]
\t});
}`,
    'sdk-jsonrpc durable prompt content helper',
  )
  source = replaceExact(
    source,
    '\t\tconst message = createUserMessage({\n\t\t\tcontent: params.contentBlocks,\n\t\t\tsource: { kind: "user" }\n\t\t});',
    '\t\tconst message = createUserMessage({\n\t\t\tcontent: await durableSdkPromptContent(this.ctx, params.contentBlocks),\n\t\t\tsource: { kind: "user" }\n\t\t});',
    'sdk-jsonrpc prompt image admission',
  )
  writeFileSync(sdkJsonrpcImageAdmissionEntry, source, 'utf8')
  return { patched: true, sdkJsonrpcImageAdmissionEntry }
}

function replaceExact(source, needle, replacement, label) {
  const first = source.indexOf(needle)
  if (first < 0) throw new Error(`cannot patch ${label}: expected source not found`)
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`cannot patch ${label}: expected source is ambiguous`)
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length)
}

function replaceRange(source, startNeedle, endNeedle, replacement, label) {
  const first = source.indexOf(startNeedle)
  if (first < 0) throw new Error(`cannot patch ${label}: expected start not found`)
  const end = source.indexOf(endNeedle, first + startNeedle.length)
  if (end < 0) throw new Error(`cannot patch ${label}: expected end not found`)
  if (source.indexOf(startNeedle, first + startNeedle.length) >= 0) {
    throw new Error(`cannot patch ${label}: expected start is ambiguous`)
  }
  return source.slice(0, first) + replacement + source.slice(end)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath && invokedPath === resolve(fileURLToPath(import.meta.url))) {
  const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const result = patchRuntimeDependencies(process.argv[2] || defaultRoot)
  console.log(`[patch-runtime-dependencies] workspace access probe ${result.workspacePatched ? 'applied' : 'already present'}`)
  console.log(`[patch-runtime-dependencies] welcome notice removal ${result.welcomeNoticePatched ? 'applied' : 'already present'}`)
  console.log(`[patch-runtime-dependencies] pi-ai provider order ${result.piAiProviderOrderPatched ? 'applied' : 'already present'}`)
  console.log(`[patch-runtime-dependencies] sdk-jsonrpc image admission ${result.sdkJsonrpcImageAdmissionPatched ? 'applied' : 'already present'}`)
  console.log(`[patch-runtime-dependencies] pi-ai DeepSeek multimodal fallback ${result.piAiDeepSeekMultimodalFallbackPatched ? 'applied' : 'already present'}`)
  console.log(`[patch-runtime-dependencies] host-apiproxy DeepSeek image selection ${result.hostApiProxyDeepSeekImageSelectionPatched ? 'applied' : 'already present'}`)
}
