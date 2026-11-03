'use strict'

// Recheck server authority on return from the account website, and while visible.
// Focus during an older read queues one fresh read instead of accepting its stale result.
function createManagedCatalogRefresh({ refresh, isActive, intervalMs = 30000, timers = globalThis, now = Date.now }) {
  let disposed = false, inFlight = null, pendingFocus = false, lastFocus = -Infinity
  async function check(fromFocus = false) {
    if (disposed || !isActive()) return
    if (inFlight) { if (fromFocus) pendingFocus = true; return inFlight }
    const operation = (async () => {
      do {
        pendingFocus = false
        try { await refresh() } catch { /* Retain the last usable catalog when offline. */ }
      } while (pendingFocus && !disposed && isActive())
    })()
    inFlight = operation
    try { await operation } finally { if (inFlight === operation) inFlight = null }
  }
  const timer = timers.setInterval(() => { void check() }, intervalMs)
  timer?.unref?.()
  return {
    focus() {
      if (disposed || !isActive() || now() - lastFocus < 1000) return Promise.resolve()
      lastFocus = now()
      return check(true)
    },
    dispose() { disposed = true; pendingFocus = false; timers.clearInterval(timer) },
  }
}
module.exports = { createManagedCatalogRefresh }
