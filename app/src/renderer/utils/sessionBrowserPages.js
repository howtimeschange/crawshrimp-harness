// Historical session ownership is preserved by the backend; this is the live UI list.
export function liveSessionBrowserPages(recordedTabs, live, closedIds = new Set()) {
  const records = Array.isArray(recordedTabs) ? recordedTabs : []
  const authoritative = live?.ok === true && Array.isArray(live.tabs)
  const liveById = new Map((authoritative ? live.tabs : []).map(tab => [tab.id, tab]))
  return records.filter(tab => tab?.id && !closedIds.has(tab.id)
    && (authoritative ? liveById.has(tab.id) : !tab.closed))
    .map(tab => ({ ...tab, ...(liveById.get(tab.id) || {}), closed: false }))
}

export function isClosedBrowserPageError(error) {
  return /页面已关闭|该页面不属于当前会话/.test(String(error?.message || error || ''))
}
