import assert from 'node:assert/strict'
import test from 'node:test'

import { interactionBudgetName, recordInteractionEvent } from './session-interaction-budget.mjs'

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


test('PTC browser dispatches consume the same action/observation budgets as native tools', () => {
  for (const type of ['tool/call', 'tool/ptc-dispatch-start']) {
    const run = { budget: { ...budget, maxAct: 1 }, counters: { steps: 0, toolCalls: 0, observe: 0, act: 0 } }
    recordInteractionEvent(run, { type, data: { name: 'mcp__crawshrimp__browser_act' } })
    assert.equal(interactionBudgetName(run), '页面操作预算耗尽(1)')
    recordInteractionEvent(run, { type: 'tool/ptc-dispatch', data: { name: 'mcp__crawshrimp__browser_act' } })
    assert.equal(run.counters.act, 1)
    recordInteractionEvent(run, { type, data: { name: 'mcp__crawshrimp__browser_observe' } })
    assert.equal(run.counters.observe, 1)
    assert.equal(run.counters.toolCalls, 2)
  }
})


test('dynamically discovered browser calls select the finite browser budget in both modes', () => {
  for (const type of ['tool/call', 'tool/ptc-dispatch-start']) {
    const run = { budget: { maxSteps: 30, maxToolCalls: 40, maxObserve: 5, maxAct: 1 },
      browserBudget: { maxSteps: 80, maxToolCalls: 120, maxObserve: 40, maxAct: 50 },
      counters: { steps: 30, toolCalls: 39, observe: 0, act: 0 } }
    recordInteractionEvent(run, { type, data: { name: 'mcp__crawshrimp__browser_navigate' } })
    assert.equal(interactionBudgetName(run), '')
    assert.equal(run.browserBudget, null)
    run.counters.observe = 40
    assert.equal(interactionBudgetName(run), '页面观察预算耗尽(40)')
  }
})
