const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { mkdtemp, mkdir, realpath, rm, symlink, writeFile } = require('node:fs/promises')
const { existsSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const test = require('node:test')
const { setTimeout: delay } = require('node:timers/promises')
const { pathToFileURL } = require('node:url')

const appRoot = resolve(__dirname, '..')
const repoRoot = resolve(appRoot, '..')
const harnessRoot = resolve(repoRoot, 'integrations/deepseek-harness')

async function waitFor(predicate, label, { timeoutMs = 1000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await delay(intervalMs)
  }
  assert.fail(label)
}

test('packaged Harness pins dsh-im 2.3.0 and registers it in canonical and generated Cordis profiles', () => {
  const runtimePackage = JSON.parse(readFileSync(resolve(harnessRoot, 'package.json'), 'utf8'))
  const runtimeLock = JSON.parse(readFileSync(resolve(harnessRoot, 'package-lock.json'), 'utf8'))
  const generator = readFileSync(resolve(harnessRoot, 'scripts/gen-web-cordis.py'), 'utf8')
  const cordis = readFileSync(resolve(harnessRoot, 'web-cordis.yml'), 'utf8')
  const staging = readFileSync(resolve(harnessRoot, 'scripts/stage-runtime.mjs'), 'utf8')
  const afterPack = readFileSync(resolve(appRoot, 'scripts/after-pack.js'), 'utf8')

  assert.equal(runtimePackage.dependencies['@xmanrui/dsh-im'], '2.3.0')
  assert.equal(runtimeLock.packages['node_modules/@xmanrui/dsh-im']?.version, '2.3.0')
  assert.match(generator, /merged\["xmanrui-dsh-im"\][\s\S]*?"@xmanrui\/dsh-im"/)
  assert.match(cordis, /- id: xmanrui-dsh-im\s+name: '@xmanrui\/dsh-im'/)
  assert.match(staging, /node_modules\/@xmanrui\/dsh-im\/lib\/index\.js/)
  assert.match(staging, /node_modules\/@xmanrui\/dsh-im\/lib\/client\.js/)
  assert.match(afterPack, /node_modules\/@xmanrui\/dsh-im\/lib\/index\.js/)
  assert.match(afterPack, /node_modules\/@xmanrui\/dsh-im\/lib\/client\.js/)
})

test('Crawshrimp settings exposes IM bots as a first-level group and embeds only the IM plugin surface', () => {
  const app = readFileSync(resolve(appRoot, 'src/renderer/App.vue'), 'utf8')
  const settings = readFileSync(resolve(appRoot, 'src/renderer/views/SettingsPage.vue'), 'utf8')
  const slots = readFileSync(resolve(harnessRoot, 'crawshrimp-slots/lib/client.js'), 'utf8')

  assert.match(app, /const settingsMountedOnce = ref\(currentView\.value === 'settings'\)/)
  assert.match(app, /v-if="currentView !== 'agent' \|\| settingsMountedOnce"/)
  assert.match(app, /v-show="currentView !== 'agent'"/)
  assert.match(app, /v-if="settingsMountedOnce"/)
  assert.match(app, /v-show="currentView === 'settings'"/)
  assert.match(app, /if \(item\.id === 'settings'\) settingsMountedOnce\.value = true/)
  assert.match(app, /settingsMountedOnce\.value = true[\s\S]*focusSettingsPanelId\.value = panelId[\s\S]*currentView\.value = 'settings'/)
  assert.match(settings, /id: 'im'/)
  assert.match(settings, /label: 'IM机器人'/)
  assert.match(settings, /children: \[\{ id: 'im-bots', label: '机器人接入'/)
  assert.match(settings, /activePanelId === 'im-bots'/)
  assert.match(settings, /csImSettings/)
  assert.match(settings, /'im-settings-frame'/)
  assert.match(settings, /imSettingsReady/)
  assert.match(settings, /const imSettingsPanelMountedOnce = ref\(initialPanelSelection\.panelId === 'im-bots'\)/)
  assert.match(settings, /v-if="imSettingsPanelMountedOnce"/)
  assert.match(settings, /v-show="activePanelId === 'im-bots'"/)
  assert.match(settings, /正在载入机器人渠道/)
  assert.match(settings, /url\.searchParams\.set\('csRuntimeGeneration', String\(Math\.trunc\(generation\)\)\)/)
  assert.match(settings, /event\.source !== frameWindow/)
  assert.match(settings, /event\.origin !== new URL\(imSettingsUrl\.value\)\.origin/)
  assert.match(settings, /event\.data\?\.__crawshrimp === 'im-settings-ready'/)
  assert.match(settings, /imSettingsPanelMountedOnce\.value = true/)
  assert.match(settings, /if \(!imSettingsFrame\.value\) imSettingsReady\.value = false/)
  assert.match(settings, /\.im-settings-frame[^}]*opacity: 0;[^}]*visibility: hidden;[^}]*pointer-events: none;/)
  assert.match(settings, /\.im-settings-frame\.is-ready[^}]*opacity: 1;[^}]*visibility: visible;[^}]*pointer-events: auto;/)
  assert.match(settings, /远程审批默认关闭/)
  assert.match(settings, /工作区范围已锁定/)
  assert.match(slots, /function openCrawshrimpImSettings\(/)
  assert.match(slots, /csImSettings/)
  assert.match(slots, /\.hHd-Xa_settingsArea[^']*display: contents !important/)
  assert.match(slots, /function isolateCrawshrimpImSurface\(overlay\)/)
  assert.match(slots, /surfaceReady && !crawshrimpImSettingsReadyPublished/)
  assert.match(slots, /postToShell\(\{ __crawshrimp: 'im-settings-ready' \}\)/)
  assert.match(slots, /data-cs-im-surface-root/)
  assert.match(slots, /data-cs-im-surface-path/)
  assert.match(slots, /\.dim-title \{ display: none !important; \}/)
  assert.match(slots, /\.dim-layout[^']*grid-template-columns: 174px 1px minmax\(0, 1fr\) !important/)
  assert.match(slots, /--dim-crawshrimp-accent: var\(--dsw-alias-state-business-primary, #FF5000\)/)
  assert.match(slots, /\.dim-page button\[data-kind="primary"\][^']*background: var\(--dim-crawshrimp-accent\) !important/)
  assert.match(slots, /\.VOzbGW_trigger/)
  assert.match(slots, /\.VOzbGW_navCell/)
  assert.match(slots, /\[role="tab"\]/)
  assert.match(slots, /机器人\|bots\?/)
  assert.match(slots, /\.dim-workspaceEdit[^']*display: none !important/)
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

  const bridgeUrl = pathToFileURL(resolve(harnessRoot, 'crawshrimp-product-bridge/lib/index.js'))
  const bridge = await import(`${bridgeUrl.href}?test=${Date.now()}`)
  assert.equal(await bridge.isImArtifactPathAllowed(workspace, 'inside.txt'), true)
  assert.equal(await bridge.isImArtifactPathAllowed(workspace, join(outside, 'outside.txt')), false)
  assert.equal(await bridge.isImArtifactPathAllowed(workspace, 'escape.txt'), false)
})

test('IM fetch policy pins workspace RPCs and filters session registry reads to the Crawshrimp root', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'crawshrimp-im-fetch-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  await mkdir(workspace)
  await mkdir(outside)
  const canonicalWorkspace = await realpath(workspace)
  const calls = []
  const responseFor = (request, value) => new Response(JSON.stringify({
    type: 'server-response',
    rpcId: request.rpcId,
    result: { ok: true, value },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  const originalFetch = async (_input, init) => {
    const request = JSON.parse(init.body)
    calls.push(request)
    if (request.method === 'workspace.create') {
      return responseFor(request, { workspace: { workspaceId: 'workspace-root', path: request.payload.path } })
    }
    if (request.method === 'session.list') {
      return responseFor(request, {
        items: [
          { sessionId: 'im-inside', cwd: workspace, running: false },
          { sessionId: 'outside-session', cwd: outside, running: false },
        ],
      })
    }
    if (request.method === 'session.history') {
      return responseFor(request, { events: [] })
    }
    throw new Error(`unexpected method ${request.method}`)
  }

  const bridgeUrl = pathToFileURL(resolve(harnessRoot, 'crawshrimp-product-bridge/lib/index.js'))
  const bridge = await import(`${bridgeUrl.href}?fetch-test=${Date.now()}`)
  const sessionRegistry = new Set()
  const securedFetch = bridge.createImPolicyFetch(originalFetch, {
    workspaceRoot: workspace,
    sessionRegistry,
  })

  await securedFetch('http://127.0.0.1:3090/api/workspace.create', {
    method: 'POST',
    body: JSON.stringify({ type: 'client-request', rpcId: 'feishu-1', method: 'workspace.create', payload: { path: outside } }),
  })
  assert.equal(calls[0].payload.path, canonicalWorkspace)

  const sessionsResponse = await securedFetch('http://127.0.0.1:3090/api/session.list', {
    method: 'POST',
    body: JSON.stringify({ type: 'client-request', rpcId: 'dingtalk-1', method: 'session.list', payload: {} }),
  })
  const sessions = await sessionsResponse.json()
  assert.deepEqual(sessions.result.value.items.map(item => item.sessionId), ['im-inside'])
  assert.equal(sessionRegistry.has('im-inside'), false)
  assert.equal(sessionRegistry.has('outside-session'), false)

  const historyResponse = await securedFetch('http://127.0.0.1:3090/api/session.history', {
    method: 'POST',
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'feishu-2',
      method: 'session.history',
      payload: { sessionId: 'im-inside', maxMessages: 1 },
    }),
  })
  assert.equal((await historyResponse.json()).result.ok, true)
  assert.equal(sessionRegistry.has('im-inside'), true)
  assert.equal(sessionRegistry.has('outside-session'), false)
})

test('IM fetch policy rejects session creation until the workspace id has been verified', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'crawshrimp-im-create-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  let forwarded = false
  const originalFetch = async () => {
    forwarded = true
    throw new Error('unverified session.create must not reach the Host')
  }
  const bridgeUrl = pathToFileURL(resolve(harnessRoot, 'crawshrimp-product-bridge/lib/index.js'))
  const bridge = await import(`${bridgeUrl.href}?create-test=${Date.now()}`)
  const securedFetch = bridge.createImPolicyFetch(originalFetch, { workspaceRoot: workspace })
  const response = await securedFetch('http://127.0.0.1:3090/api/session.create', {
    method: 'POST',
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'weixin-1',
      method: 'session.create',
      payload: { workspaceId: 'unverified-workspace' },
    }),
  })
  const body = await response.json()
  assert.equal(forwarded, false)
  assert.equal(body.result.ok, false)
  assert.equal(body.result.error.code, 'IM_WORKSPACE_LOCKED')
})

test('IM approval guard lets registered remote Sessions use native approvals by default', async () => {
  const bridgeUrl = pathToFileURL(resolve(harnessRoot, 'crawshrimp-product-bridge/lib/index.js'))
  const bridge = await import(`${bridgeUrl.href}?approval-test=${Date.now()}`)
  const approval = {
    decide: async () => 'allowed-once',
  }
  const registry = new Set(['im-session'])
  bridge.installImApprovalGuard(approval, registry, { CRAWSHRIMP_IM_REMOTE_APPROVALS: '' })
  assert.equal(await approval.decide({ agent: { session: { id: 'im-session' } } }, {}), 'allowed-once')
  assert.equal(await approval.decide({ agent: { session: { id: 'local-session' } } }, {}), 'allowed-once')

  const disabledApproval = {
    decide: async () => 'allowed-once',
  }
  bridge.installImApprovalGuard(disabledApproval, registry, { CRAWSHRIMP_IM_REMOTE_APPROVALS: 'false' })
  assert.equal(await disabledApproval.decide({ agent: { session: { id: 'im-session' } } }, {}), 'rejected')
  assert.equal(await disabledApproval.decide({ agent: { session: { id: 'local-session' } } }, {}), 'allowed-once')
})

test('IM approval route requests native approval for registered IM Sessions by default', async (t) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = undefined
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const bridgeUrl = pathToFileURL(resolve(harnessRoot, 'crawshrimp-product-bridge/lib/index.js'))
  const bridge = await import(`${bridgeUrl.href}?approval-route-test=${Date.now()}`)
  assert.equal(bridge.approvalDisplayArgumentsFromBody({}), undefined)
  assert.equal(bridge.approvalDisplayArgumentsFromBody({ arguments: '' }), undefined)
  const capped = bridge.approvalDisplayArgumentsFromBody({ arguments: 'x'.repeat(8_000) })
  assert.equal(capped.length, 4_500)
  assert.match(capped, /\.\.\.\(truncated, original length 8000\)$/)
  let approvalRequest
  let approvalHandler
  const ctx = {
    logger: { info() {}, error() {} },
    connection: {},
    agents: {
      roots: () => [{ session: { id: 'im-session' } }],
    },
    approval: {
      decide: async () => 'allowed-once',
      effectivePolicy: () => 'ask',
      request: async (request) => {
        approvalRequest = request
        return 'allowed-once'
      },
    },
    on: () => () => {},
    effect(fn) {
      return fn()
    },
    webServer: {
      register(route) {
        approvalHandler = route.handler
        return () => {}
      },
    },
  }
  bridge.apply(ctx)
  globalThis[bridge.CRAWSHRIMP_IM_SESSION_REGISTRY].clear()
  globalThis[bridge.CRAWSHRIMP_IM_SESSION_REGISTRY].add('im-session')

  const response = await new Promise((resolveResponse, reject) => {
    const req = new EventEmitter()
    req.url = '/api/crawshrimp/approval/request'
    req.method = 'POST'
    req.destroy = () => {}
    const res = {
      statusCode: 0,
      headers: {},
      writeHead(statusCode, headers) {
        this.statusCode = statusCode
        this.headers = headers
      },
      end(chunk = '') {
        resolveResponse({
          statusCode: this.statusCode,
          body: JSON.parse(String(chunk)),
        })
      },
    }
    Promise.resolve(approvalHandler(req, res)).catch(reject)
    process.nextTick(() => {
      req.emit('data', JSON.stringify({
        sessionId: 'im-session',
        toolName: 'mcp__crawshrimp__demo',
        reason: 'needs write',
        callId: 'call-1',
        arguments: {
          risk: 'local_write',
          summary: { kind: 'fs_write', path: '/tmp/demo.txt', size: 4 },
        },
        timeoutMs: 1000,
      }))
      req.emit('end')
    })
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.body.outcome, 'allowed-once')
  assert.equal(approvalRequest.toolName, 'mcp__crawshrimp__demo')
  assert.equal(approvalRequest.callId, 'call-1')
  assert.deepEqual(approvalRequest.arguments, {
    risk: 'local_write',
    summary: { kind: 'fs_write', path: '/tmp/demo.txt', size: 4 },
  })
  assert.equal(approvalRequest.agent.session.id, 'im-session')
})

test('Crawshrimp product bridge fetches the deterministic model catalog from the backend', async () => {
  const bridgeUrl = pathToFileURL(resolve(harnessRoot, 'crawshrimp-product-bridge/lib/index.js'))
  const bridge = await import(`${bridgeUrl.href}?model-catalog-fetch-test=${Date.now()}`)
  const requests = []
  const fakeFetch = async (url, init) => {
    requests.push({ url: new URL(url), init })
    return new Response(JSON.stringify({
      ok: true,
      configured_count: 2,
      total_count: 3,
      groups: [
        { id: 'llm', name: 'LLM 对话模型', configured_count: 1, total_count: 1, models: [] },
        { id: 'ai-image', name: 'AI 生图模型', configured_count: 1, total_count: 1, models: [] },
        { id: 'ai-video', name: 'AI 生视频模型', configured_count: 0, total_count: 1, models: [] },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  const catalog = await bridge.fetchCrawshrimpModelCatalog(fakeFetch, {
    CRAWSHRIMP_PORT: '18766',
    CRAWSHRIMP_API_TOKEN: 'unit-token',
  })

  assert.equal(catalog.ok, true)
  assert.equal(catalog.configured_count, 2)
  assert.deepEqual(catalog.groups.map((group) => group.id), ['llm', 'ai-image', 'ai-video'])
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url.href, 'http://127.0.0.1:18766/agent/model-catalog')
  assert.equal(requests[0].init.method, 'GET')
  assert.equal(requests[0].init.headers['x-crawshrimp-token'], 'unit-token')
})

test('Crawshrimp product bridge selects an IM session model without persisting the default model', async () => {
  const bridgeUrl = pathToFileURL(resolve(harnessRoot, 'crawshrimp-product-bridge/lib/index.js'))
  const bridge = await import(`${bridgeUrl.href}?local-model-select-test=${Date.now()}`)
  const originalDefault = {
    provider: 'crawshrimp-deepseek-official',
    model: 'deepseek-v4-flash',
  }
  let defaultSelection = { ...originalDefault }
  const savedDefaults = []
  const apiRequests = []
  const ctx = {
    agentDefaultModel: {
      currentSelection: () => ({ ...defaultSelection }),
      saveSelection: async (selection) => {
        savedDefaults.push(selection)
        defaultSelection = { ...selection }
      },
    },
    apiProxy: {
      sessions: {
        selectModel: async (request) => {
          apiRequests.push(request)
          const selected = {
            provider: request.payload.provider,
            model: request.payload.model,
          }
          defaultSelection = { ...selected }
          return {
            type: 'server-response',
            rpcId: request.rpcId,
            result: { ok: true, value: { selected } },
          }
        },
      },
    },
  }

  const result = await bridge.selectCrawshrimpSessionModel(ctx, {
    sessionId: 'im-session-1',
    provider: 'crawshrimp-deepseek-official',
    model: 'deepseek-v4-pro',
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.selected, {
    provider: 'crawshrimp-deepseek-official',
    model: 'deepseek-v4-pro',
  })
  assert.deepEqual(apiRequests.map((request) => request.method), ['session.selectModel'])
  assert.deepEqual(apiRequests[0].payload, {
    sessionId: 'im-session-1',
    provider: 'crawshrimp-deepseek-official',
    model: 'deepseek-v4-pro',
  })
  assert.deepEqual(defaultSelection, originalDefault)
  assert.deepEqual(savedDefaults, [originalDefault])
})

test('Crawshrimp product bridge exposes direct session permission control without command execution', async () => {
  const bridgeUrl = pathToFileURL(resolve(harnessRoot, 'crawshrimp-product-bridge/lib/index.js'))
  const bridge = await import(`${bridgeUrl.href}?permission-control-test=${Date.now()}`)
  let preset = 'workspace-write'
  const policyCalls = []
  const appended = []
  const agent = {
    session: {
      id: 'im-session-1',
      events: [],
      append: (type, data) => {
        appended.push({ type, data })
        agent.session.events.push({ type, data })
      },
    },
  }
  const ctx = {
    agents: {
      roots: () => [agent],
    },
    approval: {
      effectivePolicy: () => (preset === 'danger-full-access' ? 'never' : 'ask'),
      setPolicy: (_agent, policy) => {
        policyCalls.push(policy)
      },
    },
    permissionPresets: {
      names: ['workspace-write', 'danger-full-access'],
      current: () => preset,
      apply: (session, nextPreset, setApproval) => {
        session.append('permission/preset', { preset: nextPreset })
        preset = nextPreset
        setApproval(nextPreset === 'danger-full-access' ? 'never' : 'ask')
      },
    },
  }

  const before = await bridge.getCrawshrimpSessionPermission(ctx, 'im-session-1')
  assert.deepEqual(before, {
    ok: true,
    status: 200,
    preset: 'workspace-write',
    available: ['workspace-write', 'danger-full-access'],
    policy: 'ask',
  })

  const changed = await bridge.setCrawshrimpSessionPermission(ctx, {
    sessionId: 'im-session-1',
    preset: 'danger-full-access',
  })

  assert.equal(changed.ok, true)
  assert.equal(changed.previous, 'workspace-write')
  assert.equal(changed.preset, 'danger-full-access')
  assert.equal(changed.policy, 'never')
  assert.deepEqual(policyCalls, ['never'])
  assert.deepEqual(appended, [{
    type: 'permission/preset',
    data: { preset: 'danger-full-access' },
  }])
})

test('dsh-im HarnessClient prefers Crawshrimp session-only model selection when available', async () => {
  const clientUrl = pathToFileURL(resolve(
    harnessRoot,
    'node_modules/@xmanrui/dsh-im/src/channels/shared/harness-client.mjs',
  ))
  const { HarnessClient } = await import(`${clientUrl.href}?local-model-client-test=${Date.now()}`)
  const calls = []
  const responseFor = (request, value) => new Response(JSON.stringify({
    type: 'server-response',
    rpcId: request.rpcId,
    result: { ok: true, value },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  const client = new HarnessClient({
    baseUrl: 'http://127.0.0.1:3090',
    workspace: repoRoot,
    autostart: false,
    fetchImpl: async (url, init) => {
      const parsed = new URL(url)
      calls.push(parsed.pathname)
      if (parsed.pathname === '/api/host.describe') {
        return responseFor(JSON.parse(init.body), { cwd: repoRoot })
      }
      if (parsed.pathname === '/api/crawshrimp/session/select-model') {
        assert.deepEqual(JSON.parse(init.body), {
          sessionId: 'im-session-1',
          provider: 'crawshrimp-deepseek-official',
          model: 'deepseek-v4-pro',
        })
        return new Response(JSON.stringify({
          ok: true,
          selected: {
            provider: 'crawshrimp-deepseek-official',
            model: 'deepseek-v4-pro',
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (parsed.pathname === '/api/session.selectModel') {
        throw new Error('default-persisting session.selectModel must not be used')
      }
      throw new Error(`unexpected ${parsed.pathname}`)
    },
  })

  const selected = await client.selectSessionModel('im-session-1', {
    provider: 'crawshrimp-deepseek-official',
    model: 'deepseek-v4-pro',
  })

  assert.deepEqual(selected, {
    selected: {
      provider: 'crawshrimp-deepseek-official',
      model: 'deepseek-v4-pro',
    },
  })
  assert.deepEqual(calls, [
    '/api/host.describe',
    '/api/crawshrimp/session/select-model',
  ])
})

test('dsh-im HarnessClient reads and writes Crawshrimp session permission directly', async () => {
  const clientUrl = pathToFileURL(resolve(
    harnessRoot,
    'node_modules/@xmanrui/dsh-im/src/channels/shared/harness-client.mjs',
  ))
  const { HarnessClient } = await import(`${clientUrl.href}?permission-client-test=${Date.now()}`)
  const calls = []
  const responseFor = (request, value) => new Response(JSON.stringify({
    type: 'server-response',
    rpcId: request.rpcId,
    result: { ok: true, value },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  const client = new HarnessClient({
    baseUrl: 'http://127.0.0.1:3090',
    workspace: repoRoot,
    autostart: false,
    fetchImpl: async (url, init) => {
      const parsed = new URL(url)
      calls.push({ path: parsed.pathname, method: init.method, body: init.body ?? null })
      if (parsed.pathname === '/api/host.describe') {
        return responseFor(JSON.parse(init.body), { cwd: repoRoot })
      }
      if (parsed.pathname === '/api/crawshrimp/session/permission' && init.method === 'GET') {
        assert.equal(parsed.searchParams.get('sessionId'), 'im-session-1')
        return new Response(JSON.stringify({
          ok: true,
          preset: 'workspace-write',
          available: ['read-only', 'workspace-write', 'danger-full-access'],
          policy: 'ask',
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (parsed.pathname === '/api/crawshrimp/session/permission' && init.method === 'POST') {
        assert.deepEqual(JSON.parse(init.body), {
          sessionId: 'im-session-1',
          preset: 'danger-full-access',
        })
        return new Response(JSON.stringify({
          ok: true,
          preset: 'danger-full-access',
          available: ['read-only', 'workspace-write', 'danger-full-access'],
          policy: 'never',
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`unexpected ${init.method} ${parsed.pathname}`)
    },
  })

  assert.deepEqual(await client.getSessionPermission('im-session-1'), {
    ok: true,
    preset: 'workspace-write',
    available: ['read-only', 'workspace-write', 'danger-full-access'],
    policy: 'ask',
  })
  assert.deepEqual(await client.setSessionPermission('im-session-1', 'danger-full-access'), {
    ok: true,
    preset: 'danger-full-access',
    available: ['read-only', 'workspace-write', 'danger-full-access'],
    policy: 'never',
  })
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    'POST /api/host.describe',
    'GET /api/crawshrimp/session/permission',
    'POST /api/host.describe',
    'POST /api/crawshrimp/session/permission',
  ])
})

test('dsh-im natural language model and permission controls parse required mobile phrases', async () => {
  const modelUrl = pathToFileURL(resolve(
    harnessRoot,
    'node_modules/@xmanrui/dsh-im/src/channels/shared/model-command.mjs',
  ))
  const permissionUrl = pathToFileURL(resolve(
    harnessRoot,
    'node_modules/@xmanrui/dsh-im/src/channels/shared/permission-command.mjs',
  ))
  const model = await import(`${modelUrl.href}?natural-model-test=${Date.now()}`)
  const permission = await import(`${permissionUrl.href}?natural-permission-test=${Date.now()}`)

  assert.deepEqual(model.parseNaturalModelCommand('可以切换模型吗'), { action: 'list' })
  assert.deepEqual(model.parseNaturalModelCommand('有哪些模型'), { action: 'list' })
  assert.deepEqual(model.parseNaturalModelCommand('列出所有模型'), { action: 'list' })
  assert.deepEqual(model.parseNaturalModelCommand('切换模型到 gpt-5'), {
    action: 'select',
    requested: 'gpt-5',
  })
  assert.deepEqual(model.parseNaturalModelCommand('换成 deepseek-v4-pro'), {
    action: 'select',
    requested: 'deepseek-v4-pro',
  })
  assert.deepEqual(model.parseNaturalModelCommand('切换模型到 deepseek-official-v4-pro'), {
    action: 'select',
    requested: 'deepseek-official-v4-pro',
  })
  assert.deepEqual(model.parseNaturalModelCommand('切换到v4 pro 模型'), {
    action: 'select',
    requested: 'v4 pro 模型',
  })

  assert.deepEqual(permission.parsePermissionCommand('修改审批权限'), { action: 'query' })
  assert.deepEqual(permission.parsePermissionCommand('现在是什么审批模式'), { action: 'query' })
  assert.deepEqual(permission.parsePermissionCommand('审批权限改成 工作区写入'), {
    action: 'select',
    preset: 'workspace-write',
  })
  assert.deepEqual(permission.parsePermissionCommand('恢复审批'), {
    action: 'select',
    preset: 'workspace-write',
  })
  assert.deepEqual(permission.parsePermissionCommand('关闭审批'), {
    action: 'select',
    preset: 'danger-full-access',
  })
  assert.deepEqual(permission.parsePermissionCommand('去掉审批'), {
    action: 'select',
    preset: 'danger-full-access',
  })
  assert.deepEqual(permission.parsePermissionCommand('开启 full assess'), {
    action: 'select',
    preset: 'danger-full-access',
  })
  assert.deepEqual(permission.parsePermissionCommand('确认切换到完全访问'), {
    action: 'confirm-full-access',
  })
})

test('dsh-im natural model aliases select only the bound IM Session model', async () => {
  const modelUrl = pathToFileURL(resolve(
    harnessRoot,
    'node_modules/@xmanrui/dsh-im/src/channels/shared/model-command.mjs',
  ))
  const { runModelCommand } = await import(`${modelUrl.href}?natural-model-run-test=${Date.now()}`)

  let current = {
    provider: 'crawshrimp-deepseek-official',
    model: 'deepseek-v4-flash',
  }
  const selected = []
  const created = []
  const catalog = () => ({
    groups: [{
      id: 'crawshrimp-deepseek-official',
      name: 'DeepSeek 官方',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      ],
    }, {
      id: 'crawshrimp-domestic-openai',
      name: '抓虾-国内 OpenAI 兼容',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash 国内兼容' },
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro 国内兼容' },
      ],
    }, {
      id: 'crawshrimp-overseas-openai',
      name: 'OpenAI 海外',
      models: [
        { id: 'gpt-5.5', name: 'GPT-5.5' },
      ],
    }],
    failures: [],
    current,
  })
  const productCatalog = () => ({
    ok: true,
    configured_count: 2,
    total_count: 2,
    groups: [{
      id: 'llm',
      name: 'LLM 对话模型',
      configured_count: 2,
      total_count: 2,
      models: [
        {
          id: 'deepseek-official-v4-flash',
          label: 'DeepSeek V4 Flash',
          provider: 'crawshrimp-deepseek-official',
          runtime_model: 'deepseek-v4-flash',
          configured: true,
          default: true,
          supports_switch: true,
        },
        {
          id: 'deepseek-official-v4-pro',
          label: 'DeepSeek V4 Pro',
          provider: 'crawshrimp-deepseek-official',
          runtime_model: 'deepseek-v4-pro',
          configured: true,
          supports_switch: true,
        },
      ],
    }],
  })
  const session = {
    sessionExists: async () => true,
    isRunning: async () => false,
    hasActiveTurn: async () => false,
    models: async () => catalog(),
    selectModel: async (selection) => {
      selected.push(selection)
      current = { ...selection }
      return { selected: { ...selection } }
    },
  }
  const state = { sessionFor: () => 'session-1' }
  const harness = {
    listCrawshrimpModelCatalog: async () => productCatalog(),
    workspaceSession: (sessionId) => {
      assert.equal(sessionId, 'session-1')
      return session
    },
    createSession: async () => {
      created.push(true)
      return 'unexpected-session'
    },
  }

  const switched = await runModelCommand('换成 deepseek-v4-pro', harness, state, 'room-1')
  assert.match(switched.message, /crawshrimp-deepseek-official\/deepseek-v4-pro/)
  assert.deepEqual(selected, [{
    provider: 'crawshrimp-deepseek-official',
    model: 'deepseek-v4-pro',
  }])
  assert.deepEqual(created, [])

  const switchedGpt5 = await runModelCommand('切换模型到 gpt-5', harness, state, 'room-1')
  assert.match(switchedGpt5.message, /gpt-5\.5/)
  assert.deepEqual(selected.at(-1), {
    provider: 'crawshrimp-overseas-openai',
    model: 'gpt-5.5',
  })
  assert.deepEqual(created, [])

  const switchedProductId = await runModelCommand(
    '切换模型到 deepseek-official-v4-pro',
    harness,
    state,
    'room-1',
  )
  assert.match(switchedProductId.message, /crawshrimp-deepseek-official\/deepseek-v4-pro/)
  assert.deepEqual(selected.at(-1), {
    provider: 'crawshrimp-deepseek-official',
    model: 'deepseek-v4-pro',
  })

  const switchedSpokenAlias = await runModelCommand('切换到v4 pro 模型', harness, state, 'room-1')
  assert.match(switchedSpokenAlias.message, /crawshrimp-deepseek-official\/deepseek-v4-pro/)
  assert.deepEqual(selected.at(-1), {
    provider: 'crawshrimp-deepseek-official',
    model: 'deepseek-v4-pro',
  })
})

function createNaturalCommandHarnessFixture() {
  let currentModel = {
    provider: 'crawshrimp-deepseek-official',
    model: 'deepseek-v4-flash',
  }
  let currentPermission = 'read-only'
  const selected = []
  const executed = []
  const permissions = []
  const asked = []
  const calls = {
    listModels: 0,
    listCrawshrimpModelCatalog: 0,
  }
  const sessions = new Map([['direct:room-1', 'session-1'], ['p2p:user-a', 'session-1']])
  const seen = new Set()
  const catalog = () => ({
    groups: [{
      id: 'crawshrimp-deepseek-official',
      name: 'DeepSeek 官方',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      ],
    }, {
      id: 'crawshrimp-domestic-openai',
      name: '抓虾-国内 OpenAI 兼容',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash 国内兼容' },
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro 国内兼容' },
      ],
    }, {
      id: 'crawshrimp-overseas-openai',
      name: 'OpenAI 海外',
      models: [
        { id: 'gpt-5.5', name: 'GPT-5.5' },
      ],
    }],
    failures: [],
    current: currentModel,
  })
  const productCatalog = () => ({
    ok: true,
    configured_count: 5,
    total_count: 6,
    groups: [
      {
        id: 'llm',
        name: 'LLM 对话模型',
        configured_count: 3,
        total_count: 3,
        models: [
          {
            id: 'deepseek-official-v4-flash',
            label: 'DeepSeek V4 Flash',
            provider: 'crawshrimp-deepseek-official',
            configured: true,
            default: true,
            supports_switch: true,
          },
          {
            id: 'deepseek-official-v4-pro',
            label: 'DeepSeek V4 Pro',
            provider: 'crawshrimp-deepseek-official',
            runtime_model: 'deepseek-v4-pro',
            configured: true,
            supports_switch: true,
          },
          {
            id: 'gpt-5.5',
            label: 'GPT-5.5',
            provider: 'crawshrimp-overseas-openai',
            configured: true,
            supports_switch: true,
          },
        ],
      },
      {
        id: 'ai-image',
        name: 'AI 生图模型',
        configured_count: 1,
        total_count: 2,
        models: [
          {
            id: 'gpt-image-4k',
            label: 'GPT Image 4K',
            provider: '1xm',
            configured: true,
            supports_switch: false,
          },
          {
            id: 'gemini-3-pro-image-preview',
            label: 'Gemini 3 Pro Image Preview',
            provider: '1xm',
            configured: false,
            supports_switch: false,
          },
        ],
      },
      {
        id: 'ai-video',
        name: 'AI 生视频模型',
        configured_count: 1,
        total_count: 1,
        models: [
          {
            id: 'seedance-lite',
            label: 'Seedance Lite',
            provider: 'seedance',
            configured: true,
            supports_switch: false,
          },
        ],
      },
    ],
  })
  const session = {
    sessionExists: async () => true,
    isRunning: async () => false,
    hasActiveTurn: async () => false,
    models: async () => catalog(),
    selectModel: async (selection) => {
      selected.push(selection)
      currentModel = { ...selection }
      return { selected: { ...selection } }
    },
    executeCommand: async (line) => {
      executed.push(line)
      if (line.startsWith('/permission ')) {
        currentPermission = line.slice('/permission '.length)
        return { result: { kind: 'success', text: 'updated' } }
      }
      if (line === '/permission') {
        return {
          result: {
            kind: 'success',
            text: `current preset ${currentPermission} (available: read-only, workspace-write, danger-full-access)`,
          },
        }
      }
      return { result: { kind: 'error', text: 'unsupported' } }
    },
    permission: async () => {
      permissions.push(['get'])
      return {
        preset: currentPermission,
        available: ['read-only', 'workspace-write', 'danger-full-access'],
        policy: currentPermission === 'danger-full-access' ? 'never' : 'ask',
      }
    },
    setPermission: async (preset) => {
      permissions.push(['set', preset])
      currentPermission = preset
      return {
        preset: currentPermission,
        available: ['read-only', 'workspace-write', 'danger-full-access'],
        policy: currentPermission === 'danger-full-access' ? 'never' : 'ask',
      }
    },
    ask: async (text) => {
      asked.push(text)
      return 'unexpected agent reply'
    },
  }
  return {
    selected,
    executed,
    permissions,
    asked,
    calls,
    harness: {
      listModels: async () => {
        calls.listModels += 1
        return catalog()
      },
      listCrawshrimpModelCatalog: async () => {
        calls.listCrawshrimpModelCatalog += 1
        return productCatalog()
      },
      createSession: async () => 'session-1',
      workspaceSession: (sessionId) => {
        assert.equal(sessionId, 'session-1')
        return session
      },
    },
    state: {
      sessionFor: (key) => sessions.get(key) ?? null,
      setSession: async (key, sessionId) => { sessions.set(key, sessionId) },
      clearSession: async (key) => { sessions.delete(key) },
      hasSeen: (messageId) => seen.has(messageId),
      markSeen: async (messageId) => { seen.add(messageId) },
    },
  }
}

test('dsh-im text bridge routes natural model and permission commands before agent prompts', async () => {
  const bridgeUrl = pathToFileURL(resolve(
    harnessRoot,
    'node_modules/@xmanrui/dsh-im/src/channels/shared/text-harness-bridge.mjs',
  ))
  const { TextHarnessBridge } = await import(`${bridgeUrl.href}?text-natural-command-test=${Date.now()}`)
  const fixture = createNaturalCommandHarnessFixture()
  const sent = []
  const bridge = new TextHarnessBridge({
    descriptor: { key: 'weixin', label: '微信' },
    bot: {
      sendText: async (target, text) => { sent.push({ target, text }) },
    },
    harness: fixture.harness,
    state: fixture.state,
    logger: { warn() {}, error() {} },
    replyTimeoutMs: 1000,
  })
  const message = (messageId, content, senderId = 'user-a') => ({
    messageId,
    conversationId: 'room-1',
    senderId,
    replyTarget: 'reply-target',
    content,
  })

  await bridge.accept(message('text-msg-1', '列出所有模型'))
  assert.deepEqual(fixture.calls, { listModels: 0, listCrawshrimpModelCatalog: 1 })
  assert.match(sent.at(-1).text, /抓虾已支持\/已配置模型/)
  assert.match(sent.at(-1).text, /deepseek-official-v4-pro/)
  assert.match(sent.at(-1).text, /AI 生图模型/)
  assert.match(sent.at(-1).text, /AI 生视频模型/)

  await bridge.accept(message('text-msg-2', '切换模型到 gpt-5'))
  assert.deepEqual(fixture.selected.at(-1), {
    provider: 'crawshrimp-overseas-openai',
    model: 'gpt-5.5',
  })
  assert.match(sent.at(-1).text, /模型已切换为/)
  assert.match(sent.at(-1).text, /gpt-5\.5/)

  await bridge.accept(message('text-msg-3', '换成 deepseek-v4-pro'))
  assert.deepEqual(fixture.selected.at(-1), {
    provider: 'crawshrimp-deepseek-official',
    model: 'deepseek-v4-pro',
  })
  assert.match(sent.at(-1).text, /模型已切换为/)

  await bridge.accept(message('text-msg-3a', '切换模型到 deepseek-official-v4-pro'))
  assert.deepEqual(fixture.selected.at(-1), {
    provider: 'crawshrimp-deepseek-official',
    model: 'deepseek-v4-pro',
  })
  assert.match(sent.at(-1).text, /模型已切换为/)

  await bridge.accept(message('text-msg-3b', '切换到v4 pro 模型'))
  assert.deepEqual(fixture.selected.at(-1), {
    provider: 'crawshrimp-deepseek-official',
    model: 'deepseek-v4-pro',
  })
  assert.match(sent.at(-1).text, /模型已切换为/)

  await bridge.accept(message('text-msg-4', '修改审批权限'))
  assert.match(sent.at(-1).text, /当前权限/)
  assert.deepEqual(fixture.permissions.slice(-1), [['get']])

  await bridge.accept(message('text-msg-5', '审批权限改成 工作区写入'))
  assert.deepEqual(fixture.permissions.slice(-1), [['set', 'workspace-write']])
  assert.match(sent.at(-1).text, /权限已切换为/)

  await bridge.accept(message('text-msg-6', '恢复审批'))
  assert.deepEqual(fixture.permissions.slice(-1), [['set', 'workspace-write']])
  assert.match(sent.at(-1).text, /权限已切换为/)

  await bridge.accept(message('text-msg-7', '去掉审批'))
  assert.match(sent.at(-1).text, /准备切换到完全访问/)
  assert.deepEqual(fixture.permissions.filter((call) => call[1] === 'danger-full-access'), [])

  await bridge.accept(message('text-msg-8', '确认切换到完全访问'))
  assert.deepEqual(fixture.permissions.slice(-1), [['set', 'danger-full-access']])
  assert.match(sent.at(-1).text, /权限已切换为/)
  assert.deepEqual(fixture.executed, [])
  assert.deepEqual(fixture.asked, [])
})

test('dsh-im Weixin bridge routes natural model and permission commands before agent prompts', async () => {
  const weixinUrl = pathToFileURL(resolve(
    harnessRoot,
    'node_modules/@xmanrui/dsh-im/src/channels/weixin/weixin-bridge.mjs',
  ))
  const { WeixinHarnessBridge } = await import(`${weixinUrl.href}?weixin-natural-command-test=${Date.now()}`)
  const fixture = createNaturalCommandHarnessFixture()
  const sent = []
  const bridge = new WeixinHarnessBridge({
    api: {
      sendText: async ({ toUserId, text }) => {
        sent.push({ toUserId, text })
        return { message_id: `weixin-reply-${sent.length}` }
      },
    },
    baseUrl: 'https://weixin.invalid',
    token: 'token',
    ownerUserId: 'user-a',
    harness: fixture.harness,
    state: fixture.state,
    logger: { warn() {}, error() {} },
    replyTimeoutMs: 1000,
  })
  const message = (messageId, text, fromUserId = 'user-a') => ({
    message_id: messageId,
    from_user_id: fromUserId,
    item_list: [{ type: 1, text_item: { text } }],
  })

  await bridge.accept(message('weixin-natural-1', '列出所有模型'))
  assert.deepEqual(fixture.calls, { listModels: 0, listCrawshrimpModelCatalog: 1 })
  assert.match(sent.at(-1).text, /抓虾已支持\/已配置模型/)
  assert.match(sent.at(-1).text, /deepseek-official-v4-pro/)
  assert.match(sent.at(-1).text, /AI 生图模型/)
  assert.match(sent.at(-1).text, /AI 生视频模型/)

  await bridge.accept(message('weixin-natural-2', '切换模型到 gpt-5'))
  assert.deepEqual(fixture.selected.at(-1), {
    provider: 'crawshrimp-overseas-openai',
    model: 'gpt-5.5',
  })
  assert.match(sent.at(-1).text, /gpt-5\.5/)

  await bridge.accept(message('weixin-natural-3', '换成 deepseek-v4-pro'))
  assert.deepEqual(fixture.selected.at(-1), {
    provider: 'crawshrimp-deepseek-official',
    model: 'deepseek-v4-pro',
  })
  assert.match(sent.at(-1).text, /模型已切换为/)

  await bridge.accept(message('weixin-natural-3a', '切换模型到 deepseek-official-v4-pro'))
  assert.deepEqual(fixture.selected.at(-1), {
    provider: 'crawshrimp-deepseek-official',
    model: 'deepseek-v4-pro',
  })
  assert.match(sent.at(-1).text, /模型已切换为/)

  await bridge.accept(message('weixin-natural-3b', '切换到v4 pro 模型'))
  assert.deepEqual(fixture.selected.at(-1), {
    provider: 'crawshrimp-deepseek-official',
    model: 'deepseek-v4-pro',
  })
  assert.match(sent.at(-1).text, /模型已切换为/)

  await bridge.accept(message('weixin-natural-4', '修改审批权限'))
  assert.match(sent.at(-1).text, /当前权限/)
  assert.deepEqual(fixture.permissions.slice(-1), [['get']])

  await bridge.accept(message('weixin-natural-5', '审批权限改成 工作区写入'))
  assert.deepEqual(fixture.permissions.slice(-1), [['set', 'workspace-write']])
  assert.match(sent.at(-1).text, /权限已切换为/)

  await bridge.accept(message('weixin-natural-6', '恢复审批'))
  assert.deepEqual(fixture.permissions.slice(-1), [['set', 'workspace-write']])

  await bridge.accept(message('weixin-natural-7', '去掉审批'))
  assert.match(sent.at(-1).text, /准备切换到完全访问/)
  assert.deepEqual(fixture.permissions.filter((call) => call[1] === 'danger-full-access'), [])

  await bridge.accept(message('weixin-natural-8', '确认切换到完全访问'))
  assert.deepEqual(fixture.permissions.slice(-1), [['set', 'danger-full-access']])
  assert.match(sent.at(-1).text, /权限已切换为/)
  assert.deepEqual(fixture.executed, [])
  assert.deepEqual(fixture.asked, [])
})

test('dsh-im permission manager requires exact same-actor confirmation for full access', async () => {
  const permissionUrl = pathToFileURL(resolve(
    harnessRoot,
    'node_modules/@xmanrui/dsh-im/src/channels/shared/permission-command.mjs',
  ))
  const { PermissionCommandManager } = await import(`${permissionUrl.href}?permission-manager-test=${Date.now()}`)
  let now = 1000
  const executed = []
  const permissions = []
  let currentPermission = 'workspace-write'
  const session = {
    sessionExists: async () => true,
    isRunning: async () => false,
    hasActiveTurn: async () => false,
    executeCommand: async (line) => {
      executed.push(line)
      throw new Error(`permission manager must not execute ${line}`)
    },
    permission: async () => ({
      preset: currentPermission,
      available: ['read-only', 'workspace-write', 'danger-full-access'],
    }),
    setPermission: async (preset) => {
      permissions.push(preset)
      currentPermission = preset
      return {
        preset,
        available: ['read-only', 'workspace-write', 'danger-full-access'],
      }
    },
  }
  const state = { sessionFor: () => 'session-1' }
  const harness = { workspaceSession: () => session }
  const manager = new PermissionCommandManager({ now: () => now, ttlMs: 1000 })

  const request = await manager.run('关闭审批', harness, state, 'room-1', { actor: 'user-a' })
  assert.match(request.message, /准备切换到完全访问/)
  assert.deepEqual(executed, [])
  assert.deepEqual(permissions, [])

  const wrongActor = await manager.run('确认切换到完全访问', harness, state, 'room-1', { actor: 'user-b' })
  assert.match(wrongActor.message, /只有发起切换的用户/)
  assert.deepEqual(executed, [])
  assert.deepEqual(permissions, [])

  const confirmed = await manager.run('确认切换到完全访问', harness, state, 'room-1', { actor: 'user-a' })
  assert.match(confirmed.message, /权限已切换为/)
  assert.deepEqual(executed, [])
  assert.deepEqual(permissions, ['danger-full-access'])

  now += 2000
  const expired = await manager.run('确认切换到完全访问', harness, state, 'room-1', { actor: 'user-a' })
  assert.match(expired.message, /没有有效的完全访问确认/)
})

test('dsh-im approval replies require a visible pending approval from the same actor', async () => {
  const approvalUrl = pathToFileURL(resolve(
    harnessRoot,
    'node_modules/@xmanrui/dsh-im/src/channels/shared/harness-approval.mjs',
  ))
  const {
    HarnessApprovalQueue,
    harnessApprovalDecision,
    harnessApprovalText,
  } = await import(`${approvalUrl.href}?approval-queue-test=${Date.now()}`)

  assert.equal(harnessApprovalDecision('确认'), 'allowed-once')
  assert.equal(harnessApprovalDecision('继续'), 'allowed-once')
  assert.equal(harnessApprovalDecision('执行吧'), 'allowed-once')
  assert.equal(harnessApprovalDecision('可以'), 'allowed-once')
  assert.equal(harnessApprovalDecision('允许所有'), 'allowed-all')
  assert.equal(harnessApprovalDecision('拒绝'), 'rejected')
  assert.equal(harnessApprovalDecision('取消'), 'rejected')

  const payload = {
    type: 'approval/requested',
    sessionId: 'session-1',
    approvalId: 'approval-1',
    toolName: '运行任务:测试',
    callId: 'call-1',
    reason: '需要写入工作区',
    arguments: {
      risk: 'local_write',
      summary: { kind: 'fs_write', path: '/tmp/demo.txt', size: 4 },
    },
  }
  const text = harnessApprovalText(payload, { requiresMention: true })
  assert.match(text, /抓虾 Harness 需要你的审批/)
  assert.match(text, /步骤：运行任务:测试/)
  assert.match(text, /简略参数/)
  assert.match(text, /fs_write/)
  assert.match(text, /群聊中请 @机器人/)
  const mismatchedToolText = harnessApprovalText(payload, {
    toolCall: { callId: 'call-1', name: 'mcp__crawshrimp__task_run', arguments: '{}' },
  })
  assert.match(mismatchedToolText, /抓虾 Harness 需要你的审批/)
  assert.match(mismatchedToolText, /fs_write/)
  assert.match(mismatchedToolText, /运行任务:测试/)
  const longPayloadText = harnessApprovalText({
    ...payload,
    approvalId: 'approval-long-args',
    arguments: 'x'.repeat(7_000),
  })
  assert.ok(longPayloadText)
  assert.match(longPayloadText, /truncated, original length 7000/)
  assert.ok(longPayloadText.length < 6_300)
  assert.equal(
    harnessApprovalText({
      ...payload,
      approvalId: 'approval-no-args',
      arguments: undefined,
    }),
    null,
  )
  assert.equal(
    harnessApprovalText({
      ...payload,
      approvalId: 'approval-large-toolcall',
      arguments: undefined,
    }, {
      toolCall: { callId: 'call-1', name: payload.toolName, arguments: 'x'.repeat(7_000) },
    }),
    null,
  )
  assert.equal(
    harnessApprovalText({
      ...payload,
      approvalId: 'approval-mismatch-no-args',
      arguments: undefined,
    }, {
      toolCall: { callId: 'call-2', name: payload.toolName, arguments: '{}' },
    }),
    null,
  )

  const queue = new HarnessApprovalQueue({ label: 'test', logger: { warn() {}, error() {} } })
  const sent = []
  const responded = []
  const send = async (message) => { sent.push(message) }

  assert.equal(queue.claimReply({
    key: 'room-1',
    actor: 'user-a',
    text: '确认',
    send,
  }), null)

  await queue.handleRequested({
    kind: 'approval',
    interactionId: 'approval-1',
    rpcId: 'rpc-1',
    sessionId: 'session-1',
    payload,
    respond: async (result) => { responded.push(result) },
  }, {
    key: 'room-1',
    actor: 'user-a',
    send,
  })
  assert.equal(responded.length, 0)
  assert.match(sent[0], /简略参数/)

  const otherActor = queue.claimReply({
    key: 'room-1',
    actor: 'user-b',
    text: '确认',
    send,
  })
  assert.ok(otherActor)
  await otherActor.process()
  assert.equal(responded.length, 0)
  assert.match(sent.at(-1), /只有发起当前任务的用户/)

  const sameActor = queue.claimReply({
    key: 'room-1',
    actor: 'user-a',
    text: '继续',
    send,
  })
  assert.ok(sameActor)
  await sameActor.process()
  assert.equal(responded.length, 1)
  assert.equal(responded[0].value.outcome, 'allowed-once')
  assert.match(sent.at(-1), /已批准/)
})

test('dsh-im Weixin bridge presents payload approval arguments and accepts same-user natural confirmation', async () => {
  const weixinUrl = pathToFileURL(resolve(
    harnessRoot,
    'node_modules/@xmanrui/dsh-im/src/channels/weixin/weixin-bridge.mjs',
  ))
  const { WeixinHarnessBridge } = await import(`${weixinUrl.href}?weixin-approval-test=${Date.now()}`)

  const sent = []
  const responded = []
  let resolveApproval
  const approvalSettled = new Promise((resolve) => { resolveApproval = resolve })
  const payload = {
    type: 'approval/requested',
    sessionId: 'session-1',
    approvalId: 'approval-weixin-1',
    toolName: '运行任务:排盘',
    callId: 'call-1',
    reason: '需要执行本机 Python 命令',
    arguments: {
      risk: 'local_write',
      summary: {
        kind: 'run_python',
        prompt: '1996 年 6 月 29 日 中午 12 点，男，邢易成',
      },
    },
  }
  const session = {
    sessionExists: async () => true,
    ask: async (_text, options) => {
      await options.onInteraction({
        kind: 'approval',
        interactionId: payload.approvalId,
        rpcId: 'rpc-weixin-1',
        sessionId: payload.sessionId,
        payload,
        toolCall: {
          callId: 'call-1',
          name: 'mcp__crawshrimp__task_run',
          arguments: '{}',
        },
        respond: async (result) => {
          responded.push(result)
          resolveApproval()
        },
      })
      await approvalSettled
      return '审批通过后继续执行。'
    },
  }
  const sessions = new Map()
  const seen = new Set()
  const bridge = new WeixinHarnessBridge({
    api: {
      sendText: async ({ toUserId, text }) => {
        sent.push({ toUserId, text })
        return { message_id: `reply-${sent.length}` }
      },
    },
    baseUrl: 'https://weixin.invalid',
    token: 'token',
    ownerUserId: 'user-a',
    harness: {
      createSession: async () => 'session-1',
      workspaceSession: () => session,
    },
    state: {
      sessionFor: (key) => sessions.get(key) ?? null,
      setSession: async (key, sessionId) => { sessions.set(key, sessionId) },
      clearSession: async (key) => { sessions.delete(key) },
      hasSeen: (messageId) => seen.has(messageId),
      markSeen: async (messageId) => { seen.add(messageId) },
    },
    logger: { warn() {}, error() {} },
    replyTimeoutMs: 1000,
  })
  const message = (messageId, text) => ({
    message_id: messageId,
    from_user_id: 'user-a',
    item_list: [{ type: 1, text_item: { text } }],
  })

  const first = bridge.accept(message('weixin-msg-1', '帮我算命'))
  await waitFor(() => sent.some((item) => /抓虾 Harness 需要你的审批/.test(item.text)), 'Weixin approval prompt was not sent')
  const approvalPrompt = sent.find((item) => /抓虾 Harness 需要你的审批/.test(item.text)).text
  assert.match(approvalPrompt, /简略参数/)
  assert.match(approvalPrompt, /run_python/)
  assert.doesNotMatch(approvalPrompt, /\{\s*"risk"/)
  assert.doesNotMatch(approvalPrompt, /无法完整展示/)

  await bridge.accept(message('weixin-msg-2', '确认'))
  await first
  assert.equal(responded.length, 1)
  assert.equal(responded[0].value.outcome, 'allowed-once')
  assert.match(sent.at(-2).text, /已批准/)
  assert.match(sent.at(-1).text, /审批通过后继续执行/)
})

test('dsh-im Weixin bridge allow-all approval switches the bound session only for the same actor', async () => {
  const weixinUrl = pathToFileURL(resolve(
    harnessRoot,
    'node_modules/@xmanrui/dsh-im/src/channels/weixin/weixin-bridge.mjs',
  ))
  const { WeixinHarnessBridge } = await import(`${weixinUrl.href}?weixin-allow-all-test=${Date.now()}`)

  const sent = []
  const responded = []
  const executed = []
  const permissions = []
  let currentPermission = 'read-only'
  let resolveApproval
  const approvalSettled = new Promise((resolve) => { resolveApproval = resolve })
  const payload = {
    type: 'approval/requested',
    sessionId: 'session-allow-all',
    approvalId: 'approval-weixin-allow-all',
    toolName: '运行任务:排盘',
    callId: 'call-allow-all',
    reason: '需要执行本机 Python 命令',
    arguments: {
      risk: 'local_write',
      summary: {
        kind: 'run_python',
        prompt: '1996 年 6 月 29 日 中午 12 点，男，邢易成',
      },
    },
  }
  const session = {
    sessionExists: async () => true,
    executeCommand: async (line) => {
      executed.push(line)
      throw new Error(`allow-all must not execute ${line}`)
    },
    setPermission: async (preset) => {
      permissions.push(preset)
      currentPermission = preset
      return {
        preset: currentPermission,
        available: ['read-only', 'workspace-write', 'danger-full-access'],
        policy: currentPermission === 'danger-full-access' ? 'never' : 'ask',
      }
    },
    ask: async (_text, options) => {
      await options.onInteraction({
        kind: 'approval',
        interactionId: payload.approvalId,
        rpcId: 'rpc-weixin-allow-all',
        sessionId: payload.sessionId,
        payload,
        toolCall: {
          callId: 'call-allow-all',
          name: 'mcp__crawshrimp__task_run',
          arguments: '{}',
        },
        respond: async (result) => {
          responded.push(result)
          resolveApproval()
        },
      })
      await approvalSettled
      return '审批通过后继续执行。'
    },
  }
  const sessions = new Map()
  const seen = new Set()
  const bridge = new WeixinHarnessBridge({
    api: {
      sendText: async ({ toUserId, text }) => {
        sent.push({ toUserId, text })
        return { message_id: `reply-${sent.length}` }
      },
    },
    baseUrl: 'https://weixin.invalid',
    token: 'token',
    ownerUserId: 'user-a',
    harness: {
      createSession: async () => 'session-allow-all',
      workspaceSession: () => session,
    },
    state: {
      sessionFor: (key) => sessions.get(key) ?? null,
      setSession: async (key, sessionId) => { sessions.set(key, sessionId) },
      clearSession: async (key) => { sessions.delete(key) },
      hasSeen: (messageId) => seen.has(messageId),
      markSeen: async (messageId) => { seen.add(messageId) },
    },
    logger: { warn() {}, error() {} },
    replyTimeoutMs: 1000,
  })
  const message = (messageId, text, fromUserId = 'user-a') => ({
    message_id: messageId,
    from_user_id: fromUserId,
    item_list: [{ type: 1, text_item: { text } }],
  })

  const first = bridge.accept(message('weixin-allow-all-1', '帮我算命'))
  await waitFor(() => sent.some((item) => /抓虾 Harness 需要你的审批/.test(item.text)), 'Weixin approval prompt was not sent')

  await bridge.accept(message('weixin-allow-all-wrong-actor', '允许所有', 'user-b'))
  assert.deepEqual(executed, [])
  assert.deepEqual(permissions, [])
  assert.equal(responded.length, 0)

  await bridge.accept(message('weixin-allow-all-2', '允许所有'))
  await first
  assert.deepEqual(executed, [])
  assert.deepEqual(permissions, ['danger-full-access'])
  assert.equal(responded.length, 1)
  assert.equal(responded[0].value.outcome, 'allowed-once')
  assert.match(sent.at(-2).text, /已批准，并已切换当前会话为完全访问/)
  assert.match(sent.at(-1).text, /审批通过后继续执行/)
})

test('dsh-im IM bridges share natural controls and allow-all approvals beyond Weixin', () => {
  const textBridge = readFileSync(resolve(
    harnessRoot,
    'node_modules/@xmanrui/dsh-im/src/channels/shared/text-harness-bridge.mjs',
  ), 'utf8')
  assert.match(textBridge, /SessionControlDispatcher/)
  assert.match(textBridge, /PermissionCommandManager/)
  assert.match(textBridge, /#sessionControls\.isCommand/)
  assert.match(textBridge, /actor: senderId/)
  assert.match(textBridge, /pendingInteraction: this\.\#pendingInteractions\.has\(key\)[\s\S]*this\.\#approvals\.hasPending\(key\)/)
  assert.match(textBridge, /allowAll: async \(\) => \{[\s\S]*setPermission\('danger-full-access'[\s\S]*current\?\.preset !== 'danger-full-access'/)

  const inheritedBridgeFiles = [
    'slack/slack-bridge.mjs',
    'discord/discord-bridge.mjs',
    'telegram/telegram-bridge.mjs',
    'whatsapp/whatsapp-bridge.mjs',
  ]
  for (const file of inheritedBridgeFiles) {
    const source = readFileSync(resolve(
      harnessRoot,
      `node_modules/@xmanrui/dsh-im/src/channels/${file}`,
    ), 'utf8')
    assert.match(source, /extends TextHarnessBridge/, `${file} should inherit shared IM controls`)
  }

  const standaloneBridgeFiles = [
    'weixin/weixin-bridge.mjs',
    'dingtalk/dingtalk-bridge.mjs',
    'feishu/bridge.mjs',
    'qq/qq-bridge.mjs',
    'wecom/wecom-bridge.mjs',
  ]
  for (const file of standaloneBridgeFiles) {
    const source = readFileSync(resolve(
      harnessRoot,
      `node_modules/@xmanrui/dsh-im/src/channels/${file}`,
    ), 'utf8')
    assert.match(source, /SessionControlDispatcher/, `${file} should use shared session controls`)
    assert.match(source, /#sessionControls\.isCommand/, `${file} should route natural controls before agent prompts`)
    assert.match(source, /actor:/, `${file} should pass the sender identity into natural controls and approval state`)
    assert.match(source, /pendingInteraction:/, `${file} should block unsafe permission changes while an interaction is pending`)
    assert.match(source, /handleRequested\(interaction, \{[\s\S]*allowAll: async \(\) => \{[\s\S]*setPermission\('danger-full-access'[\s\S]*current\?\.preset !== 'danger-full-access'/, `${file} should support approval reply "允许所有"`)
  }
})

test('IM connection RPC policy pins direct bot and AI Office workspace settings', async () => {
  const bridgeUrl = pathToFileURL(resolve(harnessRoot, 'crawshrimp-product-bridge/lib/index.js'))
  const bridge = await import(`${bridgeUrl.href}?connection-test=${Date.now()}`)
  const registrations = new Map()
  const ctx = {
    connection: {
      rpc: {
        handle(channel, handler) {
          registrations.set(channel, handler)
          return () => registrations.delete(channel)
        },
      },
    },
  }
  bridge.installImConnectionRpcPolicy(ctx, '/crawshrimp/workspace')

  let officePayload
  ctx.connection.rpc.handle('/office', async (_endpoint, payload) => {
    officePayload = payload
    return {
      ok: true,
      value: {
        config: { workspaces: { finance: '/outside/finance' } },
      },
    }
  })
  const office = await registrations.get('/office')('connector.configure', {
    workspaces: { finance: '/outside/finance' },
  })
  assert.deepEqual(officePayload.workspaces, { finance: '/crawshrimp/workspace' })
  assert.deepEqual(office.value.config.workspaces, { finance: '/crawshrimp/workspace' })

  let feishuPayload
  ctx.connection.rpc.handle('/feishu', async (_endpoint, payload) => {
    feishuPayload = payload
    return { ok: true, value: { bot: { workspace: '/outside/feishu' } } }
  })
  const feishu = await registrations.get('/feishu')('bot.workspace.set', {
    botId: 'bot-1',
    workspace: '/outside/feishu',
  })
  assert.equal(feishuPayload.workspace, '/crawshrimp/workspace')
  assert.equal(feishu.value.bot.workspace, '/crawshrimp/workspace')
})

test('IM policy marks IM Sessions, scopes Host registry RPCs, and routes native approvals by default', () => {
  const bridge = readFileSync(resolve(harnessRoot, 'crawshrimp-product-bridge/lib/index.js'), 'utf8')
  assert.match(bridge, /IM_RPC_PREFIXES/)
  assert.match(bridge, /CRAWSHRIMP_IM_SESSION_REGISTRY/)
  assert.match(bridge, /CRAWSHRIMP_WORKSPACE_ROOT/)
  assert.match(bridge, /workspace\.list/)
  assert.match(bridge, /session\.list/)
  assert.match(bridge, /CRAWSHRIMP_IM_REMOTE_APPROVALS/)
  assert.match(bridge, /REMOTE_APPROVAL_DISABLED/)
  assert.match(bridge, /0\|false\|no\|off\|disabled/)
  assert.match(bridge, /ctx\.approval\.request/)
  assert.match(bridge, /approvalDisplayArgumentsFromBody/)
  assert.match(bridge, /DSH_IM_RETURN_FILE/)
  assert.match(bridge, /exec\.arguments/)
})

test('runtime patcher expands dsh-im natural language controls for mobile IM', () => {
  const patcher = readFileSync(resolve(harnessRoot, 'scripts/patch-runtime-dependencies.mjs'), 'utf8')
  assert.match(patcher, /DSH_IM_NATURAL_CONTROLS_PATCH_MARKER/)
  assert.match(patcher, /patchDshImNaturalControls/)
  assert.match(patcher, /patchDshImBundledHost/)
  assert.match(patcher, /patchDshImBundledHostCurrent230/)
  assert.match(patcher, /patchDshImBundledApprovalCurrent230/)
  assert.match(patcher, /patchDshImBundledNaturalModelAliases/)
  assert.match(patcher, /patchDshImBundledSessionPermissionApi/)
  assert.match(patcher, /patchDshImBundledStandaloneBridgeApprovalAllowAll/)
  assert.match(patcher, /patchDshImTextHarnessBridgeSource/)
  assert.match(patcher, /patchDshImWeixinBridgeSource/)
  assert.match(patcher, /patchDshImDingtalkBridgeApprovalAllowAllSource/)
  assert.match(patcher, /patchDshImFeishuBridgeApprovalAllowAllSource/)
  assert.match(patcher, /patchDshImQqBridgeApprovalAllowAllSource/)
  assert.match(patcher, /patchDshImWecomBridgeApprovalAllowAllSource/)
  assert.match(patcher, /text bridge commands/)
  assert.match(patcher, /weixin bridge commands/)
  assert.match(patcher, /dsh-im dingtalk bridge approval allow-all callback/)
  assert.match(patcher, /dsh-im feishu bridge approval allow-all callback/)
  assert.match(patcher, /dsh-im qq bridge approval allow-all callback/)
  assert.match(patcher, /dsh-im wecom bridge approval allow-all callback/)
  assert.match(patcher, /Hce=new Set/)
  assert.match(patcher, /可以切换模型吗/)
  assert.match(patcher, /切换模型到/)
  assert.match(patcher, /换成/)
  assert.match(patcher, /DSH_IM_NATURAL_MODEL_ALIASES_PATCH_MARKER/)
  assert.match(patcher, /deepseekofficialv4pro/)
  assert.match(patcher, /v4pro/)
  assert.match(patcher, /runtime_model/)
  assert.match(patcher, /deepseek-official-v4-pro/)
  assert.match(patcher, /if \(!source\.includes\(DSH_IM_NATURAL_MODEL_ALIASES_PATCH_MARKER\)\)/)
  assert.ok(patcher.includes('^模型(?:切换到|换成|改成|设置为|设为)'))
  assert.match(patcher, /修改审批权限/)
  assert.match(patcher, /审批权限改成/)
  assert.match(patcher, /\/api\/crawshrimp\/session\/permission/)
  assert.match(patcher, /getSessionPermission/)
  assert.match(patcher, /setSessionPermission/)
  assert.match(patcher, /directPreset/)
  assert.match(patcher, /确认切换到完全访问/)
  assert.match(patcher, /继续吧/)
  assert.match(patcher, /执行吧/)
  assert.match(patcher, /APPROVAL_DISPLAY_ARGUMENTS_PATCH_MARKER/)
  assert.match(patcher, /APPROVAL_DISPLAY_ARGUMENTS_TRUNCATION_PATCH_MARKER/)
  assert.match(patcher, /APPROVAL_DISPLAY_ARGUMENTS_MISMATCH_PATCH_MARKER/)
  assert.match(patcher, /patchApprovalDisplayArguments/)
  assert.match(patcher, /payloadArguments/)
  assert.match(patcher, /capPayloadArgumentsText/)
  assert.match(patcher, /dshImApprovalCapPayloadArgs/)
  assert.match(patcher, /cshImApprovalPayloadArgs/)
  assert.match(patcher, /cshPermissionCommand/)
  assert.match(patcher, /actor:e/)
  assert.match(patcher, /arguments: unknown\(\)\.optional/)
})

test('runtime dsh-im bundle carries product model aliases used by mobile commands', () => {
  const bundle = readFileSync(resolve(
    harnessRoot,
    'node_modules/@xmanrui/dsh-im/lib/index.js',
  ), 'utf8')
  assert.match(bundle, /可以切换模型吗/)
  assert.match(bundle, /列出所有模型/)
  assert.match(bundle, /换成/)
  assert.match(bundle, /crawshrimp-dsh-im-natural-model-aliases-v1/)
  assert.match(bundle, /crawshrimp-dsh-im-model-catalog-v1/)
  assert.match(bundle, /listCrawshrimpModelCatalog/)
  assert.match(bundle, /\/api\/crawshrimp\/model-catalog/)
  assert.match(bundle, /抓虾已支持\/已配置模型/)
  assert.match(bundle, /gpt-5/)
  assert.match(bundle, /deepseek-v4-pro/)
  assert.match(bundle, /deepseekofficialv4pro/)
  assert.match(bundle, /v4pro/)
  assert.match(bundle, /runtimeModel/)
  assert.match(bundle, /"deepseekv4pro","crawshrimp-deepseek-official\/deepseek-v4-pro"/)
  assert.doesNotMatch(bundle, /"deepseek-v4-pro","crawshrimp-deepseek-official\/deepseek-v4-pro"/)
  assert.match(bundle, /crawshrimp-deepseek-official\/deepseek-v4-pro/)
  assert.doesNotMatch(bundle, /crawshrimp-deepseek-official\/deepseek-official-v4-pro/)
  assert.doesNotMatch(bundle, /Yce=new Map;function WA/)
  assert.match(bundle, /\/api\/crawshrimp\/session\/permission/)
  assert.match(bundle, /getSessionPermission/)
  assert.match(bundle, /setSessionPermission/)
  assert.match(bundle, /setPermission\("danger-full-access"/)
  assert.doesNotMatch(bundle, /executeCommand\("\/permission/)
  assert.match(bundle, /bundled dingtalk bridge approval/)
  assert.match(bundle, /bundled feishu bridge approval/)
  assert.match(bundle, /bundled qq bridge approval/)
  assert.match(bundle, /bundled wecom bridge approval/)
})

test('staged dsh-im bundle carries mobile approval and natural controls', {
  skip: !existsSync(resolve(
    repoRoot,
    'build-staging/deepseek-harness/node_modules/@xmanrui/dsh-im/lib/index.js',
  )),
}, () => {
  const bundle = readFileSync(resolve(
    repoRoot,
    'build-staging/deepseek-harness/node_modules/@xmanrui/dsh-im/lib/index.js',
  ), 'utf8')
  assert.match(bundle, /crawshrimp-dsh-im-natural-controls-v1/)
  assert.match(bundle, /crawshrimp-approval-display-arguments-v1/)
  assert.match(bundle, /crawshrimp-approval-display-arguments-v2/)
  assert.match(bundle, /crawshrimp-approval-display-arguments-v3/)
  assert.match(bundle, /可以切换模型吗/)
  assert.match(bundle, /列出所有模型/)
  assert.match(bundle, /切换模型到/)
  assert.match(bundle, /换成/)
  assert.match(bundle, /crawshrimp-dsh-im-natural-model-aliases-v1/)
  assert.match(bundle, /crawshrimp-dsh-im-model-catalog-v1/)
  assert.match(bundle, /listCrawshrimpModelCatalog/)
  assert.match(bundle, /\/api\/crawshrimp\/model-catalog/)
  assert.match(bundle, /抓虾已支持\/已配置模型/)
  assert.match(bundle, /gpt-5/)
  assert.match(bundle, /deepseek-v4-pro/)
  assert.match(bundle, /deepseekofficialv4pro/)
  assert.match(bundle, /v4pro/)
  assert.match(bundle, /runtimeModel/)
  assert.match(bundle, /"deepseekv4pro","crawshrimp-deepseek-official\/deepseek-v4-pro"/)
  assert.doesNotMatch(bundle, /"deepseek-v4-pro","crawshrimp-deepseek-official\/deepseek-v4-pro"/)
  assert.match(bundle, /修改审批权限/)
  assert.match(bundle, /审批权限改成/)
  assert.match(bundle, /确认切换到完全访问/)
  assert.match(bundle, /\/api\/crawshrimp\/session\/permission/)
  assert.match(bundle, /getSessionPermission/)
  assert.match(bundle, /setSessionPermission/)
  assert.match(bundle, /setPermission\("danger-full-access"/)
  assert.doesNotMatch(bundle, /executeCommand\("\/permission/)
  assert.match(bundle, /cshImApprovalPayloadArgs/)
  assert.match(bundle, /actor:e/)
  assert.match(bundle, /bundled dingtalk bridge approval/)
  assert.match(bundle, /bundled feishu bridge approval/)
  assert.match(bundle, /bundled qq bridge approval/)
  assert.match(bundle, /bundled wecom bridge approval/)
  assert.ok(
    bundle.includes('抓虾 Harness 需要你的审批')
      || bundle.includes('抓虾 Harness \\u9700\\u8981\\u4F60\\u7684\\u5BA1\\u6279'),
  )
  assert.doesNotMatch(bundle, /if\(!e\|\|ya\(t\?\.callId\)!==e/)
})

test('runtime patcher adds allow-all action to the native DSH approval card', () => {
  const patcher = readFileSync(resolve(harnessRoot, 'scripts/patch-runtime-dependencies.mjs'), 'utf8')
  assert.match(patcher, /DSH_APPROVAL_ALLOW_ALL_PATCH_MARKER/)
  assert.match(patcher, /patchDshApprovalAllowAll/)
  assert.match(patcher, /dsh-client-ui-conversation/)
  assert.match(patcher, /source\.includes\(DSH_IM_APPROVAL_ALLOW_ALL_PATCH_MARKER\)/)
  assert.match(patcher, /replaceAny/)
  assert.match(patcher, /wb="请回复/)
  assert.match(patcher, /function wH\(n,t\)/)
  assert.match(patcher, /this\.#u\.handleRequested/)
  assert.match(patcher, /approval\.allowAll/)
  assert.match(patcher, /允许所有/)
  assert.match(patcher, /Allow all/)
  assert.match(patcher, /flex-wrap:wrap/)
  assert.match(patcher, /runCommand\("\/permission danger-full-access"\)\.then\(\(matched\) => \{[\s\S]*pending\.answer\("allowed-once"\)/)
  assert.match(patcher, /inject: \(sessionId\) => \(\{[\s\S]*runCommand: async \(line\)/)
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
