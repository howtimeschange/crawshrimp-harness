const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { spawnSync } = require('node:child_process')
const { mkdtemp, mkdir, realpath, rm, symlink, writeFile } = require('node:fs/promises')
const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs')
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

function sourceFiles(root) {
  const files = []
  for (const name of readdirSync(root)) {
    const path = resolve(root, name)
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path))
    else if (/\.[cm]?js$/u.test(name)) files.push(path)
  }
  return files
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
  // The coordinator's event projection must remain stable before and after
  // the idempotent product overlay. Branding itself is asserted separately by
  // the clean-install test below.
  assert.deepEqual(
    sent.map((entry) => entry.text.replace(/^\[[^\]]+\]\n/u, '')),
    ['来自 DSH 的输入', '最终答复'],
  )

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

test('clean-install runtime guard verifies upstream dsh-im contracts and the small product patch', () => {
  const patcher = readFileSync(resolve(harnessRoot, 'scripts/patch-runtime-dependencies.mjs'), 'utf8')
  const client = readFileSync(resolve(dshImRoot, 'src/channels/shared/harness-client.mjs'), 'utf8')
  assert.match(patcher, /RUNTIME_GUARD_MARKER/)
  assert.match(patcher, /patched:\s*true/)
  assert.match(patcher, /inbound-ttl\.mjs/)
  assert.match(patcher, /harness-session-binding\.mjs/)
  assert.match(patcher, /model-setting\.mjs/)
  assert.match(patcher, /CRAWSHRIMP_DSH_IM_NATURAL_CONTROLS_MARKER/)
  assert.match(patcher, /crawshrimp-natural-controls\.mjs/)
  assert.match(client, /session\.history/)
  assert.match(client, /session\.selectModel/)
})

test('clean-install dsh-im runtime exposes only the Crawshrimp Harness brand to IM users', async () => {
  const patcher = await import(`${pathToFileURL(resolve(harnessRoot, 'scripts/patch-runtime-dependencies.mjs')).href}?brand-migration=${Date.now()}`)
  const result = patcher.patchRuntimeDependencies(harnessRoot)

  assert.equal(result.patched, true)
  assert.equal(result.marker, 'crawshrimp-dsh-im-411-product-patch-v1')
  for (const root of ['src', 'plugin-src', 'lib']) {
    for (const path of sourceFiles(resolve(dshImRoot, root))) {
      const source = readFileSync(path, 'utf8')
      assert.doesNotMatch(source, /DeepSeek Harness/u, path)
    }
  }
  const question = readFileSync(resolve(dshImRoot, 'src/channels/shared/harness-question.mjs'), 'utf8')
  const approval = readFileSync(resolve(dshImRoot, 'src/channels/shared/harness-approval.mjs'), 'utf8')
  const sync = readFileSync(resolve(dshImRoot, 'plugin-src/host/session-sync-coordinator.mjs'), 'utf8')
  const weixinSettings = readFileSync(resolve(dshImRoot, 'plugin-src/client/channels/weixin/index.js'), 'utf8')
  const clientI18n = readFileSync(resolve(dshImRoot, 'plugin-src/client/i18n.js'), 'utf8')
  const clientBundle = readFileSync(resolve(dshImRoot, 'lib/client.js'), 'utf8')
  assert.match(question, /抓虾 Harness 需要你补充信息/u)
  assert.match(approval, /抓虾 Harness 需要你的审批/u)
  assert.match(sync, /\[来自抓虾 Harness\]/u)
  assert.match(sync, /\[抓虾 Harness\]/u)
  assert.match(weixinSettings, /扫一次码，就能在微信里使用 抓虾 Harness/u)
  assert.match(clientI18n, /Scan once to use 抓虾 Harness in WeChat/u)
  assert.match(clientI18n, /抓虾 Harness IM 更新/u)
  assert.ok(clientBundle.includes('Office\\uFF1B抓虾 Harness'), 'the staged client bundle must brand Unicode-escaped Chinese copy')
})

test('clean-install product copy patch preserves every dsh-im module syntax', () => {
  for (const root of ['src', 'plugin-src', 'lib']) {
    for (const path of sourceFiles(resolve(dshImRoot, root))) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' })
      assert.equal(result.status, 0, `${path}\n${result.stderr}`)
    }
  }
})

test('natural model phrases reuse the bound IM Session and preserve the bot default model', async () => {
  const patcher = await import(`${pathToFileURL(resolve(harnessRoot, 'scripts/patch-runtime-dependencies.mjs')).href}?natural-model-migration=${Date.now()}`)
  patcher.patchRuntimeDependencies(harnessRoot)
  const controlsPath = resolve(dshImRoot, 'src/channels/shared/crawshrimp-natural-controls.mjs')
  assert.equal(existsSync(controlsPath), true)
  const controls = await import(`${pathToFileURL(controlsPath).href}?natural-model-control=${Date.now()}`)

  assert.deepEqual(controls.parseNaturalModelCommand('有哪些模型'), { action: 'list' })
  assert.deepEqual(controls.parseNaturalModelCommand('当前是什么模型'), { action: 'current' })
  assert.deepEqual(controls.parseNaturalModelCommand('换成 deepseek-v4-pro'), {
    action: 'select', requested: 'deepseek-v4-pro',
  })

  let current = { provider: 'crawshrimp-deepseek-official', model: 'deepseek-v4-flash' }
  const selected = []
  const session = {
    sessionExists: async () => true,
    isRunning: async () => false,
    hasActiveTurn: async () => false,
    models: async () => ({
      groups: [{
        id: 'crawshrimp-deepseek-official',
        name: 'DeepSeek 官方',
        models: [
          { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
          { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
        ],
      }],
      failures: [],
      current,
      routable: true,
    }),
    selectModel: async (selection) => {
      selected.push(selection)
      current = { ...selection }
      return { selected: { ...selection } }
    },
  }
  const harness = {
    workspaceSession(sessionId) {
      assert.equal(sessionId, 'im-session-1')
      return session
    },
    listModels: async () => { throw new Error('a bound IM Session must be used') },
    setDefaultModel: async () => { throw new Error('bot default model must not be changed') },
  }
  const state = { sessionFor: () => 'im-session-1' }

  const listed = await controls.runNaturalModelCommand('有哪些模型', harness, state, 'direct:merchant')
  assert.match(listed.message, /DeepSeek 官方/)
  const currentResult = await controls.runNaturalModelCommand('当前是什么模型', harness, state, 'direct:merchant')
  assert.match(currentResult.message, /deepseek-v4-flash/)
  const switched = await controls.runNaturalModelCommand('换成 deepseek-v4-pro', harness, state, 'direct:merchant')
  assert.match(switched.message, /deepseek-v4-pro/)
  assert.deepEqual(selected, [{ provider: 'crawshrimp-deepseek-official', model: 'deepseek-v4-pro' }])
})

test('natural permission controls require same-user confirmation before full access', async () => {
  const patcher = await import(`${pathToFileURL(resolve(harnessRoot, 'scripts/patch-runtime-dependencies.mjs')).href}?natural-permission-migration=${Date.now()}`)
  patcher.patchRuntimeDependencies(harnessRoot)
  const controlsPath = resolve(dshImRoot, 'src/channels/shared/crawshrimp-natural-controls.mjs')
  const controls = await import(`${pathToFileURL(controlsPath).href}?natural-permission-control=${Date.now()}`)
  assert.equal(typeof controls.PermissionCommandManager, 'function')
  assert.deepEqual(controls.parseNaturalPermissionCommand('修改审批权限'), { action: 'query' })
  assert.deepEqual(controls.parseNaturalPermissionCommand('审批权限改成 工作区写入'), {
    action: 'select', preset: 'workspace-write',
  })
  assert.deepEqual(controls.parseNaturalPermissionCommand('去掉审批'), { action: 'request-full-access' })
  assert.deepEqual(controls.parseNaturalPermissionCommand('确认切换到完全访问'), {
    action: 'confirm-full-access',
  })

  let preset = 'read-only'
  const changes = []
  const session = {
    sessionExists: async () => true,
    permission: async () => ({ preset, available: ['read-only', 'workspace-write', 'danger-full-access'] }),
    setPermission: async ({ preset: next }) => {
      changes.push(next)
      preset = next
      return { preset, available: ['read-only', 'workspace-write', 'danger-full-access'] }
    },
  }
  const harness = { workspaceSession: (sessionId) => {
    assert.equal(sessionId, 'im-session-1')
    return session
  } }
  const state = { sessionFor: () => 'im-session-1' }
  const manager = new controls.PermissionCommandManager({ now: () => 1_000, ttlMs: 60_000 })

  const queried = await manager.run('修改审批权限', harness, state, 'direct:merchant', { actor: 'merchant-a' })
  assert.match(queried.message, /当前权限/)
  const writable = await manager.run('审批权限改成 工作区写入', harness, state, 'direct:merchant', { actor: 'merchant-a' })
  assert.match(writable.message, /workspace-write/)
  assert.deepEqual(changes, ['workspace-write'])

  const requested = await manager.run('去掉审批', harness, state, 'direct:merchant', { actor: 'merchant-a' })
  assert.match(requested.message, /二次确认/)
  assert.deepEqual(changes, ['workspace-write'])
  const wrongActor = await manager.run('确认切换到完全访问', harness, state, 'direct:merchant', { actor: 'merchant-b' })
  assert.match(wrongActor.message, /发起切换的用户/)
  assert.deepEqual(changes, ['workspace-write'])
  const confirmed = await manager.run('确认切换到完全访问', harness, state, 'direct:merchant', { actor: 'merchant-a' })
  assert.match(confirmed.message, /danger-full-access/)
  assert.deepEqual(changes, ['workspace-write', 'danger-full-access'])
})

test('text IM bridge handles natural permission commands locally instead of prompting the agent', async () => {
  const patcher = await import(`${pathToFileURL(resolve(harnessRoot, 'scripts/patch-runtime-dependencies.mjs')).href}?text-permission-migration=${Date.now()}`)
  patcher.patchRuntimeDependencies(harnessRoot)
  const { TextHarnessBridge } = await import(moduleUrl('src/channels/shared/text-harness-bridge.mjs', 'text-permission-command'))
  const sent = []
  const changes = []
  const agentPrompts = []
  let preset = 'read-only'
  const session = {
    sessionExists: async () => true,
    permission: async () => ({ preset, available: ['read-only', 'workspace-write', 'danger-full-access'] }),
    setPermission: async ({ preset: next }) => {
      changes.push(next)
      preset = next
      return { preset, available: ['read-only', 'workspace-write', 'danger-full-access'] }
    },
    ask: async (prompt) => {
      agentPrompts.push(prompt)
      return 'unexpected agent response'
    },
  }
  const seen = new Set()
  const bridge = new TextHarnessBridge({
    descriptor: { key: 'telegram', label: 'Telegram' },
    bot: { sendText: async (_target, text) => { sent.push(text) } },
    harness: { workspaceSession: () => session },
    state: {
      sessionFor: () => 'im-session-1',
      hasSeen: (messageId) => seen.has(messageId),
      markSeen: async (messageId) => { seen.add(messageId) },
    },
  })

  await bridge.accept({
    messageId: 'natural-permission-1',
    conversationId: 'merchant-chat',
    senderId: 'merchant-a',
    kind: 'direct',
    content: '审批权限改成 工作区写入',
    replyTarget: 'merchant-a',
  })
  assert.deepEqual(changes, ['workspace-write'])
  assert.match(sent.at(-1), /workspace-write/)
  assert.deepEqual(agentPrompts, [])
})

test('dsh-im permission RPC reads and changes only the requested live Session', async () => {
  const patcher = await import(`${pathToFileURL(resolve(harnessRoot, 'scripts/patch-runtime-dependencies.mjs')).href}?session-permission-rpc=${Date.now()}`)
  patcher.patchRuntimeDependencies(harnessRoot)
  const { HarnessClient } = await import(moduleUrl('src/channels/shared/harness-client.mjs', 'session-permission-client'))
  const { modernHarnessApi } = await import(moduleUrl('plugin-src/host/modern-harness-api.mjs', 'session-permission-api'))

  let preset = 'read-only'
  let policyChanges = 0
  const agent = { session: { id: 'im-session-1', events: [] } }
  const ctx = {
    root: {},
    typertGateway: { async invoke() {}, async stream() {} },
    agents: { roots: () => [agent] },
    permissionPresets: {
      names: ['read-only', 'workspace-write', 'danger-full-access'],
      current: () => preset,
      apply: (_session, next, applyPolicy) => {
        preset = next
        applyPolicy({ id: next })
      },
    },
    approval: { setPolicy: (target, policy) => {
      assert.equal(target, agent)
      assert.deepEqual(policy, { id: 'workspace-write' })
      policyChanges += 1
    } },
    on() { return () => {} },
  }
  const client = new HarnessClient({ apiProxy: modernHarnessApi(ctx), workspace: '/crawshrimp' })
  assert.equal(typeof client.getSessionPermission, 'function')
  assert.equal(typeof client.setSessionPermission, 'function')
  assert.deepEqual(await client.getSessionPermission('im-session-1'), {
    preset: 'read-only',
    available: ['read-only', 'workspace-write', 'danger-full-access'],
  })
  assert.deepEqual(await client.setSessionPermission('im-session-1', 'workspace-write'), {
    preset: 'workspace-write',
    available: ['read-only', 'workspace-write', 'danger-full-access'],
    previous: 'read-only',
  })
  assert.equal(policyChanges, 1)
  await assert.rejects(
    client.getSessionPermission('other-session'),
    error => error?.code === 'NO_LIVE_AGENT',
  )
})

test('allow all resolves only the visible approval once and delegates scoped elevation', async () => {
  const patcher = await import(`${pathToFileURL(resolve(harnessRoot, 'scripts/patch-runtime-dependencies.mjs')).href}?allow-all-approval=${Date.now()}`)
  patcher.patchRuntimeDependencies(harnessRoot)
  const approval = await import(moduleUrl('src/channels/shared/harness-approval.mjs', 'allow-all-approval'))
  assert.equal(approval.harnessApprovalDecision('允许所有'), 'allowed-all')
  const allowAllCalls = []
  const queue = new approval.HarnessApprovalQueue({
    label: 'telegram',
    logger: { warn() {}, error() {} },
    onAllowAll: async (context) => {
      allowAllCalls.push(context)
      return '当前会话仍需二次确认，未提升完全访问。'
    },
  })
  const sent = []
  const responded = []
  await queue.handleRequested({
    kind: 'approval',
    interactionId: 'approval-1',
    rpcId: 'approval-rpc-1',
    sessionId: 'im-session-1',
    toolCall: { callId: 'call-1', name: 'mcp__crawshrimp__file_write', arguments: '{"path":"report.txt"}' },
    payload: {
      type: 'approval/requested',
      sessionId: 'im-session-1',
      approvalId: 'approval-1',
      toolName: 'mcp__crawshrimp__file_write',
      callId: 'call-1',
    },
    respond: async (value) => { responded.push(value) },
  }, {
    key: 'direct:merchant',
    actor: 'merchant-a',
    send: async (text) => { sent.push(text) },
  })
  const claimed = queue.claimReply({
    key: 'direct:merchant', actor: 'merchant-a', text: '允许所有', send: async (text) => { sent.push(text) },
  })
  assert.ok(claimed)
  await claimed.process()
  assert.deepEqual(responded, [{
    ok: true,
    value: { sessionId: 'im-session-1', approvalId: 'approval-1', outcome: 'allowed-once' },
  }])
  assert.deepEqual(allowAllCalls, [{
    key: 'direct:merchant', actor: 'merchant-a', sessionId: 'im-session-1', approvalId: 'approval-1',
  }])
  assert.match(sent.at(-1), /二次确认/)
})

test('clean dsh-im patch routes natural controls through every native channel bridge', async () => {
  const patcher = await import(`${pathToFileURL(resolve(harnessRoot, 'scripts/patch-runtime-dependencies.mjs')).href}?native-channel-controls=${Date.now()}`)
  patcher.patchRuntimeDependencies(harnessRoot)
  for (const relativePath of [
    'src/channels/weixin/weixin-bridge.mjs',
    'src/channels/wecom/wecom-bridge.mjs',
    'src/channels/dingtalk/dingtalk-bridge.mjs',
    'src/channels/qq/qq-bridge.mjs',
    'src/channels/feishu/bridge.mjs',
  ]) {
    const source = readFileSync(resolve(dshImRoot, relativePath), 'utf8')
    assert.match(source, /isNaturalModelCommand\(commandText\)/, relativePath)
    assert.match(source, /isNaturalPermissionCommand\(commandText\)/, relativePath)
    assert.match(source, /allowNaturalPermissionForCurrentApproval/, relativePath)
  }
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

test('Crawshrimp automation receipt bridge appends one balanced native DSH turn', async () => {
  const bridgeUrl = pathToFileURL(resolve(harnessRoot, 'crawshrimp-product-bridge/lib/index.js'))
  const bridge = await import(`${bridgeUrl.href}?automation-receipt-merge-test=${Date.now()}`)
  const events = []
  const session = {
    id: 'dsh-source',
    events,
    append(type, data, options = {}) {
      const event = { type, data, ...options }
      events.push(event)
      return event
    },
  }

  const first = await bridge.appendCrawshrimpAutomationReceipt({
    agents: { roots: () => [{ status: 'idle', session }] },
  }, {
    sessionId: session.id,
    receiptId: 'automation-run-1:source-receipt',
    text: '本地自动化验收已完成',
  })
  const repeated = await bridge.appendCrawshrimpAutomationReceipt({
    agents: { roots: () => [{ status: 'idle', session }] },
  }, {
    sessionId: session.id,
    receiptId: 'automation-run-1:source-receipt',
    text: '本地自动化验收已完成',
  })

  assert.deepEqual(events.map((event) => event.type), [
    'turn/start', 'step/start', 'assistant/message', 'step/end', 'turn/end',
  ])
  assert.equal(events[2].data.message.content[0].text, '本地自动化验收已完成')
  assert.equal(events[2].data.message.source.provider, 'crawshrimp-automation')
  assert.equal(first.appended, true)
  assert.equal(repeated.appended, false)
})

test('Crawshrimp receipt bridge resumes a cold persisted DSH source session once', async () => {
  const bridgeUrl = pathToFileURL(resolve(harnessRoot, 'crawshrimp-product-bridge/lib/index.js'))
  const bridge = await import(`${bridgeUrl.href}?automation-receipt-cold-session-test=${Date.now()}`)
  const events = []
  const session = {
    id: 'dsh-cold-source',
    events,
    append(type, data, options = {}) {
      const event = { type, data, ...options }
      events.push(event)
      return event
    },
  }
  let resumeCalls = 0
  let resumedAgent
  const ctx = {
    agents: {
      roots: () => resumedAgent ? [resumedAgent] : [],
      async resume({ resumeSessionId }) {
        resumeCalls += 1
        assert.equal(resumeSessionId, session.id)
        resumedAgent = { status: 'idle', session }
        return { agent: resumedAgent }
      },
    },
  }
  Object.defineProperty(ctx, 'sessions', {
    get() {
      throw new Error('sessions is intentionally not injected into the product bridge')
    },
  })

  const [first, concurrent] = await Promise.all([
    bridge.appendCrawshrimpAutomationReceipt(ctx, {
      sessionId: session.id,
      receiptId: 'automation-run-cold:source-receipt',
      text: '冷会话回执已完成',
    }),
    bridge.appendCrawshrimpAutomationReceipt(ctx, {
      sessionId: session.id,
      receiptId: 'automation-run-cold:source-receipt',
      text: '冷会话回执已完成',
    }),
  ])
  const repeated = await bridge.appendCrawshrimpAutomationReceipt(ctx, {
    sessionId: session.id,
    receiptId: 'automation-run-cold:source-receipt',
    text: '冷会话回执已完成',
  })

  assert.equal(resumeCalls, 1)
  assert.equal(first.ok, true)
  assert.equal(concurrent.ok, true)
  assert.equal(repeated.appended, false)
  assert.deepEqual(events.map((event) => event.type), [
    'turn/start', 'step/start', 'assistant/message', 'step/end', 'turn/end',
  ])
})

test('Crawshrimp automation receipt HTTP route authenticates and rejects a busy source session', async () => {
  const bridgeUrl = pathToFileURL(resolve(harnessRoot, 'crawshrimp-product-bridge/lib/index.js'))
  const bridge = await import(`${bridgeUrl.href}?automation-receipt-http-merge-test=${Date.now()}`)
  const events = []
  const session = {
    id: 'dsh-source-route',
    events,
    append(type, data, options = {}) {
      const event = { type, data, ...options }
      events.push(event)
      return event
    },
  }
  let routeHandler
  bridge.apply({
    logger: { info() {}, error() {} },
    connection: {},
    agents: { roots: () => [{ status: 'idle', session }] },
    approval: { decide: async () => 'rejected' },
    on: () => () => {},
    effect(fn) { return fn() },
    webServer: {
      register(route) {
        routeHandler = route.handler
        return () => {}
      },
    },
  })

  const callRoute = async (token, body) => new Promise((resolveResponse, reject) => {
    const req = new EventEmitter()
    req.url = '/api/crawshrimp/session/automation-receipt'
    req.method = 'POST'
    req.headers = { 'x-crawshrimp-token': token }
    const res = {
      statusCode: 0,
      writeHead(statusCode) { this.statusCode = statusCode },
      end(chunk = '') { resolveResponse({ statusCode: this.statusCode, body: JSON.parse(String(chunk)) }) },
    }
    Promise.resolve(routeHandler(req, res)).catch(reject)
    process.nextTick(() => {
      req.emit('data', JSON.stringify(body))
      req.emit('end')
    })
  })

  const previousToken = process.env.CRAWSHRIMP_API_TOKEN
  process.env.CRAWSHRIMP_API_TOKEN = 'automation-route-test-token'
  try {
    const unauthorized = await callRoute('wrong-token', {
      sessionId: session.id, receiptId: 'receipt-1', text: '不应写入',
    })
    assert.equal(unauthorized.statusCode, 401)
    assert.equal(events.length, 0)

    const completed = await callRoute('automation-route-test-token', {
      sessionId: session.id, receiptId: 'receipt-1', text: '本地自动化验收已完成',
    })
    assert.equal(completed.statusCode, 200)
    assert.equal(completed.body.appended, true)

    session.events.push({ type: 'turn/start', data: { turn: 2 } })
    const busy = await callRoute('automation-route-test-token', {
      sessionId: session.id, receiptId: 'receipt-2', text: '稍后重试',
    })
    assert.equal(busy.statusCode, 409)
    assert.equal(busy.body.error.code, 'SESSION_BUSY')
  } finally {
    if (previousToken === undefined) delete process.env.CRAWSHRIMP_API_TOKEN
    else process.env.CRAWSHRIMP_API_TOKEN = previousToken
  }
})
