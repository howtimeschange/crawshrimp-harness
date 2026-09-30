// Stable identity is the full resource path (never the display filename).
export function resourceId(item) {
  if (item.kind === 'browser') return `browser:${item.id}`
  return `file:${String(item.path || '').replaceAll('\\', '/')}`
}
export function restoreWorkspace(state) {
  const seen = new Set()
  const tabs = (Array.isArray(state?.workTabs) ? state.workTabs : state?.selection ? [state.selection] : [])
    .filter(item => item && (item.kind === 'browser' ? typeof item.id === 'string' && item.id : typeof item.path === 'string' && item.path))
    .filter(item => { const id = resourceId(item); if (seen.has(id)) return false; seen.add(id); return true })
    .map(item => ({ ...item, key: resourceId(item), pane: item.pane === 1 ? 1 : 0 }))
  const active = [0, 1].map(pane => tabs.find(t => t.pane === pane && t.key === state?.activeIds?.[pane])?.key || tabs.find(t => t.pane === pane)?.key || '')
  return { tabs, active, split: Boolean(state?.split), focusedPane: state?.focusedPane === 1 ? 1 : 0 }
}
export function previewType(item) {
  const ext = String(item.filename || item.path || '').split('.').pop().toLowerCase()
  if (/^(png|jpg|jpeg|webp|gif|bmp|svg)$/.test(ext)) return 'image'
  if (/^(mp4|webm|mov)$/.test(ext)) return 'video'
  if (/^(mp3|wav|ogg|m4a)$/.test(ext)) return 'audio'
  if (/^(csv|tsv)$/.test(ext)) return 'table'
  return 'document'
}
export function parseDelimited(text, delimiter = ',', maxRows = 1000, maxColumns = 100) {
  const rows = []; let row = [], cell = '', quoted = false, clipped = false
  const pushCell = () => { if (row.length < maxColumns) row.push(cell); else clipped = true; cell = '' }
  const pushRow = () => { pushCell(); rows.push(row); row = [] }
  // RFC 4180: escaped quotes, quoted separators and embedded newlines.
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++ }
      else if (quoted || !cell) quoted = !quoted
      else cell += char
    } else if (!quoted && char === delimiter) pushCell()
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i++
      pushRow()
      if (rows.length >= maxRows) { clipped ||= i < text.length - 1; break }
    } else cell += char
  }
  if (rows.length < maxRows && (cell || row.length)) pushRow()
  return { rows, clipped, incomplete: quoted }
}
