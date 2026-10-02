// Components may keep a hidden DOM panel while the compact preview is visible.
// Share one stream per CDP target; an old component cannot stop a new consumer.
const targets = new Map()
function targetState(id) {
  let state = targets.get(id)
  if (!state) {
    state = { owners: new Set(), consumers: new Map(), queue: Promise.resolve(), pending: 0, started: false, disconnectRevision: 0, restart: false, frame: null, status: null }
    targets.set(id, state)
  }
  return state
}
function replay(state, consumer) {
  if (state.frame) consumer?.onFrame?.(state.frame)
  if (state.status) consumer?.onStatus?.(state.status)
}
function cleanupTarget(id, state) {
  if (state.owners.size || state.consumers.size || state.started || state.pending || targets.get(id) !== state) return
  state.offFrame?.(); state.offStatus?.()
  targets.delete(id)
}
// Cache the latest image and metadata while any visible owner holds the stream.
// A static page need not paint again when the mini hands off to a full panel.
export function subscribeBrowserPreview(id, owner, consumer, bridge = window.cs) {
  const state = targetState(id)
  state.consumers.set(owner, consumer)
  if (!state.listening) {
    state.listening = true
    const matches = payload => String(payload?.targetId || '') === String(id || '')
    state.offFrame = bridge?.onAgentBrowserFrame?.(payload => {
      if (!matches(payload) || !state.owners.size) return
      state.frame = payload
      state.status = { state: 'connected', targetId: id, url: payload.url }
      for (const callbacks of state.consumers.values()) callbacks.onFrame?.(payload)
    })
    state.offStatus = bridge?.onAgentBrowserStatus?.(payload => {
      if (!matches(payload) || !state.owners.size) return
      if (!payload.metadataOnly && payload.state === 'disconnected') {
        state.started = false
        state.disconnectRevision++
        state.frame = null
      }
      state.status = payload.metadataOnly ? { ...state.status, url: payload.url } : payload
      if (state.frame && typeof payload.url === 'string') state.frame = { ...state.frame, url: payload.url }
      for (const callbacks of state.consumers.values()) callbacks.onStatus?.(payload)
    })
  }
  replay(state, consumer)
  return () => { state.consumers.delete(owner); cleanupTarget(id, state) }
}
export function setBrowserPreviewVisible(id, owner, visible, restart = false, bridge = window.cs) {
  const state = targetState(id)
  if (visible) state.owners.add(owner); else state.owners.delete(owner)
  state.restart ||= restart
  state.pending++
  state.queue = state.queue.catch(() => {}).then(async () => {
    if (state.restart || !state.owners.size) {
      state.restart = false
      state.frame = null; state.status = null
      await bridge?.stopAgentBrowserStream?.(id); state.started = false
    }
    if (state.owners.size && !state.started) {
      const revision = state.disconnectRevision
      const result = await bridge?.startAgentBrowserStream?.(id)
      state.started = Boolean(result?.ok) && revision === state.disconnectRevision
      return result?.ok && !state.started ? { ...result, ok: false, error: '浏览器预览连接已断开，请重新打开' } : result
    }
    if (visible && state.owners.has(owner)) replay(state, state.consumers.get(owner))
    return { ok: true }
  }).finally(() => { state.pending--; cleanupTarget(id, state) })
  return state.queue
}
