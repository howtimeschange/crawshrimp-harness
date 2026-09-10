import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function normalizeDeepSeekFlash(provider, model) {
  return provider === 'crawshrimp-deepseek-official' &&
    ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4.1-flash-expires-on-0910'].includes(model)
    ? 'deepseek-flash' : model
}

export function patchDeepSeekFlashSource(source) {
  const marker = 'crawshrimp-deepseek-flash-v1'
  if (source.includes(marker)) return source
  for (const anchor of ['\tmodelOf(snapshot, provider, model) {', '\tmodelInfo(snapshot, provider, model) {']) {
    if (!source.includes(anchor)) throw new Error('DeepSeek Flash model resolution anchor changed')
    source = source.replace(anchor, anchor + '\n\t\tmodel = normalizeDeepSeekFlash(provider, model);')
  }
  const anchor = '\tasync *streamWithSnapshot(options, snapshot) {'
  if (!source.includes(anchor)) throw new Error('DeepSeek Flash stream anchor changed')
  source = source.replace(anchor, anchor + '\n\t\toptions = { ...options, model: normalizeDeepSeekFlash(options.provider, options.model) };')
  return `// ${marker}\n${normalizeDeepSeekFlash.toString()}\n` + source
}

export function patchDeepSeekFlash(root) {
  const entry = join(root, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js')
  const before = readFileSync(entry, 'utf8')
  const after = patchDeepSeekFlashSource(before).replaceAll('const CRAWSHRIMP_DEEPSEEK_VISION_MODEL = "deepseek-v4-flash-vision-exp"', 'const CRAWSHRIMP_DEEPSEEK_VISION_MODEL = "deepseek-flash"')
  if (after !== before) writeFileSync(entry, after)
  for (const pkg of ['dsh-tool-fs', 'dsh-mcp-client']) {
    const file = join(root, `node_modules/@deepseek-ai/${pkg}/lib/index.js`)
    const text = readFileSync(file, 'utf8')
    const updated = text.replaceAll('resolveModelInfo(provider, "deepseek-v4-flash-vision-exp"', 'resolveModelInfo(provider, "deepseek-flash"')
    if (updated !== text) writeFileSync(file, updated)
  }
}
