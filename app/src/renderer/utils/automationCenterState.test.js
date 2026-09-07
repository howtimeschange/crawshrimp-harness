const test = require('node:test')
const assert = require('node:assert/strict')

function deferred() {
  let resolve
  const promise = new Promise((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

test('Automation editor preserves retry zero and seconds in an unchanged one-time schedule', async () => {
  const state = await import('./automationCenterState.mjs')
  const item = {
    automation_uid: 'at-1',
    automation_kind: 'scheduled',
    context_mode: 'isolated',
    schedule: { kind: 'at', timezone: 'Asia/Shanghai', value: '2026-09-07T10:11:12+08:00' },
    execution_policy: { max_retries: 0 },
  }

  const form = state.formFromAutomation(item)
  const payload = state.payloadFromAutomationForm(form, { editing: true })

  assert.equal(form.max_retries, 0)
  assert.equal(form.schedule_value, '2026-09-07T10:11:12')
  assert.equal(payload.execution_policy.max_retries, 0)
  assert.equal(payload.schedule.value, '2026-09-07T10:11:12')
})

test('Automation run state discards stale selection and unrelated run-now evidence', async () => {
  const state = await import('./automationCenterState.mjs')
  const details = { a: deferred(), b: deferred() }
  const runs = { a: deferred(), b: deferred() }
  const api = {
    getAutomation: (uid) => details[uid].promise,
    listAutomationRuns: (uid) => runs[uid].promise,
    listAutomations: async () => ({ items: [] }),
    runAutomationNow: async () => ({ run: { run_uid: 'manual-b' } }),
  }
  const store = state.createAutomationViewState(api)

  const selectingA = store.select('a')
  const selectingB = store.select('b')
  details.b.resolve({ automation: { automation_uid: 'b', title: 'B' } })
  runs.b.resolve({ items: [{ automation_uid: 'b', run_uid: 'b-run' }] })
  await selectingB
  details.a.resolve({ automation: { automation_uid: 'a', title: 'A' } })
  runs.a.resolve({ items: [{ automation_uid: 'a', run_uid: 'a-run' }] })
  await selectingA

  assert.equal(store.selectedUid, 'b')
  assert.equal(store.selectedAutomation.title, 'B')
  assert.deepEqual(store.runsForSelected, [{ automation_uid: 'b', run_uid: 'b-run' }])

  await store.runNow({ automation_uid: 'a' })
  assert.equal(store.selectedAutomation.title, 'B')
  assert.deepEqual(store.runsForSelected, [{ automation_uid: 'b', run_uid: 'b-run' }])
})
