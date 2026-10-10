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
