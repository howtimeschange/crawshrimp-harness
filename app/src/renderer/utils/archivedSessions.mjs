// Requests travel through AgentWebView's source/origin-checked iframe bridge.
export function requestArchivedSessions(action = 'list', sessionId = '', target = window) {
  return new Promise((resolve, reject) => {
    const requestId = globalThis.crypto.randomUUID()
    const cleanup = () => { clearTimeout(timer); target.removeEventListener('cs-archive-response', onResponse) }
    const onResponse = event => {
      if (event.detail?.requestId !== requestId) return
      cleanup()
      if (event.detail.error) reject(new Error(event.detail.error))
      else resolve(event.detail.items || [])
    }
    const timer = setTimeout(() => { cleanup(); reject(new Error(action === 'restore' ? '恢复结果暂未确认，请刷新列表核实。' : '会话服务未就绪，请稍后刷新。')) }, 15000)
    target.addEventListener('cs-archive-response', onResponse)
    target.dispatchEvent(new CustomEvent('cs-archive-request', { detail: { requestId, action, sessionId } }))
  })
}
