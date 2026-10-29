// Reconcile account changes only after the shared runtime is safely restarted.
export function createAccountRuntimeSync({ restart, onPending = () => {}, onError = () => {} }) {
  let desired = '', applied = '', revision = 0, inFlight = null, retryOnIdle = false, disposed = false
  async function attempt() {
    if (disposed || desired === applied || inFlight) return
    const target = desired, startedRevision = revision
    let appliedNow = false
    const operation = (async () => {
      try {
        const result = await restart()
        if (disposed || startedRevision !== revision) return
        if (result?.ok === true) {
          applied = target
          appliedNow = true
          retryOnIdle = false
          onPending(false)
        } else if (result?.error === 'ACTIVE_RUN') {
          retryOnIdle = true
          onPending(true)
        } else {
          retryOnIdle = false
          onError(result?.message || result?.error || '智能体运行时更新失败，请重试')
        }
      } catch (error) {
        if (!disposed && startedRevision === revision) {
          retryOnIdle = false
          onError(error?.message || '智能体运行时更新失败，请重试')
        }
      }
    })()
    inFlight = operation
    try { await operation } finally {
      if (inFlight === operation) inFlight = null
      // An account change during a restart must itself be applied.
      if (!disposed && startedRevision !== revision) {
        // A restart may already have switched the runtime even when the user
        // switched back to the previously applied account while it was running.
        applied = null
        void attempt()
      }
    }
    return appliedNow
  }
  return {
    async setAccount(accountId) {
      const next = String(accountId || '')
      if (next !== desired) { desired = next; revision++; retryOnIdle = false }
      await attempt()
    },
    async retryIfIdle(activeRun) {
      if (retryOnIdle && !activeRun) return await attempt()
      return false
    },
    dispose() { disposed = true; revision++ },
  }
}
