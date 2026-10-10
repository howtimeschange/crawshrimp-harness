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
  assert.match(source, /inferAutomationPermissionMode/)
  assert.match(source, /permissionModeLabel\(automation\)/)
  assert.doesNotMatch(source, /let selectionSequence\s*=/)
  assert.doesNotMatch(source, /let runsSequence\s*=/)
})

test('editing and copying keep agreed native tools, browser recovery URL and explicit restrictions', async () => {
  const state = await import('./automationCenterState.mjs')
  const automation = {
    automation_kind: 'scheduled',
    context_mode: 'isolated',
    execution_policy: {
      toolset: ['browser_navigate', 'automation_record_verification'],
      native_toolset: ['read', 'web_fetch'],
      browser_url: 'https://example.com/updates',
      allowed_risks: ['read_only'],
      allow_filesystem: true,
      allow_network: true,
      allow_external_messages: false,
    },
  }
  for (const copy of [false, true]) {
    const form = state.formFromAutomation(automation, {}, { copy })
    const { execution_policy: policy } = state.payloadFromAutomationForm(form, { editing: !copy })
    assert.deepEqual(policy.native_toolset, ['read', 'web_fetch'])
    assert.equal(policy.browser_url, automation.execution_policy.browser_url)
    assert.equal(policy.allow_external_messages, false)
    assert.equal(policy.allow_network, true)
    assert.deepEqual(policy.allowed_risks, ['read_only'])
  }
})

test('permission scopes include preparation and recovery without granting unrelated actions', async () => {
  const state = await import('./automationCenterState.mjs')
  let form = { toolset_text: 'automation_state_get', allowed_risks_text: '', allow_external_messages: false }
  form = state.addAutomationPermissionScope(form, 'browser')
  form = state.addAutomationPermissionScope(form, 'network')
  form = state.addAutomationPermissionScope(form, 'browser')
  const { execution_policy: policy } = state.payloadFromAutomationForm(form)
  assert(policy.toolset.includes('browser_navigate'))
  assert(policy.toolset.includes('automation_record_verification'))
  assert(policy.toolset.includes('automation_state_get'))
  assert.equal(new Set(policy.toolset).size, policy.toolset.length)
  assert.deepEqual(policy.native_toolset, ['web_search', 'web_fetch'])
  assert.equal(policy.allow_network, true)
  assert.equal(policy.allow_external_messages, false)
  assert(!policy.allowed_risks.includes('external_write'))
  assert(!policy.toolset.includes('fs_exec'))
})

test('file agreement can retain a no-message restriction without allowing arbitrary commands', async () => {
  const state = await import('./automationCenterState.mjs')
  const form = state.addAutomationPermissionScope({ allow_external_messages: false }, 'local')
  const { execution_policy: policy } = state.payloadFromAutomationForm(form)
  assert(policy.toolset.includes('fs_write'))
  assert(!policy.toolset.includes('fs_exec'))
  assert(!policy.native_toolset.includes('bash'))
  assert(policy.allowed_risks.includes('local_write'))
  assert.equal(policy.allow_filesystem, true)
  assert.equal(policy.allow_external_messages, false)
})

test('command agreement explicitly enables the capabilities and risk required by command execution', async () => {
  const state = await import('./automationCenterState.mjs')
  const form = state.addAutomationPermissionScope({ allow_external_messages: false }, 'commands')
  const { execution_policy: policy } = state.payloadFromAutomationForm(form)
  assert(policy.toolset.includes('fs_exec'))
  assert(policy.native_toolset.includes('bash'))
  assert(policy.allowed_risks.includes('external_write'))
  assert.equal(policy.allow_filesystem, true)
  assert.equal(policy.allow_network, true)
  assert.equal(policy.allow_external_messages, true)
})

test('session scheduling does not persist a second tool or risk permission configuration', async () => {
  const state = await import('./automationCenterState.mjs')
  const form = state.formFromAutomation({
    automation_kind: 'scheduled', context_mode: 'inherited', source_session_id: 'chat',
    execution_policy: { permission_mode: 'session', timeout_seconds: 180, max_retries: 0 },
  })
  const { execution_policy: policy } = state.payloadFromAutomationForm({
    ...form, toolset_text: 'browser_act', allowed_risks_text: 'local_write',
    native_toolset_text: 'bash', allow_external_messages: false,
  })
  assert.equal(form.permission_mode, 'session')
  assert.deepEqual(policy, {
    permission_mode: 'session', timeout_seconds: 180, max_retries: 0, inherited_wait_seconds: 300,
  })
  assert.equal(state.formFromAutomation({ execution_policy: { toolset: ['fs_read'] } }).permission_mode, 'scoped')
})

test('permission mode inference matches backend session-vs-scoped compatibility rules', async () => {
  const state = await import('./automationCenterState.mjs')

  assert.equal(state.inferAutomationPermissionMode({}, { automationKind: 'scheduled' }), 'session')
  assert.equal(state.inferAutomationPermissionMode({
    timeout_seconds: 600,
    max_retries: 0,
    retry_backoff_seconds: 30,
    inherited_wait_seconds: 300,
    verification_schema: { type: 'object' },
  }, { automationKind: 'scheduled' }), 'session')
  assert.equal(state.formFromAutomation({
    automation_kind: 'scheduled',
    execution_policy: {},
  }).permission_mode, 'session')
  assert.equal(state.formFromAutomation({
    automation_kind: 'scheduled',
    execution_policy: { timeout_seconds: 600 },
  }).permission_mode, 'session')

  assert.equal(state.inferAutomationPermissionMode({ toolset: [] }, { automationKind: 'scheduled' }), 'scoped')
  assert.equal(state.inferAutomationPermissionMode({ native_toolset: [] }, { automationKind: 'scheduled' }), 'scoped')
  assert.equal(state.inferAutomationPermissionMode({ allowed_risks: [] }, { automationKind: 'scheduled' }), 'scoped')
  assert.equal(state.inferAutomationPermissionMode({ allow_network: true }, { automationKind: 'scheduled' }), 'scoped')
  assert.equal(state.inferAutomationPermissionMode({ permission_mode: 'advanced' }, { automationKind: 'scheduled' }), 'scoped')
  assert.equal(state.inferAutomationPermissionMode({}, { automationKind: 'loop' }), 'scoped')
  assert.equal(state.inferAutomationPermissionMode({}, { automationKind: 'scheduled', hasProgram: true }), 'scoped')
  assert.equal(state.formFromAutomation({
    automation_kind: 'scheduled',
    execution_policy: {},
    program: {},
  }).permission_mode, 'scoped')
  assert.equal(state.formFromAutomation({
    automation_kind: 'loop',
    execution_policy: {},
  }).permission_mode, 'scoped')
})
