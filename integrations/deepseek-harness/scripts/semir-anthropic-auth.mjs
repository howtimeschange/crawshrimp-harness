import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// The Semir gateway authenticates at its edge with Bearer auth. The Anthropic
// SDK's x-api-key alone is rejected even when the credential is valid.
export function semirAnthropicHeaders(headers, model, apiKey) {
  if (model?.api !== 'anthropic-messages' || !apiKey) return headers
  let url
  try { url = new URL(model.baseUrl) } catch { return headers }
  if (url.origin !== 'https://ai-aigw.semir.com' ||
      !/^\/overseas-anthropic-vip(?:\/v1)?\/?$/.test(url.pathname)) return headers
  if (Object.keys(headers ?? {}).some(name => name.toLowerCase() === 'authorization')) return headers
  return { ...headers, Authorization: `Bearer ${apiKey}` }
}

export function patchSemirAnthropicAuthSource(source) {
  const marker = 'crawshrimp-semir-anthropic-auth-v1'
  if (source.includes(marker)) return source
  const anchor = '\t\t\t\t\theaders: requestHeaders(profile.headers)'
  if (source.split(anchor).length !== 2) throw new Error('Semir Anthropic stream headers anchor changed')
  return `// ${marker}\n${semirAnthropicHeaders.toString()}\n` + source.replace(
    anchor,
    '\t\t\t\t\theaders: semirAnthropicHeaders(requestHeaders(profile.headers), model, apiKey)',
  )
}

export function patchSemirAnthropicAuth(root) {
  const entry = join(root, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js')
  const before = readFileSync(entry, 'utf8')
  const after = patchSemirAnthropicAuthSource(before)
  if (after !== before) writeFileSync(entry, after)
}
