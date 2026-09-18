// Presentation polling only: background schedulers remain in the backend.
export function adaptivePoll(callback, { interval = 5000, hiddenInterval = 60000, immediate = false, document: doc = globalThis.document } = {}) {
  let timer, stopped = false, running = false, refreshPending = false
  const delay = () => doc?.hidden ? hiddenInterval : interval
  function schedule() { if (!stopped) timer = setTimeout(tick, delay()) }
  async function tick() {
    if (stopped) return
    if (running) { refreshPending = true; return }
    running = true
    try { await callback() } finally {
      running = false
      if (refreshPending && !stopped) { refreshPending = false; timer = setTimeout(tick, 0) }
      else schedule()
    }
  }
  function visibility() {
    clearTimeout(timer)
    if (doc?.hidden) { if (!running) schedule() }
    else if (running) refreshPending = true
    else void tick()
  }
  doc?.addEventListener('visibilitychange', visibility)
  if (immediate) void tick(); else schedule()
  return () => { stopped = true; clearTimeout(timer); doc?.removeEventListener('visibilitychange', visibility) }
}
