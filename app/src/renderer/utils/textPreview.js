// 206 also describes a complete small file when a Range was requested.
export function isPartialTextPreview(response) {
  if (response.status !== 206) return false
  const range = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(response.headers.get('Content-Range') || '')
  if (!range || range[3] === '*') return true
  return Number(range[1]) !== 0 || Number(range[2]) + 1 < Number(range[3])
}
