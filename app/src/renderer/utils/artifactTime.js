// Resource events use local ISO timestamps; preserve explicit offsets when present.
export function artifactTimestamp(value) {
  if (!value) return NaN
  let stamp = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(stamp)) stamp = stamp.replace(' ', 'T')
  return Date.parse(stamp)
}

export function formatArtifactAge(value, now = Date.now()) {
  const time = artifactTimestamp(value)
  if (!Number.isFinite(time)) return ''
  const age = Math.max(0, now - time)
  const minutes = Math.floor(age / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  return days > 99 ? '' : `${days}天前`
}

export function sortArtifactsByUpdated(items) {
  const timestamp = item => {
    const value = artifactTimestamp(item.updated_at || item.created_at)
    return Number.isFinite(value) ? value : -Infinity
  }
  return [...items].sort((a, b) => timestamp(b) - timestamp(a))
}

export function isOfficeDocument(item) {
  return Boolean(item?.office && /\.(docx|pptx|xlsx)$/i.test(item.filename || item.path || ''))
}
