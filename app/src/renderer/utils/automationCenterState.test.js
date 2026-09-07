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
  assert.equal(Object.hasOwn(payload, 'context_mode'), false)
})

test('Automation editor converts absolute at instants into the schedule IANA wall clock', async () => {
  const state = await import('./automationCenterState.mjs')

  assert.equal(state.scheduleValueForInput('2099-01-01T00:00:00Z', 'Asia/Shanghai'), '2099-01-01T08:00:00')
  assert.equal(state.scheduleValueForInput('2099-01-01T00:00:00-05:00', 'Asia/Shanghai'), '2099-01-01T13:00:00')
  assert.equal(state.scheduleValueForInput('2026-03-08T06:30:00Z', 'America/New_York'), '2026-03-08T01:30:00')
  assert.equal(state.scheduleValueForInput('2026-03-08T07:30:00Z', 'America/New_York'), '2026-03-08T03:30:00')

  const form = state.formFromAutomation({
    automation_kind: 'scheduled',
    schedule: { kind: 'at', timezone: 'Asia/Shanghai', value: '2099-01-01T00:00:00Z' },
  })
  assert.equal(form.schedule_value, '2099-01-01T08:00:00')
})

test('copy-as-new always starts disabled while preserving the explicit new-definition fields', async () => {
  const state = await import('./automationCenterState.mjs')
  const form = state.formFromAutomation({
    title: '已启用自动化',
    automation_kind: 'scheduled',
    context_mode: 'inherited',
    source_session_id: 'source-session',
    enabled: true,
    schedule: { kind: 'at', timezone: 'Asia/Shanghai', value: '2099-01-01T00:00:00+08:00' },
  }, {}, { copy: true })
  const payload = state.payloadFromAutomationForm(form)

  assert.equal(form.enabled, false)
  assert.equal(payload.enabled, false)
  assert.equal(payload.context_mode, 'inherited')
  assert.equal(payload.source_session_id, 'source-session')
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

test('Automation Center consumes the same race-safe state object exercised by unit tests', () => {
  const { readFileSync } = require('node:fs')
  const { resolve } = require('node:path')
  const source = readFileSync(resolve(__dirname, '../views/AutomationCenter.vue'), 'utf8')

  assert.match(source, /createAutomationViewState/)
  assert.match(source, /automationViewState\.select\(/)
  assert.match(source, /automationViewState\.runNow\(/)
  assert.doesNotMatch(source, /let selectionSequence\s*=/)
  assert.doesNotMatch(source, /let runsSequence\s*=/)
})
