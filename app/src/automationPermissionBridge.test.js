const test = require('node:test')
const assert = require('node:assert/strict')
const { createAutomationPermissionBridge } = require('./automationPermissionBridge')
test('bridge rejects unauthenticated/browser/script requests and passes only target and purpose', async () => {
  const calls = []
  const bridge = createAutomationPermissionBridge({ requestPermission: async (...args) => { calls.push(args); return { status: 'authorized' } } })
  await bridge.start()
  const env = bridge.environment(), url = env.CRAWSHRIMP_AUTOMATION_URL
  const headers = { 'Content-Type': 'application/json', 'x-crawshrimp-automation-token': env.CRAWSHRIMP_AUTOMATION_TOKEN }
  try {
    assert.equal((await fetch(url, { method: 'POST' })).status, 403)
    assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'http://evil.invalid' } })).status, 403)
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ script: 'arbitrary' }) })).status, 400)
    const result = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ bundle_id: 'com.apple.TextEdit', purpose: '创建测试文稿', script: 'ignored' }) })
    assert.equal((await result.json()).status, 'authorized')
    assert.deepEqual(calls, [['com.apple.TextEdit', '创建测试文稿']])
  } finally { await bridge.close() }
})
