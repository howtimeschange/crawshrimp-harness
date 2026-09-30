// Components may keep a hidden DOM panel while the compact preview is visible.
// Share one stream per CDP target; an old component cannot stop a new consumer.
const targets = new Map()
export function setBrowserPreviewVisible(id, owner, visible, restart = false, bridge = window.cs) {
  let state = targets.get(id)
  if (!state) { state = { owners: new Set(), queue: Promise.resolve(), started: false, restart: false }; targets.set(id, state) }
  if (visible) state.owners.add(owner); else state.owners.delete(owner)
  state.restart ||= restart
  state.queue = state.queue.catch(() => {}).then(async () => {
    if (state.restart || !state.owners.size) {
      state.restart = false
      await bridge?.stopAgentBrowserStream?.(id); state.started = false
    }
    if (state.owners.size && !state.started) {
      const result = await bridge?.startAgentBrowserStream?.(id)
      state.started = Boolean(result?.ok)
      return result
    }
    return { ok: true }
  })
  return state.queue
}
