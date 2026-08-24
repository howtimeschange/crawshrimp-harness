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
  const settings = readFileSync(resolve(appRoot, 'src/renderer/views/SettingsPage.vue'), 'utf8')
  const slots = readFileSync(resolve(harnessRoot, 'crawshrimp-slots/lib/client.js'), 'utf8')

  assert.match(settings, /id: 'im'/)
  assert.match(settings, /label: 'IM机器人'/)
  assert.match(settings, /children: \[\{ id: 'im-bots', label: '机器人接入'/)
  assert.match(settings, /activePanelId === 'im-bots'/)
  assert.match(settings, /csImSettings/)
  assert.match(settings, /class="im-settings-frame"/)
  assert.match(settings, /远程审批默认关闭/)
  assert.match(settings, /工作区范围已锁定/)
  assert.match(slots, /function openCrawshrimpImSettings\(/)
  assert.match(slots, /csImSettings/)
  assert.match(slots, /\.hHd-Xa_settingsArea[^']*display: contents !important/)
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

test('IM approval guard rejects registered remote Sessions unless explicitly enabled', async () => {
  const bridgeUrl = pathToFileURL(resolve(harnessRoot, 'crawshrimp-product-bridge/lib/index.js'))
  const bridge = await import(`${bridgeUrl.href}?approval-test=${Date.now()}`)
  const approval = {
    decide: async () => 'allowed-once',
  }
  const registry = new Set(['im-session'])
  bridge.installImApprovalGuard(approval, registry, { CRAWSHRIMP_IM_REMOTE_APPROVALS: '' })
  assert.equal(await approval.decide({ agent: { session: { id: 'im-session' } } }, {}), 'rejected')
  assert.equal(await approval.decide({ agent: { session: { id: 'local-session' } } }, {}), 'allowed-once')
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

test('IM policy marks IM Sessions, scopes Host registry RPCs, and rejects remote MCP approvals by default', () => {
  const bridge = readFileSync(resolve(harnessRoot, 'crawshrimp-product-bridge/lib/index.js'), 'utf8')
  assert.match(bridge, /IM_RPC_PREFIXES/)
  assert.match(bridge, /CRAWSHRIMP_IM_SESSION_REGISTRY/)
  assert.match(bridge, /CRAWSHRIMP_WORKSPACE_ROOT/)
  assert.match(bridge, /workspace\.list/)
  assert.match(bridge, /session\.list/)
  assert.match(bridge, /CRAWSHRIMP_IM_REMOTE_APPROVALS/)
  assert.match(bridge, /REMOTE_APPROVAL_DISABLED/)
  assert.match(bridge, /DSH_IM_RETURN_FILE/)
  assert.match(bridge, /exec\.arguments/)
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
