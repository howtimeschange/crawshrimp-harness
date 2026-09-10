import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function patchOfficeMcpImageAdmissionSource(source) {
  const marker = 'crawshrimp-office-mcp-image-v1'
  if (source.includes(marker)) return source
  const anchor = '\tif (info.inputModalities === void 0 || !info.inputModalities.includes("image")) throw new Error(`model "${model}" does not declare image input`);'
  if (!source.includes(anchor)) throw new Error('Office MCP image admission anchor changed')
  return source.replace(anchor, `\t// ${marker}: the installed paired vision bridge also handles MCP page images.
\tlet officeImageAllowed = info.inputModalities?.includes("image") === true;
\tif (!officeImageAllowed && provider === "crawshrimp-deepseek-official" && (model === "deepseek-v4-flash" || model === "deepseek-v4-pro")) {
\t\tconst vision = await llm.resolveModelInfo(provider, "deepseek-flash", exec.signal);
\t\tofficeImageAllowed = vision.inputModalities?.includes("image") === true;
\t}
\tif (!officeImageAllowed) throw new Error(\`model "\${model}" does not declare image input and no verified paired vision route is available\`);`)
}

export function patchOfficeToolImageVisionSource(source) {
  const marker = 'crawshrimp-office-tool-image-vision-v1'
  if (source.includes(marker)) return source
  const anchor = 'if (message.role === "user" && contentHasImage(message.content)) return index;'
  if (!source.includes(anchor)) throw new Error('Office tool-image vision bridge anchor changed')
  return source.replace(anchor, `/* ${marker}: latest actual image, including nested tool-result page pixels. */
\t\tif (contentHasImage(message.content)) return index;`).replace(
    '只描述最新一条含图片的用户消息，保留界面文字、数字、按钮、错误码、商品/页面结构和用户可能关心的关键事实。',
    '只描述最新一条含图片的消息（包含工具返回的文档页图），保留页码、文字、数字、错误、结构和关键事实；文档页面需指出截断、遮挡、缺字、过小文字及对齐问题。')
}

export function patchOfficeBridgeTransportSource(source) {
  const marker = 'crawshrimp-office-bridge-transport-v2'
  if (source.includes(marker)) return source
  if (source.includes('// crawshrimp-office-bridge-transport-v1')) {
    source = source.slice(0, source.indexOf('// crawshrimp-office-bridge-transport-v1'))
      .replace('inputModalities: crawshrimpOfficeInputModalities(resolvedModel.input, provider, model, snapshot, this.config),', 'inputModalities: [...resolvedModel.input],')
      .replace('...crawshrimpOfficeVisionOptions(crawshrimpVisionOptions(options)),', '...crawshrimpVisionOptions(options),')
  }
  const info = 'inputModalities: [...resolvedModel.input],'
  const context = '...crawshrimpVisionOptions(options),'
  if (!source.includes(info) || !source.includes(context)) throw new Error('Office vision transport anchor changed')
  return source.replace(info, `inputModalities: crawshrimpOfficeInputModalities(resolvedModel.input, provider, model, snapshot, this.config),`)
    .replace(context, '...crawshrimpOfficeVisionOptions(crawshrimpVisionOptions(options)),')
    .replace('const visionSystem = [\n\t\toptions.system,', 'const visionSystem = [') + `
// ${marker}: advertise the adapter's verified paired capability before LLM projection.
function crawshrimpOfficeInputModalities(input, provider, model, snapshot, config) {
  const modalities = [...input];
  if (!modalities.includes("image") && crawshrimpDeepSeekTextModelCanUseVisionBridge(provider, model)
      && config.resolveAttachments?.() !== undefined
      && snapshot.models.getModel(provider, CRAWSHRIMP_DEEPSEEK_VISION_MODEL)?.input.includes("image")) {
    modalities.push("image");
  }
  return modalities;
}
function crawshrimpOfficeVisionOptions(options) {
  const target = crawshrimpLatestImageUserMessageIndex(options.messages);
  const message = options.messages[target];
  if (!message) return options;
  // The vision request gets only a standalone current image, avoiding task
  // continuation and tool replay. The agent's original history stays intact.
  const content = [];
  function collect(blocks) {
    for (const block of blocks) {
      if (block.type === "text" || block.type === "image") content.push(block);
      else if (block.type === "tool-result") collect(block.content);
    }
  }
  collect(message.content);
  return { ...options, messages: [{ ...message, role: "user", content }] };
}
`
}

export function patchOfficeVision(root, bridge) {
  const mcp = join(root, 'node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js')
  if (!bridge?.entry) throw new Error('Office image admission requires the installed vision bridge')
  for (const [file, patch] of [[bridge.entry, source => patchOfficeBridgeTransportSource(patchOfficeToolImageVisionSource(source))], [mcp, patchOfficeMcpImageAdmissionSource]]) {
    const source = readFileSync(file, 'utf8')
    const result = patch(source)
    if (result !== source) writeFileSync(file, result)
  }
}
