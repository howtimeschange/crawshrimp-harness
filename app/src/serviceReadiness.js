'use strict'

async function waitForServiceReadiness({ recoveryBarrier = null, startupPromise = null, ensureServices } = {}) {
  if (recoveryBarrier && typeof recoveryBarrier.then === 'function') {
    try { await recoveryBarrier } catch { /* status probing can continue and report the actual state */ }
  }
  if (startupPromise && typeof startupPromise.then === 'function') {
    try { await startupPromise } catch { /* status probing can continue and report the actual state */ }
    return
  }
  if (typeof ensureServices === 'function') {
    try { await ensureServices() } catch { /* status probing can continue and report the actual state */ }
  }
}

module.exports = { waitForServiceReadiness }
