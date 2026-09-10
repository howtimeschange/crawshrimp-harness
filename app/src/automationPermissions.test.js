const test = require('node:test')
const assert = require('node:assert/strict')
const { createAutomationPermissions, classifyPermission, validateTarget } = require('./automationPermissions')
const healthy = { usageDescription: true, signatureInspected: true, hardened: true, appleEventsEntitlement: true }
test('status checks never request permission; explicit request rechecks after consent', async () => {
  const calls = []
  let allowed = false
  const service = createAutomationPermissions({ platform: 'darwin', hostInfo: async () => healthy, native: async (_helper, target, ask) => {
    calls.push({ target, ask }); if (ask) allowed = true
    return { status: allowed ? 'authorized' : 'not_determined', accessibility: true }
  } })
  assert.equal((await service.check('com.apple.TextEdit')).canRequest, true)
  assert.equal((await service.request('com.apple.TextEdit')).status, 'authorized')
  assert.deepEqual(calls.map(c => c.ask), [false, false, true, false])
})
test('denial falls back to AX without repeating prompt', async () => {
  let denied = false, prompts = 0
  const service = createAutomationPermissions({ platform: 'darwin', hostInfo: async () => healthy, native: async (_h, _t, ask) => {
    if (ask) { denied = true; prompts++ }
    return { status: denied ? 'denied_or_restricted' : 'not_determined', accessibility: true }
  } })
  const result = await service.request('com.apple.TextEdit')
  assert.equal(result.fallback, 'ax'); assert.equal(result.canRequest, false)
  await service.request('com.apple.TextEdit'); assert.equal(prompts, 1)
})
test('missing usage string and hardened entitlement identify build failure before requesting', () => {
  for (const host of [{ ...healthy, usageDescription: false }, { ...healthy, appleEventsEntitlement: false }]) {
    const r = classifyPermission({ status: 'not_determined' }, host)
    assert.equal(r.status, 'configuration_blocked'); assert.equal(r.canRequest, false)
  }
})
test('sandbox and ambiguous denial never masquerade as a fresh permission request', () => {
  assert.equal(classifyPermission({ status: 'denied_or_restricted' }, { ...healthy, appSandbox: true }).status, 'sandbox_restricted')
  assert.equal(classifyPermission({ status: 'denied_or_restricted' }, healthy).canRequest, false)
  assert.equal(classifyPermission({ status: 'not_determined' }, {}).canRequest, false)
  assert.equal(classifyPermission({ status: 'target_not_running' }, healthy).canRequest, false)
})
test('invalid targets cannot reach native execution', async () => {
  assert.throws(() => validateTarget('com.apple.TextEdit; touch /tmp/test'))
  const service = createAutomationPermissions({ native: async () => { throw new Error('must not run') } })
  await assert.rejects(service.check('../target'))
})
test('concurrent requests cannot produce duplicate system prompts', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const service = createAutomationPermissions({ platform: 'darwin', hostInfo: async () => healthy, native: async (_h, _t, ask) => { if (ask) await pending; return { status: 'not_determined' } } })
  const request = service.request('com.apple.TextEdit')
  await assert.rejects(service.request('com.apple.TextEdit'), /已有授权请求/)
  release(); await request
})

test('application inventory uses only the read-only native catalogue command', async () => {
  const calls = []
  const service = createAutomationPermissions({ platform: 'darwin', native: async (...args) => {
    calls.push(args); return { status: 'ok', applications: [{ bundle_id: 'com.apple.TextEdit' }] }
  } })
  assert.equal((await service.list()).applications.length, 1)
  assert.deepEqual(calls[0].slice(1), ['', false, 'automation_applications'])
})
test('single authorize action updates already-authorized state without any prompt', async () => {
  const calls = []
  const service = createAutomationPermissions({ platform: 'darwin', hostInfo: async () => healthy, native: async (_h, _id, ask) => {
    calls.push(ask); return { status: 'authorized', accessibility: true }
  } })
  assert.equal((await service.request('com.apple.TextEdit')).status, 'authorized')
  assert.deepEqual(calls, [false])
})
