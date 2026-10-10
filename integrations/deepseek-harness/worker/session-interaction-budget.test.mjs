import assert from 'node:assert/strict'
import test from 'node:test'

import { interactionBudgetName } from './session-interaction-budget.mjs'

const budget = { maxSteps: 2, maxToolCalls: 3, maxObserve: 4, maxAct: 5 }

test('ordinary worker runs still enforce interaction budgets', () => {
  assert.equal(interactionBudgetName({ budget, counters: { steps: 2, toolCalls: 0, observe: 0, act: 0 } }), '步数预算耗尽(2)')
  assert.equal(interactionBudgetName({ budget, counters: { steps: 0, toolCalls: 3, observe: 0, act: 0 } }), '工具调用预算耗尽(3)')
  assert.equal(interactionBudgetName({ budget, counters: { steps: 0, toolCalls: 0, observe: 4, act: 0 } }), '页面观察预算耗尽(4)')
  assert.equal(interactionBudgetName({ budget, counters: { steps: 0, toolCalls: 0, observe: 0, act: 5 } }), '页面操作预算耗尽(5)')
})

test('trusted session continuations skip only worker interaction budgets', () => {
  assert.equal(interactionBudgetName({
    sessionContinuation: true,
    budget,
    counters: { steps: 999, toolCalls: 999, observe: 999, act: 999 },
  }), '')
})
