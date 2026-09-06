const assert = require('node:assert/strict')
const { mkdtemp, mkdir, realpath, rm, symlink, writeFile } = require('node:fs/promises')
const { readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')

const appRoot = resolve(__dirname, '..')
const repoRoot = resolve(appRoot, '..')
const harnessRoot = resolve(repoRoot, 'integrations/deepseek-harness')
const dshImRoot = resolve(harnessRoot, 'node_modules/@xmanrui/dsh-im')

function moduleUrl(relativePath, query) {
  const url = pathToFileURL(resolve(dshImRoot, relativePath))
  return `${url.href}?${query}=${Date.now()}`
}

test('DSH rc.1 Web profile pins dsh-im 4.11 and registers it as a product-owned profile plugin', () => {
  const runtimePackage = JSON.parse(readFileSync(resolve(harnessRoot, 'package.json'), 'utf8'))
  const runtimeLock = JSON.parse(readFileSync(resolve(harnessRoot, 'package-lock.json'), 'utf8'))
  const profilePackage = JSON.parse(readFileSync(resolve(harnessRoot, 'profile/web/package.json'), 'utf8'))
  const profilePatch = readFileSync(resolve(harnessRoot, 'profile/web/cordis.patch.yml'), 'utf8')
  const staging = readFileSync(resolve(harnessRoot, 'scripts/stage-runtime.mjs'), 'utf8')

  assert.equal(runtimePackage.dependencies['@deepseek-ai/dsh'], '0.1.2-rc.1')
  assert.equal(runtimeLock.packages['node_modules/@deepseek-ai/dsh']?.version, '0.1.2-rc.1')
  assert.equal(runtimePackage.dependencies['@xmanrui/dsh-im'], '4.11.0')
  assert.equal(runtimeLock.packages['node_modules/@xmanrui/dsh-im']?.version, '4.11.0')
  assert.deepEqual(profilePackage.dsh.profile.bundles, [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    '@xmanrui/dsh-im',
  ])
  assert.equal(profilePackage.dependencies['@xmanrui/dsh-im'], '4.11.0')
  assert.match(profilePatch, /- id: xmanrui-dsh-im\s+disabled: true/)
  assert.match(profilePatch, /- id: crawshrimp-dsh-im\s+name: '@xmanrui\/dsh-im'/)
  assert.match(staging, /node_modules\/@xmanrui\/dsh-im\/lib\/index\.js/)
  assert.match(staging, /node_modules\/@xmanrui\/dsh-im\/src\/channels\/shared\/inbound-ttl\.mjs/)
})

test('Crawshrimp settings keeps the dsh-im management surface mounted across navigation', () => {
  const app = readFileSync(resolve(appRoot, 'src/renderer/App.vue'), 'utf8')
  const settings = readFileSync(resolve(appRoot, 'src/renderer/views/SettingsPage.vue'), 'utf8')
  const slots = readFileSync(resolve(harnessRoot, 'crawshrimp-slots/lib/client.js'), 'utf8')

  assert.match(app, /const settingsMountedOnce = ref\(currentView\.value === 'settings'\)/)
  assert.match(app, /v-show="currentView !== 'agent'"/)
  assert.match(settings, /label: 'IM机器人'/)
  assert.match(settings, /children: \[\{ id: 'im-bots', label: '机器人接入'/)
  assert.match(settings, /const imSettingsPanelMountedOnce = ref/)
  assert.match(settings, /v-show="activePanelId === 'im-bots'"/)
  assert.match(settings, /v-else-if="activePanelId === 'im-bots'"[\s\S]*key="im-bots-transition-anchor"/)
  assert.match(settings, /\.im-panel-transition-anchor\s*\{\s*display:\s*block;[\s\S]*flex:\s*0\s+0\s+0;[\s\S]*width:\s*0;[\s\S]*height:\s*0;/)
  assert.match(settings, /event\.origin !== new URL\(imSettingsUrl\.value\)\.origin/)
  assert.match(settings, /event\.data\?\.__crawshrimp === 'im-settings-ready'/)
  assert.match(slots, /function openCrawshrimpImSettings\(/)
  assert.match(slots, /function isolateCrawshrimpImSurface\(overlay\)/)
  assert.match(slots, /let node = page\s*\n\s*while \(node && node !== root\)/)
  assert.match(slots, /node\.dataset\.csImSurfacePath = '1'/)
  assert.match(slots, /\[data-cs-im-surface-path="1"\]:not\(\.dim-page\) > :not\(\[data-cs-im-surface-path="1"\]\):not\(\.dim-page\)/)
  assert.match(slots, /function isCurrentSettingsNav\(button\)/)
  assert.match(slots, /button\.classList\?\.contains\('VOzbGW_active'\)/)
  assert.match(slots, /if \(!imTab\) \{[\s\S]*pluginNav[\s\S]*return false/)
  assert.match(slots, /if \(!isCurrentSettingsNav\(imTab\)\) \{\s*imTab\.click\(\)\s*return false/)
  assert.match(slots, /postToShell\(\{ __crawshrimp: 'im-settings-ready' \}\)/)
  assert.match(slots, /\[role="tab"\], \.VOzbGW_navCell/)
  assert.match(slots, /getAttribute\('aria-current'\) === 'true'/)
})

test('IM policy confines returned files to the active workspace, including symlink escapes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'crawshrimp-im-policy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  await mkdir(workspace)
  await mkdir(outside)
  await writeFile(join(workspace, 'inside.txt'), 'inside')
  await writeFile(join(outside, 'outside.txt'), 'outside')
  await symlink(join(outside, 'outside.txt'), join(workspace, 'escape.txt'))

  const bridge = await import(`${pathToFileURL(resolve(harnessRoot, 'crawshrimp-product-bridge/lib/index.js')).href}?artifact-policy=${Date.now()}`)
  assert.equal(await bridge.isImArtifactPathAllowed(workspace, 'inside.txt'), true)
  assert.equal(await bridge.isImArtifactPathAllowed(workspace, join(outside, 'outside.txt')), false)
  assert.equal(await bridge.isImArtifactPathAllowed(workspace, 'escape.txt'), false)
})

test('MCP context acquire reports structured backend failures without an object-string error', async (t) => {
  const bridge = await import(`${pathToFileURL(resolve(harnessRoot, 'crawshrimp-product-bridge/lib/index.js')).href}?context-error=${Date.now()}`)
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.CRAWSHRIMP_MCP_URL
  const originalToken = process.env.CRAWSHRIMP_MCP_TOKEN
  process.env.CRAWSHRIMP_MCP_URL = 'http://127.0.0.1:18965/mcp'
  process.env.CRAWSHRIMP_MCP_TOKEN = 'test-token'
  globalThis.fetch = async () => new Response(JSON.stringify({
    detail: {
      code: 'RUNTIME_SESSION_CONTEXT_UNAVAILABLE',
      message: 'runtime session 没有可用的 active run: session-example',
    },
  }), { status: 409, headers: { 'content-type': 'application/json' } })
  t.after(() => {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.CRAWSHRIMP_MCP_URL
    else process.env.CRAWSHRIMP_MCP_URL = originalUrl
    if (originalToken === undefined) delete process.env.CRAWSHRIMP_MCP_TOKEN
    else process.env.CRAWSHRIMP_MCP_TOKEN = originalToken
  })

  await assert.rejects(
    bridge.postMcpContext('acquire', { runtime_session_id: 'session-example' }),
    error => {
      assert.equal(error.code, 'RUNTIME_SESSION_CONTEXT_UNAVAILABLE')
      assert.equal(error.status, 409)
      assert.match(error.message, /Crawshrimp MCP context acquire failed \[RUNTIME_SESSION_CONTEXT_UNAVAILABLE\]/)
      assert.match(error.message, /active run/)
      assert.doesNotMatch(String(error), /\[object Object\]/)
      return true
    },
  )
})

test('IM fetch policy locks workspace creation and only registers sessions after a valid in-root read', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'crawshrimp-im-fetch-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  await mkdir(workspace)
  await mkdir(outside)
  const canonicalWorkspace = await realpath(workspace)
  const calls = []
  const responseFor = (request, value) => new Response(JSON.stringify({
    type: 'server-response', rpcId: request.rpcId, result: { ok: true, value },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  const originalFetch = async (_input, init) => {
    const request = JSON.parse(init.body)
    calls.push(request)
    if (request.method === 'workspace.create') {
      return responseFor(request, { workspace: { workspaceId: 'root', path: request.payload.path } })
    }
    if (request.method === 'session.list') {
      return responseFor(request, { items: [
        { sessionId: 'inside', cwd: workspace, running: false },
        { sessionId: 'outside', cwd: outside, running: false },
      ] })
    }
    if (request.method === 'session.history') return responseFor(request, { events: [] })
    throw new Error(`unexpected method ${request.method}`)
  }

  const bridge = await import(`${pathToFileURL(resolve(harnessRoot, 'crawshrimp-product-bridge/lib/index.js')).href}?fetch-policy=${Date.now()}`)
  const registry = new Set()
  const securedFetch = bridge.createImPolicyFetch(originalFetch, { workspaceRoot: workspace, sessionRegistry: registry })
  await securedFetch('http://127.0.0.1:3090/api/workspace.create', {
    method: 'POST',
    // dsh-im channel HarnessClient instances use a channel prefix (for example
    // `weixin-<uuid>`), which is the boundary the product fetch guard scopes.
    body: JSON.stringify({ type: 'client-request', rpcId: 'weixin-workspace-1', method: 'workspace.create', payload: { path: outside } }),
  })
  assert.equal(calls[0].payload.path, canonicalWorkspace)

  const sessions = await (await securedFetch('http://127.0.0.1:3090/api/session.list', {
    method: 'POST',
    body: JSON.stringify({ type: 'client-request', rpcId: 'weixin-sessions-1', method: 'session.list', payload: {} }),
  })).json()
  assert.deepEqual(sessions.result.value.items.map((item) => item.sessionId), ['inside'])
  assert.equal(registry.has('inside'), false)

  await securedFetch('http://127.0.0.1:3090/api/session.history', {
    method: 'POST',
    body: JSON.stringify({
      type: 'client-request', rpcId: 'weixin-history-1', method: 'session.history',
      payload: { sessionId: 'inside', maxMessages: 1 },
    }),
  })
  assert.equal(registry.has('inside'), true)
  assert.equal(registry.has('outside'), false)
})

test('IM approval guard retains native approval for registered remote Sessions', async () => {
  const bridge = await import(`${pathToFileURL(resolve(harnessRoot, 'crawshrimp-product-bridge/lib/index.js')).href}?approval-guard=${Date.now()}`)
  const registered = new Set(['im-session'])
  const approval = { decide: async () => 'allowed-once' }
  bridge.installImApprovalGuard(approval, registered, { CRAWSHRIMP_IM_REMOTE_APPROVALS: '' })
  assert.equal(await approval.decide({ agent: { session: { id: 'im-session' } } }, {}), 'allowed-once')

  const disabled = { decide: async () => 'allowed-once' }
  bridge.installImApprovalGuard(disabled, registered, { CRAWSHRIMP_IM_REMOTE_APPROVALS: 'false' })
  assert.equal(await disabled.decide({ agent: { session: { id: 'im-session' } } }, {}), 'rejected')
})

test('dsh-im 4.11 preserves the seven-day inbound attachment retention policy', async () => {
  const ttl = await import(moduleUrl('src/channels/shared/inbound-ttl.mjs', 'inbound-ttl'))
  assert.equal(ttl.DEFAULT_INBOUND_TTL_HOURS, 168)
  assert.equal(ttl.normalizeInboundTtlHours(undefined), null)
  assert.equal(ttl.normalizeInboundTtlHours('168'), 168)
  assert.equal(ttl.normalizeInboundTtlHours(-1), -1)
  assert.equal(ttl.normalizeInboundTtlHours(8761), null)
})

test('dsh-im 4.11 adopts only an unambiguous registered workspace Session', async () => {
  const binding = await import(moduleUrl('src/channels/shared/harness-session-binding.mjs', 'session-binding'))
  const calls = []
  const client = {
    async ensureRunning() { calls.push('ensureRunning') },
    async rpc(method, payload) {
      calls.push(method)
      if (method === 'workspace.list') return {
        items: [{ workspaceId: 'workspace-1', path: '/tmp/crawshrimp-workspace', sessionIds: ['session-1'] }],
        archivedSessionIds: [],
      }
      if (method === 'session.list') return {
        items: [{ sessionId: 'session-1', projections: { values: { title: '已绑定会话' } } }],
      }
      if (method === 'session.create') {
        assert.deepEqual(payload, { workspaceId: 'workspace-1', sessionId: 'session-1' })
        return { sessionId: 'session-1' }
      }
      throw new Error(`unexpected RPC ${method}`)
    },
  }
  const adopted = await binding.adoptRegisteredWorkspaceSession(client, 'session-1')
  assert.deepEqual(adopted, {
    sessionId: 'session-1', workspace: '/tmp/crawshrimp-workspace', title: '已绑定会话', archived: false,
  })
  assert.deepEqual(calls, ['ensureRunning', 'workspace.list', 'session.list', 'session.create'])
})

test('dsh-im persists each bot default model and a private two-way Session-sync target', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'crawshrimp-im-store-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const config = join(root, 'bots.json')
  await mkdir(workspace)
  const { BotWorkspaceStore } = await import(moduleUrl('src/channels/shared/bot-workspace-store.mjs', 'bot-store'))
  const store = await new BotWorkspaceStore(config, { defaultWorkspace: workspace }).load()
  await store.ensure('bot-1', { workspace })
  assert.deepEqual(await store.setModel('bot-1', { provider: 'crawshrimp', model: 'model-a' }), {
    provider: 'crawshrimp', model: 'model-a',
  })
  await store.createDeliveryTarget('bot-1', {
    targetId: 'private-user', kind: 'user', route: { userId: 'user-1' },
  })
  assert.equal(await store.setDeliveryTargetSessionSync('bot-1', 'private-user', 'weixin:user-1'), true)
  assert.deepEqual(store.listSessionSyncTargets(), [{
    botId: 'bot-1', targetId: 'private-user', conversationKey: 'weixin:user-1',
  }])

  const reloaded = await new BotWorkspaceStore(config, { defaultWorkspace: workspace }).load()
  assert.deepEqual(reloaded.modelFor('bot-1'), { provider: 'crawshrimp', model: 'model-a' })
  assert.deepEqual(reloaded.listSessionSyncTargets(), [{
    botId: 'bot-1', targetId: 'private-user', conversationKey: 'weixin:user-1',
  }])
})

test('dsh-im private Session sync delivers DSH-originated user and final assistant text without echoing IM input', async () => {
  const { createSessionSyncCoordinator } = await import(moduleUrl('plugin-src/host/session-sync-coordinator.mjs', 'sync-coordinator'))
  const sent = []
  const coordinator = createSessionSyncCoordinator({
    deliveryService: {
      async listSessionSyncTargets(sessionId) {
        assert.equal(sessionId, 'session-1')
        return [
          { channel: 'weixin', botId: 'bot-1', targetId: 'private-user' },
          { channel: 'weixin', botId: 'bot-1', targetId: 'private-user' },
        ]
      },
      async sendSessionSyncText(botId, targetId, sessionId, text) {
        sent.push({ botId, targetId, sessionId, text })
      },
    },
    logger: { warn() {} },
  })
  await coordinator.enqueue('session-1', { type: 'turn/start', data: { turn: 7 } })
  await coordinator.enqueue('session-1', {
    type: 'user/message', surfaceOp: 'append', data: { content: [{ type: 'text', text: '来自 DSH 的输入' }] },
  }, 'dsh')
  await coordinator.enqueue('session-1', {
    type: 'assistant/message', surfaceOp: 'append', data: {
      turn: 7, step: 0, message: { content: [{ type: 'text', text: '最终答复' }] },
    },
  })
  await coordinator.enqueue('session-1', { type: 'turn/end', data: { turn: 7, reason: 'completed' } })
  await coordinator.whenIdle()
  assert.deepEqual(sent.map((entry) => entry.text), ['[来自 DSH]\n来自 DSH 的输入', '[DSH 助手]\n最终答复'])

  await coordinator.enqueue('session-1', { type: 'turn/start', data: { turn: 8 } })
  await coordinator.enqueue('session-1', {
    type: 'user/message', surfaceOp: 'append', data: { content: [{ type: 'text', text: 'IM 已发送' }] },
  }, 'im')
  await coordinator.enqueue('session-1', { type: 'turn/end', data: { turn: 8, reason: 'completed' } })
  await coordinator.whenIdle()
  assert.equal(sent.length, 2)
  coordinator.close()
})

test('dsh-im modern compatibility bridge uses DSH Session snapshots and current Session model routes', async () => {
  const source = readFileSync(resolve(dshImRoot, 'plugin-src/host/modern-harness-api.mjs'), 'utf8')
  assert.match(source, /session\?\.snapshotEvents/)
  assert.match(source, /'session', 'follow'/)
  assert.match(source, /frame\?\.type !== 'snapshot'/)
  assert.match(source, /'session', 'selectModel'/)

  const { modernHarnessApi } = await import(moduleUrl('plugin-src/host/modern-harness-api.mjs', 'modern-api'))
  const streamCalls = []
  const invokeCalls = []
  const root = {}
  const ctx = {
    root,
    typertGateway: {
      async stream(request) {
        streamCalls.push(request)
        return (async function* stream() {
          yield {
            type: 'snapshot', cursor: 5, hasMore: false,
            records: [{ type: 'event', event: { type: 'assistant/message', seq: 5, data: {} } }],
          }
        }())
      },
      async invoke(request) {
        invokeCalls.push(request)
        return { selected: { provider: request.args.request.provider, model: request.args.request.model } }
      },
    },
    on() { return () => {} },
  }
  const api = modernHarnessApi(ctx)
  const history = await api.sessions.history({ rpcId: 'history-1', payload: { sessionId: 'session-1', maxMessages: 1 } })
  assert.equal(history.result.ok, true)
  assert.equal(history.result.value.events[0].event.seq, 5)
  assert.equal(streamCalls[0].namespace, 'session')
  assert.equal(streamCalls[0].method, 'follow')
  const selected = await api.sessions.selectModel({
    rpcId: 'model-1', payload: { sessionId: 'session-1', provider: 'provider-1', model: 'model-1' },
  })
  assert.deepEqual(selected.result.value.selected, { provider: 'provider-1', model: 'model-1' })
  assert.equal(invokeCalls[0].method, 'selectModel')
  api.dispose()
})

test('clean-install runtime guard verifies upstream dsh-im contracts without reviving rc.8 binary patches', () => {
  const patcher = readFileSync(resolve(harnessRoot, 'scripts/patch-runtime-dependencies.mjs'), 'utf8')
  const client = readFileSync(resolve(dshImRoot, 'src/channels/shared/harness-client.mjs'), 'utf8')
  assert.match(patcher, /RUNTIME_GUARD_MARKER/)
  assert.match(patcher, /patched:\s*false/)
  assert.match(patcher, /inbound-ttl\.mjs/)
  assert.match(patcher, /harness-session-binding\.mjs/)
  assert.match(patcher, /model-setting\.mjs/)
  assert.doesNotMatch(patcher, /DSH_IM_NATURAL_CONTROLS_PATCH_MARKER/)
  assert.match(client, /session\.history/)
  assert.match(client, /session\.selectModel/)
})

test('IM connection RPC policy pins direct-bot and AI Office workspaces to Crawshrimp', async () => {
  const bridge = await import(`${pathToFileURL(resolve(harnessRoot, 'crawshrimp-product-bridge/lib/index.js')).href}?connection-policy=${Date.now()}`)
  const registrations = new Map()
  const ctx = { connection: { rpc: { handle(channel, handler) { registrations.set(channel, handler); return () => registrations.delete(channel) } } } }
  bridge.installImConnectionRpcPolicy(ctx, '/crawshrimp/workspace')
  let payload
  ctx.connection.rpc.handle('/office', async (_endpoint, value) => {
    payload = value
    return { ok: true, value: { config: { workspaces: { finance: '/outside' } } } }
  })
  const result = await registrations.get('/office')('connector.configure', { workspaces: { finance: '/outside' } })
  assert.deepEqual(payload.workspaces, { finance: '/crawshrimp/workspace' })
  assert.deepEqual(result.value.config.workspaces, { finance: '/crawshrimp/workspace' })
})

test('worker cancellation and safety budgets keep the shared IM Host process alive', () => {
  const worker = readFileSync(resolve(harnessRoot, 'worker/worker.mjs'), 'utf8')
  const cancelBody = worker.match(/function cancelActiveRun\(\)\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  const budgetBody = worker.match(/if \(exceeded\) \{([\s\S]*?)\n\s*\}/)?.[1] || ''
  assert.match(worker, /function cancelActiveRuntimeSession\(/)
  assert.match(cancelBody, /session\/cancel/)
  assert.doesNotMatch(cancelBody, /stopRuntime\(\)/)
  assert.match(budgetBody, /cancelActiveRuntimeSession\(run,/)
  assert.doesNotMatch(budgetBody, /stopRuntime\(\)/)
})
