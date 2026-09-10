export const TEXT_LIMIT = 262144
export function documentKind(name = '') {
  const ext = name.split('.').pop().toLowerCase()
  if (/^(md|markdown)$/.test(ext)) return 'markdown'
  if (/^(html|htm)$/.test(ext)) return 'html'
  if (ext === 'pdf') return 'pdf'
  if (/^(txt|csv|json|jsonl|js|jsx|ts|tsx|py|log|yaml|yml|css|scss|xml|sh|sql|toml|ini|rs|go|java|c|cpp|h|vue)$/.test(ext)) return 'code'
  return ''
}
export async function readDocumentText(url, signal) {
  const response = await fetch(url, { signal, headers: { Range: `bytes=0-${TEXT_LIMIT - 1}` } })
  if (!response.ok) throw new Error('文件不存在或无法读取')
  const reader = response.body.getReader(), chunks = []
  let size = 0, overflow = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const keep = value.subarray(0, TEXT_LIMIT - size)
      chunks.push(keep); size += keep.length
      if (size >= TEXT_LIMIT) { overflow = true; break }
    }
  } finally { await reader.cancel() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  const total = Number(response.headers.get('content-range')?.split('/')[1] || response.headers.get('content-length'))
  const truncated = total ? total > size : overflow
  // Stream mode leaves an incomplete final UTF-8 sequence buffered on truncated reads.
  const text = new TextDecoder().decode(bytes, { stream: truncated })
  return { text, truncated }
}
