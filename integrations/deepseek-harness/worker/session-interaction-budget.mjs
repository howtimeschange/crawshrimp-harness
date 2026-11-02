export function interactionBudgetName(run) {
  if (!run) return ''
  if (run.sessionContinuation === true) return ''
  const b = run.budget || {}
  const counters = run.counters || {}
  if (counters.steps >= b.maxSteps) return `步数预算耗尽(${b.maxSteps})`
  if (counters.toolCalls >= b.maxToolCalls) return `工具调用预算耗尽(${b.maxToolCalls})`
  if (counters.observe >= b.maxObserve) return `页面观察预算耗尽(${b.maxObserve})`
  if (counters.act >= b.maxAct) return `页面操作预算耗尽(${b.maxAct})`
  return ''
}


// A PTC wrapper must not hide the actual browser/tool work from run budgets.
export function recordInteractionEvent(run, event) {
  const type = event?.type
  if (type === 'step/start') run.counters.steps += 1
  if (type !== 'tool/call' && type !== 'tool/ptc-dispatch-start') return
  const name = String(event.data?.name || '')
  // Dynamic discovery can enter a browser workflow without an initial tab ref.
  // This only selects a finite product budget; MCP grants/approvals remain authoritative.
  if (name.startsWith('mcp__crawshrimp__browser_') && run.browserBudget) {
    run.budget = { ...run.budget, ...run.browserBudget }
    run.browserBudget = null
  }
  run.counters.toolCalls += 1
  if (name.includes('browser_observe')) run.counters.observe += 1
  if (name.includes('browser_act')) run.counters.act += 1
}
