import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKSPACE_ACCESS_PROBE_MARKER = 'crawshrimp-workspace-access-probe-v1'
const WELCOME_NOTICE_PATCH_MARKER = 'crawshrimp-disable-dsh-welcome-notice-v1'
const LLM_PI_AI_PROVIDER_ORDER_PATCH_MARKER = 'crawshrimp-llm-pi-ai-provider-order-v1'
const OLD_SDK_JSONRPC_IMAGE_ADMISSION_PATCH_MARKER = 'crawshrimp-sdk-jsonrpc-image-admission-v1'
const SDK_JSONRPC_IMAGE_ADMISSION_PATCH_MARKER = 'crawshrimp-sdk-jsonrpc-image-admission-v2'
const SDK_JSONRPC_CANCEL_PATCH_MARKER = 'crawshrimp-sdk-jsonrpc-cancel-v1'
const SDK_JSONRPC_INTERNAL_PROMPT_PATCH_MARKER = 'crawshrimp-sdk-jsonrpc-internal-prompt-v1'
const OLD_DEEPSEEK_MULTIMODAL_FALLBACK_PATCH_MARKER = 'crawshrimp-deepseek-multimodal-fallback-v1'
const DEEPSEEK_MULTIMODAL_FALLBACK_PATCH_MARKER = 'crawshrimp-deepseek-multimodal-fallback-v2'
const OLD_DEEPSEEK_MULTIMODAL_AUDIT_PATCH_MARKER = 'crawshrimp-deepseek-multimodal-audit-v1'
const DEEPSEEK_MULTIMODAL_AUDIT_PATCH_MARKER = 'crawshrimp-deepseek-multimodal-audit-v2'
const DEEPSEEK_VISION_REASONING_GUARD_PATCH_MARKER = 'crawshrimp-deepseek-vision-reasoning-guard-v1'
const HOST_APIPROXY_DEEPSEEK_IMAGE_SELECTION_PATCH_MARKER = 'crawshrimp-host-apiproxy-deepseek-image-selection-v1'
const DSH_IM_NATURAL_CONTROLS_PATCH_MARKER = 'crawshrimp-dsh-im-natural-controls-v1'
const DSH_IM_NATURAL_MODEL_ALIASES_PATCH_MARKER = 'crawshrimp-dsh-im-natural-model-aliases-v1'
const DSH_IM_MODEL_CATALOG_PATCH_MARKER = 'crawshrimp-dsh-im-model-catalog-v1'
const DSH_IM_LOCAL_MODEL_SELECT_PATCH_MARKER = 'crawshrimp-dsh-im-local-model-select-v1'
const DSH_IM_SESSION_PERMISSION_API_PATCH_MARKER = 'crawshrimp-dsh-im-session-permission-api-v1'
const DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER = 'crawshrimp-dsh-im-approval-allow-all-v1'
const DSH_IM_APPROVAL_BRIEF_CARD_PATCH_MARKER = 'crawshrimp-dsh-im-approval-brief-card-v1'
const DSH_APPROVAL_ALLOW_ALL_PATCH_MARKER = 'crawshrimp-dsh-approval-allow-all-v1'
const APPROVAL_DISPLAY_ARGUMENTS_PATCH_MARKER = 'crawshrimp-approval-display-arguments-v1'
const APPROVAL_DISPLAY_ARGUMENTS_TRUNCATION_PATCH_MARKER = 'crawshrimp-approval-display-arguments-v2'
const APPROVAL_DISPLAY_ARGUMENTS_MISMATCH_PATCH_MARKER = 'crawshrimp-approval-display-arguments-v3'

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

function xmanruiPackageEntryPaths(runtimeRoot, packageName, ...segments) {
  const root = resolve(runtimeRoot)
  const candidates = [join(root, 'node_modules', '@xmanrui', packageName)]
  const pnpmRoot = join(root, 'node_modules', '.pnpm')
  if (existsSync(pnpmRoot)) {
    for (const entry of readdirSync(pnpmRoot)) {
      if (entry.startsWith(`@xmanrui+${packageName}@`)) {
        candidates.push(join(pnpmRoot, entry, 'node_modules', '@xmanrui', packageName))
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
  const sdkJsonrpcCancelResult = patchSdkJsonrpcCancel(runtimeRoot)
  const sdkJsonrpcInternalPromptResult = patchSdkJsonrpcInternalPrompt(runtimeRoot)
  const piAiDeepSeekMultimodalFallbackResult = patchPiAiDeepSeekMultimodalFallback(runtimeRoot)
  const hostApiProxyDeepSeekImageSelectionResult = patchHostApiProxyDeepSeekImageSelection(runtimeRoot)
  const approvalDisplayArgumentsResult = patchApprovalDisplayArguments(runtimeRoot)
  const dshApprovalAllowAllResult = patchDshApprovalAllowAll(runtimeRoot)
  const dshImNaturalControlsResult = patchDshImNaturalControls(runtimeRoot)
  return {
    patched: workspaceResult.patched || welcomeNoticeResult.patched || piAiProviderOrderResult.patched || sdkJsonrpcImageAdmissionResult.patched || sdkJsonrpcCancelResult.patched || sdkJsonrpcInternalPromptResult.patched || piAiDeepSeekMultimodalFallbackResult.patched || hostApiProxyDeepSeekImageSelectionResult.patched || approvalDisplayArgumentsResult.patched || dshApprovalAllowAllResult.patched || dshImNaturalControlsResult.patched,
    workspaceEntry: workspaceResult.workspaceEntry,
    welcomeNoticeEntry: welcomeNoticeResult.welcomeNoticeEntry,
    piAiProviderOrderEntry: piAiProviderOrderResult.piAiProviderOrderEntry,
    sdkJsonrpcImageAdmissionEntry: sdkJsonrpcImageAdmissionResult.sdkJsonrpcImageAdmissionEntry,
    sdkJsonrpcCancelEntry: sdkJsonrpcCancelResult.sdkJsonrpcCancelEntry,
    sdkJsonrpcInternalPromptEntry: sdkJsonrpcInternalPromptResult.sdkJsonrpcInternalPromptEntry,
    piAiDeepSeekMultimodalFallbackEntry: piAiDeepSeekMultimodalFallbackResult.piAiDeepSeekMultimodalFallbackEntry,
    hostApiProxyDeepSeekImageSelectionEntry: hostApiProxyDeepSeekImageSelectionResult.hostApiProxyDeepSeekImageSelectionEntry,
    approvalDisplayArgumentsEntry: approvalDisplayArgumentsResult.approvalDisplayArgumentsEntry,
    dshApprovalAllowAllEntry: dshApprovalAllowAllResult.dshApprovalAllowAllEntry,
    dshImNaturalControlsEntry: dshImNaturalControlsResult.dshImNaturalControlsEntry,
    workspacePatched: workspaceResult.patched,
    welcomeNoticePatched: welcomeNoticeResult.patched,
    piAiProviderOrderPatched: piAiProviderOrderResult.patched,
    sdkJsonrpcImageAdmissionPatched: sdkJsonrpcImageAdmissionResult.patched,
    sdkJsonrpcCancelPatched: sdkJsonrpcCancelResult.patched,
    sdkJsonrpcInternalPromptPatched: sdkJsonrpcInternalPromptResult.patched,
    piAiDeepSeekMultimodalFallbackPatched: piAiDeepSeekMultimodalFallbackResult.patched,
    hostApiProxyDeepSeekImageSelectionPatched: hostApiProxyDeepSeekImageSelectionResult.patched,
    approvalDisplayArgumentsPatched: approvalDisplayArgumentsResult.patched,
    dshApprovalAllowAllPatched: dshApprovalAllowAllResult.patched,
    dshImNaturalControlsPatched: dshImNaturalControlsResult.patched,
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

function patchApprovalDisplayArguments(runtimeRoot) {
  const hostIndexEntries = deepseekPackageEntryPaths(runtimeRoot, 'dsh-host-apiproxy', 'lib', 'index.js')
  const hostTypedEntries = deepseekPackageEntryPaths(runtimeRoot, 'dsh-host-apiproxy', 'lib', 'types', 'api-proxy.js')
  const hostEventSchemaEntries = deepseekPackageEntryPaths(runtimeRoot, 'dsh-host-apiproxy', 'lib', 'types', 'api', 'events.schema.js')
  const hostEventTypeEntries = deepseekPackageEntryPaths(runtimeRoot, 'dsh-host-apiproxy', 'lib', 'types', 'api', 'events.d.ts')
  const clientConnectionEntries = deepseekPackageEntryPaths(runtimeRoot, 'dsh-client-connection', 'lib', 'client.js')
  let patched = false

  for (const entry of hostIndexEntries) {
    patched = patchFile(entry, patchHostApiProxyApprovalArgumentsIndexSource) || patched
  }
  for (const entry of hostTypedEntries) {
    patched = patchFile(entry, patchHostApiProxyApprovalArgumentsTypedSource) || patched
  }
  for (const entry of hostEventSchemaEntries) {
    patched = patchFile(entry, patchHostApiProxyApprovalArgumentsEventSchemaSource) || patched
  }
  for (const entry of hostEventTypeEntries) {
    patched = patchFile(entry, patchHostApiProxyApprovalArgumentsEventTypesSource) || patched
  }
  for (const entry of clientConnectionEntries) {
    patched = patchFile(entry, patchClientConnectionApprovalArgumentsSource) || patched
  }

  return {
    patched,
    approvalDisplayArgumentsEntry: [
      ...hostIndexEntries,
      ...hostTypedEntries,
      ...hostEventSchemaEntries,
      ...hostEventTypeEntries,
      ...clientConnectionEntries,
    ].join(','),
  }
}

function patchHostApiProxyApprovalArgumentsIndexSource(source) {
  if (!source.includes(`${APPROVAL_DISPLAY_ARGUMENTS_PATCH_MARKER}: host-apiproxy-index`)) {
    source = replaceExact(
      source,
      `function requestedFrame(pending) {
\treturn {
\t\trpcId: pending.rpcId,
\t\tpayload: {
\t\t\ttype: "approval/requested",
\t\t\tsessionId: pending.sessionId,
\t\t\tapprovalId: pending.approvalId,
\t\t\ttoolName: pending.toolName,
\t\t\t...pending.callId === void 0 ? {} : { callId: pending.callId },
\t\t\t...pending.reason === void 0 ? {} : { reason: pending.reason }
\t\t}
\t};
}`,
      `// ${APPROVAL_DISPLAY_ARGUMENTS_PATCH_MARKER}: host-apiproxy-index keeps display-only approval args on live IM frames.
function requestedFrame(pending) {
\treturn {
\t\trpcId: pending.rpcId,
\t\tpayload: {
\t\t\ttype: "approval/requested",
\t\t\tsessionId: pending.sessionId,
\t\t\tapprovalId: pending.approvalId,
\t\t\ttoolName: pending.toolName,
\t\t\t...pending.callId === void 0 ? {} : { callId: pending.callId },
\t\t\t...pending.reason === void 0 ? {} : { reason: pending.reason },
\t\t\t...pending.arguments === void 0 ? {} : { arguments: pending.arguments }
\t\t}
\t};
}`,
      'host-apiproxy approval requested frame arguments',
    )
    source = replaceExact(
      source,
      `\t\t\t\t\ttoolName: req.toolName,
\t\t\t\t\t...req.callId === void 0 ? {} : { callId: req.callId },
\t\t\t\t\t...req.reason === void 0 ? {} : { reason: req.reason },
\t\t\t\t\tresolve: settle`,
      `\t\t\t\t\ttoolName: req.toolName,
\t\t\t\t\t...req.callId === void 0 ? {} : { callId: req.callId },
\t\t\t\t\t...req.reason === void 0 ? {} : { reason: req.reason },
\t\t\t\t\t...req.arguments === void 0 ? {} : { arguments: req.arguments },
\t\t\t\t\tresolve: settle`,
      'host-apiproxy pending approval arguments',
    )
  }
  if (!source.includes('arguments: z$1.unknown().optional()')) {
    source = replaceExact(
      source,
      `\t\ttoolName: z$1.string(),
\t\tcallId: z$1.string().optional(),
\t\treason: z$1.string().optional()
\t}),`,
      `\t\ttoolName: z$1.string(),
\t\tcallId: z$1.string().optional(),
\t\treason: z$1.string().optional(),
\t\targuments: z$1.unknown().optional()
\t}),`,
      'host-apiproxy inline event schema approval arguments',
    )
  }
  return source
}

function patchHostApiProxyApprovalArgumentsTypedSource(source) {
  if (source.includes(`${APPROVAL_DISPLAY_ARGUMENTS_PATCH_MARKER}: host-apiproxy-typed`)) return source
  source = replaceExact(
    source,
    `function requestedFrame(pending) {
    return {
        rpcId: pending.rpcId,
        payload: {
            type: 'approval/requested',
            sessionId: pending.sessionId,
            approvalId: pending.approvalId,
            toolName: pending.toolName,
            ...pending.callId === undefined ? {} : { callId: pending.callId },
            ...pending.reason === undefined ? {} : { reason: pending.reason },
        },
    };
}`,
    `// ${APPROVAL_DISPLAY_ARGUMENTS_PATCH_MARKER}: host-apiproxy-typed keeps display-only approval args on live IM frames.
function requestedFrame(pending) {
    return {
        rpcId: pending.rpcId,
        payload: {
            type: 'approval/requested',
            sessionId: pending.sessionId,
            approvalId: pending.approvalId,
            toolName: pending.toolName,
            ...pending.callId === undefined ? {} : { callId: pending.callId },
            ...pending.reason === undefined ? {} : { reason: pending.reason },
            ...pending.arguments === undefined ? {} : { arguments: pending.arguments },
        },
    };
}`,
    'typed host-apiproxy approval requested frame arguments',
  )
  return replaceExact(
    source,
    `                    toolName: req.toolName,
                    ...req.callId === undefined ? {} : { callId: req.callId },
                    ...req.reason === undefined ? {} : { reason: req.reason },
                    resolve: settle,`,
    `                    toolName: req.toolName,
                    ...req.callId === undefined ? {} : { callId: req.callId },
                    ...req.reason === undefined ? {} : { reason: req.reason },
                    ...req.arguments === undefined ? {} : { arguments: req.arguments },
                    resolve: settle,`,
    'typed host-apiproxy pending approval arguments',
  )
}

function patchHostApiProxyApprovalArgumentsEventSchemaSource(source) {
  if (source.includes(`${APPROVAL_DISPLAY_ARGUMENTS_PATCH_MARKER}: events-schema`)) return source
  source = replaceExact(
    source,
    '/** MuxFrame union (payload slot of a mux-stream ServerRequest). */',
    `/** MuxFrame union (payload slot of a mux-stream ServerRequest). */
// ${APPROVAL_DISPLAY_ARGUMENTS_PATCH_MARKER}: events-schema allows display-only approval arguments.`,
    'host-apiproxy event schema approval arguments marker',
  )
  return replaceExact(
    source,
    "z.object({ type: z.literal('approval/requested'), sessionId: sessionIdSchema, approvalId: approvalRequestIdSchema, toolName: z.string(), callId: z.string().optional(), reason: z.string().optional() })",
    "z.object({ type: z.literal('approval/requested'), sessionId: sessionIdSchema, approvalId: approvalRequestIdSchema, toolName: z.string(), callId: z.string().optional(), reason: z.string().optional(), arguments: z.unknown().optional() })",
    'host-apiproxy event schema approval arguments',
  )
}

function patchHostApiProxyApprovalArgumentsEventTypesSource(source) {
  if (source.includes('arguments?: unknown;')) return source
  return replaceExact(
    source,
    `    toolName: string;
    callId?: CallId;
    reason?: string;
} | {`,
    `    toolName: string;
    callId?: CallId;
    reason?: string;
    /** Display-only, redacted operation arguments for non-visual IM clients. */
    arguments?: unknown;
} | {`,
    'host-apiproxy event type approval arguments',
  )
}

function patchClientConnectionApprovalArgumentsSource(source) {
  if (source.includes(`${APPROVAL_DISPLAY_ARGUMENTS_PATCH_MARKER}: client-connection`)) return source
  source = replaceExact(
    source,
    '\t\t/** MuxFrame union (payload slot of a mux-stream ServerRequest). */',
    `\t\t/** MuxFrame union (payload slot of a mux-stream ServerRequest). */
\t\t// ${APPROVAL_DISPLAY_ARGUMENTS_PATCH_MARKER}: client-connection preserves display-only approval arguments.`,
    'client-connection approval arguments marker',
  )
  return replaceExact(
    source,
    `\t\t\tobject({
\t\t\t\ttype: literal("approval/requested"),
\t\t\t\tsessionId: sessionIdSchema,
\t\t\t\tapprovalId: approvalRequestIdSchema,
\t\t\t\ttoolName: string(),
\t\t\t\tcallId: string().optional(),
\t\t\t\treason: string().optional()
\t\t\t}),`,
    `\t\t\tobject({
\t\t\t\ttype: literal("approval/requested"),
\t\t\t\tsessionId: sessionIdSchema,
\t\t\t\tapprovalId: approvalRequestIdSchema,
\t\t\t\ttoolName: string(),
\t\t\t\tcallId: string().optional(),
\t\t\t\treason: string().optional(),
\t\t\t\targuments: unknown().optional()
\t\t\t}),`,
    'client-connection approval requested schema arguments',
  )
}

function patchDshApprovalAllowAll(runtimeRoot) {
  const clientEntries = deepseekPackageEntryPaths(
    runtimeRoot,
    'dsh-client-ui-conversation',
    'lib',
    'client.js',
  )
  const slotTypeEntries = deepseekPackageEntryPaths(
    runtimeRoot,
    'dsh-client-ui-conversation',
    'lib',
    'types',
    'client',
    'contract',
    'slots.d.ts',
  )
  const localeTypeEntries = deepseekPackageEntryPaths(
    runtimeRoot,
    'dsh-client-ui-conversation',
    'lib',
    'types',
    'client',
    'locales.d.ts',
  )
  let patched = false

  for (const entry of clientEntries) {
    patched = patchFile(entry, patchDshApprovalAllowAllClientSource) || patched
  }
  for (const entry of slotTypeEntries) {
    patched = patchFile(entry, patchDshApprovalAllowAllSlotTypesSource) || patched
  }
  for (const entry of localeTypeEntries) {
    patched = patchFile(entry, patchDshApprovalAllowAllLocaleTypesSource) || patched
  }

  return {
    patched,
    dshApprovalAllowAllEntry: [
      ...clientEntries,
      ...slotTypeEntries,
      ...localeTypeEntries,
    ].join(','),
  }
}

function patchDshApprovalAllowAllClientSource(source) {
  if (source.includes(DSH_APPROVAL_ALLOW_ALL_PATCH_MARKER)) return source
  source = replaceExact(
    source,
    '.bqrRRG_actionRow{justify-content:flex-end;gap:8px;padding:14px 16px;display:flex}',
    '.bqrRRG_actionRow{justify-content:flex-end;gap:8px;padding:14px 16px;display:flex;flex-wrap:wrap}',
    'approval panel action row wrapping',
  )
  source = replaceRange(
    source,
    '\t\tfunction ApprovalPanel(props) {',
    '\t\tfunction ApprovalFlow',
    `\t\t/* ${DSH_APPROVAL_ALLOW_ALL_PATCH_MARKER}: switch the current session to full access before answering the pending approval. */
\t\tfunction ApprovalPanel(props) {
\t\t\tconst approval = (0, react.useMemo)(() => new PendingApproval(props.matched), [props.matched]);
\t\t\tconst command = props.useSession((snapshot) => {
\t\t\t\tif (approval.callId === void 0) return void 0;
\t\t\t\tconst root = rootToolCall(snapshot, approval.callId);
\t\t\t\tif (root === void 0) return void 0;
\t\t\t\treturn root.callId === approval.callId && !("kind" in root) ? commandOf(root) : void 0;
\t\t\t});
\t\t\treturn (0, react_jsx_runtime.jsx)(ApprovalFlow, {
\t\t\t\tpending: approval,
\t\t\t\trunCommand: props.runCommand,
\t\t\t\tt: props.t,
\t\t\t\t...command === void 0 ? {} : { command }
\t\t\t}, approval.key);
\t\t}
`,
    'approval panel allow-all command prop',
  )
  source = replaceRange(
    source,
    '\t\tfunction ApprovalFlow({ pending, command, t }) {',
    '\t\t//#endregion',
    `\t\tfunction ApprovalFlow({ pending, command, runCommand, t }) {
\t\t\tconst [answered, setAnswered] = (0, react.useState)(false);
\t\t\tconst answer = (outcome) => {
\t\t\t\tsetAnswered(true);
\t\t\t\tpending.answer(outcome).catch(() => {
\t\t\t\t\tsetAnswered(false);
\t\t\t\t});
\t\t\t};
\t\t\tconst allowAll = () => {
\t\t\t\tif (runCommand === void 0) return;
\t\t\t\tsetAnswered(true);
\t\t\t\trunCommand("/permission danger-full-access").then((matched) => {
\t\t\t\t\tif (!matched) throw new Error("permission command unavailable");
\t\t\t\t\treturn pending.answer("allowed-once");
\t\t\t\t}).catch(() => {
\t\t\t\t\tsetAnswered(false);
\t\t\t\t});
\t\t\t};
\t\t\treturn (0, react_jsx_runtime.jsx)("div", {
\t\t\t\tclassName: ApprovalPanel_module_css_default.root,
\t\t\t\t"data-approval-key": pending.key,
\t\t\t\tchildren: (0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\tclassName: ApprovalPanel_module_css_default.card,
\t\t\t\t\tchildren: [
\t\t\t\t\t\t(0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\t\t\tclassName: ApprovalPanel_module_css_default.strip,
\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)("span", { className: ApprovalPanel_module_css_default.dot }), t("approval.waiting")]
\t\t\t\t\t\t}),
\t\t\t\t\t\t(0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\t\t\tclassName: ApprovalPanel_module_css_default.body,
\t\t\t\t\t\t\t"data-approval-scroll": "",
\t\t\t\t\t\t\ttabIndex: 0,
\t\t\t\t\t\t\trole: "group",
\t\t\t\t\t\t\t"aria-label": t("approval.detail.aria"),
\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\t\t\tclassName: ApprovalPanel_module_css_default.headline,
\t\t\t\t\t\t\t\tchildren: pending.reason ?? t("approval.escalation", { toolName: pending.toolName })
\t\t\t\t\t\t\t}), command !== void 0 && (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\t\t\tclassName: ApprovalPanel_module_css_default.command,
\t\t\t\t\t\t\t\tchildren: command
\t\t\t\t\t\t\t})]
\t\t\t\t\t\t}),
\t\t\t\t\t\t(0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\t\t\tclassName: ApprovalPanel_module_css_default.actionRow,
\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
\t\t\t\t\t\t\t\tvariant: "outline",
\t\t\t\t\t\t\t\tclassName: ApprovalPanel_module_css_default.reject,
\t\t\t\t\t\t\t\tdisabled: answered,
\t\t\t\t\t\t\t\tonClick: () => {
\t\t\t\t\t\t\t\t\tanswer("rejected");
\t\t\t\t\t\t\t\t},
\t\t\t\t\t\t\t\tchildren: t("approval.reject")
\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
\t\t\t\t\t\t\t\tvariant: "primary",
\t\t\t\t\t\t\t\tdisabled: answered,
\t\t\t\t\t\t\t\tonClick: () => {
\t\t\t\t\t\t\t\t\tanswer("allowed-once");
\t\t\t\t\t\t\t\t},
\t\t\t\t\t\t\t\tchildren: t("approval.allowOnce")
\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
\t\t\t\t\t\t\t\tvariant: "outline",
\t\t\t\t\t\t\t\tdisabled: answered || runCommand === void 0,
\t\t\t\t\t\t\t\tonClick: allowAll,
\t\t\t\t\t\t\t\tchildren: t("approval.allowAll")
\t\t\t\t\t\t\t})]
\t\t\t\t\t\t})
\t\t\t\t\t]
\t\t\t\t})
\t\t\t});
\t\t}
`,
    'approval flow allow-all action',
  )
  source = replaceExact(
    source,
    '\t\t\t"approval.allowOnce": "允许一次",',
    '\t\t\t"approval.allowOnce": "允许一次",\n\t\t\t"approval.allowAll": "允许所有",',
    'zh approval allow-all locale',
  )
  source = replaceExact(
    source,
    '\t\t\t"approval.allowOnce": "Allow once",',
    '\t\t\t"approval.allowOnce": "Allow once",\n\t\t\t"approval.allowAll": "Allow all",',
    'en approval allow-all locale',
  )
  return replaceExact(
    source,
    `\t\t\tslots.register({
\t\t\t\tname: "conversation.composer",
\t\t\t\tselect: selectApproval,
\t\t\t\tpriority: 1,
\t\t\t\tlocale: NS
\t\t\t}, ApprovalPanel);`,
    `\t\t\tslots.register({
\t\t\t\tname: "conversation.composer",
\t\t\t\tselect: selectApproval,
\t\t\t\tpriority: 1,
\t\t\t\tlocale: NS,
\t\t\t\tinject: (sessionId) => ({
\t\t\t\t\trunCommand: async (line) => {
\t\t\t\t\t\tconst session = sessions.binding(sessionId)?.session;
\t\t\t\t\t\tif (session === void 0) return false;
\t\t\t\t\t\tconst result = await session.command(line);
\t\t\t\t\t\treturn result.ok && result.value.matched;
\t\t\t\t\t}
\t\t\t\t})
\t\t\t}, ApprovalPanel);`,
    'approval panel command injection',
  )
}

function patchDshApprovalAllowAllSlotTypesSource(source) {
  if (source.includes('ApprovalComposerInjected')) return source
  source = replaceExact(
    source,
    ' * standard locale seat. No injected share: the carrier plus the domain face\n * above carry the whole behavior surface; the paired command line derives\n * from useSession in-component.\n */',
    ' * standard locale seat. The injected command face keeps broad approvals on\n * the native slash-command path so the permission change remains logged.\n */',
    'approval composer injected comment',
  )
  return replaceExact(
    source,
    `export type ApprovalComposerProps = PropsRuntime<'conversation.composer'> & {
    matched: ApprovalWait;
} & PropsLocale<'conversation'>;`,
    `export interface ApprovalComposerInjected {
    /** Submit one slash-command line against this session's agent. */
    runCommand: ((line: string) => Promise<boolean>) | undefined;
}
export type ApprovalComposerProps = PropsRuntime<'conversation.composer'> & {
    matched: ApprovalWait;
} & InjectFace<ApprovalComposerInjected> & PropsLocale<'conversation'>;`,
    'approval composer injected type',
  )
}

function patchDshApprovalAllowAllLocaleTypesSource(source) {
  if (source.includes("'approval.allowAll'")) return source
  const needle = "    'approval.allowOnce': string;\n    'ask.rowTitle': string;"
  const replacement = "    'approval.allowOnce': string;\n    'approval.allowAll': string;\n    'ask.rowTitle': string;"
  const next = source.split(needle).join(replacement)
  if (next === source) throw new Error('cannot patch approval allow-all locale types: expected source not found')
  return next
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

function patchSdkJsonrpcCancel(runtimeRoot) {
  const sdkJsonrpcCancelEntry = join(
    resolve(runtimeRoot),
    'node_modules',
    '@deepseek-ai',
    'dsh-sdk-jsonrpc-server',
    'lib',
    'index.js',
  )
  let source = readFileSync(sdkJsonrpcCancelEntry, 'utf8')
  if (source.includes(SDK_JSONRPC_CANCEL_PATCH_MARKER)) {
    return { patched: false, sdkJsonrpcCancelEntry }
  }

  source = replaceExact(
    source,
    '\tasync prompt(params) {\n\t\tconst rec = await this.getOrCreateSession(params.sessionId);\n\t\tif (this.ctx.agents.get(rec.handle.agent.id) !== rec.handle.agent) throw new Error(`session agent was disposed outside the server: ${params.sessionId}`);\n\t\tconst message = createUserMessage({\n\t\t\tcontent: await durableSdkPromptContent(this.ctx, params.contentBlocks),\n\t\t\tsource: { kind: "user" }\n\t\t});\n\t\trec.handle.agent.followup(message);\n\t\treturn { messageId: message.id };\n\t}\n',
    `\tasync prompt(params) {
\t\tconst rec = await this.getOrCreateSession(params.sessionId);
\t\tif (this.ctx.agents.get(rec.handle.agent.id) !== rec.handle.agent) throw new Error(\`session agent was disposed outside the server: \${params.sessionId}\`);
\t\tconst message = createUserMessage({
\t\t\tcontent: await durableSdkPromptContent(this.ctx, params.contentBlocks),
\t\t\tsource: { kind: "user" }
\t\t});
\t\trec.handle.agent.followup(message);
\t\treturn { messageId: message.id };
\t}
\t// ${SDK_JSONRPC_CANCEL_PATCH_MARKER}: abort one SDK-owned session without tearing down the web runtime.
\tasync cancel(params) {
\t\tconst pending = this.sessionCreations.get(params.sessionId);
\t\tconst rec = this.sessions.get(params.sessionId) ?? (pending ? await pending : void 0);
\t\tif (rec === void 0) return { accepted: false, reason: "session-not-found" };
\t\tif (this.ctx.agents.get(rec.handle.agent.id) !== rec.handle.agent) throw new Error(\`session agent was disposed outside the server: \${params.sessionId}\`);
\t\trec.handle.agent.cancel({ kind: "hook", reason: String(params.reason || "sdk-cancel") }, { keepInbox: params.keepInbox === true });
\t\tawait rec.handle.agent.whenIdle();
\t\treturn { accepted: true };
\t}
`,
    'sdk-jsonrpc cancel method',
  )
  source = replaceExact(
    source,
    '\t\t\tcase "session/prompt": return this.prompt(params);\n\t\t\tcase "shutdown": return this.shutdown();',
    '\t\t\tcase "session/prompt": return this.prompt(params);\n\t\t\tcase "session/cancel": return this.cancel(params);\n\t\t\tcase "shutdown": return this.shutdown();',
    'sdk-jsonrpc cancel dispatch',
  )
  writeFileSync(sdkJsonrpcCancelEntry, source, 'utf8')
  return { patched: true, sdkJsonrpcCancelEntry }
}

function patchSdkJsonrpcInternalPrompt(runtimeRoot) {
  const sdkJsonrpcInternalPromptEntry = join(
    resolve(runtimeRoot),
    'node_modules',
    '@deepseek-ai',
    'dsh-sdk-jsonrpc-server',
    'lib',
    'index.js',
  )
  let source = readFileSync(sdkJsonrpcInternalPromptEntry, 'utf8')
  if (source.includes(SDK_JSONRPC_INTERNAL_PROMPT_PATCH_MARKER)) {
    return { patched: false, sdkJsonrpcInternalPromptEntry }
  }

  source = replaceExact(
    source,
    '\t\t\tcontent: await durableSdkPromptContent(this.ctx, params.contentBlocks),\n\t\t\tsource: { kind: "user" }',
    `\t\t\tcontent: await durableSdkPromptContent(this.ctx, params.contentBlocks),
\t\t\t// ${SDK_JSONRPC_INTERNAL_PROMPT_PATCH_MARKER}: keep automatic output continuation out of user-authored history.
\t\t\tsource: params.internal === true ? {
\t\t\t\tkind: "plugin",
\t\t\t\tplugin: "crawshrimp-output-continuation",
\t\t\t\tform: "instructions"
\t\t\t} : { kind: "user" }`,
    'sdk-jsonrpc internal prompt source',
  )
  writeFileSync(sdkJsonrpcInternalPromptEntry, source, 'utf8')
  return { patched: true, sdkJsonrpcInternalPromptEntry }
}

function patchDshImNaturalControls(runtimeRoot) {
  const modelEntries = xmanruiPackageEntryPaths(
    runtimeRoot,
    'dsh-im',
    'src',
    'channels',
    'shared',
    'model-command.mjs',
  )
  const permissionEntries = xmanruiPackageEntryPaths(
    runtimeRoot,
    'dsh-im',
    'src',
    'channels',
    'shared',
    'permission-command.mjs',
  )
  const approvalEntries = xmanruiPackageEntryPaths(
    runtimeRoot,
    'dsh-im',
    'src',
    'channels',
    'shared',
    'harness-approval.mjs',
  )
  const harnessClientEntries = xmanruiPackageEntryPaths(
    runtimeRoot,
    'dsh-im',
    'src',
    'channels',
    'shared',
    'harness-client.mjs',
  )
  const botWorkspaceStoreEntries = xmanruiPackageEntryPaths(
    runtimeRoot,
    'dsh-im',
    'src',
    'channels',
    'shared',
    'bot-workspace-store.mjs',
  )
  const workspaceSessionEntries = xmanruiPackageEntryPaths(
    runtimeRoot,
    'dsh-im',
    'src',
    'channels',
    'shared',
    'workspace-session.mjs',
  )
  const textBridgeEntries = xmanruiPackageEntryPaths(
    runtimeRoot,
    'dsh-im',
    'src',
    'channels',
    'shared',
    'text-harness-bridge.mjs',
  )
  const weixinBridgeEntries = xmanruiPackageEntryPaths(
    runtimeRoot,
    'dsh-im',
    'src',
    'channels',
    'weixin',
    'weixin-bridge.mjs',
  )
  const dingtalkBridgeEntries = xmanruiPackageEntryPaths(
    runtimeRoot,
    'dsh-im',
    'src',
    'channels',
    'dingtalk',
    'dingtalk-bridge.mjs',
  )
  const feishuBridgeEntries = xmanruiPackageEntryPaths(
    runtimeRoot,
    'dsh-im',
    'src',
    'channels',
    'feishu',
    'bridge.mjs',
  )
  const qqBridgeEntries = xmanruiPackageEntryPaths(
    runtimeRoot,
    'dsh-im',
    'src',
    'channels',
    'qq',
    'qq-bridge.mjs',
  )
  const wecomBridgeEntries = xmanruiPackageEntryPaths(
    runtimeRoot,
    'dsh-im',
    'src',
    'channels',
    'wecom',
    'wecom-bridge.mjs',
  )
  const bundledEntries = xmanruiPackageEntryPaths(runtimeRoot, 'dsh-im', 'lib', 'index.js')
  let patched = false

  for (const entry of modelEntries) {
    patched = patchFile(entry, patchDshImModelCommandSource) || patched
  }
  for (const entry of permissionEntries) {
    patched = patchFile(entry, patchDshImPermissionCommandSource) || patched
  }
  for (const entry of approvalEntries) {
    patched = patchFile(entry, patchDshImHarnessApprovalSource) || patched
  }
  for (const entry of harnessClientEntries) {
    patched = patchFile(entry, patchDshImHarnessClientSource) || patched
  }
  for (const entry of botWorkspaceStoreEntries) {
    patched = patchFile(entry, patchDshImBotWorkspaceStoreSource) || patched
  }
  for (const entry of workspaceSessionEntries) {
    patched = patchFile(entry, patchDshImWorkspaceSessionSource) || patched
  }
  for (const entry of textBridgeEntries) {
    patched = patchFile(entry, patchDshImTextHarnessBridgeSource) || patched
  }
  for (const entry of weixinBridgeEntries) {
    patched = patchFile(entry, patchDshImWeixinBridgeSource) || patched
  }
  for (const entry of dingtalkBridgeEntries) {
    patched = patchFile(entry, patchDshImDingtalkBridgeApprovalAllowAllSource) || patched
  }
  for (const entry of feishuBridgeEntries) {
    patched = patchFile(entry, patchDshImFeishuBridgeApprovalAllowAllSource) || patched
  }
  for (const entry of qqBridgeEntries) {
    patched = patchFile(entry, patchDshImQqBridgeApprovalAllowAllSource) || patched
  }
  for (const entry of wecomBridgeEntries) {
    patched = patchFile(entry, patchDshImWecomBridgeApprovalAllowAllSource) || patched
  }
  for (const entry of bundledEntries) {
    patched = patchFile(entry, patchDshImBundledHost) || patched
  }

  return {
    patched,
    dshImNaturalControlsEntry: [
      ...modelEntries,
      ...permissionEntries,
      ...approvalEntries,
      ...harnessClientEntries,
      ...botWorkspaceStoreEntries,
      ...workspaceSessionEntries,
      ...textBridgeEntries,
      ...weixinBridgeEntries,
      ...dingtalkBridgeEntries,
      ...feishuBridgeEntries,
      ...qqBridgeEntries,
      ...wecomBridgeEntries,
      ...bundledEntries,
    ].join(','),
  }
}

function patchFile(entry, transform) {
  let source = readFileSync(entry, 'utf8')
  const next = transform(source)
  if (next === source) return false
  writeFileSync(entry, next, 'utf8')
  return true
}

function patchDshImHarnessClientSource(source) {
  if (!source.includes(`${DSH_IM_MODEL_CATALOG_PATCH_MARKER}: harness client`)) {
    source = replaceExact(
      source,
      `  async listModels(options = {}) {
    await this.ensureRunning(options);
    const value = await this.rpc('llm.models', {}, 30_000, options);
    return validateModelCatalog(value, 'llm.models');
  }

  async getSessionModels(sessionId, options = {}) {`,
      `  async listModels(options = {}) {
    await this.ensureRunning(options);
    const value = await this.rpc('llm.models', {}, 30_000, options);
    return validateModelCatalog(value, 'llm.models');
  }

  // ${DSH_IM_MODEL_CATALOG_PATCH_MARKER}: harness client reads Crawshrimp's deterministic all-model catalog.
  async listCrawshrimpModelCatalog(options = {}) {
    await this.ensureRunning(options);
    let response;
    try {
      response = await this.#fetch(new URL('/api/crawshrimp/model-catalog', this.#baseUrl), {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new HarnessTransportError('harness-connect-failed', 'crawshrimp.modelCatalog', {
        cause: error,
      });
    }
    if (!response.ok) {
      throw new HarnessTransportError('harness-http-failed', 'crawshrimp.modelCatalog', {
        status: response.status,
      });
    }
    try {
      const body = await response.json();
      if (!body || body.ok !== true || !Array.isArray(body.groups)) {
        throw new Error('Crawshrimp returned an invalid model catalog');
      }
      return body;
    } catch (error) {
      throw new HarnessTransportError('harness-response-invalid', 'crawshrimp.modelCatalog', {
        cause: error,
      });
    }
  }

  async getSessionModels(sessionId, options = {}) {`,
      'dsh-im Crawshrimp model catalog client',
    )
  }
  if (!source.includes(DSH_IM_LOCAL_MODEL_SELECT_PATCH_MARKER)) {
    source = replaceExact(
      source,
      `    await this.ensureRunning(options);
    const operation = (maintenanceSignal) => {`,
      `    await this.ensureRunning(options);
    // ${DSH_IM_LOCAL_MODEL_SELECT_PATCH_MARKER}: prefer Crawshrimp's session-only model switch endpoint.
    let localResponse;
    try {
      localResponse = await this.#fetch(new URL('/api/crawshrimp/session/select-model', this.#baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sessionId,
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: selection.reasoningEffort }),
        }),
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
    }
    if (localResponse && localResponse.status !== 404 && localResponse.status !== 501) {
      if (!localResponse.ok) {
        throw new HarnessTransportError('harness-http-failed', 'crawshrimp.session.selectModel', {
          status: localResponse.status,
        });
      }
      const body = await localResponse.json();
      if (body?.ok === false) throw new HarnessRpcError('crawshrimp.session.selectModel', body.error);
      if (!body || body.ok !== true || !validModelSelection(body.selected)) {
        throw new HarnessTransportError('harness-response-invalid', 'crawshrimp.session.selectModel', {
          cause: new Error('Crawshrimp returned an invalid selected model'),
        });
      }
      return { selected: body.selected };
    }
    const operation = (maintenanceSignal) => {`,
      'dsh-im Crawshrimp local model select client',
    )
  }
  if (source.includes(DSH_IM_SESSION_PERMISSION_API_PATCH_MARKER)) return source
  source = replaceExact(
    source,
    `function turnStoppedError() {`,
    `function validPermissionPayload(value) {
  return value !== null
    && typeof value === 'object'
    && typeof value.preset === 'string'
    && Boolean(value.preset)
    && Array.isArray(value.available)
    && value.available.every((preset) => typeof preset === 'string' && Boolean(preset));
}

function turnStoppedError() {`,
    'dsh-im session permission payload validator',
  )
  return replaceExact(
    source,
    `  async isSessionRunning(sessionId, options = {}) {`,
    `  // ${DSH_IM_SESSION_PERMISSION_API_PATCH_MARKER}: direct permission control avoids model/tool execution loops.
  async getSessionPermission(sessionId, options = {}) {
    if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId is required');
    await this.ensureRunning(options);
    let response;
    try {
      const url = new URL('/api/crawshrimp/session/permission', this.#baseUrl);
      url.searchParams.set('sessionId', sessionId);
      response = await this.#fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new HarnessTransportError('harness-connect-failed', 'crawshrimp.session.permission', {
        cause: error,
      });
    }
    if (!response.ok) {
      throw new HarnessTransportError('harness-http-failed', 'crawshrimp.session.permission', {
        status: response.status,
      });
    }
    const body = await response.json();
    if (body?.ok === false) throw new HarnessRpcError('crawshrimp.session.permission', body.error);
    if (!validPermissionPayload(body)) {
      throw new HarnessTransportError('harness-response-invalid', 'crawshrimp.session.permission', {
        cause: new Error('Crawshrimp returned an invalid session permission'),
      });
    }
    return body;
  }

  async setSessionPermission(sessionId, preset, options = {}) {
    if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('sessionId is required');
    if (typeof preset !== 'string' || !preset) throw new TypeError('permission preset is required');
    await this.ensureRunning(options);
    let response;
    try {
      response = await this.#fetch(new URL('/api/crawshrimp/session/permission', this.#baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sessionId, preset }),
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new HarnessTransportError('harness-connect-failed', 'crawshrimp.session.permission', {
        cause: error,
      });
    }
    if (!response.ok) {
      throw new HarnessTransportError('harness-http-failed', 'crawshrimp.session.permission', {
        status: response.status,
      });
    }
    const body = await response.json();
    if (body?.ok === false) throw new HarnessRpcError('crawshrimp.session.permission', body.error);
    if (!validPermissionPayload(body) || body.preset !== preset) {
      throw new HarnessTransportError('harness-response-invalid', 'crawshrimp.session.permission', {
        cause: new Error('Crawshrimp returned an invalid session permission update'),
      });
    }
    return body;
  }

  async isSessionRunning(sessionId, options = {}) {`,
    'dsh-im Crawshrimp session permission client',
  )
}

function patchDshImBotWorkspaceStoreSource(source) {
  if (!source.includes(`${DSH_IM_MODEL_CATALOG_PATCH_MARKER}: workspace scoped catalog`)) {
    source = replaceExact(
      source,
      `      if ((property === 'listWorkspaces'
        || property === 'listWorkspaceSessions'
        || property === 'listModels')
        && typeof target[property] === 'function') {`,
      `      if ((property === 'listWorkspaces'
        || property === 'listWorkspaceSessions'
        || property === 'listModels'
        // ${DSH_IM_MODEL_CATALOG_PATCH_MARKER}: workspace scoped catalog for mobile model-list commands.
        || property === 'listCrawshrimpModelCatalog')
        && typeof target[property] === 'function') {`,
      'dsh-im workspace scoped Crawshrimp model catalog',
    )
  }
  if (source.includes(`${DSH_IM_SESSION_PERMISSION_API_PATCH_MARKER}: direct permission control`)) {
    return source
  }
  return replaceExact(
    source,
    `            selectModel(...args) {
              return invokeCurrentSession('selectSessionModel', args, 'model selection');
            },
            isRunning(...args) {`,
    `            selectModel(...args) {
              return invokeCurrentSession('selectSessionModel', args, 'model selection');
            },
            // ${DSH_IM_SESSION_PERMISSION_API_PATCH_MARKER}: direct permission control avoids model/tool execution loops.
            permission(...args) {
              return invokeCurrentSession('getSessionPermission', args, 'permission query');
            },
            setPermission(...args) {
              return invokeStartedSessionMutation('setSessionPermission', args, 'permission update');
            },
            isRunning(...args) {`,
    'dsh-im workspace scoped session permission control',
  )
}

function patchDshImWorkspaceSessionSource(source) {
  if (source.includes(`${DSH_IM_SESSION_PERMISSION_API_PATCH_MARKER}: direct permission control`)) {
    return source
  }
  return replaceExact(
    source,
    `    models: (...args) => harness.getSessionModels(sessionId, ...args),
    selectModel: (...args) => harness.selectSessionModel(sessionId, ...args),
    isRunning: (...args) => harness.isSessionRunning(sessionId, ...args),`,
    `    models: (...args) => harness.getSessionModels(sessionId, ...args),
    selectModel: (...args) => harness.selectSessionModel(sessionId, ...args),
    // ${DSH_IM_SESSION_PERMISSION_API_PATCH_MARKER}: direct permission control avoids model/tool execution loops.
    permission: (...args) => harness.getSessionPermission(sessionId, ...args),
    setPermission: (...args) => harness.setSessionPermission(sessionId, ...args),
    isRunning: (...args) => harness.isSessionRunning(sessionId, ...args),`,
    'dsh-im workspace session permission control',
  )
}

function patchDshImModelCommandSource(source) {
  if (!source.includes(`${DSH_IM_NATURAL_CONTROLS_PATCH_MARKER}: model`)) {
    source = replaceExact(
      source,
      "import { withSessionBindingLock } from './session-binding-lock.mjs';",
      "import { withSessionBindingLock } from './session-binding-lock.mjs';\nimport { normalizeControlText, normalizeModelLookup } from './control-text.mjs';",
      'dsh-im model command control-text imports',
    )
    source = replaceExact(
      source,
      `const UNSAFE_DISPLAY_TEXT_GLOBAL = /[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]+/gu;`,
      `const UNSAFE_DISPLAY_TEXT_GLOBAL = /[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]+/gu;
const UNSAFE_MODEL_TARGET = /[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]/u;
// ${DSH_IM_NATURAL_CONTROLS_PATCH_MARKER}: model controls for mobile IM chats without toolbar access.
const NATURAL_MODEL_LIST = new Set([
  '有哪些模型',
  '列出所有模型',
  '列出所有可用模型',
  '列出可用模型',
  '查看可用模型',
  '查看模型',
  '模型列表',
  '可用模型',
  '所有模型',
  '可以切换模型吗',
  '能切换模型吗',
  '怎么切换模型',
]);
const NATURAL_MODEL_CURRENT = new Set([
  '当前是什么模型',
  '现在用的哪个模型',
  '当前模型',
  '现在模型',
  '用的什么模型',
  '现在是什么模型',
]);
const NATURAL_MODEL_SELECT = Object.freeze([
  /^切换到\\s*(.+)$/u,
  /^切换模型到\\s*(.+)$/u,
  /^切(?:到|成|为)\\s*(.+)$/u,
  /^换到\\s*(.+)$/u,
  /^换成\\s*(.+)$/u,
  /^改用\\s*(.+)$/u,
  /^使用\\s+(.+?)\\s*模型$/u,
  /^用\\s*(.+?)\\s*模型$/u,
  /^模型(?:切换到|换成|改成|设置为|设为)\\s*(.+)$/u,
]);
const SAFE_MODEL_ALIASES = new Map();`,
      'dsh-im natural model constants',
    )
    source = replaceExact(
      source,
      `function assertSessionBinding(state, key, expectedSessionId) {
  const currentSessionId = typeof state?.sessionFor === 'function'
    ? state.sessionFor(key)
    : null;
  if (currentSessionId !== expectedSessionId) throw sessionBindingChanged();
}
`,
    `function assertSessionBinding(state, key, expectedSessionId) {
  const currentSessionId = typeof state?.sessionFor === 'function'
    ? state.sessionFor(key)
    : null;
  if (currentSessionId !== expectedSessionId) throw sessionBindingChanged();
}

function naturalModelCandidates(catalog) {
  return catalog.groups.flatMap((group) => group.models.map((model) => ({
    provider: group.id,
    model: model.id,
    displayName: model.name,
    fullId: modelId(group.id, model.id),
    aliases: [model.id, model.name, modelId(group.id, model.id)],
  })));
}

function modelLookupVariants(value) {
  const normalized = normalizeControlText(value, { allowPolitePrefix: false });
  if (!normalized) return [];
  const variants = new Set([normalized]);
  for (const suffix of ['模型', 'model']) {
    if (normalized.endsWith(suffix)) {
      const withoutSuffix = normalized.slice(0, -suffix.length).trim();
      if (withoutSuffix) variants.add(withoutSuffix);
    }
  }
  return [...new Set(
    [...variants].map((variant) => normalizeModelLookup(variant)).filter(Boolean),
  )];
}

function candidateAliases(candidate) {
  return [
    candidate.fullId,
    candidate.model,
    candidate.displayName,
    ...(Array.isArray(candidate.aliases) ? candidate.aliases : []),
  ].filter((value) => typeof value === 'string' && value);
}

function matchingModelCandidates(candidates, requested) {
  const raw = requested.toLocaleLowerCase('en-US');
  const lookups = modelLookupVariants(requested);
  if (lookups.length === 0) return [];
  const tiers = [
    (candidate) => candidate.fullId.toLocaleLowerCase('en-US') === raw,
    (candidate) => lookups.some((lookup) => SAFE_MODEL_ALIASES.get(lookup) === candidate.fullId),
    (candidate) => candidateAliases(candidate)
      .some((alias) => lookups.includes(normalizeModelLookup(alias))),
  ];
  for (const matchesTier of tiers) {
    const matches = candidates.filter(matchesTier);
    if (matches.length > 0) return matches;
  }
  return [];
}

function matchingNaturalModels(catalog, requested) {
  return matchingModelCandidates(naturalModelCandidates(catalog), requested);
}

function productModelCandidates(catalog) {
  return catalog.groups.flatMap((group) => group.models.flatMap((model) => {
    const provider = model.provider;
    const runtimeModel = model.runtimeModel || model.id;
    if (!model.configured || !model.supportsSwitch || !provider || !runtimeModel) return [];
    const runtimeFullId = modelId(provider, runtimeModel);
    const productFullId = modelId(provider, model.id);
    return [{
      provider,
      model: runtimeModel,
      displayName: model.label,
      fullId: runtimeFullId,
      aliases: [
        model.id,
        model.label,
        productFullId,
        runtimeModel,
        runtimeFullId,
      ],
    }];
  }));
}

function matchingProductNaturalModels(catalog, requested) {
  return matchingModelCandidates(productModelCandidates(catalog), requested);
}

function ambiguousNaturalModelMessage(matches) {
  return [
    t('找到多个匹配的模型，请使用 provider/model 明确指定：'),
    '',
    ...matches.map(({ fullId }) => \`- \${safeDisplayText(fullId)}\`).sort(),
    '',
    t('例如：模型改成 provider/model'),
  ].join('\\n');
}

function missingNaturalModelMessage(requested) {
  return [
    t('没有找到模型：{model}', { model: safeDisplayText(requested) }),
    '',
    t('请发送“列出所有可用模型”查看可用模型。'),
  ].join('\\n');
}
`,
      'dsh-im natural model matching helpers',
    )
    source = replaceExact(
      source,
      `function isReasoningCommand(command) {
  return REASONING_COMMAND.test(command);
}

export function isModelCommand(text) {`,
    `function isReasoningCommand(command) {
  return REASONING_COMMAND.test(command);
}

export function parseNaturalModelCommand(text) {
  const command = normalizeControlText(text);
  if (!command) return null;
  if (NATURAL_MODEL_LIST.has(command)) return { action: 'list' };
  if (NATURAL_MODEL_CURRENT.has(command)) return { action: 'current' };
  for (const pattern of NATURAL_MODEL_SELECT) {
    const match = pattern.exec(command);
    if (!match) continue;
    const requested = match[1].trim();
    if (!requested || requested.length > 256 || UNSAFE_MODEL_TARGET.test(requested)) {
      return null;
    }
    return { action: 'select', requested };
  }
  return null;
}

export function isNaturalModelCommand(text) {
  return parseNaturalModelCommand(text) !== null;
}

export function isModelCommand(text) {
  if (isNaturalModelCommand(text)) return true;`,
      'dsh-im natural model parser',
    )
    source = replaceExact(
      source,
      `export async function runModelCommand(text, harness, state, key, options = {}) {
  if (!isModelCommand(text)) return null;
  const command = text.trim();`,
      `export async function runModelCommand(text, harness, state, key, options = {}) {
  const natural = parseNaturalModelCommand(text);
  if (!natural && !isModelCommand(text)) return null;
  const command = natural ? '' : text.trim();`,
      'dsh-im natural model command entry',
    )
    source = replaceExact(
      source,
      `  const requestOptions = rpcOptions(options.signal);

  if (isModelsCommand(command)) {`,
      `  const requestOptions = rpcOptions(options.signal);

  if (natural?.action === 'list') {
    try {
      return commandResult(formatCatalog(await listCatalog(harness, requestOptions)));
    } catch (error) {
      return commandResult(modelErrorMessage(error, 'list'));
    }
  }

  if (natural?.action === 'current') {
    try {
      const bound = await boundSession(harness, state, key, requestOptions);
      if (!bound) return commandResult(noSessionMessage());
      return commandResult(currentModelMessage(
        await sessionCatalog(bound.session, requestOptions),
      ));
    } catch (error) {
      return commandResult(modelErrorMessage(error, 'select'));
    }
  }

  if (isModelsCommand(command)) {`,
      'dsh-im natural model list and current actions',
    )
    source = replaceExact(
      source,
      `  const match = /^\\/model(?:[ \\t]+([^\\s]+)(?:[ \\t]+([^\\s]+))?)?[ \\t]*$/iu.exec(command);
  if (!match) return commandResult(t(MODEL_USAGE));
  const requested = match[1];
  const requestedEffort = match[2];`,
      `  const match = natural
    ? null
    : /^\\/model(?:[ \\t]+([^\\s]+)(?:[ \\t]+([^\\s]+))?)?[ \\t]*$/iu.exec(command);
  if (!natural && !match) return commandResult(t(MODEL_USAGE));
  const requested = natural?.requested ?? match?.[1];
  const requestedEffort = match?.[2];`,
      'dsh-im natural model selection parse',
    )
    source = replaceExact(
      source,
      `  const numberRequest = positiveNumberRequest(requested);
  if (numberRequest?.index === null) {`,
      `  const numberRequest = natural ? null : positiveNumberRequest(requested);
  if (!natural && numberRequest?.index === null) {`,
      'dsh-im natural model number guard',
    )
    source = replaceExact(
      source,
      `  if (!numberRequest
    && (!requested.includes('/') || requested.startsWith('/') || requested.endsWith('/'))) {`,
      `  if (!natural && !numberRequest
    && (!requested.includes('/') || requested.startsWith('/') || requested.endsWith('/'))) {`,
      'dsh-im natural model id guard',
    )
    source = replaceExact(
      source,
      `      const selection = numberRequest
        ? modelAt(catalog, numberRequest.index)
        : matchingModel(catalog, requested);
      if (!selection) {
        if (numberRequest) return commandResult(invalidModelNumberMessage(requested));
        return commandResult([
          t('没有找到模型：{model}', { model: safeDisplayText(requested) }),
          '',
          t('请发送 /models 查看可用模型。'),
        ].join('\\n'));
      }`,
      `      let selection;
      if (natural) {
        const matches = matchingNaturalModels(catalog, requested);
        if (matches.length > 1) {
          return commandResult(ambiguousNaturalModelMessage(matches));
        }
        if (matches.length === 1) {
          selection = { provider: matches[0].provider, model: matches[0].model };
        }
        if (!selection) {
          const productCatalog = await listProductModelCatalog(harness, requestOptions);
          const productMatches = productCatalog
            ? matchingProductNaturalModels(productCatalog, requested)
            : [];
          if (productMatches.length > 1) {
            return commandResult(ambiguousNaturalModelMessage(productMatches));
          }
          if (productMatches.length === 1) {
            selection = {
              provider: productMatches[0].provider,
              model: productMatches[0].model,
            };
          }
        }
      } else {
        selection = numberRequest
          ? modelAt(catalog, numberRequest.index)
          : matchingModel(catalog, requested);
      }
      if (!selection) {
        if (numberRequest) return commandResult(invalidModelNumberMessage(requested));
        if (natural) return commandResult(missingNaturalModelMessage(requested));
        return commandResult([
          t('没有找到模型：{model}', { model: safeDisplayText(requested) }),
          '',
          t('请发送 /models 查看可用模型。'),
        ].join('\\n'));
      }`,
      'dsh-im natural model selection matching',
    )
  }
  if (!source.includes('function matchingProductNaturalModels(catalog, requested)')) {
    source = replaceRange(
      source,
      `function naturalModelCandidates(catalog) {`,
      `function ambiguousNaturalModelMessage(matches) {`,
      `function naturalModelCandidates(catalog) {
  return catalog.groups.flatMap((group) => group.models.map((model) => ({
    provider: group.id,
    model: model.id,
    displayName: model.name,
    fullId: modelId(group.id, model.id),
    aliases: [model.id, model.name, modelId(group.id, model.id)],
  })));
}

function modelLookupVariants(value) {
  const normalized = normalizeControlText(value, { allowPolitePrefix: false });
  if (!normalized) return [];
  const variants = new Set([normalized]);
  for (const suffix of ['模型', 'model']) {
    if (normalized.endsWith(suffix)) {
      const withoutSuffix = normalized.slice(0, -suffix.length).trim();
      if (withoutSuffix) variants.add(withoutSuffix);
    }
  }
  return [...new Set(
    [...variants].map((variant) => normalizeModelLookup(variant)).filter(Boolean),
  )];
}

function candidateAliases(candidate) {
  return [
    candidate.fullId,
    candidate.model,
    candidate.displayName,
    ...(Array.isArray(candidate.aliases) ? candidate.aliases : []),
  ].filter((value) => typeof value === 'string' && value);
}

function matchingModelCandidates(candidates, requested) {
  const raw = requested.toLocaleLowerCase('en-US');
  const lookups = modelLookupVariants(requested);
  if (lookups.length === 0) return [];
  const tiers = [
    (candidate) => candidate.fullId.toLocaleLowerCase('en-US') === raw,
    (candidate) => lookups.some((lookup) => SAFE_MODEL_ALIASES.get(lookup) === candidate.fullId),
    (candidate) => candidateAliases(candidate)
      .some((alias) => lookups.includes(normalizeModelLookup(alias))),
  ];
  for (const matchesTier of tiers) {
    const matches = candidates.filter(matchesTier);
    if (matches.length > 0) return matches;
  }
  return [];
}

function matchingNaturalModels(catalog, requested) {
  return matchingModelCandidates(naturalModelCandidates(catalog), requested);
}

function productModelCandidates(catalog) {
  return catalog.groups.flatMap((group) => group.models.flatMap((model) => {
    const provider = model.provider;
    const runtimeModel = model.runtimeModel || model.id;
    if (!model.configured || !model.supportsSwitch || !provider || !runtimeModel) return [];
    const runtimeFullId = modelId(provider, runtimeModel);
    const productFullId = modelId(provider, model.id);
    return [{
      provider,
      model: runtimeModel,
      displayName: model.label,
      fullId: runtimeFullId,
      aliases: [
        model.id,
        model.label,
        productFullId,
        runtimeModel,
        runtimeFullId,
      ],
    }];
  }));
}

function matchingProductNaturalModels(catalog, requested) {
  return matchingModelCandidates(productModelCandidates(catalog), requested);
}

function ambiguousNaturalModelMessage(matches) {`,
      'dsh-im natural product model matching helpers',
    )
  }
  if (!source.includes('matchingProductNaturalModels(productCatalog, requested)')) {
    source = replaceExact(
      source,
      `        if (matches.length === 1) {
          selection = { provider: matches[0].provider, model: matches[0].model };
        }
      } else {`,
      `        if (matches.length === 1) {
          selection = { provider: matches[0].provider, model: matches[0].model };
        }
        if (!selection) {
          const productCatalog = await listProductModelCatalog(harness, requestOptions);
          const productMatches = productCatalog
            ? matchingProductNaturalModels(productCatalog, requested)
            : [];
          if (productMatches.length > 1) {
            return commandResult(ambiguousNaturalModelMessage(productMatches));
          }
          if (productMatches.length === 1) {
            selection = {
              provider: productMatches[0].provider,
              model: productMatches[0].model,
            };
          }
        }
      } else {`,
      'dsh-im natural model product catalog fallback',
    )
  }
  if (!source.includes(DSH_IM_NATURAL_MODEL_ALIASES_PATCH_MARKER)) {
    source = replaceExact(
      source,
      'const SAFE_MODEL_ALIASES = new Map();',
      `// ${DSH_IM_NATURAL_MODEL_ALIASES_PATCH_MARKER}: accept product shorthand only when the corresponding full catalog id exists.
const SAFE_MODEL_ALIASES = new Map([
  ['gpt5', 'crawshrimp-overseas-openai/gpt-5.5'],
  ['v4pro', 'crawshrimp-deepseek-official/deepseek-v4-pro'],
  ['v4flash', 'crawshrimp-deepseek-official/deepseek-v4-flash'],
  ['deepseekofficialv4pro', 'crawshrimp-deepseek-official/deepseek-v4-pro'],
  ['deepseekofficialv4flash', 'crawshrimp-deepseek-official/deepseek-v4-flash'],
  ['deepseekofficialv4flashvisionexp', 'crawshrimp-deepseek-official/deepseek-v4-flash-vision-exp'],
  ['deepseekv4pro', 'crawshrimp-deepseek-official/deepseek-v4-pro'],
  ['deepseekv4flash', 'crawshrimp-deepseek-official/deepseek-v4-flash'],
  ['deepseekv4flashvisionexp', 'crawshrimp-deepseek-official/deepseek-v4-flash-vision-exp'],
]);`,
      'dsh-im natural model safe aliases',
    )
  }
  const oldNaturalTierOrder = `  const tiers = [
    (candidate) => candidate.fullId.toLocaleLowerCase('en-US') === raw,
    (candidate) => normalizeModelLookup(candidate.model) === lookup,
    (candidate) => normalizeModelLookup(candidate.displayName) === lookup,
    (candidate) => SAFE_MODEL_ALIASES.get(lookup) === candidate.fullId,
  ];`
  if (source.includes(oldNaturalTierOrder)) {
    source = replaceExact(
      source,
      oldNaturalTierOrder,
      `  const tiers = [
    (candidate) => candidate.fullId.toLocaleLowerCase('en-US') === raw,
    (candidate) => SAFE_MODEL_ALIASES.get(lookup) === candidate.fullId,
    (candidate) => normalizeModelLookup(candidate.model) === lookup,
    (candidate) => normalizeModelLookup(candidate.displayName) === lookup,
  ];`,
      'dsh-im natural model alias priority',
    )
  }
  const canonicalSafeModelAliases = `const SAFE_MODEL_ALIASES = new Map([
  ['gpt5', 'crawshrimp-overseas-openai/gpt-5.5'],
  ['v4pro', 'crawshrimp-deepseek-official/deepseek-v4-pro'],
  ['v4flash', 'crawshrimp-deepseek-official/deepseek-v4-flash'],
  ['deepseekofficialv4pro', 'crawshrimp-deepseek-official/deepseek-v4-pro'],
  ['deepseekofficialv4flash', 'crawshrimp-deepseek-official/deepseek-v4-flash'],
  ['deepseekofficialv4flashvisionexp', 'crawshrimp-deepseek-official/deepseek-v4-flash-vision-exp'],
  ['deepseekv4pro', 'crawshrimp-deepseek-official/deepseek-v4-pro'],
  ['deepseekv4flash', 'crawshrimp-deepseek-official/deepseek-v4-flash'],
  ['deepseekv4flashvisionexp', 'crawshrimp-deepseek-official/deepseek-v4-flash-vision-exp'],
]);`
  if (!source.includes("['deepseekofficialv4pro', 'crawshrimp-deepseek-official/deepseek-v4-pro']")
    || source.includes('crawshrimp-deepseek-official/deepseek-official-v4-pro')) {
    const oldAliasMaps = [
      `const SAFE_MODEL_ALIASES = new Map([
  ['gpt5', 'crawshrimp-overseas-openai/gpt-5.5'],
  ['deepseekv4pro', 'crawshrimp-deepseek-official/deepseek-v4-pro'],
  ['deepseekv4flash', 'crawshrimp-deepseek-official/deepseek-v4-flash'],
  ['deepseekv4flashvisionexp', 'crawshrimp-deepseek-official/deepseek-v4-flash-vision-exp'],
]);`,
      `const SAFE_MODEL_ALIASES = new Map([
  ['gpt-5', 'crawshrimp-overseas-openai/gpt-5.5'],
  ['deepseek-v4-pro', 'crawshrimp-deepseek-official/deepseek-official-v4-pro'],
  ['deepseek-v4-flash', 'crawshrimp-deepseek-official/deepseek-official-v4-flash'],
  ['deepseek-v4-flash-vision-exp', 'crawshrimp-deepseek-official/deepseek-official-v4-flash-vision-exp'],
]);`,
      `const SAFE_MODEL_ALIASES = new Map([
  ['gpt5', 'crawshrimp-overseas-openai/gpt-5.5'],
  ['deepseek-v4-pro', 'crawshrimp-deepseek-official/deepseek-official-v4-pro'],
  ['deepseek-v4-flash', 'crawshrimp-deepseek-official/deepseek-official-v4-flash'],
  ['deepseek-v4-flash-vision-exp', 'crawshrimp-deepseek-official/deepseek-official-v4-flash-vision-exp'],
]);`,
      `const SAFE_MODEL_ALIASES = new Map([
  ['deepseek-v4-pro', 'crawshrimp-deepseek-official/deepseek-official-v4-pro'],
  ['deepseek-v4-flash', 'crawshrimp-deepseek-official/deepseek-official-v4-flash'],
  ['deepseek-v4-flash-vision-exp', 'crawshrimp-deepseek-official/deepseek-official-v4-flash-vision-exp'],
]);`,
    ]
    const previous = source
    for (const oldAliasMap of oldAliasMaps) {
      source = source.replaceAll(oldAliasMap, canonicalSafeModelAliases)
    }
    if (source === previous) {
      throw new Error('cannot migrate dsh-im natural model aliases: expected alias map shape not found')
    }
  }
  if (!source.includes(DSH_IM_MODEL_CATALOG_PATCH_MARKER)) {
    source = replaceExact(
      source,
      `const SAFE_MODEL_ALIASES = new Map([
  ['gpt5', 'crawshrimp-overseas-openai/gpt-5.5'],
  ['v4pro', 'crawshrimp-deepseek-official/deepseek-v4-pro'],
  ['v4flash', 'crawshrimp-deepseek-official/deepseek-v4-flash'],
  ['deepseekofficialv4pro', 'crawshrimp-deepseek-official/deepseek-v4-pro'],
  ['deepseekofficialv4flash', 'crawshrimp-deepseek-official/deepseek-v4-flash'],
  ['deepseekofficialv4flashvisionexp', 'crawshrimp-deepseek-official/deepseek-v4-flash-vision-exp'],
  ['deepseekv4pro', 'crawshrimp-deepseek-official/deepseek-v4-pro'],
  ['deepseekv4flash', 'crawshrimp-deepseek-official/deepseek-v4-flash'],
  ['deepseekv4flashvisionexp', 'crawshrimp-deepseek-official/deepseek-v4-flash-vision-exp'],
]);`,
      `const SAFE_MODEL_ALIASES = new Map([
  ['gpt5', 'crawshrimp-overseas-openai/gpt-5.5'],
  ['v4pro', 'crawshrimp-deepseek-official/deepseek-v4-pro'],
  ['v4flash', 'crawshrimp-deepseek-official/deepseek-v4-flash'],
  ['deepseekofficialv4pro', 'crawshrimp-deepseek-official/deepseek-v4-pro'],
  ['deepseekofficialv4flash', 'crawshrimp-deepseek-official/deepseek-v4-flash'],
  ['deepseekofficialv4flashvisionexp', 'crawshrimp-deepseek-official/deepseek-v4-flash-vision-exp'],
  ['deepseekv4pro', 'crawshrimp-deepseek-official/deepseek-v4-pro'],
  ['deepseekv4flash', 'crawshrimp-deepseek-official/deepseek-v4-flash'],
  ['deepseekv4flashvisionexp', 'crawshrimp-deepseek-official/deepseek-v4-flash-vision-exp'],
]);
// ${DSH_IM_MODEL_CATALOG_PATCH_MARKER}: natural model list commands use Crawshrimp's deterministic all-model catalog.
const PRODUCT_MODEL_GROUP_LABELS = new Map([
  ['llm', 'LLM 对话模型'],
  ['ai-image', 'AI 生图模型'],
  ['image', 'AI 生图模型'],
  ['ai-video', 'AI 生视频模型'],
  ['video', 'AI 生视频模型'],
]);`,
      'dsh-im product model catalog constants',
    )
    source = replaceExact(
      source,
      `function currentModelMessage(catalog) {`,
      `function normalizeProductModelCatalog(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.groups)) {
    throw new TypeError('Crawshrimp returned an invalid model catalog');
  }
  const groups = value.groups.map((group) => {
    if (!group || typeof group !== 'object' || !Array.isArray(group.models)) {
      throw new TypeError('Crawshrimp returned an invalid model group');
    }
    const id = safeDisplayText(String(group.id || 'models'));
    const name = safeDisplayText(
      String(group.name || PRODUCT_MODEL_GROUP_LABELS.get(id) || id),
    );
    const models = group.models.map((model) => {
      if (!model || typeof model !== 'object') {
        throw new TypeError('Crawshrimp returned an invalid model');
      }
      const modelIdText = safeDisplayText(String(model.id || model.model || ''));
      if (!modelIdText) throw new TypeError('Crawshrimp returned a model without id');
      return {
        id: modelIdText,
        label: safeDisplayText(String(model.label || model.name || modelIdText)),
        provider: safeDisplayText(String(model.provider || '')),
        type: safeDisplayText(String(model.type || group.id || '')),
        runtimeModel: safeDisplayText(String(model.runtime_model || model.runtimeModel || '')),
        configured: model.configured === true,
        default: model.default === true,
        supportsSwitch: model.supports_switch === true || model.supportsSwitch === true,
      };
    });
    return {
      id,
      name,
      configuredCount: Number.isFinite(Number(group.configured_count))
        ? Number(group.configured_count)
        : models.filter((model) => model.configured).length,
      totalCount: Number.isFinite(Number(group.total_count))
        ? Number(group.total_count)
        : models.length,
      models,
    };
  });
  return {
    groups,
    configuredCount: Number.isFinite(Number(value.configured_count))
      ? Number(value.configured_count)
      : groups.reduce((sum, group) => sum + group.configuredCount, 0),
    totalCount: Number.isFinite(Number(value.total_count))
      ? Number(value.total_count)
      : groups.reduce((sum, group) => sum + group.totalCount, 0),
  };
}

function formatProductModelCatalog(catalog) {
  const lines = [
    t('抓虾已支持/已配置模型：'),
    t('已配置 {configured}/{total}', {
      configured: String(catalog.configuredCount),
      total: String(catalog.totalCount),
    }),
  ];
  for (const group of catalog.groups) {
    lines.push('', \`\${group.name}（\${group.configuredCount}/\${group.totalCount} 已配置）\`);
    if (group.models.length === 0) {
      lines.push(t('暂无模型。'));
      continue;
    }
    for (const model of group.models) {
      const badges = [];
      badges.push(model.configured ? t('已配置') : t('未配置'));
      if (model.default) badges.push(t('默认'));
      if (model.supportsSwitch) badges.push(t('可在聊天中切换'));
      const provider = model.provider ? \` · \${model.provider}\` : '';
      lines.push(\`- \${model.label} (\${model.id})\${provider} · \${badges.join(' / ')}\`);
    }
  }
  lines.push(
    '',
    t('LLM 可回复“切换模型到 <模型名>”切换；生图和生视频模型在对应工作台中使用。'),
  );
  return lines.join('\\n');
}

function currentModelMessage(catalog) {`,
      'dsh-im product model catalog formatting',
    )
    source = replaceExact(
      source,
      `async function listCatalog(harness, options) {
  if (typeof harness?.listModels !== 'function') {
    throw new TypeError('Harness does not support listing models');
  }
  return normalizeCatalog(await harness.listModels(options));
}

async function sessionCatalog(session, options) {`,
      `async function listCatalog(harness, options) {
  if (typeof harness?.listModels !== 'function') {
    throw new TypeError('Harness does not support listing models');
  }
  return normalizeCatalog(await harness.listModels(options));
}

async function listProductModelCatalog(harness, options) {
  if (typeof harness?.listCrawshrimpModelCatalog !== 'function') return null;
  return normalizeProductModelCatalog(await harness.listCrawshrimpModelCatalog(options));
}

async function sessionCatalog(session, options) {`,
      'dsh-im product model catalog loader',
    )
    source = replaceExact(
      source,
      `  if (natural?.action === 'list') {
    try {
      return commandResult(formatCatalog(await listCatalog(harness, requestOptions)));
    } catch (error) {
      return commandResult(modelErrorMessage(error, 'list'));
    }
  }`,
      `  if (natural?.action === 'list') {
    try {
      const productCatalog = await listProductModelCatalog(harness, requestOptions);
      if (productCatalog) return commandResult(formatProductModelCatalog(productCatalog));
      return commandResult(formatCatalog(await listCatalog(harness, requestOptions)));
    } catch (error) {
      return commandResult(modelErrorMessage(error, 'list'));
    }
  }`,
      'dsh-im natural all-model catalog action',
    )
  }
  if (source.includes(DSH_IM_MODEL_CATALOG_PATCH_MARKER)
    && !source.includes("runtimeModel: safeDisplayText(String(model.runtime_model || model.runtimeModel || ''))")) {
    source = replaceExact(
      source,
      `        provider: safeDisplayText(String(model.provider || '')),
        configured: model.configured === true,`,
      `        provider: safeDisplayText(String(model.provider || '')),
        type: safeDisplayText(String(model.type || group.id || '')),
        runtimeModel: safeDisplayText(String(model.runtime_model || model.runtimeModel || '')),
        configured: model.configured === true,`,
      'dsh-im product model runtime model field',
    )
  }
  return source
}

function patchDshImPermissionCommandSource(source) {
  if (!source.includes(`${DSH_IM_NATURAL_CONTROLS_PATCH_MARKER}: permission`)) {
    source = replaceExact(
      source,
      "const CONFIRM_FULL_ACCESS = '确认切换到完全访问';\nconst UNSAFE_TARGET_TEXT = /[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]/u;",
      `const CONFIRM_FULL_ACCESS = '确认切换到完全访问';
// ${DSH_IM_NATURAL_CONTROLS_PATCH_MARKER}: permission controls for mobile IM chats without menu access.
const UNSAFE_TARGET_TEXT = /[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]/u;`,
      'dsh-im natural permission marker',
    )
    source = replaceExact(
      source,
      `const PRESETS = Object.freeze({
  'read-only': Object.freeze({
    label: '只读（Read Only）',
    aliases: Object.freeze(['只读', '只读模式', 'read only']),
  }),
  'workspace-write': Object.freeze({
    label: '工作区写入（Workspace Write）',
    aliases: Object.freeze(['工作区写入', '允许工作区写入', 'workspace write']),
  }),
  'danger-full-access': Object.freeze({
    label: '完全访问（Full access）',
    aliases: Object.freeze(['完全访问', '完整访问', 'full access']),
  }),
});`,
      `const PRESETS = Object.freeze({
  'read-only': Object.freeze({
    label: '只读（Read Only）',
    aliases: Object.freeze(['只读', '只读模式', '只读权限', '只读审批', 'read only', 'read-only']),
  }),
  'workspace-write': Object.freeze({
    label: '工作区写入（Workspace Write）',
    aliases: Object.freeze([
      '工作区写入',
      '允许工作区写入',
      '允许写入工作区',
      '工作区写入权限',
      '打开审批模式',
      '开启审批',
      '打开审批',
      '恢复审批',
      '需要审批',
      '逐次审批',
      'ask',
      'workspace write',
      'workspace-write',
    ]),
  }),
  'danger-full-access': Object.freeze({
    label: '完全访问（Full access）',
    aliases: Object.freeze([
      '完全访问',
      '完整访问',
      '完全访问权限',
      '全权限',
      '关闭审批',
      '关闭审批模式',
      '去掉审批',
      '去除审批',
      '取消审批',
      '关掉审批',
      '取消审批模式',
      '不用审批',
      '不需要审批',
      '自动批准',
      '自动审批',
      '免审批',
      'never',
      'full access',
      'full assess',
      'full-access',
    ]),
  }),
});`,
      'dsh-im permission preset aliases',
    )
    source = replaceExact(
      source,
      `const QUERY_PHRASES = new Set([
  '当前什么权限',
  '查看审批权限',
  '现在是哪个权限模式',
  '有哪些权限',
]);`,
      `const QUERY_PHRASES = new Set([
  '当前什么权限',
  '当前权限',
  '查看权限',
  '查看审批权限',
  '现在是哪个权限模式',
  '现在是什么审批模式',
  '当前审批模式',
  '当前审批策略',
  '现在审批策略',
  '审批模式',
  '审批权限',
  '审批权限设置',
  '审批怎么设置',
  '修改审批权限',
  '调整审批权限',
  '更改审批权限',
  '有哪些权限',
  '有哪些审批权限',
  '权限列表',
]);`,
      'dsh-im permission query phrases',
    )
    source = replaceExact(
      source,
      "  const match = /^(?:切换到|设置为|设为)\\s*(.+)$/u.exec(normalized)\n    ?? /^允许\\s*(工作区写入)$/u.exec(normalized);\n  const target = match?.[1]?.trim();",
      "  const directPreset = PRESET_BY_ALIAS.get(normalized);\n  if (directPreset) return { action: 'select', preset: directPreset };\n\n  const match = /^(?:切换到|设置为|设为|改成|权限改成|审批权限改成|审批改成|设置审批为|审批设置为|把审批改成|把权限改成|开启|启用|打开)\\s*(.+)$/u.exec(normalized)\n    ?? /^允许\\s*(工作区写入|写入工作区)$/u.exec(normalized);\n  const target = match?.[1]?.trim();",
      'dsh-im natural permission parser',
    )
  }
  if (!source.includes("'去掉审批'")) {
    source = replaceExact(
      source,
      "      '关闭审批',\n      '不用审批',",
      "      '关闭审批',\n      '关闭审批模式',\n      '去掉审批',\n      '去除审批',\n      '取消审批',\n      '关掉审批',\n      '取消审批模式',\n      '不用审批',",
      'dsh-im extra no-approval aliases',
    )
  }
  if (!source.includes("'full assess'")) {
    source = replaceExact(
      source,
      "      'full access',\n      'full-access',",
      "      'full access',\n      'full assess',\n      'full-access',",
      'dsh-im full access typo alias',
    )
  }
  if (!source.includes("'现在是什么审批模式'")) {
    source = replaceExact(
      source,
      "  '现在是哪个权限模式',\n  '当前审批策略',",
      "  '现在是哪个权限模式',\n  '现在是什么审批模式',\n  '当前审批模式',\n  '当前审批策略',",
      'dsh-im approval mode query aliases',
    )
    source = replaceExact(
      source,
      "  '现在审批策略',\n  '审批权限',",
      "  '现在审批策略',\n  '审批模式',\n  '审批权限',",
      'dsh-im approval mode query phrase',
    )
  }
  if (!source.includes(`${DSH_IM_SESSION_PERMISSION_API_PATCH_MARKER}: permission manager`)) {
    source = replaceExact(
      source,
      `function presetLabel(preset) {`,
      `// ${DSH_IM_SESSION_PERMISSION_API_PATCH_MARKER}: permission manager uses direct session permission API.
function permissionPayloadPreset(payload) {
  if (!payload || typeof payload !== 'object'
    || typeof payload.preset !== 'string'
    || !payload.preset) {
    throw new TypeError('Harness returned an invalid permission payload');
  }
  if (!Object.hasOwn(PRESETS, payload.preset) && payload.preset !== 'custom') {
    throw new TypeError('Harness returned an unknown permission preset');
  }
  return payload.preset;
}

function presetLabel(preset) {`,
      'dsh-im permission payload parser',
    )
    source = replaceExact(
      source,
      `        if (typeof bound.session.executeCommand !== 'function') {
          const unavailable = new Error('Harness command execution is unavailable');
          unavailable.code = 'commands-unavailable';
          throw unavailable;
        }
        const preset = currentPreset(await bound.session.executeCommand(
          '/permission',
          rpcOptions,
        ));
        if (!preset) throw new TypeError('Harness returned an invalid current permission');`,
      `        if (typeof bound.session.permission !== 'function') {
          const unavailable = new Error('Harness permission API is unavailable');
          unavailable.code = 'commands-unavailable';
          throw unavailable;
        }
        const preset = permissionPayloadPreset(await bound.session.permission(rpcOptions));`,
      'dsh-im direct permission query',
    )
    source = replaceExact(
      source,
      `        if (typeof bound.session.executeCommand !== 'function') {
          const unavailable = new Error('Harness command execution is unavailable');
          unavailable.code = 'commands-unavailable';
          throw unavailable;
        }
        const changed = commandResultValue(await bound.session.executeCommand(
          permissionLine(preset),
          rpcOptions,
        ));
        if (changed.kind !== 'success') throw new Error('Harness rejected the permission preset');
        const actual = currentPreset(await bound.session.executeCommand(
          '/permission',
          rpcOptions,
        ));`,
      `        if (typeof bound.session.setPermission !== 'function') {
          const unavailable = new Error('Harness permission API is unavailable');
          unavailable.code = 'commands-unavailable';
          throw unavailable;
        }
        const actual = permissionPayloadPreset(await bound.session.setPermission(
          preset,
          rpcOptions,
        ));`,
      'dsh-im direct permission change',
    )
  }
  return source
}

function patchDshImHarnessApprovalSource(source) {
  if (!source.includes(`${DSH_IM_NATURAL_CONTROLS_PATCH_MARKER}: approval`)) {
    source = replaceExact(
      source,
      "import { t } from './i18n.mjs';",
      "import { t } from './i18n.mjs';\nimport { normalizeControlText } from './control-text.mjs';",
      'dsh-im approval control-text import',
    )
    source = replaceExact(
      source,
      "const APPROVAL_REPLIES = new Map([\n  ['批准', 'allowed-once'],\n  ['同意', 'allowed-once'],\n  ['yes', 'allowed-once'],\n  ['拒绝', 'rejected'],\n  ['不同意', 'rejected'],\n  ['no', 'rejected'],\n]);",
      `// ${DSH_IM_NATURAL_CONTROLS_PATCH_MARKER}: approval replies for mobile IM chats without card buttons.
const APPROVAL_REPLIES = new Map([
  ['批准', 'allowed-once'],
  ['批准执行', 'allowed-once'],
  ['同意', 'allowed-once'],
  ['同意执行', 'allowed-once'],
  ['确认', 'allowed-once'],
  ['确认批准', 'allowed-once'],
  ['确认执行', 'allowed-once'],
  ['允许', 'allowed-once'],
  ['允许执行', 'allowed-once'],
  ['可以', 'allowed-once'],
  ['可以了', 'allowed-once'],
  ['可以继续', 'allowed-once'],
  ['可以执行', 'allowed-once'],
  ['同意本次', 'allowed-once'],
  ['继续', 'allowed-once'],
  ['继续吧', 'allowed-once'],
  ['继续执行', 'allowed-once'],
  ['你继续', 'allowed-once'],
  ['执行吧', 'allowed-once'],
  ['马上执行', 'allowed-once'],
  ['yes', 'allowed-once'],
  ['ok', 'allowed-once'],
  ['okay', 'allowed-once'],
  ['y', 'allowed-once'],
  ['go', 'allowed-once'],
  ['拒绝', 'rejected'],
  ['不批准', 'rejected'],
  ['不同意', 'rejected'],
  ['不要', 'rejected'],
  ['不要执行', 'rejected'],
  ['不允许', 'rejected'],
  ['取消', 'rejected'],
  ['取消本次', 'rejected'],
  ['取消执行', 'rejected'],
  ['停止执行', 'rejected'],
  ['别执行', 'rejected'],
  ['算了', 'rejected'],
  ['no', 'rejected'],
  ['n', 'rejected'],
  ['reject', 'rejected'],
  ['deny', 'rejected'],
]);`,
      'dsh-im natural approval replies',
    )
    source = replaceExact(
      source,
      "const APPROVAL_PROMPT = '请精准回复「批准」或「拒绝」（也支持：同意 / 不同意 / yes / no）。';",
      "const APPROVAL_PROMPT = '请回复「确认执行」或「拒绝」（也支持：确认 / 继续 / 执行吧 / 可以 / 批准 / 同意 / 不同意 / yes / no）。';",
      'dsh-im natural approval prompt',
    )
    source = replaceExact(
      source,
      `export function harnessApprovalDecision(text) {
  return APPROVAL_REPLIES.get(cleanText(text).toLowerCase()) ?? null;
}`,
      `export function harnessApprovalDecision(text) {
  const normalized = normalizeControlText(text);
  return normalized ? APPROVAL_REPLIES.get(normalized) ?? null : null;
}`,
      'dsh-im natural approval decision normalization',
    )
  }
  if (!source.includes(DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER)) {
    source = replaceExact(
      source,
      "  ['允许执行', 'allowed-once'],\n  ['可以', 'allowed-once'],",
      "  ['允许执行', 'allowed-once'],\n  ['允许所有', 'allowed-all'],\n  ['全部允许', 'allowed-all'],\n  ['后续都允许', 'allowed-all'],\n  ['本会话都允许', 'allowed-all'],\n  ['不再询问', 'allowed-all'],\n  ['可以', 'allowed-once'],",
      'dsh-im approval allow-all replies',
    )
    source = replaceExact(
      source,
      "const APPROVAL_PROMPT = '请回复「确认执行」或「拒绝」（也支持：确认 / 继续 / 执行吧 / 可以 / 批准 / 同意 / 不同意 / yes / no）。';",
      `// ${DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER}: allow mobile IM users to approve the visible request and switch the bound Session to full access.
const APPROVAL_PROMPT = '请回复「确认执行」或「拒绝」（也支持：确认 / 继续 / 执行吧 / 可以 / 批准 / 同意 / 允许所有 / 不同意 / yes / no）。';`,
      'dsh-im approval allow-all prompt',
    )
    source = replaceExact(
      source,
      `function approvalResult(pending, outcome) {
  return {
    ok: true,
    value: {
      sessionId: pending.sessionId,
      approvalId: pending.approvalId,
      outcome,
    },
  };
}`,
      `function approvalResult(pending, outcome) {
  const resolvedOutcome = outcome === 'allowed-all' ? 'allowed-once' : outcome;
  return {
    ok: true,
    value: {
      sessionId: pending.sessionId,
      approvalId: pending.approvalId,
      outcome: resolvedOutcome,
    },
  };
}`,
      'dsh-im approval allow-all result outcome',
    )
    source = replaceExact(
      source,
      `function approvalOutcomeText(outcome) {
  if (outcome === 'allowed-once') return t('已批准，仅对本次操作有效。');
  if (outcome === 'rejected') return t('已拒绝此次操作。');
  return t(APPROVAL_RESOLVED_TEXT);
}`,
      `function approvalOutcomeText(outcome) {
  if (outcome === 'allowed-all') return t('已批准，并已切换当前会话为完全访问；后续需审批的命令将不再弹窗。');
  if (outcome === 'allowed-once') return t('已批准，仅对本次操作有效。');
  if (outcome === 'rejected') return t('已拒绝此次操作。');
  return t(APPROVAL_RESOLVED_TEXT);
}`,
      'dsh-im approval allow-all outcome text',
    )
    source = replaceExact(
      source,
      `      requiresMention: context.requiresMention === true,
      send,
      text,`,
      `      requiresMention: context.requiresMention === true,
      send,
      allowAll: typeof context.allowAll === 'function' ? context.allowAll : null,
      text,`,
      'dsh-im approval allow-all pending context',
    )
    source = replaceExact(
      source,
      `  async #submit(pending, outcome) {
    pending.submitting = true;
    try {
      await pending.interaction.respond(approvalResult(pending, outcome));
    } catch (error) {`,
      `  async #submit(pending, outcome) {
    pending.submitting = true;
    try {
      if (outcome === 'allowed-all') {
        if (typeof pending.allowAll !== 'function') throw new Error('approval allow-all is unavailable');
        await pending.allowAll({
          sessionId: pending.sessionId,
          approvalId: pending.approvalId,
        });
      }
      await pending.interaction.respond(approvalResult(pending, outcome));
    } catch (error) {`,
      'dsh-im approval allow-all submit permission first',
    )
    source = replaceExact(
      source,
      `      await pending.send(t('审批提交失败，请重新回复「批准」或「拒绝」。')).catch(() => undefined);`,
      `      await pending.send(t('审批提交失败，请重新回复「批准」「允许所有」或「拒绝」。')).catch(() => undefined);`,
      'dsh-im approval allow-all retry prompt',
    )
  }
  if (!source.includes(`${APPROVAL_DISPLAY_ARGUMENTS_PATCH_MARKER}: dsh-im-approval`)) {
    source = replaceExact(
      source,
      `function toolArguments(toolCall) {
  const source = toolCall?.arguments;
  if (source !== null && typeof source === 'object') {
    try {
      return JSON.stringify(source, null, 2);
    } catch {
      return null;
    }
  }
  if (typeof source !== 'string') return null;
  const raw = printableText(source);
  // Harness treats an empty tool argument string as an empty object.
  if (!raw) return source === '' ? '{}' : null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}`,
      `function argumentText(source) {
  if (source !== null && typeof source === 'object') {
    try {
      return JSON.stringify(source, null, 2);
    } catch {
      return null;
    }
  }
  if (typeof source !== 'string') return null;
  const raw = printableText(source);
  // Harness treats an empty tool argument string as an empty object.
  if (!raw) return source === '' ? '{}' : null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function toolArguments(toolCall) {
  return argumentText(toolCall?.arguments);
}

// ${APPROVAL_DISPLAY_ARGUMENTS_PATCH_MARKER}: dsh-im-approval renders external approval payload args when no tool/call snapshot is available.
function payloadArguments(payload) {
  return argumentText(payload?.arguments ?? payload?.toolArguments);
}`,
      'dsh-im approval argument helpers',
    )
    source = replaceExact(
      source,
      `  const callId = cleanText(payload.callId);
  if (!callId
    || cleanText(toolCall?.callId) !== callId
    || cleanText(toolCall?.name) !== cleanText(payload.toolName)) return null;
  const operation = toolArguments(toolCall);
  if (!operation || operation.length > maxArgumentsLength) return null;`,
      `  const callId = cleanText(payload.callId);
  let operation = null;
  if (toolCall) {
    if ((callId && cleanText(toolCall.callId) !== callId)
      || cleanText(toolCall.name) !== cleanText(payload.toolName)) return null;
    operation = toolArguments(toolCall);
  }
  if (!operation) operation = payloadArguments(payload);
  if (!operation || operation.length > maxArgumentsLength) return null;`,
      'dsh-im approval text payload argument fallback',
    )
  }
  if (!source.includes(`${APPROVAL_DISPLAY_ARGUMENTS_TRUNCATION_PATCH_MARKER}: payload args`)) {
    source = replaceExact(
    source,
    `function payloadArguments(payload) {
  return argumentText(payload?.arguments ?? payload?.toolArguments);
}
`,
    `function payloadArguments(payload) {
  return argumentText(payload?.arguments ?? payload?.toolArguments);
}

// ${APPROVAL_DISPLAY_ARGUMENTS_TRUNCATION_PATCH_MARKER}: payload args are display-only and may be pre-truncated.
function capPayloadArgumentsText(text, maxLength) {
  if (text.length <= maxLength) return text;
  const suffix = \`\\n...(truncated, original length \${text.length})\`;
  return \`\${text.slice(0, Math.max(0, maxLength - suffix.length))}\${suffix}\`;
}
`,
    'dsh-im approval payload argument truncation helper',
    )
    source = replaceExact(
      source,
    `  const callId = cleanText(payload.callId);
  let operation = null;
  if (toolCall) {
    if ((callId && cleanText(toolCall.callId) !== callId)
      || cleanText(toolCall.name) !== cleanText(payload.toolName)) return null;
    operation = toolArguments(toolCall);
  }
  if (!operation) operation = payloadArguments(payload);
  if (!operation || operation.length > maxArgumentsLength) return null;`,
    `  const callId = cleanText(payload.callId);
  let operation = null;
  let operationFromPayload = false;
  if (toolCall) {
    if ((callId && cleanText(toolCall.callId) !== callId)
      || cleanText(toolCall.name) !== cleanText(payload.toolName)) return null;
    operation = toolArguments(toolCall);
  }
  if (!operation) {
    operation = payloadArguments(payload);
    operationFromPayload = Boolean(operation);
  }
  if (!operation) return null;
  if (operation.length > maxArgumentsLength) {
    if (!operationFromPayload) return null;
    operation = capPayloadArgumentsText(operation, maxArgumentsLength);
  }`,
      'dsh-im approval text payload argument truncation',
    )
  }

  if (!source.includes(`${APPROVAL_DISPLAY_ARGUMENTS_MISMATCH_PATCH_MARKER}: payload args`)) {
    source = replaceExact(
      source,
      `  const callId = cleanText(payload.callId);
  let operation = null;
  let operationFromPayload = false;
  if (toolCall) {
    if ((callId && cleanText(toolCall.callId) !== callId)
      || cleanText(toolCall.name) !== cleanText(payload.toolName)) return null;
    operation = toolArguments(toolCall);
  }
  if (!operation) {
    operation = payloadArguments(payload);
    operationFromPayload = Boolean(operation);
  }
  if (!operation) return null;
  if (operation.length > maxArgumentsLength) {
    if (!operationFromPayload) return null;
    operation = capPayloadArgumentsText(operation, maxArgumentsLength);
  }`,
      `  const callId = cleanText(payload.callId);
  let operation = null;
  let operationFromPayload = false;
  const payloadOperation = payloadArguments(payload);
  if (toolCall) {
    const matchedToolCall = (!callId || cleanText(toolCall.callId) === callId)
      && cleanText(toolCall.name) === cleanText(payload.toolName);
    if (matchedToolCall) operation = toolArguments(toolCall);
  }
  if (!operation && payloadOperation) {
    operation = payloadOperation;
    operationFromPayload = true;
  }
  // ${APPROVAL_DISPLAY_ARGUMENTS_MISMATCH_PATCH_MARKER}: payload args keep IM approvals displayable when the local
  // product-facing tool name differs from the Harness snapshot tool name.
  if (!operation) return null;
  if (operation.length > maxArgumentsLength) {
    if (!operationFromPayload) return null;
    operation = capPayloadArgumentsText(operation, maxArgumentsLength);
  }`,
      'dsh-im approval text payload argument mismatch fallback',
    )
  }
  return patchDshImApprovalBriefCardSource(source)
}

function patchDshImApprovalBriefCardSource(source) {
  if (source.includes(DSH_IM_APPROVAL_BRIEF_CARD_PATCH_MARKER)) return source
  source = replaceExact(
    source,
    `const RESOLVED_ROUTE_TTL_MS = 5 * 60_000;
const MAX_RESOLVED_ROUTES = 2_048;`,
    `const RESOLVED_ROUTE_TTL_MS = 5 * 60_000;
const MAX_RESOLVED_ROUTES = 2_048;
// ${DSH_IM_APPROVAL_BRIEF_CARD_PATCH_MARKER}: mobile IM approvals show purpose plus brief parameters, not full tool JSON.
const MAX_APPROVAL_BRIEF_FIELDS = 6;
const MAX_APPROVAL_BRIEF_VALUE = 80;`,
    'dsh-im approval brief constants',
  )
  source = replaceExact(
    source,
    `function argumentText(source) {
  if (source !== null && typeof source === 'object') {
    try {
      return JSON.stringify(source, null, 2);
    } catch {
      return null;
    }
  }
  if (typeof source !== 'string') return null;
  const raw = printableText(source);
  // Harness treats an empty tool argument string as an empty object.
  if (!raw) return source === '' ? '{}' : null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}`,
    `function briefValue(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return \`[\${value.length}项]\`;
  if (typeof value === 'object') return '[对象]';
  let text = printableText(String(value));
  if (text.length > MAX_APPROVAL_BRIEF_VALUE) {
    text = \`\${text.slice(0, MAX_APPROVAL_BRIEF_VALUE)}...\`;
  }
  return text;
}

function collectBriefFields(source, fields, prefix = '') {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return;
  for (const [key, value] of Object.entries(source)) {
    if (fields.length >= MAX_APPROVAL_BRIEF_FIELDS) return;
    const safeKey = printableText(String(key));
    if (!safeKey) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)
      && ['summary', 'params', 'arguments', 'plan'].includes(safeKey)) {
      collectBriefFields(value, fields, \`\${prefix}\${safeKey}.\`);
      continue;
    }
    const safeValue = briefValue(value);
    if (!safeValue) continue;
    fields.push(\`\${prefix}\${safeKey}=\${safeValue}\`);
  }
}

function briefObjectText(source) {
  const fields = [];
  collectBriefFields(source, fields);
  return fields.length > 0 ? fields.join('\\n') : null;
}

function argumentText(source) {
  if (source !== null && typeof source === 'object') {
    return briefObjectText(source);
  }
  if (typeof source !== 'string') return null;
  const raw = printableText(source);
  // Harness treats an empty tool argument string as an empty object.
  if (!raw) return source === '' ? '{}' : null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object') return briefObjectText(parsed);
    return printableText(String(parsed));
  } catch {
    return raw;
  }
}`,
    'dsh-im approval brief argument preview',
  )
  source = replaceExact(
    source,
    `  const payloadOperation = payloadArguments(payload);
  if (toolCall) {
    const matchedToolCall = (!callId || cleanText(toolCall.callId) === callId)
      && cleanText(toolCall.name) === cleanText(payload.toolName);
    if (matchedToolCall) operation = toolArguments(toolCall);
  }
  if (!operation && payloadOperation) {
    operation = payloadOperation;
    operationFromPayload = true;
  }`,
    `  const payloadOperation = payloadArguments(payload);
  if (payloadOperation) {
    operation = payloadOperation;
    operationFromPayload = true;
  }
  if (!operation && toolCall) {
    const matchedToolCall = (!callId || cleanText(toolCall.callId) === callId)
      && cleanText(toolCall.name) === cleanText(payload.toolName);
    if (matchedToolCall) operation = toolArguments(toolCall);
  }`,
    'dsh-im approval brief prefers payload display args',
  )
  return replaceExact(
    source,
    `  const lines = [
    t('DeepSeek Harness 需要你的审批：'),
    '',
    t('工具：{tool}', { tool: printableText(payload.toolName) }),
    t('操作参数：'),
    operation,
  ];
  const reason = printableText(payload.reason);
  if (reason) lines.push(t('原因：{reason}', { reason }));
  lines.push('', t(APPROVAL_PROMPT));`,
    `  const lines = [
    t('抓虾 Harness 需要你的审批'),
    '',
    t('步骤：{step}', { step: printableText(payload.toolName) }),
  ];
  const reason = printableText(payload.reason);
  if (reason) lines.push(t('说明：{reason}', { reason }));
  lines.push(t('简略参数：'), operation);
  lines.push('', t(APPROVAL_PROMPT));`,
    'dsh-im approval brief card text',
  )
}

function upgradeDshImApprovalAllowAllPermissionApiSource(source) {
  let next = source.replaceAll(
    `          if (!session || typeof session.executeCommand !== 'function') {
            throw new Error('Harness permission command is unavailable');
          }`,
    `          if (!session || typeof session.setPermission !== 'function') {
            throw new Error('Harness permission API is unavailable');
          }`,
  )
  next = next.replaceAll(
    `          const options = this.#signal ? { signal: this.#signal } : undefined;
          const changed = await session.executeCommand('/permission danger-full-access', options);
          if (changed?.result?.kind !== 'success') throw new Error('Harness rejected permission allow-all');
          const current = await session.executeCommand('/permission', options);
          const currentText = String(current?.result?.text || '').trim();
          if (!/^current preset danger-full-access \\(/u.test(currentText)) {
            throw new Error('Harness permission allow-all readback mismatch');
          }`,
    `          const options = this.#signal ? { signal: this.#signal } : undefined;
          const current = await session.setPermission('danger-full-access', options);
          if (current?.preset !== 'danger-full-access') {
            throw new Error('Harness permission allow-all readback mismatch');
          }`,
  )
  return next
}

function patchDshImTextBridgeApprovalAllowAllSource(source) {
  source = upgradeDshImApprovalAllowAllPermissionApiSource(source)
  if (source.includes(DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER)) {
    return source
  }
  return replaceExact(
    source,
    `        requiresMention,
        send: (text) => this.#bot.sendText(target, text),
      });`,
    `        requiresMention,
        send: (text) => this.#bot.sendText(target, text),
        // ${DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER}: allow-all is only available for the currently displayed same-actor approval.
        allowAll: async () => {
          const sessionId = typeof this.#state.sessionFor === 'function'
            ? this.#state.sessionFor(key)
            : null;
          if (sessionId !== interaction.sessionId) throw new Error('approval session binding changed');
          if (typeof this.#harness.workspaceSession !== 'function') {
            throw new Error('Harness workspace session is unavailable');
          }
          const session = this.#harness.workspaceSession(sessionId);
          if (!session || typeof session.setPermission !== 'function') {
            throw new Error('Harness permission API is unavailable');
          }
          const options = this.#signal ? { signal: this.#signal } : undefined;
          const current = await session.setPermission('danger-full-access', options);
          if (current?.preset !== 'danger-full-access') {
            throw new Error('Harness permission allow-all readback mismatch');
          }
        },
      });`,
    'dsh-im text bridge approval allow-all callback',
  )
}

function patchDshImTextHarnessBridgeSource(source) {
  if (source.includes(`${DSH_IM_NATURAL_CONTROLS_PATCH_MARKER}: text bridge commands`)) {
    return patchDshImTextBridgeApprovalAllowAllSource(source)
  }
  if (!source.includes('PermissionCommandManager')) {
    const withExistingModelImport = source.replace(
      `import {
  isModelCommand,
  runModelCommand,
} from './model-command.mjs';
import {
  isPresetCommand,
  runPresetCommand,
} from './preset-command.mjs';`,
      `import {
  isModelCommand,
  runModelCommand,
} from './model-command.mjs';
import {
  isPermissionCommand,
  PermissionCommandManager,
} from './permission-command.mjs';
import {
  isPresetCommand,
  runPresetCommand,
} from './preset-command.mjs';`,
    )
    source = withExistingModelImport !== source
      ? withExistingModelImport
      : replaceExact(
        source,
        `import {
  isPresetCommand,
  runPresetCommand,
} from './preset-command.mjs';
import { askInWorkspaceSession } from './workspace-session.mjs';`,
        `import {
  isPresetCommand,
  runPresetCommand,
} from './preset-command.mjs';
import {
  isModelCommand,
  runModelCommand,
} from './model-command.mjs';
import {
  isPermissionCommand,
  PermissionCommandManager,
} from './permission-command.mjs';
import { askInWorkspaceSession } from './workspace-session.mjs';`,
        'dsh-im text bridge natural command imports',
      )
  }
  if (!source.includes('#permissions = new PermissionCommandManager();')) {
    const withSessionControls = source.replace(
      `  #approvals;
  #sessionControls = new SessionControlDispatcher();
  #batches = new BatchInputManager();`,
      `  #approvals;
  #sessionControls = new SessionControlDispatcher();
  #permissions = new PermissionCommandManager();
  #batches = new BatchInputManager();`,
    )
    source = withSessionControls !== source
      ? withSessionControls
      : replaceExact(
        source,
        `  #approvals;
  #batches = new BatchInputManager();`,
        `  #approvals;
  #permissions = new PermissionCommandManager();
  #batches = new BatchInputManager();`,
        'dsh-im text bridge permission manager',
      )
  }
  const withSessionControlRunner = source.replace(
    `    const commandRunner = collectingBatch || hasFiles ? null : isControlCommand(text)
      ? runControlCommand
      : (sessionControlRunner ?? (isPresetCommand(text) ? runPresetCommand : null));`,
    `    // ${DSH_IM_NATURAL_CONTROLS_PATCH_MARKER}: text bridge commands for mobile IM chats without toolbar access.
    const commandRunner = collectingBatch || hasFiles ? null : isControlCommand(text)
      ? runControlCommand
      : (sessionControlRunner
        ?? (isPresetCommand(text) ? runPresetCommand : null)
        ?? (isModelCommand(text) ? runModelCommand : null)
        ?? (!hasImages && isPermissionCommand(text) ? this.#permissions.run.bind(this.#permissions) : null));`,
  )
  if (withSessionControlRunner !== source) {
    return patchDshImTextBridgeApprovalAllowAllSource(withSessionControlRunner)
  }
  return patchDshImTextBridgeApprovalAllowAllSource(replaceExact(
    source,
    `    const commandRunner = collectingBatch || hasInboundFiles(normalized) ? null : isControlCommand(text)
      ? runControlCommand
      : (isModelCommand(text)
          ? runModelCommand
          : (isPresetCommand(text) ? runPresetCommand : null));`,
    `    // ${DSH_IM_NATURAL_CONTROLS_PATCH_MARKER}: text bridge commands for mobile IM chats without toolbar access.
    const commandRunner = collectingBatch || hasInboundFiles(normalized) ? null : isControlCommand(text)
      ? runControlCommand
      : (isModelCommand(text)
          ? runModelCommand
          : (isPresetCommand(text)
            ? runPresetCommand
            : (!hasInboundImages(normalized) && isPermissionCommand(text)
              ? this.#permissions.run.bind(this.#permissions)
              : null)));`,
    'dsh-im text bridge natural command routing',
  ))
}

function patchDshImWeixinBridgeApprovalAllowAllSource(source) {
  source = upgradeDshImApprovalAllowAllPermissionApiSource(source)
  if (source.includes(DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER)) {
    return source
  }
  return replaceExact(
    source,
    `        actor,
        send: (text) => this.#send(actor, text, contextToken, runId),
      });`,
    `        actor,
        send: (text) => this.#send(actor, text, contextToken, runId),
        // ${DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER}: allow-all is only available for the currently displayed same-actor approval.
        allowAll: async () => {
          const sessionId = typeof this.#state.sessionFor === 'function'
            ? this.#state.sessionFor(key)
            : null;
          if (sessionId !== interaction.sessionId) throw new Error('approval session binding changed');
          if (typeof this.#harness.workspaceSession !== 'function') {
            throw new Error('Harness workspace session is unavailable');
          }
          const session = this.#harness.workspaceSession(sessionId);
          if (!session || typeof session.setPermission !== 'function') {
            throw new Error('Harness permission API is unavailable');
          }
          const options = this.#signal ? { signal: this.#signal } : undefined;
          const current = await session.setPermission('danger-full-access', options);
          if (current?.preset !== 'danger-full-access') {
            throw new Error('Harness permission allow-all readback mismatch');
          }
        },
      });`,
    'dsh-im weixin bridge approval allow-all callback',
  )
}

function patchDshImWeixinBridgeSource(source) {
  if (source.includes(`${DSH_IM_NATURAL_CONTROLS_PATCH_MARKER}: weixin bridge commands`)) {
    return patchDshImWeixinBridgeApprovalAllowAllSource(source)
  }
  if (!source.includes('PermissionCommandManager')) {
    const withExistingModelImport = source.replace(
      `import {
  isModelCommand,
  runModelCommand,
} from '../shared/model-command.mjs';
import {
  isPresetCommand,
  runPresetCommand,
} from '../shared/preset-command.mjs';`,
      `import {
  isModelCommand,
  runModelCommand,
} from '../shared/model-command.mjs';
import {
  isPermissionCommand,
  PermissionCommandManager,
} from '../shared/permission-command.mjs';
import {
  isPresetCommand,
  runPresetCommand,
} from '../shared/preset-command.mjs';`,
    )
    source = withExistingModelImport !== source
      ? withExistingModelImport
      : replaceExact(
        source,
        `import {
  isPresetCommand,
  runPresetCommand,
} from '../shared/preset-command.mjs';
import { runWorkspaceCommand } from '../shared/workspace-command.mjs';`,
        `import {
  isPresetCommand,
  runPresetCommand,
} from '../shared/preset-command.mjs';
import {
  isModelCommand,
  runModelCommand,
} from '../shared/model-command.mjs';
import {
  isPermissionCommand,
  PermissionCommandManager,
} from '../shared/permission-command.mjs';
import { runWorkspaceCommand } from '../shared/workspace-command.mjs';`,
        'dsh-im weixin bridge natural command imports',
      )
  }
  if (!source.includes('#permissions = new PermissionCommandManager();')) {
    const withSessionControls = source.replace(
      `  #approvals;
  #sessionControls = new SessionControlDispatcher();
  #batchInputs = new BatchInputManager();`,
      `  #approvals;
  #sessionControls = new SessionControlDispatcher();
  #permissions = new PermissionCommandManager();
  #batchInputs = new BatchInputManager();`,
    )
    source = withSessionControls !== source
      ? withSessionControls
      : replaceExact(
        source,
        `  #approvals;
  #batchInputs = new BatchInputManager();`,
        `  #approvals;
  #permissions = new PermissionCommandManager();
  #batchInputs = new BatchInputManager();`,
        'dsh-im weixin bridge permission manager',
      )
  }
  const withSessionControlRunner = source.replace(
    `    const commandRunner = hasFiles ? null : isControlCommand(commandText)
      ? runControlCommand
      : (sessionControlRunner ?? (isPresetCommand(commandText) ? runPresetCommand : null));`,
    `    // ${DSH_IM_NATURAL_CONTROLS_PATCH_MARKER}: weixin bridge commands for mobile chats without toolbar access.
    const commandRunner = hasFiles ? null : isControlCommand(commandText)
      ? runControlCommand
      : (sessionControlRunner
        ?? (isPresetCommand(commandText) ? runPresetCommand : null)
        ?? (isModelCommand(commandText) ? runModelCommand : null)
        ?? (!hasImages && isPermissionCommand(commandText) ? this.#permissions.run.bind(this.#permissions) : null));`,
  )
  if (withSessionControlRunner !== source) {
    return patchDshImWeixinBridgeApprovalAllowAllSource(withSessionControlRunner)
  }
  const withLocalFlagsRunner = source.replace(
    `    const commandRunner = hasFiles ? null : isControlCommand(commandText)
      ? runControlCommand
      : (isModelCommand(commandText)
          ? runModelCommand
          : (isPresetCommand(commandText) ? runPresetCommand : null));`,
    `    // ${DSH_IM_NATURAL_CONTROLS_PATCH_MARKER}: weixin bridge commands for mobile chats without toolbar access.
    const commandRunner = hasFiles ? null : isControlCommand(commandText)
      ? runControlCommand
      : (isModelCommand(commandText)
          ? runModelCommand
          : (isPresetCommand(commandText)
            ? runPresetCommand
            : (!hasImages && isPermissionCommand(commandText)
              ? this.#permissions.run.bind(this.#permissions)
              : null)));`,
  )
  if (withLocalFlagsRunner !== source) {
    return patchDshImWeixinBridgeApprovalAllowAllSource(withLocalFlagsRunner)
  }
  return patchDshImWeixinBridgeApprovalAllowAllSource(replaceExact(
    source,
    `    const commandRunner = hasWeixinFileItems(message) ? null : isControlCommand(commandText)
      ? runControlCommand
      : (isModelCommand(commandText)
          ? runModelCommand
          : (isPresetCommand(commandText) ? runPresetCommand : null));`,
    `    // ${DSH_IM_NATURAL_CONTROLS_PATCH_MARKER}: weixin bridge commands for mobile chats without toolbar access.
    const commandRunner = hasWeixinFileItems(message) ? null : isControlCommand(commandText)
      ? runControlCommand
      : (isModelCommand(commandText)
          ? runModelCommand
          : (isPresetCommand(commandText)
            ? runPresetCommand
            : (!hasWeixinImageItems(message) && isPermissionCommand(commandText)
              ? this.#permissions.run.bind(this.#permissions)
              : null)));`,
    'dsh-im weixin bridge natural command routing',
  ))
}

function approvalAllowAllSource() {
  return `        // ${DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER}: allow-all is only available for the currently displayed same-actor approval.
        allowAll: async () => {
          const sessionId = typeof this.#state.sessionFor === 'function'
            ? this.#state.sessionFor(key)
            : null;
          if (sessionId !== interaction.sessionId) throw new Error('approval session binding changed');
          if (typeof this.#harness.workspaceSession !== 'function') {
            throw new Error('Harness workspace session is unavailable');
          }
          const session = this.#harness.workspaceSession(sessionId);
          if (!session || typeof session.setPermission !== 'function') {
            throw new Error('Harness permission API is unavailable');
          }
          const options = this.#signal ? { signal: this.#signal } : undefined;
          const current = await session.setPermission('danger-full-access', options);
          if (current?.preset !== 'danger-full-access') {
            throw new Error('Harness permission allow-all readback mismatch');
          }
        },`
}

function patchDshImDingtalkBridgeApprovalAllowAllSource(source) {
  if (source.includes(DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER)) {
    return source
  }
  return replaceExact(
    source,
    `      actor,
      requiresMention,
      send: (text) => this.#send(sessionWebhook, text),
    })) return;`,
    `      actor,
      requiresMention,
      send: (text) => this.#send(sessionWebhook, text),
${approvalAllowAllSource()}
    })) return;`,
    'dsh-im dingtalk bridge approval allow-all callback',
  )
}

function patchDshImFeishuBridgeApprovalAllowAllSource(source) {
  if (source.includes(DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER)) {
    return source
  }
  return replaceExact(
    source,
    `      actor,
      requiresMention,
      send: (text) => this.#send(chatId, text),
    })) return;`,
    `      actor,
      requiresMention,
      send: (text) => this.#send(chatId, text),
${approvalAllowAllSource()}
    })) return;`,
    'dsh-im feishu bridge approval allow-all callback',
  )
}

function patchDshImQqBridgeApprovalAllowAllSource(source) {
  if (source.includes(DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER)) {
    return source
  }
  return replaceExact(
    source,
    `        actor,
        requiresMention,
        send: (text) => this.#bot.sendText(target, text),
      });`,
    `        actor,
        requiresMention,
        send: (text) => this.#bot.sendText(target, text),
${approvalAllowAllSource()}
      });`,
    'dsh-im qq bridge approval allow-all callback',
  )
}

function patchDshImWecomBridgeApprovalAllowAllSource(source) {
  if (source.includes(DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER)) {
    return source
  }
  return replaceExact(
    source,
    `        actor,
        requiresMention,
        send: (text) => this.#sendActive(chatId, text),
      });`,
    `        actor,
        requiresMention,
        send: (text) => this.#sendActive(chatId, text),
${approvalAllowAllSource()}
      });`,
    'dsh-im wecom bridge approval allow-all callback',
  )
}

function patchDshImBundledHostCurrent230(source) {
  if (!source.includes('var Ice=/^\\/model(?=$|\\s)/i')) return source

  source = replaceRange(
    source,
    'var Tge=new Map([["\\u6279\\u51C6"',
    ',Nge=',
    `/* ${DSH_IM_NATURAL_CONTROLS_PATCH_MARKER}: approval replies for mobile IM chats without card buttons. */var Tge=new Map([["批准","allowed-once"],["批准执行","allowed-once"],["同意","allowed-once"],["同意执行","allowed-once"],["确认","allowed-once"],["确认批准","allowed-once"],["确认执行","allowed-once"],["允许","allowed-once"],["允许执行","allowed-once"],["可以","allowed-once"],["可以了","allowed-once"],["可以继续","allowed-once"],["可以执行","allowed-once"],["同意本次","allowed-once"],["继续","allowed-once"],["继续吧","allowed-once"],["继续执行","allowed-once"],["你继续","allowed-once"],["执行吧","allowed-once"],["马上执行","allowed-once"],["yes","allowed-once"],["ok","allowed-once"],["okay","allowed-once"],["y","allowed-once"],["go","allowed-once"],["拒绝","rejected"],["不批准","rejected"],["不同意","rejected"],["不要","rejected"],["不要执行","rejected"],["不允许","rejected"],["取消","rejected"],["取消本次","rejected"],["取消执行","rejected"],["停止执行","rejected"],["别执行","rejected"],["算了","rejected"],["no","rejected"],["n","rejected"],["reject","rejected"],["deny","rejected"]]),wb="请回复「确认执行」或「拒绝」（也支持：确认 / 继续 / 执行吧 / 可以 / 批准 / 同意 / 不同意 / yes / no）。"`,
    'bundled dsh-im current approval replies',
  )
  source = replaceExact(
    source,
    'function Ob(n){return ya(n).replace(/[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]/g,"")}function vge(n){return Tge.get(ya(n).toLowerCase())??null}',
    'function Ob(n){return ya(n).replace(/[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]/g,"")}function cshApprovalControlText(n){return Ob(n).replace(/[？?。！!，,；;：:]+$/gu,"").replace(/\\s+/gu," ").trim().toLowerCase()}function vge(n){let t=cshApprovalControlText(n);return t?Tge.get(t)??null:null}',
    'bundled dsh-im current approval decision normalization',
  )
  source = replaceExact(
    source,
    'hce=/[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]+/gu;function pt',
      `hce=/[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]+/gu,cshUnsafeControl=/[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]/u,cshNaturalModelList=new Set(["有哪些模型","列出所有模型","列出所有可用模型","列出可用模型","查看可用模型","查看模型","模型列表","可用模型","所有模型","可以切换模型吗","能切换模型吗","怎么切换模型"]),cshNaturalModelCurrent=new Set(["当前是什么模型","现在用的哪个模型","当前模型","现在模型","用的什么模型","现在是什么模型"]),cshNaturalModelSelect=Object.freeze([/^切换到\\s*(.+)$/u,/^切换模型到\\s*(.+)$/u,/^切(?:到|成|为)\\s*(.+)$/u,/^换到\\s*(.+)$/u,/^换成\\s*(.+)$/u,/^改用\\s*(.+)$/u,/^使用\\s+(.+?)\\s*模型$/u,/^用\\s*(.+?)\\s*模型$/u,/^模型(?:切换到|换成|改成|设置为|设为)\\s*(.+)$/u]),cshSafeModelAliases=${bundledNaturalModelAliasMapSource()};/* ${DSH_IM_NATURAL_MODEL_ALIASES_PATCH_MARKER}: bundled current */function cshNormalizeControlText(n){return typeof n!="string"?"":n.replace(hce," ").replace(/[？?。！!，,；;：:]+$/gu,"").replace(/\\s+/gu," ").trim()}function cshNormalizeModelLookup(n){let t=cshNormalizeControlText(n).toLocaleLowerCase("en-US");for(let o of["模型","model"])if(t.endsWith(o)){let i=t.slice(0,-o.length).trim();if(i)t=i}return t.replace(/[\\s_.-]+/g,"")}/* cshStripModelLookupSuffix */function cshNaturalModelCommand(n){let t=cshNormalizeControlText(n);if(!t)return null;if(cshNaturalModelList.has(t))return{action:"list"};if(cshNaturalModelCurrent.has(t))return{action:"current"};for(let o of cshNaturalModelSelect){let i=o.exec(t);if(!i)continue;let e=i[1].trim();return!e||e.length>256||cshUnsafeControl.test(e)?null:{action:"select",requested:e}}return null}function pt`,
    'bundled dsh-im current natural model constants',
  )
  source = replaceExact(
    source,
    'function fce(n,t){for(let o of n.groups)for(let i of o.models)if(fs(o.id,i.id)===t)return{provider:o.id,model:i.id};return null}function Qce',
    `function fce(n,t){for(let o of n.groups)for(let i of o.models)if(fs(o.id,i.id)===t)return{provider:o.id,model:i.id};return null}function cshNaturalModelCandidates(n){return n.groups.flatMap(t=>t.models.map(o=>({provider:t.id,model:o.id,displayName:o.name,fullId:fs(t.id,o.id)})))}function cshNaturalModelMatches(n,t){let o=t.toLocaleLowerCase("en-US"),i=cshNormalizeModelLookup(t);if(!i)return[];let e=cshNaturalModelCandidates(n),a=[A=>A.fullId.toLocaleLowerCase("en-US")===o,A=>cshSafeModelAliases.get(i)===A.fullId,A=>cshNormalizeModelLookup(A.model)===i,A=>cshNormalizeModelLookup(A.displayName)===i];for(let A of a){let r=e.filter(A);if(r.length>0)return r}return[]}function cshAmbiguousNaturalModelMessage(n){return[D("找到多个匹配的模型，请使用 provider/model 明确指定："),"",...n.map(({fullId:t})=>"- "+jr(t)).sort(),"",D("例如：模型改成 provider/model")].join("\\n")}function cshMissingNaturalModelMessage(n){return[D("没有找到模型：{model}",{model:jr(n)}),"",D("请发送“列出所有可用模型”查看可用模型。")].join("\\n")}function Qce`,
    'bundled dsh-im current natural model matching helpers',
  )
  source = replaceExact(
    source,
    'async function vb(n,t,o){if(typeof n?.selectModel!="function")throw new TypeError("Harness session does not support model selection");let i=(await n.selectModel(t,o))?.selected;if(!Bce(i,t))throw UH(t,i,"selectModel.selected");let e=(await Kc(n,o)).current;if(!uce(e,i))throw UH(i,e,"models.current");return e}function _ce',
    `async function vb(n,t,o){if(typeof n?.selectModel!="function")throw new TypeError("Harness session does not support model selection");let i=(await n.selectModel(t,o))?.selected;if(!Bce(i,t))throw UH(t,i,"selectModel.selected");let e=(await Kc(n,o)).current;if(!uce(e,i))throw UH(i,e,"models.current");return e}var cshPermissionTtlMs=12e4,cshConfirmFullAccess="确认切换到完全访问",cshPermissionPresets=Object.freeze({"read-only":Object.freeze({label:"只读（Read Only）",aliases:Object.freeze(["只读","只读模式","只读权限","只读审批","read only","read-only"])}),"workspace-write":Object.freeze({label:"工作区写入（Workspace Write）",aliases:Object.freeze(["工作区写入","允许工作区写入","允许写入工作区","工作区写入权限","开启审批","打开审批","恢复审批","需要审批","逐次审批","ask","workspace write","workspace-write"])}),"danger-full-access":Object.freeze({label:"完全访问（Full access）",aliases:Object.freeze(["完全访问","完整访问","完全访问权限","全权限","关闭审批","不用审批","不需要审批","自动批准","自动审批","免审批","never","full access","full-access"])})}),cshPermissionQueries=new Set(["当前什么权限","当前权限","查看权限","查看审批权限","现在是哪个权限模式","当前审批策略","现在审批策略","审批权限","审批权限设置","审批怎么设置","修改审批权限","调整审批权限","更改审批权限","有哪些权限","有哪些审批权限","权限列表"]),cshPermissionAliases=new Map(Object.entries(cshPermissionPresets).flatMap(([n,t])=>t.aliases.map(o=>[o,n]))),cshPermissionPending=new Map;function cshPermissionCommand(n){let t=cshNormalizeControlText(n);if(!t)return null;if(cshPermissionQueries.has(t))return{action:"query"};if(t===cshConfirmFullAccess)return{action:"confirm-full-access"};let o=cshPermissionAliases.get(t);if(o)return{action:"select",preset:o};let i=(/^(?:切换到|设置为|设为|改成|权限改成|审批权限改成|审批改成|设置审批为|审批设置为|把审批改成|把权限改成)\\s*(.+)$/u.exec(t)??/^允许\\s*(工作区写入|写入工作区)$/u.exec(t))?.[1]?.trim();if(!i||i.length>128||cshUnsafeControl.test(i))return null;let e=cshPermissionAliases.get(i);return e?{action:"select",preset:e}:null}function cshPermissionCleanIdentity(n){return typeof n=="string"&&n.trim()?n.trim():null}function cshPermissionLine(n){if(!Object.hasOwn(cshPermissionPresets,n))throw new TypeError("Unsupported permission preset");return"/permission "+n}function cshPermissionResultValue(n){if(n===void 0){let t=new Error("Harness permission command is unavailable");throw t.code="commands-unavailable",t}let t=n?.result;if(!t||typeof t!="object"||!["success","error"].includes(t.kind)||t.text!==void 0&&typeof t.text!="string")throw new TypeError("Harness returned an invalid permission command result");return t}function cshCurrentPermission(n){let t=cshPermissionResultValue(n);if(t.kind!=="success"||typeof t.text!="string")return null;let o=/^current preset ([^\\s()]+) \\(available: ([^)]+)\\)$/u.exec(t.text.trim());return!o||!Object.hasOwn(cshPermissionPresets,o[1])&&o[1]!=="custom"?null:o[1]}function cshPermissionLabel(n){return cshPermissionPresets[n]?.label??D("自定义权限")}function cshPermissionSummary(n){return D("当前权限：\\n{preset}\\n\\n仅影响当前聊天绑定的 Session。\\n可选权限：只读（Read Only）/ 工作区写入（Workspace Write）/ 完全访问（Full access）",{preset:cshPermissionLabel(n)})}function cshPermissionChanged(n){let t=n==="danger-full-access"?D("审批策略已关闭（never），后续需审批的命令将不再弹窗。"):D("逐次审批已恢复；需要额外授权的操作仍会请求确认。");return D("权限已切换为：\\n{preset}\\n\\n仅影响当前聊天绑定的 Session。\\n{suffix}",{preset:cshPermissionLabel(n),suffix:t})}function cshFullAccessWarning(){return D("准备切换到完全访问（Full access），尚未修改权限。\\n\\n风险：\\n- 可访问工作区外文件\\n- 审批策略将变为 never\\n- 后续需审批的命令将不再弹窗\\n\\n如确认，请在 2 分钟内发送完整短句：\\n确认切换到完全访问")}function cshPendingInteractionMessage(){return D("当前任务正在等待你的回答或审批。\\n\\n请先处理当前请求，或者发送 /stop 停止任务。")}function cshPermissionError(n,{query:t=!1,mismatch:o=!1}={}){let i=n?.code??n?.failure?.code;if(i==="commands-unavailable")return D("当前 Harness 不支持通过 IM 进行权限切换或查询。");if(i==="agent-busy")return D("当前任务正在运行，请等待完成或先发送 /stop。");if(i==="session-not-found")return D("当前聊天绑定的会话已不存在，请发送新消息开启会话。");if(i===ei||i==="workspace-bot-not-found")return D("工作区或机器人状态已发生变化，权限未切换，请重试。");if(n?.name==="AbortError"||i==="cancelled")return t?D("权限查询已取消。"):D("权限切换已取消，权限未切换。");return o?D("权限写入结果未能确认，请检查桌面端；本次操作状态未知。"):t?D("暂时无法查询当前权限，请稍后重试。"):D("权限未切换，请稍后重试。")}function cshPermissionPrune(n,t){for(let[o,i]of cshPermissionPending)i.expiresAt<n&&o!==t&&cshPermissionPending.delete(o)}async function cshPermissionQuery(n,t,o,i){let e=Ece(i.signal);try{return await Lc(t,o,async()=>{let a=await Tl(n,t,o,e);if(!a)return pt(D("当前聊天没有绑定会话，请先发送消息开始会话。"));if(typeof a.session.executeCommand!="function"){let A=new Error("Harness command execution is unavailable");throw A.code="commands-unavailable",A}let A=cshCurrentPermission(await a.session.executeCommand("/permission",e));if(!A)throw new TypeError("Harness returned an invalid current permission");return t.sessionFor(o)!==a.sessionId?pt(D("当前聊天绑定的会话已发生变化，请重试权限查询。")):pt(cshPermissionSummary(A))})}catch(a){return pt(cshPermissionError(a,{query:!0}))}}async function cshPermissionChange(n,t,o,i,e,a){let A=Ece(e.signal);try{return await Lc(o,i,async()=>{let r=await Tl(t,o,i,A);if(!r)return pt(D("当前聊天没有绑定会话，请先发送消息开始会话。"));if(a&&r.sessionId!==a)return pt(D("当前聊天绑定的会话已变化，完全访问确认已失效，请重新发起。"));if(await jH(r.session,e.control,A))return pt(D("当前任务正在运行，请等待完成或先发送 /stop。"));if(typeof r.session.executeCommand!="function"){let s=new Error("Harness command execution is unavailable");throw s.code="commands-unavailable",s}if(cshPermissionResultValue(await r.session.executeCommand(cshPermissionLine(n),A)).kind!=="success")throw new Error("Harness rejected the permission preset");if(cshCurrentPermission(await r.session.executeCommand("/permission",A))!==n){let s=new Error("Harness permission readback mismatch");throw s.code="permission-readback-mismatch",s}return o.sessionFor(i)!==r.sessionId?pt(D("当前聊天绑定的会话已发生变化，无法确认权限切换。")):pt(cshPermissionChanged(n))})}catch(r){return pt(cshPermissionError(r,{mismatch:r?.code==="permission-readback-mismatch"}))}}async function cshPermissionRequestFullAccess(n,t,o,i,e){let a=cshPermissionCleanIdentity(e.actor);if(!a)return pt(D("无法确认当前操作者，未创建完全访问确认。"));let A=Ece(e.signal);try{return await Lc(t,o,async()=>{let r=await Tl(n,t,o,A);if(!r)return pt(D("当前聊天没有绑定会话，请先发送消息开始会话。"));if(await jH(r.session,e.control,A))return pt(D("当前任务正在运行，请等待完成或先发送 /stop。"));if(t.sessionFor(o)!==r.sessionId)return pt(D("当前聊天绑定的会话已发生变化，请重新发起权限切换。"));cshPermissionPending.set(o,Object.freeze({actor:a,sessionId:r.sessionId,expiresAt:i+cshPermissionTtlMs}));return pt(cshFullAccessWarning())})}catch(r){return pt(cshPermissionError(r))}}async function cshPermissionConfirmFullAccess(n,t,o,i,e){let a=cshPermissionPending.get(o);if(!a)return pt(D("没有有效的完全访问确认，请先重新发起“切换到完全访问”。"));if(a.expiresAt<i)return cshPermissionPending.delete(o),pt(D("完全访问确认已过期，请重新发起权限切换。"));let A=cshPermissionCleanIdentity(e.actor);if(!A||A!==a.actor)return pt(D("只有发起切换的用户可以确认完全访问。"));if(t?.sessionFor?.(o)!==a.sessionId)return cshPermissionPending.delete(o),pt(D("当前聊天绑定的会话已变化，完全访问确认已失效，请重新发起。"));cshPermissionPending.delete(o);return e.pendingInteraction?pt(D("当前任务正在等待回答或审批，完全访问确认已失效，请处理后重新发起。")):cshPermissionChange("danger-full-access",n,t,o,e,a.sessionId)}async function cshRunPermissionCommand(n,t,o,i,e={}){if(!n||e.hasImages||e.hasFiles)return null;let a=Date.now();if(cshPermissionPrune(a,i),n.action==="confirm-full-access")return cshPermissionConfirmFullAccess(t,o,i,a,e);if(n.action==="select")cshPermissionPending.delete(i);if(e.pendingInteraction)return pt(cshPendingInteractionMessage());return n.action==="query"?cshPermissionQuery(t,o,i,e):n.action==="select"&&n.preset==="danger-full-access"?cshPermissionRequestFullAccess(t,o,i,a,e):n.action==="select"?cshPermissionChange(n.preset,t,o,i,e):null}function _ce`,
    'bundled dsh-im current permission controls',
  )
  source = replaceExact(
    source,
    'function _i(n){if(typeof n!="string")return!1;let t=n.trim();return qH.test(t)||Ice.test(t)||WH.test(t)||VH.test(t)||zH.test(t)}',
    'function _i(n){if(typeof n!="string")return!1;let t=n.trim();return cshNaturalModelCommand(t)!==null||cshPermissionCommand(t)!==null||qH.test(t)||Ice.test(t)||WH.test(t)||VH.test(t)||zH.test(t)}',
    'bundled dsh-im current command predicate',
  )
  source = replaceExact(
    source,
    'async function Ti(n,t,o,i,e={}){if(!_i(n))return null;let a=n.trim();if(e.hasImages)return pt(D("\\u6A21\\u578B\\u548C\\u63A8\\u7406\\u7B49\\u7EA7\\u547D\\u4EE4\\u4EC5\\u652F\\u6301\\u7EAF\\u6587\\u5B57\\uFF0C\\u8BF7\\u79FB\\u9664\\u56FE\\u7247\\u540E\\u91CD\\u8BD5\\u3002"));let A=Ece(e.signal);',
    'async function Ti(n,t,o,i,e={}){let cshPermission=cshPermissionCommand(n);if(cshPermission)return cshRunPermissionCommand(cshPermission,t,o,i,e);let cshNatural=cshNaturalModelCommand(n);if(!cshNatural&&!_i(n))return null;let a=cshNatural?"":n.trim();if(e.hasImages)return pt(D("\\u6A21\\u578B\\u548C\\u63A8\\u7406\\u7B49\\u7EA7\\u547D\\u4EE4\\u4EC5\\u652F\\u6301\\u7EAF\\u6587\\u5B57\\uFF0C\\u8BF7\\u79FB\\u9664\\u56FE\\u7247\\u540E\\u91CD\\u8BD5\\u3002"));let A=Ece(e.signal);if(cshNatural?.action==="list")try{let I=await Tl(t,o,i,A),d=I?await Kc(I.session,A):await JH(t,A);return pt(Sce(d))}catch(I){return pt(_l(I,"list"))}if(cshNatural?.action==="current")try{let I=await Tl(t,o,i,A);return pt(I?Dce(await Kc(I.session,A)):bce())}catch(I){return pt(_l(I,"select"))}',
    'bundled dsh-im current command entry',
  )
  source = replaceExact(
    source,
    'let r=/^\\/model(?:[ \\t]+([^\\s]+)(?:[ \\t]+([^\\s]+))?)?[ \\t]*$/iu.exec(a);if(!r)return pt(D(LH));let s=r[1],g=r[2];',
    'let r=cshNatural?null:/^\\/model(?:[ \\t]+([^\\s]+)(?:[ \\t]+([^\\s]+))?)?[ \\t]*$/iu.exec(a);if(!cshNatural&&!r)return pt(D(LH));let s=cshNatural?.requested??r?.[1],g=r?.[2];',
    'bundled dsh-im current natural model selection parse',
  )
  source = replaceExact(
    source,
    'let c=KH(s);if(c?.index===null)return pt(xH(s));if(!c&&(!s.includes("/")||s.startsWith("/")||s.endsWith("/")))return pt(D(LH));',
    'let c=cshNatural?null:KH(s);if(!cshNatural&&c?.index===null)return pt(xH(s));if(!cshNatural&&!c&&(!s.includes("/")||s.startsWith("/")||s.endsWith("/")))return pt(D(LH));',
    'bundled dsh-im current natural model guard',
  )
  source = replaceExact(
    source,
    `let d=I?await Kc(I.session,A):await JH(t,A),B=c?Qce(d,c.index):fce(d,s);if(!B)return pt(c?xH(s):[D("\\u6CA1\\u6709\\u627E\\u5230\\u6A21\\u578B\\uFF1A{model}",{model:jr(s)}),"",D("\\u8BF7\\u53D1\\u9001 /models \\u67E5\\u770B\\u53EF\\u7528\\u6A21\\u578B\\u3002")].join(\`
\`));`,
    'let d=I?await Kc(I.session,A):await JH(t,A),B;if(cshNatural){let m=cshNaturalModelMatches(d,s);if(m.length>1)return pt(cshAmbiguousNaturalModelMessage(m));m.length===1&&(B={provider:m[0].provider,model:m[0].model})}else B=c?Qce(d,c.index):fce(d,s);if(!B)return pt(c?xH(s):cshNatural?cshMissingNaturalModelMessage(s):[D("\\u6CA1\\u6709\\u627E\\u5230\\u6A21\\u578B\\uFF1A{model}",{model:jr(s)}),"",D("\\u8BF7\\u53D1\\u9001 /models \\u67E5\\u770B\\u53EF\\u7528\\u6A21\\u578B\\u3002")].join("\\n"));',
    'bundled dsh-im current natural model matching',
  )
  source = replaceExact(
    source,
    '{signal:this.#n,hasImages:iS(t),hasFiles:oS(t),pendingInteraction:this.#l.has(i)||this.#u.hasPending(i),control:{owner:this,key:i}}',
    '{signal:this.#n,actor:e,hasImages:iS(t),hasFiles:oS(t),pendingInteraction:this.#l.has(i)||this.#u.hasPending(i),control:{owner:this,key:i}}',
    'bundled dsh-im current weixin command actor',
  )
  return source
}

function patchDshImBundledApprovalCurrent230(source) {
  if (!source.includes('function Pge(n){let t=n?.arguments;')) return source
  return replaceExact(
    source,
    'function Pge(n){let t=n?.arguments;if(t!==null&&typeof t=="object")try{return JSON.stringify(t,null,2)}catch{return null}if(typeof t!="string")return null;let o=Ob(t);if(!o)return t===""?"{}":null;try{return JSON.stringify(JSON.parse(o),null,2)}catch{return o}}function bb(n,{toolCall:t,requiresMention:o=!1,maxArgumentsLength:i=6e3}={}){if(!OH(n))return null;let e=ya(n.callId);if(!e||ya(t?.callId)!==e||ya(t?.name)!==ya(n.toolName))return null;let a=Pge(t);if(!a||a.length>i)return null;',
    `function Pge(n){let t=n;if(t!==null&&typeof t=="object")try{return JSON.stringify(t,null,2)}catch{return null}if(typeof t!="string")return null;let o=Ob(t);if(!o)return t===""?"{}":null;try{return JSON.stringify(JSON.parse(o),null,2)}catch{return o}}function cshImApprovalPayloadArgs(n){return n&&typeof n=="object"?n.arguments??n.toolArguments:void 0}function cshImApprovalCapPayloadArgs(n,t){if(n.length<=t)return n;let o="\\n...(truncated, original length "+n.length+")";return n.slice(0,Math.max(0,t-o.length))+o}function bb(n,{toolCall:t,requiresMention:o=!1,maxArgumentsLength:i=6e3}={}){if(!OH(n))return null;let e=ya(n.callId),a=null,u=!1;if(t){if(!(e&&ya(t?.callId)!==e||ya(t?.name)!==ya(n.toolName)))a=Pge(t.arguments)}a||(a=Pge(cshImApprovalPayloadArgs(n)),u=!!a);if(!a)return null;if(a.length>i){if(!u)return null;a=cshImApprovalCapPayloadArgs(a,i)}/* ${APPROVAL_DISPLAY_ARGUMENTS_PATCH_MARKER}: dsh-im-bundled-approval *//* ${APPROVAL_DISPLAY_ARGUMENTS_TRUNCATION_PATCH_MARKER}: dsh-im-bundled-approval *//* ${APPROVAL_DISPLAY_ARGUMENTS_MISMATCH_PATCH_MARKER}: dsh-im-bundled-approval */`,
    'bundled dsh-im current approval payload argument fallback',
  )
}

function bundledNaturalModelAliasMapSource() {
  return 'new Map([["gpt5","crawshrimp-overseas-openai/gpt-5.5"],["v4pro","crawshrimp-deepseek-official/deepseek-v4-pro"],["v4flash","crawshrimp-deepseek-official/deepseek-v4-flash"],["deepseekofficialv4pro","crawshrimp-deepseek-official/deepseek-v4-pro"],["deepseekofficialv4flash","crawshrimp-deepseek-official/deepseek-v4-flash"],["deepseekofficialv4flashvisionexp","crawshrimp-deepseek-official/deepseek-v4-flash-vision-exp"],["deepseekv4pro","crawshrimp-deepseek-official/deepseek-v4-pro"],["deepseekv4flash","crawshrimp-deepseek-official/deepseek-v4-flash"],["deepseekv4flashvisionexp","crawshrimp-deepseek-official/deepseek-v4-flash-vision-exp"]])'
}

function patchDshImBundledNaturalModelAliases(source) {
  const aliasMap = bundledNaturalModelAliasMapSource()
  let migrated = source
  if (source.includes(`${DSH_IM_NATURAL_MODEL_ALIASES_PATCH_MARKER}: bundled current`)) {
    const oldAliasMaps = source.includes(aliasMap) ? [] : [
      'new Map([["gpt5","crawshrimp-overseas-openai/gpt-5.5"],["deepseekv4pro","crawshrimp-deepseek-official/deepseek-v4-pro"],["deepseekv4flash","crawshrimp-deepseek-official/deepseek-v4-flash"],["deepseekv4flashvisionexp","crawshrimp-deepseek-official/deepseek-v4-flash-vision-exp"]])',
      'new Map([["gpt-5","crawshrimp-overseas-openai/gpt-5.5"],["deepseek-v4-pro","crawshrimp-deepseek-official/deepseek-official-v4-pro"],["deepseek-v4-flash","crawshrimp-deepseek-official/deepseek-official-v4-flash"],["deepseek-v4-flash-vision-exp","crawshrimp-deepseek-official/deepseek-official-v4-flash-vision-exp"]])',
      'new Map([["gpt5","crawshrimp-overseas-openai/gpt-5.5"],["deepseek-v4-pro","crawshrimp-deepseek-official/deepseek-official-v4-pro"],["deepseek-v4-flash","crawshrimp-deepseek-official/deepseek-official-v4-flash"],["deepseek-v4-flash-vision-exp","crawshrimp-deepseek-official/deepseek-official-v4-flash-vision-exp"]])',
      'new Map([["deepseek-v4-pro","crawshrimp-deepseek-official/deepseek-official-v4-pro"],["deepseek-v4-flash","crawshrimp-deepseek-official/deepseek-official-v4-flash"],["deepseek-v4-flash-vision-exp","crawshrimp-deepseek-official/deepseek-official-v4-flash-vision-exp"]])',
      'new Map([["gpt5","crawshrimp-overseas-openai/gpt-5.5"],["deepseek-v4-pro","crawshrimp-deepseek-official/deepseek-v4-pro"],["deepseek-v4-flash","crawshrimp-deepseek-official/deepseek-v4-flash"],["deepseek-v4-flash-vision-exp","crawshrimp-deepseek-official/deepseek-v4-flash-vision-exp"]])',
      'new Map([["deepseek-v4-pro","crawshrimp-deepseek-official/deepseek-v4-pro"],["deepseek-v4-flash","crawshrimp-deepseek-official/deepseek-v4-flash"],["deepseek-v4-flash-vision-exp","crawshrimp-deepseek-official/deepseek-v4-flash-vision-exp"]])',
    ]
    for (const oldAliasMap of oldAliasMaps) {
      migrated = migrated.replaceAll(oldAliasMap, aliasMap)
    }
    const oldOrders = [
      'a=[A=>A.fullId.toLocaleLowerCase("en-US")===o,A=>sf(A.model)===i,A=>sf(A.displayName)===i,A=>Yce.get(i)===A.fullId]',
      'a=[A=>A.fullId.toLocaleLowerCase("en-US")===o,A=>cshNormalizeModelLookup(A.model)===i,A=>cshNormalizeModelLookup(A.displayName)===i,A=>cshSafeModelAliases.get(i)===A.fullId]',
    ]
    const newOrders = [
      'a=[A=>A.fullId.toLocaleLowerCase("en-US")===o,A=>Yce.get(i)===A.fullId,A=>sf(A.model)===i,A=>sf(A.displayName)===i]',
      'a=[A=>A.fullId.toLocaleLowerCase("en-US")===o,A=>cshSafeModelAliases.get(i)===A.fullId,A=>cshNormalizeModelLookup(A.model)===i,A=>cshNormalizeModelLookup(A.displayName)===i]',
    ]
    for (const [index, oldOrder] of oldOrders.entries()) {
      migrated = migrated.replaceAll(oldOrder, newOrders[index])
    }
    if (migrated !== source || migrated.includes(aliasMap)) return patchDshImBundledModelLookupSuffix(migrated)
    throw new Error('cannot migrate bundled dsh-im natural model aliases: expected alias map shape not found')
  }
  const named = migrated.replace(
    'cshSafeModelAliases=new Map;function cshNormalizeControlText',
    `cshSafeModelAliases=${aliasMap};/* ${DSH_IM_NATURAL_MODEL_ALIASES_PATCH_MARKER}: bundled current */function cshNormalizeControlText`,
  )
  if (named !== migrated) return patchDshImBundledModelLookupSuffix(named)

  const minified = migrated.replace(
    /(Hce=new Set\(\["有哪些模型"[\s\S]{0,1200}?xce=Object\.freeze\(\[[\s\S]{0,1200}?\]\),)([A-Za-z_$][\w$]*)=new Map;function /,
    `$1$2=${aliasMap};/* ${DSH_IM_NATURAL_MODEL_ALIASES_PATCH_MARKER}: bundled current */function `,
  )
  if (minified !== migrated) return patchDshImBundledModelLookupSuffix(minified)

  if (source.includes('可以切换模型吗') && source.includes('deepseek-official-v4-pro')) {
    throw new Error('cannot patch bundled dsh-im natural model aliases: expected alias map shape not found')
  }
  return patchDshImBundledModelLookupSuffix(source)
}

function patchDshImBundledModelLookupSuffix(source) {
  if (source.includes('cshStripModelLookupSuffix')) return source
  return replaceAny(
    source,
    [
      [
        'function sf(n){return Kc(n,{allowPolitePrefix:!1})?.replace(/[\\s-]+/gu,"")??null}',
        'function sf(n){let t=Kc(n,{allowPolitePrefix:!1});if(!t)return null;for(let o of["模型","model"])if(t.endsWith(o)){let i=t.slice(0,-o.length).trim();if(i)t=i}return t.replace(/[\\s_.-]+/gu,"")}/* cshStripModelLookupSuffix */',
      ],
      [
        'function cshNormalizeModelLookup(n){let t=cshNormalizeControlText(n).toLocaleLowerCase("en-US");return t.replace(/[\\s_]+/g,"-").replace(/[._]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"")}',
        'function cshNormalizeModelLookup(n){let t=cshNormalizeControlText(n).toLocaleLowerCase("en-US");for(let o of["模型","model"])if(t.endsWith(o)){let i=t.slice(0,-o.length).trim();if(i)t=i}return t.replace(/[\\s_.-]+/g,"")}/* cshStripModelLookupSuffix */',
      ],
    ],
    'bundled dsh-im model lookup suffix normalization',
  )
}

function patchDshImBundledProductModelCatalog(source) {
  if (source.includes(`${DSH_IM_MODEL_CATALOG_PATCH_MARKER}: bundled current`)) {
    return patchDshImBundledProductRuntimeModel(source)
  }
  if (source.includes('cshNaturalModelList=new Set(["有哪些模型","列出所有可用模型"')) {
    source = replaceExact(
      source,
      'cshNaturalModelList=new Set(["有哪些模型","列出所有可用模型"',
      'cshNaturalModelList=new Set(["有哪些模型","列出所有模型","列出所有可用模型"',
      'bundled dsh-im product model list phrase current',
    )
  }
  if (source.includes('Hce=new Set(["有哪些模型","列出所有可用模型"')) {
    source = replaceExact(
      source,
      'Hce=new Set(["有哪些模型","列出所有可用模型"',
      'Hce=new Set(["有哪些模型","列出所有模型","列出所有可用模型"',
      'bundled dsh-im product model list phrase legacy',
    )
  }
  source = replaceAny(
    source,
    [
      [
        'async listModels(t={}){await this.ensureRunning(t);let o=await this.rpc("llm.models",{},3e4,t);return ox(o,"llm.models")}async getSessionModels',
        'async listModels(t={}){await this.ensureRunning(t);let o=await this.rpc("llm.models",{},3e4,t);return ox(o,"llm.models")}async listCrawshrimpModelCatalog(t={}){await this.ensureRunning(t);let o=await this.#i(new URL("/api/crawshrimp/model-catalog",this.#e),{method:"GET",headers:{accept:"application/json"},signal:t.signal});if(!o.ok)throw new Error("Harness crawshrimp.modelCatalog failed");let i=await o.json();if(!i||i.ok!==!0||!Array.isArray(i.groups))throw new Error("Crawshrimp returned an invalid model catalog");return i}async getSessionModels',
      ],
      [
        'async listModels(t={}){await this.ensureRunning(t);let o=await this.rpc("llm.models",{},3e4,t);return GK(o,"llm.models")}async getSessionModels',
        'async listModels(t={}){await this.ensureRunning(t);let o=await this.rpc("llm.models",{},3e4,t);return GK(o,"llm.models")}async listCrawshrimpModelCatalog(t={}){await this.ensureRunning(t);let o=await this.#i(new URL("/api/crawshrimp/model-catalog",this.#e),{method:"GET",headers:{accept:"application/json"},signal:t.signal});if(!o.ok)throw new Error("Harness crawshrimp.modelCatalog failed");let i=await o.json();if(!i||i.ok!==!0||!Array.isArray(i.groups))throw new Error("Crawshrimp returned an invalid model catalog");return i}async getSessionModels',
      ],
    ],
    'bundled dsh-im Crawshrimp model catalog client',
  )
  source = replaceExact(
    source,
    'if((d==="listWorkspaces"||d==="listWorkspaceSessions"||d==="listModels")&&typeof I[d]=="function")',
    `if((d==="listWorkspaces"||d==="listWorkspaceSessions"||d==="listModels"||d==="listCrawshrimpModelCatalog")&&typeof I[d]=="function")/* ${DSH_IM_MODEL_CATALOG_PATCH_MARKER}: bundled workspace scoped catalog */`,
    'bundled dsh-im workspace scoped Crawshrimp model catalog',
  )
  source = replaceAny(
    source,
    [
      [
        'function yn(n,t){return`${n}/${t}`}',
        `var cshProductGroupLabels=new Map([["llm","LLM 对话模型"],["ai-image","AI 生图模型"],["image","AI 生图模型"],["ai-video","AI 生视频模型"],["video","AI 生视频模型"]]);/* ${DSH_IM_MODEL_CATALOG_PATCH_MARKER}: bundled current */function cshProductText(n){return Qr(String(n??""))}function cshNormalizeProductCatalog(n){if(!n||typeof n!="object"||!Array.isArray(n.groups))throw new TypeError("Crawshrimp returned an invalid model catalog");let t=n.groups.map(o=>{if(!o||typeof o!="object"||!Array.isArray(o.models))throw new TypeError("Crawshrimp returned an invalid model group");let i=cshProductText(o.id||"models"),e=cshProductText(o.name||cshProductGroupLabels.get(i)||i),a=o.models.map(A=>{if(!A||typeof A!="object")throw new TypeError("Crawshrimp returned an invalid model");let r=cshProductText(A.id||A.model||"");if(!r)throw new TypeError("Crawshrimp returned a model without id");return{id:r,label:cshProductText(A.label||A.name||r),provider:cshProductText(A.provider||""),configured:A.configured===!0,default:A.default===!0,supportsSwitch:A.supports_switch===!0||A.supportsSwitch===!0}});return{id:i,name:e,configuredCount:Number.isFinite(Number(o.configured_count))?Number(o.configured_count):a.filter(A=>A.configured).length,totalCount:Number.isFinite(Number(o.total_count))?Number(o.total_count):a.length,models:a}});return{groups:t,configuredCount:Number.isFinite(Number(n.configured_count))?Number(n.configured_count):t.reduce((o,i)=>o+i.configuredCount,0),totalCount:Number.isFinite(Number(n.total_count))?Number(n.total_count):t.reduce((o,i)=>o+i.totalCount,0)}}function cshFormatProductCatalog(n){let t=[D("抓虾已支持/已配置模型："),D("已配置 {configured}/{total}",{configured:String(n.configuredCount),total:String(n.totalCount)})];for(let o of n.groups){t.push("",\`\${o.name}（\${o.configuredCount}/\${o.totalCount} 已配置）\`);if(o.models.length===0){t.push(D("暂无模型。"));continue}for(let i of o.models){let e=[i.configured?D("已配置"):D("未配置")];i.default&&e.push(D("默认")),i.supportsSwitch&&e.push(D("可在聊天中切换"));let a=i.provider?\` · \${i.provider}\`:"";t.push(\`- \${i.label} (\${i.id})\${a} · \${e.join(" / ")}\`)}}return t.push("",D("LLM 可回复“切换模型到 <模型名>”切换；生图和生视频模型在对应工作台中使用。")),t.join("\\n")}function yn(n,t){return\`\${n}/\${t}\`}`,
      ],
      [
        'function fs(n,t){return`${n}/${t}`}',
        `var cshProductGroupLabels=new Map([["llm","LLM 对话模型"],["ai-image","AI 生图模型"],["image","AI 生图模型"],["ai-video","AI 生视频模型"],["video","AI 生视频模型"]]);/* ${DSH_IM_MODEL_CATALOG_PATCH_MARKER}: bundled current */function cshProductText(n){return jr(String(n??""))}function cshNormalizeProductCatalog(n){if(!n||typeof n!="object"||!Array.isArray(n.groups))throw new TypeError("Crawshrimp returned an invalid model catalog");let t=n.groups.map(o=>{if(!o||typeof o!="object"||!Array.isArray(o.models))throw new TypeError("Crawshrimp returned an invalid model group");let i=cshProductText(o.id||"models"),e=cshProductText(o.name||cshProductGroupLabels.get(i)||i),a=o.models.map(A=>{if(!A||typeof A!="object")throw new TypeError("Crawshrimp returned an invalid model");let r=cshProductText(A.id||A.model||"");if(!r)throw new TypeError("Crawshrimp returned a model without id");return{id:r,label:cshProductText(A.label||A.name||r),provider:cshProductText(A.provider||""),configured:A.configured===!0,default:A.default===!0,supportsSwitch:A.supports_switch===!0||A.supportsSwitch===!0}});return{id:i,name:e,configuredCount:Number.isFinite(Number(o.configured_count))?Number(o.configured_count):a.filter(A=>A.configured).length,totalCount:Number.isFinite(Number(o.total_count))?Number(o.total_count):a.length,models:a}});return{groups:t,configuredCount:Number.isFinite(Number(n.configured_count))?Number(n.configured_count):t.reduce((o,i)=>o+i.configuredCount,0),totalCount:Number.isFinite(Number(n.total_count))?Number(n.total_count):t.reduce((o,i)=>o+i.totalCount,0)}}function cshFormatProductCatalog(n){let t=[D("抓虾已支持/已配置模型："),D("已配置 {configured}/{total}",{configured:String(n.configuredCount),total:String(n.totalCount)})];for(let o of n.groups){t.push("",\`\${o.name}（\${o.configuredCount}/\${o.totalCount} 已配置）\`);if(o.models.length===0){t.push(D("暂无模型。"));continue}for(let i of o.models){let e=[i.configured?D("已配置"):D("未配置")];i.default&&e.push(D("默认")),i.supportsSwitch&&e.push(D("可在聊天中切换"));let a=i.provider?\` · \${i.provider}\`:"";t.push(\`- \${i.label} (\${i.id})\${a} · \${e.join(" / ")}\`)}}return t.push("",D("LLM 可回复“切换模型到 <模型名>”切换；生图和生视频模型在对应工作台中使用。")),t.join("\\n")}function fs(n,t){return\`\${n}/\${t}\`}`,
      ],
    ],
    'bundled dsh-im product model catalog formatter',
  )
  source = replaceAny(
    source,
    [
      [
        'async function Ub(n,t){if(typeof n?.listModels!="function")throw new TypeError("Harness does not support listing models");return dK(await n.listModels(t))}async function wg',
        'async function Ub(n,t){if(typeof n?.listModels!="function")throw new TypeError("Harness does not support listing models");return dK(await n.listModels(t))}async function cshProductCatalog(n,t){if(typeof n?.listCrawshrimpModelCatalog!="function")return null;return cshNormalizeProductCatalog(await n.listCrawshrimpModelCatalog(t))}async function wg',
      ],
      [
        'async function JH(n,t){if(typeof n?.listModels!="function")throw new TypeError("Harness does not support listing models");return $H(await n.listModels(t))}async function Kc',
        'async function JH(n,t){if(typeof n?.listModels!="function")throw new TypeError("Harness does not support listing models");return $H(await n.listModels(t))}async function cshProductCatalog(n,t){if(typeof n?.listCrawshrimpModelCatalog!="function")return null;return cshNormalizeProductCatalog(await n.listCrawshrimpModelCatalog(t))}async function Kc',
      ],
    ],
    'bundled dsh-im product model catalog loader',
  )
  source = replaceAny(
    source,
    [
      [
        'if(a?.action==="list")try{return WA(aK(await Ub(t,r)))}catch(d){return WA(Dg(d,"list"))}',
        'if(a?.action==="list")try{let d=await cshProductCatalog(t,r);return WA(d?cshFormatProductCatalog(d):aK(await Ub(t,r)))}catch(d){return WA(Dg(d,"list"))}',
      ],
      [
        'if(cshNatural?.action==="list")try{let I=await Tl(t,o,i,A),d=I?await Kc(I.session,A):await JH(t,A);return pt(Sce(d))}catch(I){return pt(_l(I,"list"))}',
        'if(cshNatural?.action==="list")try{let P=await cshProductCatalog(t,A);if(P)return pt(cshFormatProductCatalog(P));let I=await Tl(t,o,i,A),d=I?await Kc(I.session,A):await JH(t,A);return pt(Sce(d))}catch(I){return pt(_l(I,"list"))}',
      ],
    ],
    'bundled dsh-im natural product model list action',
  )
  return patchDshImBundledProductRuntimeModel(source)
}

function patchDshImBundledProductRuntimeModel(source) {
  if (source.includes('runtimeModel:cshProductText')) return source
  return replaceExact(
    source,
    'return{id:r,label:cshProductText(A.label||A.name||r),provider:cshProductText(A.provider||""),configured:A.configured===!0,default:A.default===!0,supportsSwitch:A.supports_switch===!0||A.supportsSwitch===!0}',
    'return{id:r,label:cshProductText(A.label||A.name||r),provider:cshProductText(A.provider||""),type:cshProductText(A.type||o.id||""),runtimeModel:cshProductText(A.runtime_model||A.runtimeModel||""),configured:A.configured===!0,default:A.default===!0,supportsSwitch:A.supports_switch===!0||A.supportsSwitch===!0}',
    'bundled dsh-im product runtime model field',
  )
}

function patchDshImBundledApprovalAllowAll(source) {
  source = upgradeDshImBundledApprovalAllowAllPermissionApi(source)
  if (source.includes(`${DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER}: bundled approval`)) {
    return patchDshImBundledStandaloneBridgeApprovalAllowAll(source)
  }
  source = replaceExact(
    source,
    '["允许执行","allowed-once"],["可以","allowed-once"]',
    '["允许执行","allowed-once"],["允许所有","allowed-all"],["全部允许","allowed-all"],["后续都允许","allowed-all"],["本会话都允许","allowed-all"],["不再询问","allowed-all"],["可以","allowed-once"]',
    'bundled dsh-im approval allow-all replies',
  )
  source = replaceAny(
    source,
    [
      [
        'Tb="请回复「确认执行」或「拒绝」（也支持：确认 / 继续 / 执行吧 / 可以 / 批准 / 同意 / 不同意 / yes / no）。"',
        `/* ${DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER}: bundled approval */Tb="请回复「确认执行」或「拒绝」（也支持：确认 / 继续 / 执行吧 / 可以 / 批准 / 同意 / 允许所有 / 不同意 / yes / no）。"`,
      ],
      [
        'wb="请回复「确认执行」或「拒绝」（也支持：确认 / 继续 / 执行吧 / 可以 / 批准 / 同意 / 不同意 / yes / no）。"',
        `/* ${DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER}: bundled approval */wb="请回复「确认执行」或「拒绝」（也支持：确认 / 继续 / 执行吧 / 可以 / 批准 / 同意 / 允许所有 / 不同意 / yes / no）。"`,
      ],
    ],
    'bundled dsh-im approval allow-all prompt',
  )
  source = replaceAny(
    source,
    [
      [
        'function LH(n,t){return{ok:!0,value:{sessionId:n.sessionId,approvalId:n.approvalId,outcome:t}}}',
        'function LH(n,t){let o=t==="allowed-all"?"allowed-once":t;return{ok:!0,value:{sessionId:n.sessionId,approvalId:n.approvalId,outcome:o}}}',
      ],
      [
        'function wH(n,t){return{ok:!0,value:{sessionId:n.sessionId,approvalId:n.approvalId,outcome:t}}}',
        'function wH(n,t){let o=t==="allowed-all"?"allowed-once":t;return{ok:!0,value:{sessionId:n.sessionId,approvalId:n.approvalId,outcome:o}}}',
      ],
    ],
    'bundled dsh-im approval allow-all result outcome',
  )
  source = replaceAny(
    source,
    [
      [
        'function gf(n){return n==="allowed-once"?D("\\u5DF2\\u6279\\u51C6\\uFF0C\\u4EC5\\u5BF9\\u672C\\u6B21\\u64CD\\u4F5C\\u6709\\u6548\\u3002"):n==="rejected"?D("\\u5DF2\\u62D2\\u7EDD\\u6B64\\u6B21\\u64CD\\u4F5C\\u3002"):D(_l)}',
        'function gf(n){return n==="allowed-all"?D("已批准，并已切换当前会话为完全访问；后续需审批的命令将不再弹窗。"):n==="allowed-once"?D("\\u5DF2\\u6279\\u51C6\\uFF0C\\u4EC5\\u5BF9\\u672C\\u6B21\\u64CD\\u4F5C\\u6709\\u6548\\u3002"):n==="rejected"?D("\\u5DF2\\u62D2\\u7EDD\\u6B64\\u6B21\\u64CD\\u4F5C\\u3002"):D(_l)}',
      ],
      [
        'function af(n){return n==="allowed-once"?D("\\u5DF2\\u6279\\u51C6\\uFF0C\\u4EC5\\u5BF9\\u672C\\u6B21\\u64CD\\u4F5C\\u6709\\u6548\\u3002"):n==="rejected"?D("\\u5DF2\\u62D2\\u7EDD\\u6B64\\u6B21\\u64CD\\u4F5C\\u3002"):D(Ol)}',
        'function af(n){return n==="allowed-all"?D("已批准，并已切换当前会话为完全访问；后续需审批的命令将不再弹窗。"):n==="allowed-once"?D("\\u5DF2\\u6279\\u51C6\\uFF0C\\u4EC5\\u5BF9\\u672C\\u6B21\\u64CD\\u4F5C\\u6709\\u6548\\u3002"):n==="rejected"?D("\\u5DF2\\u62D2\\u7EDD\\u6B64\\u6B21\\u64CD\\u4F5C\\u3002"):D(Ol)}',
      ],
    ],
    'bundled dsh-im approval allow-all outcome text',
  )
  source = replaceExact(
    source,
    'requiresMention:o.requiresMention===!0,send:A,text:g,presented:!1',
    'requiresMention:o.requiresMention===!0,send:A,allowAll:typeof o.allowAll=="function"?o.allowAll:null,text:g,presented:!1',
    'bundled dsh-im approval allow-all pending context',
  )
  source = replaceAny(
    source,
    [
      [
        'async#c(t,o){t.submitting=!0;try{await t.interaction.respond(LH(t,o))}catch(a){',
        'async#c(t,o){t.submitting=!0;try{if(o==="allowed-all"){if(typeof t.allowAll!="function")throw new Error("approval allow-all is unavailable");await t.allowAll({sessionId:t.sessionId,approvalId:t.approvalId})}await t.interaction.respond(LH(t,o))}catch(a){',
      ],
      [
        'async#c(t,o){t.submitting=!0;try{await t.interaction.respond(wH(t,o))}catch(a){',
        'async#c(t,o){t.submitting=!0;try{if(o==="allowed-all"){if(typeof t.allowAll!="function")throw new Error("approval allow-all is unavailable");await t.allowAll({sessionId:t.sessionId,approvalId:t.approvalId})}await t.interaction.respond(wH(t,o))}catch(a){',
      ],
    ],
    'bundled dsh-im approval allow-all submit permission first',
  )
  source = replaceExact(
    source,
    'await t.send(D("\\u5BA1\\u6279\\u63D0\\u4EA4\\u5931\\u8D25\\uFF0C\\u8BF7\\u91CD\\u65B0\\u56DE\\u590D\\u300C\\u6279\\u51C6\\u300D\\u6216\\u300C\\u62D2\\u7EDD\\u300D\\u3002")).catch(()=>{});return}',
    'await t.send(D("审批提交失败，请重新回复「批准」「允许所有」或「拒绝」。")).catch(()=>{});return}',
    'bundled dsh-im approval allow-all retry prompt',
  )
  source = replaceExact(
    source,
    'this.#d.handleRequested(t,{key:o,actor:i,requiresMention:a,send:c=>this.#A.sendText(e,c)})',
    `this.#d.handleRequested(t,{key:o,actor:i,requiresMention:a,send:c=>this.#A.sendText(e,c),/* ${DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER}: bundled text bridge approval */allowAll:async()=>{let c=typeof this.#r.sessionFor=="function"?this.#r.sessionFor(o):null;if(c!==t.sessionId)throw new Error("approval session binding changed");if(typeof this.#t.workspaceSession!="function")throw new Error("Harness workspace session is unavailable");let I=this.#t.workspaceSession(c);if(!I||typeof I.setPermission!="function")throw new Error("Harness permission API is unavailable");let d=this.#s?{signal:this.#s}:void 0,B=await I.setPermission("danger-full-access",d);if(B?.preset!=="danger-full-access")throw new Error("Harness permission allow-all readback mismatch")}})`,
    'bundled dsh-im text bridge approval allow-all callback',
  )
  source = replaceAny(
    source,
    [
      [
        'this.#C.handleRequested(t,{key:o,actor:i,send:c=>this.#b(i,c,e,a)})',
        `this.#C.handleRequested(t,{key:o,actor:i,send:c=>this.#b(i,c,e,a),/* ${DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER}: bundled weixin bridge approval */allowAll:async()=>{let c=typeof this.#i.sessionFor=="function"?this.#i.sessionFor(o):null;if(c!==t.sessionId)throw new Error("approval session binding changed");if(typeof this.#o.workspaceSession!="function")throw new Error("Harness workspace session is unavailable");let I=this.#o.workspaceSession(c);if(!I||typeof I.setPermission!="function")throw new Error("Harness permission API is unavailable");let d=this.#n?{signal:this.#n}:void 0,B=await I.setPermission("danger-full-access",d);if(B?.preset!=="danger-full-access")throw new Error("Harness permission allow-all readback mismatch")}})`,
      ],
      [
        'this.#u.handleRequested(t,{key:o,actor:i,send:c=>this.#_(i,c,e,a)})',
        `this.#u.handleRequested(t,{key:o,actor:i,send:c=>this.#_(i,c,e,a),/* ${DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER}: bundled weixin bridge approval */allowAll:async()=>{let c=typeof this.#i.sessionFor=="function"?this.#i.sessionFor(o):null;if(c!==t.sessionId)throw new Error("approval session binding changed");if(typeof this.#o.workspaceSession!="function")throw new Error("Harness workspace session is unavailable");let I=this.#o.workspaceSession(c);if(!I||typeof I.setPermission!="function")throw new Error("Harness permission API is unavailable");let d=this.#n?{signal:this.#n}:void 0,B=await I.setPermission("danger-full-access",d);if(B?.preset!=="danger-full-access")throw new Error("Harness permission allow-all readback mismatch")}})`,
      ],
    ],
    'bundled dsh-im weixin bridge approval allow-all callback',
  )
  return patchDshImBundledStandaloneBridgeApprovalAllowAll(source)
}

function bundledApprovalAllowAllCallback({ label, state, harness, signal }) {
  return `/* ${DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER}: bundled ${label} bridge approval */allowAll:async()=>{let c=typeof this.${state}.sessionFor=="function"?this.${state}.sessionFor(o):null;if(c!==t.sessionId)throw new Error("approval session binding changed");if(typeof this.${harness}.workspaceSession!="function")throw new Error("Harness workspace session is unavailable");let I=this.${harness}.workspaceSession(c);if(!I||typeof I.setPermission!="function")throw new Error("Harness permission API is unavailable");let d=this.${signal}?{signal:this.${signal}}:void 0,B=await I.setPermission("danger-full-access",d);if(B?.preset!=="danger-full-access")throw new Error("Harness permission allow-all readback mismatch")}`
}

function upgradeDshImBundledApprovalAllowAllPermissionApi(source) {
  return source.replace(
    /if\(!I\|\|typeof I\.executeCommand!="function"\)throw new Error\("Harness permission command is unavailable"\);let d=(this\.#[A-Za-z_$][\w$]*)\?\{signal:\1\}:void 0,B=await I\.executeCommand\("\/permission danger-full-access",d\);if\(B\?\.result\?\.kind!=="success"\)throw new Error\("Harness rejected permission allow-all"\);let f=await I\.executeCommand\("\/permission",d\),Q=String\(f\?\.result\?\.text\|\|""\)\.trim\(\);if\(!\/\^current preset danger-full-access \\\(\/u\.test\(Q\)\)throw new Error\("Harness permission allow-all readback mismatch"\)/g,
    'if(!I||typeof I.setPermission!="function")throw new Error("Harness permission API is unavailable");let d=$1?{signal:$1}:void 0,B=await I.setPermission("danger-full-access",d);if(B?.preset!=="danger-full-access")throw new Error("Harness permission allow-all readback mismatch")',
  )
}

function patchDshImBundledStandaloneBridgeApprovalAllowAll(source) {
  const patches = [
    {
      label: 'dingtalk',
      variants: [
        {
          needle: 'this.#h.handleRequested(t,{key:o,actor:i,requiresMention:a,send:c=>this.#_(e,c)})',
          callback: bundledApprovalAllowAllCallback({
            label: 'dingtalk',
            state: '#o',
            harness: '#r',
            signal: '#a',
          }),
        },
        {
          needle: 'this.#h.handleRequested(t,{key:o,actor:i,requiresMention:a,send:c=>this.#O(e,c)})',
          callback: bundledApprovalAllowAllCallback({
            label: 'dingtalk',
            state: '#o',
            harness: '#r',
            signal: '#a',
          }),
        },
      ],
    },
    {
      label: 'feishu',
      variants: [
        {
          needle: 'this.#S.handleRequested(t,{key:o,actor:i,requiresMention:a,send:c=>this.#m(e,c)})',
          callback: bundledApprovalAllowAllCallback({
            label: 'feishu',
            state: '#r',
            harness: '#t',
            signal: '#w',
          }),
        },
        {
          needle: 'this.#Q.handleRequested(t,{key:o,actor:i,requiresMention:a,send:c=>this.#m(e,c)})',
          callback: bundledApprovalAllowAllCallback({
            label: 'feishu',
            state: '#r',
            harness: '#t',
            signal: '#D',
          }),
        },
      ],
    },
    {
      label: 'qq',
      variants: [
        {
          needle: 'this.#h.handleRequested(t,{key:o,actor:i,requiresMention:a,send:c=>this.#e.sendText(e,c)})',
          callback: bundledApprovalAllowAllCallback({
            label: 'qq',
            state: '#r',
            harness: '#t',
            signal: '#s',
          }),
        },
      ],
    },
    {
      label: 'wecom',
      variants: [
        {
          needle: 'this.#E.handleRequested(t,{key:o,actor:i,requiresMention:a,send:c=>this.#S(e,c)})',
          callback: bundledApprovalAllowAllCallback({
            label: 'wecom',
            state: '#t',
            harness: '#A',
            signal: '#s',
          }),
        },
        {
          needle: 'this.#E.handleRequested(t,{key:o,actor:i,requiresMention:a,send:c=>this.#w(e,c)})',
          callback: bundledApprovalAllowAllCallback({
            label: 'wecom',
            state: '#t',
            harness: '#A',
            signal: '#s',
          }),
        },
      ],
    },
  ]
  let next = upgradeDshImBundledApprovalAllowAllPermissionApi(source).replaceAll(
    'throw new Error("Harness permission allow-all readback mismatch")}}})',
    'throw new Error("Harness permission allow-all readback mismatch")}})',
  )
  for (const patch of patches) {
    if (next.includes(`${DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER}: bundled ${patch.label} bridge approval`)) {
      continue
    }
    let applied = false
    for (const variant of patch.variants) {
      if (!next.includes(variant.needle)) continue
      next = replaceExact(
        next,
        variant.needle,
        variant.needle.replace('})', `,${variant.callback}})`),
        `bundled dsh-im ${patch.label} bridge approval allow-all callback`,
      )
      applied = true
      break
    }
    if (!applied) {
      throw new Error(`cannot patch bundled dsh-im ${patch.label} bridge approval allow-all callback: expected source not found`)
    }
  }
  return upgradeDshImBundledApprovalAllowAllPermissionApi(next)
}

function replaceAny(source, replacements, label) {
  for (const [needle, replacement] of replacements) {
    const first = source.indexOf(needle)
    if (first < 0) continue
    const second = source.indexOf(needle, first + needle.length)
    if (second >= 0) throw new Error(`cannot patch ${label}: source found more than once`)
    return source.slice(0, first) + replacement + source.slice(first + needle.length)
  }
  throw new Error(`cannot patch ${label}: expected source not found`)
}

function patchDshImBundledHost(source) {
  if (!source.includes(DSH_IM_NATURAL_CONTROLS_PATCH_MARKER)) {
    const current230 = patchDshImBundledHostCurrent230(source)
    if (current230 !== source) {
      source = current230
    } else {
      source = replaceExact(
      source,
      'Hce=new Set(["\\u6709\\u54EA\\u4E9B\\u6A21\\u578B","\\u5217\\u51FA\\u6240\\u6709\\u53EF\\u7528\\u6A21\\u578B","\\u67E5\\u770B\\u53EF\\u7528\\u6A21\\u578B"])',
      `Hce=new Set(["有哪些模型","列出所有可用模型","列出可用模型","查看可用模型","查看模型","模型列表","可用模型","所有模型","可以切换模型吗","能切换模型吗","怎么切换模型"])`,
      'bundled dsh-im natural model list',
    )
      source = replaceExact(
      source,
      'Kce=new Set(["\\u5F53\\u524D\\u662F\\u4EC0\\u4E48\\u6A21\\u578B","\\u73B0\\u5728\\u7528\\u7684\\u54EA\\u4E2A\\u6A21\\u578B"])',
      `Kce=new Set(["当前是什么模型","现在用的哪个模型","当前模型","现在模型","用的什么模型","现在是什么模型"])`,
      'bundled dsh-im natural current model',
    )
      source = replaceExact(
      source,
      'xce=Object.freeze([/^切换到\\s*(.+)$/u,/^使用\\s+(.+?)\\s*模型$/u,/^模型改成\\s*(.+)$/u])',
      `xce=Object.freeze([/^切换到\\s*(.+)$/u,/^切换模型到\\s*(.+)$/u,/^切(?:到|成|为)\\s*(.+)$/u,/^换到\\s*(.+)$/u,/^换成\\s*(.+)$/u,/^改用\\s*(.+)$/u,/^使用\\s+(.+?)\\s*模型$/u,/^用\\s*(.+?)\\s*模型$/u,/^模型(?:切换到|换成|改成|设置为|设为)\\s*(.+)$/u])`,
      'bundled dsh-im natural model select',
    )
      source = replaceExact(
      source,
      'hf=Object.freeze({"read-only":Object.freeze({label:"\\u53EA\\u8BFB\\uFF08Read Only\\uFF09",aliases:Object.freeze(["\\u53EA\\u8BFB","\\u53EA\\u8BFB\\u6A21\\u5F0F","read only"])}),"workspace-write":Object.freeze({label:"\\u5DE5\\u4F5C\\u533A\\u5199\\u5165\\uFF08Workspace Write\\uFF09",aliases:Object.freeze(["\\u5DE5\\u4F5C\\u533A\\u5199\\u5165","\\u5141\\u8BB8\\u5DE5\\u4F5C\\u533A\\u5199\\u5165","workspace write"])}),"danger-full-access":Object.freeze({label:"\\u5B8C\\u5168\\u8BBF\\u95EE\\uFF08Full access\\uFF09",aliases:Object.freeze(["\\u5B8C\\u5168\\u8BBF\\u95EE","\\u5B8C\\u6574\\u8BBF\\u95EE","full access"])})})',
      `hf=Object.freeze({"read-only":Object.freeze({label:"只读（Read Only）",aliases:Object.freeze(["只读","只读模式","只读权限","只读审批","read only","read-only"])}),"workspace-write":Object.freeze({label:"工作区写入（Workspace Write）",aliases:Object.freeze(["工作区写入","允许工作区写入","允许写入工作区","工作区写入权限","开启审批","打开审批","恢复审批","需要审批","逐次审批","ask","workspace write","workspace-write"])}),"danger-full-access":Object.freeze({label:"完全访问（Full access）",aliases:Object.freeze(["完全访问","完整访问","完全访问权限","全权限","关闭审批","不用审批","不需要审批","自动批准","自动审批","免审批","never","full access","full-access"])})})`,
      'bundled dsh-im permission aliases',
    )
      source = replaceExact(
      source,
      'lIe=new Set(["\\u5F53\\u524D\\u4EC0\\u4E48\\u6743\\u9650","\\u67E5\\u770B\\u5BA1\\u6279\\u6743\\u9650","\\u73B0\\u5728\\u662F\\u54EA\\u4E2A\\u6743\\u9650\\u6A21\\u5F0F","\\u6709\\u54EA\\u4E9B\\u6743\\u9650"])',
      `lIe=new Set(["当前什么权限","当前权限","查看权限","查看审批权限","现在是哪个权限模式","当前审批策略","现在审批策略","审批权限","审批权限设置","审批怎么设置","修改审批权限","调整审批权限","更改审批权限","有哪些权限","有哪些审批权限","权限列表"])`,
      'bundled dsh-im permission query phrases',
    )
      source = replaceExact(
      source,
      'function SK(n){let t=Kc(n);if(!t)return null;if(lIe.has(t))return{action:"query"};if(t===cIe)return{action:"confirm-full-access"};let i=(/^(?:切换到|设置为|设为)\\s*(.+)$/u.exec(t)??/^允许\\s*(工作区写入)$/u.exec(t))?.[1]?.trim();if(!i||i.length>128||IIe.test(i))return null;let e=pIe.get(i);return e?{action:"select",preset:e}:null}',
      `function SK(n){let t=Kc(n);if(!t)return null;if(lIe.has(t))return{action:"query"};if(t===cIe)return{action:"confirm-full-access"};let o=pIe.get(t);if(o)return{action:"select",preset:o};let i=(/^(?:切换到|设置为|设为|改成|权限改成|审批权限改成|审批改成|设置审批为|审批设置为|把审批改成|把权限改成)\\s*(.+)$/u.exec(t)??/^允许\\s*(工作区写入|写入工作区)$/u.exec(t))?.[1]?.trim();if(!i||i.length>128||IIe.test(i))return null;let e=pIe.get(i);return e?{action:"select",preset:e}:null}`,
      'bundled dsh-im natural permission parser',
    )
      source = replaceExact(
      source,
      'Ace=new Map([["\\u6279\\u51C6","allowed-once"],["\\u540C\\u610F","allowed-once"],["\\u786E\\u8BA4","allowed-once"],["\\u786E\\u8BA4\\u6267\\u884C","allowed-once"],["\\u5141\\u8BB8\\u6267\\u884C","allowed-once"],["\\u53EF\\u4EE5\\u6267\\u884C","allowed-once"],["\\u540C\\u610F\\u672C\\u6B21","allowed-once"],["\\u7EE7\\u7EED\\u6267\\u884C","allowed-once"],["yes","allowed-once"],["\\u62D2\\u7EDD","rejected"],["\\u4E0D\\u540C\\u610F","rejected"],["\\u4E0D\\u8981\\u6267\\u884C","rejected"],["\\u4E0D\\u5141\\u8BB8","rejected"],["\\u53D6\\u6D88\\u672C\\u6B21","rejected"],["no","rejected"]])',
      `/* ${DSH_IM_NATURAL_CONTROLS_PATCH_MARKER}: approval replies for mobile IM chats without card buttons. */Ace=new Map([["批准","allowed-once"],["批准执行","allowed-once"],["同意","allowed-once"],["同意执行","allowed-once"],["确认","allowed-once"],["确认批准","allowed-once"],["确认执行","allowed-once"],["允许","allowed-once"],["允许执行","allowed-once"],["可以","allowed-once"],["可以了","allowed-once"],["可以继续","allowed-once"],["可以执行","allowed-once"],["同意本次","allowed-once"],["继续","allowed-once"],["继续吧","allowed-once"],["继续执行","allowed-once"],["你继续","allowed-once"],["执行吧","allowed-once"],["马上执行","allowed-once"],["yes","allowed-once"],["ok","allowed-once"],["okay","allowed-once"],["y","allowed-once"],["go","allowed-once"],["拒绝","rejected"],["不批准","rejected"],["不同意","rejected"],["不要","rejected"],["不要执行","rejected"],["不允许","rejected"],["取消","rejected"],["取消本次","rejected"],["取消执行","rejected"],["停止执行","rejected"],["别执行","rejected"],["算了","rejected"],["no","rejected"],["n","rejected"],["reject","rejected"],["deny","rejected"]])`,
      'bundled dsh-im approval replies',
    )
      source = replaceExact(
      source,
      'Tb="\\u8BF7\\u7CBE\\u51C6\\u56DE\\u590D\\u300C\\u786E\\u8BA4\\u6267\\u884C\\u300D\\u6216\\u300C\\u62D2\\u7EDD\\u300D\\uFF08\\u4E5F\\u652F\\u6301\\uFF1A\\u6279\\u51C6 / \\u540C\\u610F / \\u5141\\u8BB8\\u6267\\u884C / \\u4E0D\\u540C\\u610F / yes / no\\uFF09\\u3002"',
      `Tb="请回复「确认执行」或「拒绝」（也支持：确认 / 继续 / 执行吧 / 可以 / 批准 / 同意 / 不同意 / yes / no）。"`,
      'bundled dsh-im approval prompt',
      )
    }
  }
  if (!source.includes(`${APPROVAL_DISPLAY_ARGUMENTS_PATCH_MARKER}: dsh-im-bundled-approval`)) {
    const current230 = patchDshImBundledApprovalCurrent230(source)
    if (current230 !== source) {
      source = current230
    } else {
      source = replaceExact(
      source,
      'function oce(n){let t=n?.arguments;if(t!==null&&typeof t=="object")try{return JSON.stringify(t,null,2)}catch{return null}if(typeof t!="string")return null;let o=Nb(t);if(!o)return t===""?"{}":null;try{return JSON.stringify(JSON.parse(o),null,2)}catch{return o}}function Rb(n,{toolCall:t,requiresMention:o=!1,maxArgumentsLength:i=6e3}={}){if(!UH(n))return null;let e=Ua(n.callId);if(!e||Ua(t?.callId)!==e||Ua(t?.name)!==Ua(n.toolName))return null;let a=oce(t);if(!a||a.length>i)return null;',
      `function oce(n){let t=n;if(t!==null&&typeof t=="object")try{return JSON.stringify(t,null,2)}catch{return null}if(typeof t!="string")return null;let o=Nb(t);if(!o)return t===""?"{}":null;try{return JSON.stringify(JSON.parse(o),null,2)}catch{return o}}function dshImApprovalPayloadArgs(n){return n&&typeof n=="object"?n.arguments??n.toolArguments:void 0}function dshImApprovalCapPayloadArgs(n,t){if(n.length<=t)return n;let o=\`\\n...(truncated, original length \${n.length})\`;return n.slice(0,Math.max(0,t-o.length))+o}function Rb(n,{toolCall:t,requiresMention:o=!1,maxArgumentsLength:i=6e3}={}){if(!UH(n))return null;let e=Ua(n.callId),a=null,u=!1;if(t){if(e&&Ua(t?.callId)!==e||Ua(t?.name)!==Ua(n.toolName))return null;a=oce(t.arguments)}a||(a=oce(dshImApprovalPayloadArgs(n)),u=!!a);if(!a)return null;if(a.length>i){if(!u)return null;a=dshImApprovalCapPayloadArgs(a,i)}/* ${APPROVAL_DISPLAY_ARGUMENTS_PATCH_MARKER}: dsh-im-bundled-approval *//* ${APPROVAL_DISPLAY_ARGUMENTS_TRUNCATION_PATCH_MARKER}: dsh-im-bundled-approval */`,
      'bundled dsh-im approval payload argument fallback',
      )
    }
  }
  source = patchDshImBundledNaturalModelAliases(source)
  source = patchDshImBundledProductModelCatalog(source)
  source = patchDshImBundledLocalModelSelect(source)
  source = patchDshImBundledSessionPermissionApi(source)
  source = patchDshImBundledApprovalAllowAll(source)
  if (!source.includes(`${APPROVAL_DISPLAY_ARGUMENTS_TRUNCATION_PATCH_MARKER}: dsh-im-bundled-approval`)) {
    source = replaceExact(
      source,
      'function dshImApprovalPayloadArgs(n){return n&&typeof n=="object"?n.arguments??n.toolArguments:void 0}function Rb(n,{toolCall:t,requiresMention:o=!1,maxArgumentsLength:i=6e3}={}){if(!UH(n))return null;let e=Ua(n.callId),a=null;if(t){if(e&&Ua(t?.callId)!==e||Ua(t?.name)!==Ua(n.toolName))return null;a=oce(t.arguments)}a||(a=oce(dshImApprovalPayloadArgs(n)));if(!a||a.length>i)return null;/* crawshrimp-approval-display-arguments-v1: dsh-im-bundled-approval */',
      `function dshImApprovalPayloadArgs(n){return n&&typeof n=="object"?n.arguments??n.toolArguments:void 0}function dshImApprovalCapPayloadArgs(n,t){if(n.length<=t)return n;let o=\`\\n...(truncated, original length \${n.length})\`;return n.slice(0,Math.max(0,t-o.length))+o}function Rb(n,{toolCall:t,requiresMention:o=!1,maxArgumentsLength:i=6e3}={}){if(!UH(n))return null;let e=Ua(n.callId),a=null,u=!1;if(t){if(e&&Ua(t?.callId)!==e||Ua(t?.name)!==Ua(n.toolName))return null;a=oce(t.arguments)}a||(a=oce(dshImApprovalPayloadArgs(n)),u=!!a);if(!a)return null;if(a.length>i){if(!u)return null;a=dshImApprovalCapPayloadArgs(a,i)}/* ${APPROVAL_DISPLAY_ARGUMENTS_PATCH_MARKER}: dsh-im-bundled-approval *//* ${APPROVAL_DISPLAY_ARGUMENTS_TRUNCATION_PATCH_MARKER}: dsh-im-bundled-approval */`,
      'bundled dsh-im approval payload argument truncation',
    )
  }
  if (source.includes(`${APPROVAL_DISPLAY_ARGUMENTS_MISMATCH_PATCH_MARKER}: dsh-im-bundled-approval`)) {
    return patchDshImBundledApprovalBriefCard(source)
  }
  const nextR = source.replace(
    'let e=Ua(n.callId),a=null,u=!1;if(t){if(e&&Ua(t?.callId)!==e||Ua(t?.name)!==Ua(n.toolName))return null;a=oce(t.arguments)}a||(a=oce(dshImApprovalPayloadArgs(n)),u=!!a);',
    `let e=Ua(n.callId),a=null,u=!1;if(t){if(!(e&&Ua(t?.callId)!==e||Ua(t?.name)!==Ua(n.toolName)))a=oce(t.arguments)}a||(a=oce(dshImApprovalPayloadArgs(n)),u=!!a);/* ${APPROVAL_DISPLAY_ARGUMENTS_MISMATCH_PATCH_MARKER}: dsh-im-bundled-approval */`,
  )
  if (nextR !== source) return patchDshImBundledApprovalBriefCard(nextR)
  const nextBb = source.replace(
    'let e=ya(n.callId),a=null,u=!1;if(t){if(e&&ya(t?.callId)!==e||ya(t?.name)!==ya(n.toolName))return null;a=Pge(t.arguments)}a||(a=Pge(cshImApprovalPayloadArgs(n)),u=!!a);',
    `let e=ya(n.callId),a=null,u=!1;if(t){if(!(e&&ya(t?.callId)!==e||ya(t?.name)!==ya(n.toolName)))a=Pge(t.arguments)}a||(a=Pge(cshImApprovalPayloadArgs(n)),u=!!a);/* ${APPROVAL_DISPLAY_ARGUMENTS_MISMATCH_PATCH_MARKER}: dsh-im-bundled-approval */`,
  )
  if (nextBb !== source) return patchDshImBundledApprovalBriefCard(nextBb)
  throw new Error('cannot patch bundled dsh-im approval payload mismatch fallback: expected source not found')
}

function patchDshImBundledLocalModelSelect(source) {
  if (source.includes(`${DSH_IM_LOCAL_MODEL_SELECT_PATCH_MARKER}: bundled client`)) {
    return source
  }
  return replaceAny(
    source,
    [
      [
        'async selectSessionModel(t,o,i={}){if(typeof t!="string"||!t)throw new TypeError("sessionId is required");if(!dM(o))throw new TypeError("A provider and model are required");await this.ensureRunning(i);let e=A=>{let r=A&&i.signal?AbortSignal.any([A,i.signal]):A??i.signal;return this.rpc("session.selectModel",{sessionId:t,provider:o.provider,model:o.model,...o.reasoningEffort===void 0?{}:{reasoningEffort:o.reasoningEffort}},3e4,r?{...i,signal:r}:i)},a=this.#l?await this.#l({sessionId:t,operation:e}):await e();if(!a||typeof a!="object"||!dM(a.selected))throw new Error("Harness returned an invalid response for session.selectModel");return a}',
        `async selectSessionModel(t,o,i={}){if(typeof t!="string"||!t)throw new TypeError("sessionId is required");if(!dM(o))throw new TypeError("A provider and model are required");await this.ensureRunning(i);let e;try{e=await this.#i(new URL("/api/crawshrimp/session/select-model",this.#e),{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({sessionId:t,provider:o.provider,model:o.model,...o.reasoningEffort===void 0?{}:{reasoningEffort:o.reasoningEffort}}),signal:i.signal})}catch(A){if(i.signal?.aborted)throw A}if(e&&e.status!==404&&e.status!==501){if(!e.ok)throw new Og("harness-http-failed","crawshrimp.session.selectModel",{status:e.status});let A=await e.json();if(A?.ok===!1)throw new jo("crawshrimp.session.selectModel",A.error);if(!A||A.ok!==!0||!dM(A.selected))throw new Og("harness-response-invalid","crawshrimp.session.selectModel",{cause:new Error("Crawshrimp returned an invalid selected model")});return{selected:A.selected}}/* ${DSH_IM_LOCAL_MODEL_SELECT_PATCH_MARKER}: bundled client */let a=A=>{let r=A&&i.signal?AbortSignal.any([A,i.signal]):A??i.signal;return this.rpc("session.selectModel",{sessionId:t,provider:o.provider,model:o.model,...o.reasoningEffort===void 0?{}:{reasoningEffort:o.reasoningEffort}},3e4,r?{...i,signal:r}:i)},r=this.#l?await this.#l({sessionId:t,operation:a}):await a();if(!r||typeof r!="object"||!dM(r.selected))throw new Error("Harness returned an invalid response for session.selectModel");return r}`,
      ],
      [
        'async selectSessionModel(t,o,i={}){if(typeof t!="string"||!t)throw new TypeError("sessionId is required");if(!tM(o))throw new TypeError("A provider and model are required");await this.ensureRunning(i);let e=A=>{let r=A&&i.signal?AbortSignal.any([A,i.signal]):A??i.signal;return this.rpc("session.selectModel",{sessionId:t,provider:o.provider,model:o.model,...o.reasoningEffort===void 0?{}:{reasoningEffort:o.reasoningEffort}},3e4,r?{...i,signal:r}:i)},a=this.#l?await this.#l({sessionId:t,operation:e}):await e();if(!a||typeof a!="object"||!tM(a.selected))throw new Error("Harness returned an invalid response for session.selectModel");return a}',
        `async selectSessionModel(t,o,i={}){if(typeof t!="string"||!t)throw new TypeError("sessionId is required");if(!tM(o))throw new TypeError("A provider and model are required");await this.ensureRunning(i);let e;try{e=await this.#i(new URL("/api/crawshrimp/session/select-model",this.#e),{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({sessionId:t,provider:o.provider,model:o.model,...o.reasoningEffort===void 0?{}:{reasoningEffort:o.reasoningEffort}}),signal:i.signal})}catch(A){if(i.signal?.aborted)throw A}if(e&&e.status!==404&&e.status!==501){if(!e.ok)throw new Sg("harness-http-failed","crawshrimp.session.selectModel",{status:e.status});let A=await e.json();if(A?.ok===!1)throw new Yo("crawshrimp.session.selectModel",A.error);if(!A||A.ok!==!0||!tM(A.selected))throw new Sg("harness-response-invalid","crawshrimp.session.selectModel",{cause:new Error("Crawshrimp returned an invalid selected model")});return{selected:A.selected}}/* ${DSH_IM_LOCAL_MODEL_SELECT_PATCH_MARKER}: bundled client */let a=A=>{let r=A&&i.signal?AbortSignal.any([A,i.signal]):A??i.signal;return this.rpc("session.selectModel",{sessionId:t,provider:o.provider,model:o.model,...o.reasoningEffort===void 0?{}:{reasoningEffort:o.reasoningEffort}},3e4,r?{...i,signal:r}:i)},r=this.#l?await this.#l({sessionId:t,operation:a}):await a();if(!r||typeof r!="object"||!tM(r.selected))throw new Error("Harness returned an invalid response for session.selectModel");return r}`,
      ],
    ],
    'bundled dsh-im Crawshrimp local model select client',
  )
}

function bundledPermissionPayloadGuard(value, { requirePreset } = {}) {
  return `!${value}||typeof ${value}!="object"||typeof ${value}.preset!="string"||!${value}.preset||!Array.isArray(${value}.available)||${value}.available.some(${requirePreset}=>typeof ${requirePreset}!="string"||!${requirePreset})`
}

function patchDshImBundledSessionPermissionApi(source) {
  let next = source
  if (!next.includes(`${DSH_IM_SESSION_PERMISSION_API_PATCH_MARKER}: bundled client`)) {
    const transportError = next.includes('new Og("harness-http-failed","crawshrimp.session.selectModel"')
      ? 'Og'
      : (next.includes('new Sg("harness-http-failed","crawshrimp.session.selectModel"') ? 'Sg' : null)
    const rpcError = transportError === 'Og' ? 'jo' : (transportError === 'Sg' ? 'Yo' : null)
    if (!transportError || !rpcError) {
      throw new Error('cannot patch bundled dsh-im session permission client: expected transport error names not found')
    }
    next = replaceExact(
      next,
      'async isSessionRunning(t,o={}){if(typeof t!="string"||!t)throw new TypeError("sessionId is required");',
      `async getSessionPermission(t,o={}){if(typeof t!="string"||!t)throw new TypeError("sessionId is required");await this.ensureRunning(o);let i=await this.#i(new URL("/api/crawshrimp/session/permission",this.#e),{method:"GET",headers:{accept:"application/json"},signal:o.signal});if(!i.ok)throw new ${transportError}("harness-http-failed","crawshrimp.session.permission",{status:i.status});let e=await i.json();if(e?.ok===!1)throw new ${rpcError}("crawshrimp.session.permission",e.error);if(${bundledPermissionPayloadGuard('e', { requirePreset: 'a' })})throw new ${transportError}("harness-response-invalid","crawshrimp.session.permission",{cause:new Error("Crawshrimp returned an invalid session permission")});return e}async setSessionPermission(t,o,i={}){if(typeof t!="string"||!t)throw new TypeError("sessionId is required");if(typeof o!="string"||!o)throw new TypeError("permission preset is required");await this.ensureRunning(i);let e=await this.#i(new URL("/api/crawshrimp/session/permission",this.#e),{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({sessionId:t,preset:o}),signal:i.signal});if(!e.ok)throw new ${transportError}("harness-http-failed","crawshrimp.session.permission",{status:e.status});let a=await e.json();if(a?.ok===!1)throw new ${rpcError}("crawshrimp.session.permission",a.error);if(${bundledPermissionPayloadGuard('a', { requirePreset: 'A' })}||a.preset!==o)throw new ${transportError}("harness-response-invalid","crawshrimp.session.permission",{cause:new Error("Crawshrimp returned an invalid session permission update")});return a}/* ${DSH_IM_SESSION_PERMISSION_API_PATCH_MARKER}: bundled client */async isSessionRunning(t,o={}){if(typeof t!="string"||!t)throw new TypeError("sessionId is required");`,
      'bundled dsh-im session permission client',
    )
  }

  if (!next.includes(`${DSH_IM_SESSION_PERMISSION_API_PATCH_MARKER}: bundled workspace session`)) {
    next = replaceExact(
      next,
      'selectModel:(...o)=>n.selectSessionModel(t,...o),isRunning:(...o)=>n.isSessionRunning(t,...o),',
      `selectModel:(...o)=>n.selectSessionModel(t,...o),permission:(...o)=>n.getSessionPermission(t,...o),setPermission:(...o)=>n.setSessionPermission(t,...o),/* ${DSH_IM_SESSION_PERMISSION_API_PATCH_MARKER}: bundled workspace session */isRunning:(...o)=>n.isSessionRunning(t,...o),`,
      'bundled dsh-im workspace session permission facade',
    )
  }

  if (!next.includes(`${DSH_IM_SESSION_PERMISSION_API_PATCH_MARKER}: bundled bot workspace store`)) {
    next = replaceExact(
      next,
      'models(...N){return m("getSessionModels",N,"model listing")},selectModel(...N){return m("selectSessionModel",N,"model selection")},isRunning(...N){return m("isSessionRunning",N,"run-state check")},',
      `models(...N){return m("getSessionModels",N,"model listing")},selectModel(...N){return m("selectSessionModel",N,"model selection")},permission(...N){return m("getSessionPermission",N,"permission query")},setPermission(...N){return _("setSessionPermission",N,"permission update")},/* ${DSH_IM_SESSION_PERMISSION_API_PATCH_MARKER}: bundled bot workspace store */isRunning(...N){return m("isSessionRunning",N,"run-state check")},`,
      'bundled dsh-im bot workspace session permission facade',
    )
  }

  if (!next.includes('"去掉审批"')) {
    next = replaceExact(
      next,
      '"关闭审批","不用审批"',
      '"关闭审批","关闭审批模式","去掉审批","去除审批","取消审批","关掉审批","取消审批模式","不用审批"',
      'bundled dsh-im no-approval aliases',
    )
  }
  if (!next.includes('"full assess"')) {
    next = replaceExact(
      next,
      '"full access","full-access"',
      '"full access","full assess","full-access"',
      'bundled dsh-im full assess alias',
    )
  }
  if (!next.includes('"现在是什么审批模式"')) {
    next = replaceExact(
      next,
      '"现在是哪个权限模式","当前审批策略"',
      '"现在是哪个权限模式","现在是什么审批模式","当前审批模式","当前审批策略"',
      'bundled dsh-im approval mode query aliases',
    )
    next = replaceExact(
      next,
      '"现在审批策略","审批权限"',
      '"现在审批策略","审批模式","审批权限"',
      'bundled dsh-im approval mode query phrase',
    )
  }
  if (!next.includes('|把权限改成|开启|启用|打开)\\s*(.+)')) {
    next = replaceExact(
      next,
      '|把权限改成)\\s*(.+)',
      '|把权限改成|开启|启用|打开)\\s*(.+)',
      'bundled dsh-im approval mode verb aliases',
    )
  }

  if (!next.includes(`${DSH_IM_SESSION_PERMISSION_API_PATCH_MARKER}: bundled permission manager`)) {
    next = replaceAny(
      next,
      [
        [
          'if(typeof A.session.executeCommand!="function"){let s=new Error("Harness command execution is unavailable");throw s.code="commands-unavailable",s}let r=fK(await A.session.executeCommand("/permission",a));if(!r)throw new TypeError("Harness returned an invalid current permission");return o.sessionFor(i)!==A.sessionId?cr(D("\\u5F53\\u524D\\u804A\\u5929\\u7ED1\\u5B9A\\u7684\\u4F1A\\u8BDD\\u5DF2\\u53D1\\u751F\\u53D8\\u5316\\uFF0C\\u8BF7\\u91CD\\u8BD5\\u6743\\u9650\\u67E5\\u8BE2\\u3002")):cr(hIe(r))',
          `if(typeof A.session.permission!="function"){let s=new Error("Harness permission API is unavailable");throw s.code="commands-unavailable",s}let r=await A.session.permission(a);if(${bundledPermissionPayloadGuard('r', { requirePreset: 's' })})throw new TypeError("Harness returned an invalid permission payload");let g=r.preset;if(!Object.hasOwn(hf,g)&&g!=="custom")throw new TypeError("Harness returned an unknown permission preset");/* ${DSH_IM_SESSION_PERMISSION_API_PATCH_MARKER}: bundled permission manager */return o.sessionFor(i)!==A.sessionId?cr(D("\\u5F53\\u524D\\u804A\\u5929\\u7ED1\\u5B9A\\u7684\\u4F1A\\u8BDD\\u5DF2\\u53D1\\u751F\\u53D8\\u5316\\uFF0C\\u8BF7\\u91CD\\u8BD5\\u6743\\u9650\\u67E5\\u8BE2\\u3002")):cr(hIe(g))`,
        ],
        [
          'if(typeof a.session.executeCommand!="function"){let A=new Error("Harness command execution is unavailable");throw A.code="commands-unavailable",A}let A=cshCurrentPermission(await a.session.executeCommand("/permission",e));if(!A)throw new TypeError("Harness returned an invalid current permission");return t.sessionFor(o)!==a.sessionId?pt(D("当前聊天绑定的会话已发生变化，请重试权限查询。")):pt(cshPermissionSummary(A))',
          `if(typeof a.session.permission!="function"){let A=new Error("Harness permission API is unavailable");throw A.code="commands-unavailable",A}let A=await a.session.permission(e);if(${bundledPermissionPayloadGuard('A', { requirePreset: 'r' })})throw new TypeError("Harness returned an invalid permission payload");let r=A.preset;if(!Object.hasOwn(cshPermissionPresets,r)&&r!=="custom")throw new TypeError("Harness returned an unknown permission preset");/* ${DSH_IM_SESSION_PERMISSION_API_PATCH_MARKER}: bundled permission manager */return t.sessionFor(o)!==a.sessionId?pt(D("当前聊天绑定的会话已发生变化，请重试权限查询。")):pt(cshPermissionSummary(r))`,
        ],
      ],
      'bundled dsh-im direct permission query',
    )
    next = replaceAny(
      next,
      [
        [
          'if(typeof s.session.executeCommand!="function"){let I=new Error("Harness command execution is unavailable");throw I.code="commands-unavailable",I}if(yK(await s.session.executeCommand(dIe(t),r)).kind!=="success")throw new Error("Harness rejected the permission preset");if(fK(await s.session.executeCommand("/permission",r))!==t){let I=new Error("Harness permission readback mismatch");throw I.code="permission-readback-mismatch",I}',
          `if(typeof s.session.setPermission!="function"){let I=new Error("Harness permission API is unavailable");throw I.code="commands-unavailable",I}let d=await s.session.setPermission(t,r);if(${bundledPermissionPayloadGuard('d', { requirePreset: 'B' })})throw new TypeError("Harness returned an invalid permission payload");if(d.preset!==t){let I=new Error("Harness permission readback mismatch");throw I.code="permission-readback-mismatch",I}`,
        ],
        [
          'if(typeof r.session.executeCommand!="function"){let s=new Error("Harness command execution is unavailable");throw s.code="commands-unavailable",s}if(cshPermissionResultValue(await r.session.executeCommand(cshPermissionLine(n),A)).kind!=="success")throw new Error("Harness rejected the permission preset");if(cshCurrentPermission(await r.session.executeCommand("/permission",A))!==n){let s=new Error("Harness permission readback mismatch");throw s.code="permission-readback-mismatch",s}',
          `if(typeof r.session.setPermission!="function"){let s=new Error("Harness permission API is unavailable");throw s.code="commands-unavailable",s}let g=await r.session.setPermission(n,A);if(${bundledPermissionPayloadGuard('g', { requirePreset: 's' })})throw new TypeError("Harness returned an invalid permission payload");if(g.preset!==n){let s=new Error("Harness permission readback mismatch");throw s.code="permission-readback-mismatch",s}`,
        ],
      ],
      'bundled dsh-im direct permission change',
    )
  }

  return upgradeDshImBundledApprovalAllowAllPermissionApi(next)
}

function patchDshImBundledApprovalBriefCard(source) {
  if (source.includes(`${DSH_IM_APPROVAL_BRIEF_CARD_PATCH_MARKER}: bundled approval`)) {
    return source
  }
  return replaceAny(
    source,
    [
      [
        'let A=[D("DeepSeek Harness \\u9700\\u8981\\u4F60\\u7684\\u5BA1\\u6279\\uFF1A"),"",D("\\u5DE5\\u5177\\uFF1A{tool}",{tool:Nb(n.toolName)}),D("\\u64CD\\u4F5C\\u53C2\\u6570\\uFF1A"),a],r=Nb(n.reason);return r&&A.push(D("\\u539F\\u56E0\\uFF1A{reason}",{reason:r})),A.push("",D(Tb))',
        `/* ${DSH_IM_APPROVAL_BRIEF_CARD_PATCH_MARKER}: bundled approval */let A=[D("抓虾 Harness 需要你的审批"),"",D("步骤：{step}",{step:Nb(n.toolName)})],r=Nb(n.reason);return r&&A.push(D("说明：{reason}",{reason:r})),A.push(D("简略参数："),a),A.push("",D(Tb))`,
      ],
      [
        'let A=[D("DeepSeek Harness \\u9700\\u8981\\u4F60\\u7684\\u5BA1\\u6279\\uFF1A"),"",D("\\u5DE5\\u5177\\uFF1A{tool}",{tool:Ob(n.toolName)}),D("\\u64CD\\u4F5C\\u53C2\\u6570\\uFF1A"),a],r=Ob(n.reason);return r&&A.push(D("\\u539F\\u56E0\\uFF1A{reason}",{reason:r})),A.push("",D(wb))',
        `/* ${DSH_IM_APPROVAL_BRIEF_CARD_PATCH_MARKER}: bundled approval */let A=[D("抓虾 Harness 需要你的审批"),"",D("步骤：{step}",{step:Ob(n.toolName)})],r=Ob(n.reason);return r&&A.push(D("说明：{reason}",{reason:r})),A.push(D("简略参数："),a),A.push("",D(wb))`,
      ],
    ],
    'bundled dsh-im approval brief card text',
  )
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
  console.log(`[patch-runtime-dependencies] sdk-jsonrpc cancel ${result.sdkJsonrpcCancelPatched ? 'applied' : 'already present'}`)
  console.log(`[patch-runtime-dependencies] sdk-jsonrpc internal prompt ${result.sdkJsonrpcInternalPromptPatched ? 'applied' : 'already present'}`)
  console.log(`[patch-runtime-dependencies] pi-ai DeepSeek multimodal fallback ${result.piAiDeepSeekMultimodalFallbackPatched ? 'applied' : 'already present'}`)
  console.log(`[patch-runtime-dependencies] host-apiproxy DeepSeek image selection ${result.hostApiProxyDeepSeekImageSelectionPatched ? 'applied' : 'already present'}`)
  console.log(`[patch-runtime-dependencies] approval display arguments ${result.approvalDisplayArgumentsPatched ? 'applied' : 'already present'}`)
  console.log(`[patch-runtime-dependencies] dsh approval allow-all ${result.dshApprovalAllowAllPatched ? 'applied' : 'already present'}`)
  console.log(`[patch-runtime-dependencies] dsh-im natural controls ${result.dshImNaturalControlsPatched ? 'applied' : 'already present'}`)
}
