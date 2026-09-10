const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, writeFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

test('file return uses rc.1 snapshotEvents and rejects closed turns', async () => {
  const root = resolve(__dirname, '../../integrations/deepseek-harness')
  const patcher = await import(pathToFileURL(resolve(root, 'scripts/patch-runtime-dependencies.mjs')).href)
  patcher.patchRuntimeDependencies(root)
  const { OutboundArtifactRegistry } = await import(pathToFileURL(resolve(root, 'node_modules/@xmanrui/dsh-im/src/channels/shared/semantic/artifact.mjs')).href)
  const dir = await mkdtemp(resolve(tmpdir(), 'cs-artifact-'))
  const file = resolve(dir, 'result.png')
  await writeFile(file, 'existing image')
  const events = [{ type: 'turn/start', data: { turn: 1 } }]
  const session = { id: 'web-session', header: { id: 'web-session', cwd: dir }, snapshotEvents: () => events }
  const registry = new OutboundArtifactRegistry()
  try {
    const artifact = await registry.stage({ path: file }, { agent: { session }, callId: 'return-call' })
    assert.equal(artifact.origin.sessionId, 'web-session')
    assert.equal(artifact.origin.turn, 1)
    registry.release(artifact)
    events.push({ type: 'turn/end', data: { turn: 1 } })
    await assert.rejects(registry.stage({ path: file }, { agent: { session } }), /live/)
  } finally { registry.disposeSession(session); await rm(dir, { recursive: true, force: true }) }
})

test('desktop file return forwards in the active session workspace and releases failed deliveries', async () => {
  const bridge = await import(pathToFileURL(resolve(__dirname, '../../integrations/deepseek-harness/crawshrimp-product-bridge/lib/index.js')).href)
  const dir = await mkdtemp(resolve(tmpdir(), 'cs-web-return-'))
  const file = resolve(dir, 'existing.png')
  await writeFile(file, 'existing image')
  const originalFetch = globalThis.fetch
  const previous = { url: process.env.CRAWSHRIMP_MCP_URL, token: process.env.CRAWSHRIMP_MCP_TOKEN, root: process.env.CRAWSHRIMP_WORKSPACE_ROOT }
  const requests = []
  let failDelivery = false
  process.env.CRAWSHRIMP_MCP_URL = 'http://localhost:1234/mcp'
  process.env.CRAWSHRIMP_MCP_TOKEN = 'test'
  process.env.CRAWSHRIMP_WORKSPACE_ROOT = '/different-global-workspace'
  globalThis.fetch = async (url, init) => {
    const action = new URL(url).pathname
    requests.push({ action, body: JSON.parse(init.body) })
    return new Response(JSON.stringify(action.endsWith('/acquire') ? { ok: true, lease_id: 'file-lease' } : { ok: !(failDelivery && action.endsWith('/return-file')) }), { status: failDelivery && action.endsWith('/return-file') ? 409 : 200 })
  }
  const hooks = {}
  try {
    bridge.apply({ provide() {}, on(name, callback) { hooks[name] = callback }, effect() {} })
    const exec = { name: 'dsh_im_return_file', arguments: { path: 'existing.png' }, callId: 'send-call', agent: { id: 'web-session', session: { header: { cwd: dir } } } }
    const nativeResult = { content: [{ type: 'text', text: 'Registered' }] }
    assert.equal(await hooks['tools/execute'](exec, async () => nativeResult), nativeResult)
    assert.deepEqual(requests.map(r => r.action), ['/context/acquire', '/context/validate-return-file', '/context/release', '/context/acquire', '/context/return-file', '/context/release'])
    assert.deepEqual(requests[0].body, { runtime_session_id: 'web-session', call_id: 'send-call' })
    assert.equal(requests[1].body.path, file)
    assert.equal(requests[4].body.path, file)
    requests.length = 0
    failDelivery = true
    await assert.rejects(hooks['tools/execute'](exec, async () => nativeResult))
    assert.equal(requests.at(-1).action, '/context/release')
    requests.length = 0
    const failed = { isError: true }
    assert.equal(await hooks['tools/execute'](exec, async () => failed), failed)
    assert.deepEqual(requests.map(r => r.action), ['/context/acquire', '/context/validate-return-file', '/context/release'])
    await assert.rejects(hooks['tools/execute']({ ...exec, arguments: { path: '../outside.png' } }, async () => nativeResult), /workspace/)
  } finally {
    globalThis.fetch = originalFetch
    for (const [key, value] of [['CRAWSHRIMP_MCP_URL', previous.url], ['CRAWSHRIMP_MCP_TOKEN', previous.token], ['CRAWSHRIMP_WORKSPACE_ROOT', previous.root]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
    await rm(dir, { recursive: true, force: true })
  }
})
