import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const CRAWSHRIMP_GLM_VISION_BRIDGE_MARKER = 'crawshrimp-glm-vision-bridge-v1'
export const CRAWSHRIMP_GLM_VISION_ADMISSION_MARKER = 'crawshrimp-glm-vision-admission-v1'
export const CRAWSHRIMP_GLM_READ_IMAGE_MARKER = 'crawshrimp-glm-read-image-vision-v1'
export const CRAWSHRIMP_GLM_OFFICE_MCP_MARKER = 'crawshrimp-glm-office-mcp-image-v1'
export const CRAWSHRIMP_GLM_OFFICE_TRANSPORT_MARKER = 'crawshrimp-glm-office-transport-v1'
export const CRAWSHRIMP_GLM_VISION_AUDIT_MARKER = 'crawshrimp-glm-vision-audit-v1'
export const CRAWSHRIMP_GLM_LIST_MODELS_MARKER = 'crawshrimp-glm-list-models-image-v1'

function replaceRequired(source, expected, replacement, label) {
  if (!source.includes(expected)) throw new Error(`GLM vision patch anchor changed: ${label}`)
  return source.replace(expected, replacement)
}

function requireFile(root, relativePath) {
  return join(root, relativePath)
}

export function patchGlmVisionSource(source) {
  if (!source.includes('crawshrimp-deepseek-vision-bridge-v3')) {
    throw new Error('GLM vision bridge requires the installed DeepSeek image bridge helpers')
  }
  const hasBridge = source.includes(CRAWSHRIMP_GLM_VISION_BRIDGE_MARKER)
  source = patchGlmVisionAuditSource(source)
  source = patchGlmFallbackSource(source)
  source = patchGlmOfficeTransportSource(source)
  source = patchGlmListModelsSource(source)
  if (hasBridge) return source
  source = replaceRequired(
    source,
    'async function toPiContextWithImages(options, images, onReplayDegrade) {',
    `${glmVisionRuntimeHelpers()}\nasync function toPiContextWithImages(options, images, onReplayDegrade) {`,
    'llm-pi-ai GLM vision helpers',
  )
  source = replaceRequired(
    source,
    'requestOptions = await crawshrimpBridgeDeepSeekImages.call(this, snapshot, profile, options, apiKey, watchdog.signal, onReplayDegrade) ?? options;',
    'requestOptions = await crawshrimpBridgeDeepSeekImages.call(this, snapshot, profile, options, apiKey, watchdog.signal, onReplayDegrade) ?? await crawshrimpBridgeGlmImages.call(this, snapshot, profile, options, apiKey, watchdog.signal, onReplayDegrade) ?? options;',
    'llm-pi-ai GLM declared text-image bridge dispatch',
  )
  source = replaceRequired(
    source,
    'const iterator = toStreamChunks(snapshot.models.streamSimple(model, context, {\n\t\t\t\t\t...profileOptions(profile, reasoning, apiKey),\n\t\t\t\t\tonPayload: (payload) => applyReasoningWireIntent(payload, model, reasoning),\n\t\t\t\t\t...requestOptions.temperature === void 0 ? {} : { temperature: requestOptions.temperature },\n\t\t\t\t\t...requestOptions.maxTokens === void 0 ? {} : { maxTokens: requestOptions.maxTokens },\n\t\t\t\t\t...requestOptions.sessionId === void 0 ? {} : { sessionId: String(requestOptions.sessionId) },\n\t\t\t\t\tsignal: watchdog.signal,\n\t\t\t\t\theaders: semirAnthropicHeaders(requestHeaders(profile.headers), model, apiKey)\n\t\t\t\t}), model.contextWindow, options.signal)[Symbol.asyncIterator]();',
    'const iterator = crawshrimpGlmStreamWithVisionFallback.call(this, snapshot, profile, model, context, requestOptions, apiKey, reasoning, watchdog.signal, onReplayDegrade, options.signal)[Symbol.asyncIterator]();',
    'llm-pi-ai GLM streamed image fallback',
  )
  return source
}

export function patchGlmListModelsSource(source) {
  if (source.includes(CRAWSHRIMP_GLM_LIST_MODELS_MARKER)) return source
  return replaceRequired(
    source,
    'inputModalities: [...model.input]',
    `// ${CRAWSHRIMP_GLM_LIST_MODELS_MARKER}: list the paired image capability exposed by modelInfo.
\t\t\t\tinputModalities: crawshrimpOfficeInputModalities(model.input, provider, model.id, snapshot, this.config)`,
    'listModels GLM paired image declaration',
  )
}

export function patchGlmVisionAuditSource(source) {
  if (source.includes(CRAWSHRIMP_GLM_VISION_AUDIT_MARKER)) {
    if (source.includes('event: provider === "crawshrimp-glm-official" ? "glm_vision_preflight" : "deepseek_vision_preflight"')) {
      source = replaceRequired(
        source,
        '\t\t\tconst audit = {\n\t\t\t\tevent: provider === "crawshrimp-glm-official" ? "glm_vision_preflight" : "deepseek_vision_preflight",',
        '\t\t\tconst event = provider === "crawshrimp-glm-official" ? "glm_vision_preflight" : "deepseek_vision_preflight";\n\t\t\tconst audit = {\n\t\t\t\tevent: "deepseek_vision_preflight",',
        'llm-pi-ai GLM vision audit v1 migration event literal',
      )
      source = replaceRequired(
        source,
        '\t\t\t};\n\t\t\tctx.logger.info("crawshrimp.audit " + JSON.stringify(audit));',
        '\t\t\t};\n\t\t\taudit.event = event;\n\t\t\tctx.logger.info("crawshrimp.audit " + JSON.stringify(audit));',
        'llm-pi-ai GLM vision audit v1 migration event assignment',
      )
    }
    return source
  }
  return replaceRequired(
    source,
    '\t\t\tconst audit = {\n\t\t\t\tevent: "deepseek_vision_preflight",\n\t\t\t\tvision_preflight: true,\n\t\t\t\tprovider,\n\t\t\t\toriginal_model: model,\n\t\t\t\tvision_model: visionModel,\n\t\t\t\tsession_id: sessionId ?? null\n\t\t\t};',
    `\t\t\t// ${CRAWSHRIMP_GLM_VISION_AUDIT_MARKER}: keep DeepSeek audit names and use a GLM-specific event for GLM.
\t\t\tconst event = provider === "crawshrimp-glm-official" ? "glm_vision_preflight" : "deepseek_vision_preflight";
\t\t\tconst audit = {
\t\t\t\tevent: "deepseek_vision_preflight",
\t\t\t\tvision_preflight: true,
\t\t\t\tprovider,
\t\t\t\toriginal_model: model,
\t\t\t\tvision_model: visionModel,
\t\t\t\tsession_id: sessionId ?? null
\t\t\t};
\t\t\taudit.event = event;`,
    'llm-pi-ai GLM vision audit event',
  )
}

export function patchGlmFallbackSource(source) {
  if (source.includes('allowAnyOfficialModel = false') && source.includes('const declaredModel = snapshot.models.getModel(options.provider, options.model);')) return source
  if (!source.includes(CRAWSHRIMP_GLM_VISION_BRIDGE_MARKER)) return source
  if (!source.includes('allowAnyOfficialModel = false')) {
    source = replaceRequired(
      source,
      'async function crawshrimpBridgeGlmImages(snapshot, profile, options, apiKey, signal, onReplayDegrade) {\n\tif (!crawshrimpGlmTextModelCanUseVisionBridge(options.provider, options.model)) return void 0;',
      'async function crawshrimpBridgeGlmImages(snapshot, profile, options, apiKey, signal, onReplayDegrade, allowAnyOfficialModel = false) {\n\tif (!crawshrimpGlmTextModelCanUseVisionBridge(options.provider, options.model) && !(allowAnyOfficialModel && options.provider === CRAWSHRIMP_GLM_OFFICIAL_PROVIDER)) return void 0;',
      'GLM unknown-model fallback preflight guard',
    )
  }
  source = replaceRequired(
    source,
    '\tif (!crawshrimpGlmTextModelCanUseVisionBridge(options.provider, options.model) && !(allowAnyOfficialModel && options.provider === CRAWSHRIMP_GLM_OFFICIAL_PROVIDER)) return void 0;',
    '\tconst declaredModel = snapshot.models.getModel(options.provider, options.model);\n\tif (allowAnyOfficialModel) {\n\t\tif (options.provider !== CRAWSHRIMP_GLM_OFFICIAL_PROVIDER) return void 0;\n\t} else if (!crawshrimpGlmTextModelCanUseVisionBridge(options.provider, options.model) || declaredModel?.input.includes("image")) return void 0;',
    'GLM declared-image direct-send guard',
  )
  if (source.includes('const replayOptions = await crawshrimpBridgeGlmImages.call(this, snapshot, profile, requestOptions, apiKey, streamSignal, onReplayDegrade);')) {
    source = replaceRequired(
      source,
      'const replayOptions = await crawshrimpBridgeGlmImages.call(this, snapshot, profile, requestOptions, apiKey, streamSignal, onReplayDegrade);',
      'const replayOptions = await crawshrimpBridgeGlmImages.call(this, snapshot, profile, requestOptions, apiKey, streamSignal, onReplayDegrade, true);',
      'GLM unknown-model fallback preflight dispatch',
    )
  }
  return source
}

function glmVisionRuntimeHelpers() {
  return `// ${CRAWSHRIMP_GLM_VISION_BRIDGE_MARKER}: GLM text routes use the same provider's Flash vision preflight.
const CRAWSHRIMP_GLM_OFFICIAL_PROVIDER = "crawshrimp-glm-official";
const CRAWSHRIMP_GLM_VISION_MODELS = Object.freeze(["glm-5.3-flash", "glm-5.3-flashx"]);
function crawshrimpGlmTextModelCanUseVisionBridge(provider, model) {
\treturn provider === CRAWSHRIMP_GLM_OFFICIAL_PROVIDER && (model === "glm-5.3" || model === "glm-5.2");
}
function crawshrimpGlmVisionRoute(snapshot, provider) {
\tif (provider !== CRAWSHRIMP_GLM_OFFICIAL_PROVIDER) return void 0;
\tfor (const id of CRAWSHRIMP_GLM_VISION_MODELS) {
\t\tconst model = snapshot.models.getModel(provider, id);
\t\tif (model?.input.includes("image")) return { id, model };
\t}
\treturn void 0;
}
function crawshrimpPairedTextModelCanUseVisionBridge(provider, model) {
\treturn crawshrimpDeepSeekTextModelCanUseVisionBridge(provider, model) || crawshrimpGlmTextModelCanUseVisionBridge(provider, model);
}
function crawshrimpPairedVisionModelFor(snapshot, provider, model) {
\tif (crawshrimpDeepSeekTextModelCanUseVisionBridge(provider, model)) return snapshot.models.getModel(provider, CRAWSHRIMP_DEEPSEEK_VISION_MODEL);
\tif (crawshrimpGlmTextModelCanUseVisionBridge(provider, model)) return crawshrimpGlmVisionRoute(snapshot, provider)?.model;
\treturn void 0;
}
function crawshrimpTextOnlyOptionsFromGlmVision(options, visionText) {
\tconst target = crawshrimpLatestImageUserMessageIndex(options.messages);
\tlet injected = false;
\treturn {
\t\t...options,
\t\tmessages: options.messages.map((message, index) => !contentHasImage(message.content) ? message : {
\t\t\t...message,
\t\t\tcontent: crawshrimpReplaceImages(message.content, () => {
\t\t\t\tif (index === target && !injected) {
\t\t\t\t\tinjected = true;
\t\t\t\t\treturn \`\\n\\n[GLM Vision 识别结果]\\n\${visionText}\\n\\n[兼容说明]\\n原始图片已经由同一 GLM 官方供应商的多模态模型转写成以上文字；当前 GLM 文本模型应直接基于这些文字继续回答，不要因为原始会话含图而要求用户切换到视觉模型。\\n\\n\`;
\t\t\t\t}
\t\t\t\treturn "[图片已由 GLM Vision 处理；当前文本模型不再接收原始图片。]";
\t\t\t})
\t\t})
\t};
}
async function crawshrimpBridgeGlmImages(snapshot, profile, options, apiKey, signal, onReplayDegrade, allowAnyOfficialModel = false) {
\tconst declaredModel = snapshot.models.getModel(options.provider, options.model);
\tif (allowAnyOfficialModel) {
\t\tif (options.provider !== CRAWSHRIMP_GLM_OFFICIAL_PROVIDER) return void 0;
\t} else if (!crawshrimpGlmTextModelCanUseVisionBridge(options.provider, options.model) || declaredModel?.input.includes("image")) return void 0;
\tconst attachments = this.config.resolveAttachments?.();
\tif (attachments === void 0) return void 0;
\tconst route = crawshrimpGlmVisionRoute(snapshot, options.provider);
\tif (route === void 0) return void 0;
\tconst target = crawshrimpLatestImageUserMessageIndex(options.messages);
\tif (target < 0) return void 0;
\tthis.config.onVisionPreflight?.({
\t\tprovider: options.provider,
\t\tmodel: options.model,
\t\tvisionModel: route.id,
\t\tsessionId: options.sessionId === void 0 ? void 0 : String(options.sessionId)
\t});
\tconst visionSystem = [
\t\t"你是抓虾 Harness 的图片识别前置模型。只描述最新一条含图片的消息（包含工具返回的文档页图），保留页码、文字、数字、错误、结构和关键事实；文档页面需指出截断、遮挡、缺字、过小文字及对齐问题。不要执行任务，不要给操作建议。"
\t].filter((part) => typeof part === "string" && part.trim()).join("\\n\\n");
\tconst visionContext = await toPiContext({
\t\t...crawshrimpOfficeVisionOptions(crawshrimpVisionOptions(options)),
\t\t...visionSystem ? { system: visionSystem } : {},
\t\ttools: void 0,
\t\tsignal
\t}, crawshrimpImageOptions(this, attachments, profile), onReplayDegrade);
\tconst visionMessage = await snapshot.models.completeSimple(route.model, visionContext, {
\t\t...profileOptions(profile, void 0, apiKey),
\t\tmaxTokens: 2048,
\t\t...options.sessionId === void 0 ? {} : { sessionId: \`\${options.sessionId}:glm-vision\` },
\t\tsignal,
\t\theaders: requestHeaders(profile.headers)
\t});
\tif (visionMessage.stopReason === "error") throw new LlmError(\`GLM vision preflight failed: \${visionMessage.errorMessage ?? "unknown error"}\`, "UNSUPPORTED_CONTENT");
\tconst visionText = crawshrimpTextFromPiMessage(visionMessage) || "GLM Vision 未返回可用图片描述。";
\treturn crawshrimpTextOnlyOptionsFromGlmVision(options, visionText);
}
function crawshrimpGlmFinishIsUnsupportedImage(finish) {
\tconst message = String(finish?.reason?.failure?.message ?? "");
\tif (finish?.type !== "finish" || finish.reason?.kind !== "error" || !message) return false;
\tif (/\\b(?:401|403|429|5\\d\\d)\\b|unauthori[sz]ed|forbidden|rate.?limit|quota|timeout|timed?\\s*out|审核|安全|safety|moderation|policy/iu.test(message)) return false;
\tif (/messages\\.content\\.type/u.test(message) && /取值范围/u.test(message) && /\\[\\s*['"]text['"]\\s*\\]/u.test(message)) return true;
\treturn /\\b400\\b/iu.test(message) && /(?:image|图片|图像|多模态|content(?:\\.type)?|content type|image_url)/iu.test(message) && /(?:only\\s+(?:supports?\\s+)?text|text\\s+only|仅(?:支持|允许).*text|只(?:支持|允许).*text|不支持.*(?:image|图片|图像)|unsupported.*(?:image|image_url)|not support.*(?:image|image_url)|取值范围.*text)/iu.test(message);
}
function crawshrimpGlmChunkCommitsOutput(chunk) {
\treturn chunk?.type === "block-start" || chunk?.type === "text-delta" || chunk?.type === "reasoning-delta"
\t\t|| chunk?.type === "tool-call-delta" || chunk?.type === "block-end";
}
async function* crawshrimpGlmStreamWithVisionFallback(snapshot, profile, model, context, requestOptions, apiKey, reasoning, streamSignal, onReplayDegrade, callerSignal) {
\tconst streamOptions = {
\t\t...profileOptions(profile, reasoning, apiKey),
\t\tonPayload: (payload) => applyReasoningWireIntent(payload, model, reasoning),
\t\t...requestOptions.temperature === void 0 ? {} : { temperature: requestOptions.temperature },
\t\t...requestOptions.maxTokens === void 0 ? {} : { maxTokens: requestOptions.maxTokens },
\t\t...requestOptions.sessionId === void 0 ? {} : { sessionId: String(requestOptions.sessionId) },
\t\tsignal: streamSignal,
\t\theaders: semirAnthropicHeaders(requestHeaders(profile.headers), model, apiKey)
\t};
\tconst chunks = toStreamChunks(snapshot.models.streamSimple(model, context, streamOptions), model.contextWindow, callerSignal);
\tconst buffered = [];
\tlet committed = false;
\tfor await (const chunk of chunks) {
\t\tif (crawshrimpGlmChunkCommitsOutput(chunk)) {
\t\t\tcommitted = true;
\t\t\twhile (buffered.length > 0) yield buffered.shift();
\t\t\tyield chunk;
\t\t\tcontinue;
\t\t}
\t\tif (chunk?.type === "finish") {
\t\t\tif (!committed && requestOptions.provider === CRAWSHRIMP_GLM_OFFICIAL_PROVIDER
\t\t\t\t&& requestOptions.messages.some((message) => contentHasImage(message.content))
\t\t\t\t&& crawshrimpGlmFinishIsUnsupportedImage(chunk)) {
\t\t\t\tconst replayOptions = await crawshrimpBridgeGlmImages.call(this, snapshot, profile, requestOptions, apiKey, streamSignal, onReplayDegrade, true);
\t\t\t\tif (replayOptions !== void 0 && replayOptions !== requestOptions) {
\t\t\t\t\tconst replayContext = toPiContext(replayOptions, void 0, onReplayDegrade);
\t\t\t\t\tyield* toStreamChunks(snapshot.models.streamSimple(model, replayContext, {
\t\t\t\t\t\t...streamOptions,
\t\t\t\t\t\t...replayOptions.temperature === void 0 ? {} : { temperature: replayOptions.temperature },
\t\t\t\t\t\t...replayOptions.maxTokens === void 0 ? {} : { maxTokens: replayOptions.maxTokens }
\t\t\t\t\t}), model.contextWindow, callerSignal);
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t}
\t\t\twhile (buffered.length > 0) yield buffered.shift();
\t\t\tyield chunk;
\t\t\treturn;
\t\t}
\t\tbuffered.push(chunk);
\t}
\twhile (buffered.length > 0) yield buffered.shift();
}`
}

export function patchGlmSessionAdmissionSource(source) {
  if (source.includes(CRAWSHRIMP_GLM_VISION_ADMISSION_MARKER)) return source
  return replaceRequired(
    source,
    'const crawshrimpVisionBridgeAllowsImageAdmission = current.provider === "crawshrimp-deepseek-official" && (current.model === "deepseek-v4-flash" || current.model === "deepseek-v4-pro");',
    `/* ${CRAWSHRIMP_GLM_VISION_ADMISSION_MARKER}: GLM 5.3/5.2 use the same-provider GLM Flash vision route. */
\t\t\t\t\tconst crawshrimpGlmVisionBridgeAllowsImageAdmission = current.provider === "crawshrimp-glm-official" && (current.model === "glm-5.3" || current.model === "glm-5.2");
\t\t\t\t\tconst crawshrimpVisionBridgeAllowsImageAdmission = current.provider === "crawshrimp-deepseek-official" && (current.model === "deepseek-v4-flash" || current.model === "deepseek-v4-pro") || crawshrimpGlmVisionBridgeAllowsImageAdmission;`,
    'session GLM image admission',
  )
}

export function patchGlmReadImageSource(source) {
  if (source.includes(CRAWSHRIMP_GLM_READ_IMAGE_MARKER)) return source
  return replaceRequired(
    source,
    '\tif (provider === "crawshrimp-deepseek-official" && (model === "deepseek-v4-flash" || model === "deepseek-v4-pro")) {\n\t\tconst vision = await llm.resolveModelInfo(provider, "deepseek-flash", exec.signal);\n\t\tif (vision.inputModalities?.includes("image")) return;\n\t}',
    `\tif (provider === "crawshrimp-deepseek-official" && (model === "deepseek-v4-flash" || model === "deepseek-v4-pro")) {
\t\tconst vision = await llm.resolveModelInfo(provider, "deepseek-flash", exec.signal);
\t\tif (vision.inputModalities?.includes("image")) return;
\t}
\t/* ${CRAWSHRIMP_GLM_READ_IMAGE_MARKER}: GLM text routes can receive read_image pixels through same-provider Flash. */
\tif (provider === "crawshrimp-glm-official" && (model === "glm-5.3" || model === "glm-5.2")) {
\t\tfor (const visionModel of ["glm-5.3-flash", "glm-5.3-flashx"]) {
\t\t\tlet vision;
\t\t\ttry {
\t\t\t\tvision = await llm.resolveModelInfo(provider, visionModel, exec.signal);
\t\t\t} catch {
\t\t\t\tcontinue;
\t\t\t}
\t\t\tif (vision.inputModalities?.includes("image")) return;
\t\t}
\t}`,
    'read_image GLM vision admission',
  )
}

export function patchGlmOfficeMcpSource(source) {
  if (source.includes(CRAWSHRIMP_GLM_OFFICE_MCP_MARKER)) return source
  return replaceRequired(
    source,
    '\tif (!officeImageAllowed && provider === "crawshrimp-deepseek-official" && (model === "deepseek-v4-flash" || model === "deepseek-v4-pro")) {\n\t\tconst vision = await llm.resolveModelInfo(provider, "deepseek-flash", exec.signal);\n\t\tofficeImageAllowed = vision.inputModalities?.includes("image") === true;\n\t}',
    `\tif (!officeImageAllowed && provider === "crawshrimp-deepseek-official" && (model === "deepseek-v4-flash" || model === "deepseek-v4-pro")) {
\t\tconst vision = await llm.resolveModelInfo(provider, "deepseek-flash", exec.signal);
\t\tofficeImageAllowed = vision.inputModalities?.includes("image") === true;
\t}
\t// ${CRAWSHRIMP_GLM_OFFICE_MCP_MARKER}: Office page pixels can enter GLM text routes via same-provider Flash.
\tif (!officeImageAllowed && provider === "crawshrimp-glm-official" && (model === "glm-5.3" || model === "glm-5.2")) {
\t\tfor (const visionModel of ["glm-5.3-flash", "glm-5.3-flashx"]) {
\t\t\tlet vision;
\t\t\ttry {
\t\t\t\tvision = await llm.resolveModelInfo(provider, visionModel, exec.signal);
\t\t\t} catch {
\t\t\t\tcontinue;
\t\t\t}
\t\t\tif (vision.inputModalities?.includes("image") === true) {
\t\t\t\tofficeImageAllowed = true;
\t\t\t\tbreak;
\t\t\t}
\t\t}
\t}`,
    'Office MCP GLM vision admission',
  )
}

export function patchGlmOfficeTransportSource(source) {
  if (source.includes(CRAWSHRIMP_GLM_OFFICE_TRANSPORT_MARKER)) return source
  return replaceRequired(
    source,
    'if (!modalities.includes("image") && crawshrimpDeepSeekTextModelCanUseVisionBridge(provider, model)\n      && config.resolveAttachments?.() !== undefined\n      && snapshot.models.getModel(provider, CRAWSHRIMP_DEEPSEEK_VISION_MODEL)?.input.includes("image")) {',
    `if (!modalities.includes("image") && crawshrimpPairedTextModelCanUseVisionBridge(provider, model)
      && config.resolveAttachments?.() !== undefined
      && crawshrimpPairedVisionModelFor(snapshot, provider, model)?.input.includes("image")) {
    // ${CRAWSHRIMP_GLM_OFFICE_TRANSPORT_MARKER}`,
    'Office transport GLM modelInfo image declaration',
  )
}

export function patchGlmVision(root) {
  const piAi = requireFile(root, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js')
  const session = requireFile(root, 'node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js')
  const fsTool = requireFile(root, 'node_modules/@deepseek-ai/dsh-tool-fs/lib/index.js')
  const mcp = requireFile(root, 'node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js')
  const changed = []
  for (const [entry, patch] of [
    [piAi, patchGlmVisionSource],
    [session, patchGlmSessionAdmissionSource],
    [fsTool, patchGlmReadImageSource],
    [mcp, patchGlmOfficeMcpSource],
  ]) {
    const before = readFileSync(entry, 'utf8')
    const after = patch(before)
    if (after !== before) {
      writeFileSync(entry, after)
      changed.push(entry)
    }
  }
  return { entry: piAi, changed, marker: CRAWSHRIMP_GLM_VISION_BRIDGE_MARKER }
}
