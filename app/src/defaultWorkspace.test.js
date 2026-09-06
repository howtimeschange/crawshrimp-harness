const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')
const vm = require('node:vm')

const clientBundle = resolve(__dirname, '../../integrations/deepseek-harness/crawshrimp-slots/lib/client.js')

function loadSlotsClient({ logs = [], search = '' } = {}) {
  let declaration
  const shellMessages = []
  const listeners = new Map()
  const parent = {
    postMessage(message, origin) {
      shellMessages.push({ message, origin })
    },
  }
  const sandbox = {
    clearTimeout,
    console: {
      error: (...args) => logs.push(['error', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
    },
    setTimeout,
    URLSearchParams,
    window: {
      location: { search },
      parent,
      addEventListener(type, listener) {
        listeners.set(type, listener)
      },
      removeEventListener(type, listener) {
        if (listeners.get(type) === listener) listeners.delete(type)
      },
      __ModuleLoader__: {
        load(value) { declaration = value },
      },
    },
  }
  vm.runInNewContext(readFileSync(clientBundle, 'utf8'), sandbox, { filename: clientBundle })
  assert.equal(declaration?.id, 'crawshrimp-slots')
  const module = declaration.factory((name) => {
    if (name === 'react') return {}
    throw new Error(`unexpected client dependency: ${name}`)
  })
  return {
    module,
    shellMessages,
    dispatchFromShell(data) {
      const listener = listeners.get('message')
      assert.equal(typeof listener, 'function', 'slots client must subscribe to Shell messages')
      listener({ source: parent, origin: 'http://shell.test', data })
    },
  }
}

function loadWorkspaceInitializer(logs = []) {
  const client = loadSlotsClient({ logs })
  assert.equal(typeof client.module.ensureDefaultWorkspace, 'function')
  return client.module.ensureDefaultWorkspace
}

test('Crawshrimp preset copy distinguishes the recommended product mode from upstream developer modes', () => {
  const client = loadSlotsClient()
  assert.equal(typeof client.module.agentPresetDisplayCopy, 'function')

  const recommended = client.module.agentPresetDisplayCopy('crawshrimp-standard')
  assert.deepEqual({ id: recommended.id, name: recommended.name, description: recommended.description }, {
    id: 'crawshrimp-standard',
    name: '抓虾工作模式（推荐）',
    description: '适合日常抓虾任务：脚本、附件与数据分析、实时浏览器、文件、AI 内容、计划和子代理均可使用；涉及改动时仍会请求确认。',
  })
  const standard = client.module.agentPresetDisplayCopy('标准模式')
  assert.deepEqual({ id: standard.id, name: standard.name, description: standard.description }, {
    id: 'standard',
    name: '通用开发模式',
    description: 'DSH 上游的完整开发模式，不是抓虾专用；适合通用代码与文件任务，抓虾日常工作推荐使用「抓虾工作模式」。',
  })
  const ptc = client.module.agentPresetDisplayCopy('PTC 模式')
  assert.deepEqual({ id: ptc.id, name: ptc.name, description: ptc.description }, {
    id: 'ptc',
    name: '开发者编排模式',
    description: 'DSH 上游高级模式，不是抓虾专用；面向需要用 TypeScript 编排多步工具调用的开发者，日常任务不推荐。',
  })
  assert.equal(client.module.agentPresetDisplayCopy('不存在的模式'), undefined)
})

function snapshotStore(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

function fakeContext({ ready = false, sessionReady = ready, rc1Phases = false, items = [], current } = {}) {
  const workspaceList = snapshotStore(rc1Phases
    ? { phase: ready ? 'ready' : 'waiting', items }
    : { baselinesReady: ready, items })
  const sessionList = snapshotStore(rc1Phases
    ? { phase: sessionReady ? 'ready' : 'waiting', current }
    : { current })
  const createCalls = []
  const connectCalls = []
  const openCalls = []
  const ctx = {
    workspaces: {
      list: workspaceList,
      async create(input) {
        createCalls.push(input)
        const workspace = {
          workspaceId: 'workspace-default',
          path: input.path,
          title: 'default',
          sessionIds: [],
        }
        workspaceList.set({ ...workspaceList.getSnapshot(), items: [workspace] })
        return workspace
      },
    },
    uiWorkspace: {
      async connectWorkspace(workspaceId) {
        connectCalls.push(workspaceId)
        return 'session-default'
      },
    },
    sessions: {
      list: sessionList,
      open(sessionId) {
        openCalls.push(sessionId)
        sessionList.set({ ...sessionList.getSnapshot(), current: sessionId })
      },
    },
  }
  return { ctx, workspaceList, sessionList, createCalls, connectCalls, openCalls }
}

test('default workspace waits for baselines, creates with { path }, reads back, and opens its session', async () => {
  const ensureDefaultWorkspace = loadWorkspaceInitializer()
  const fixture = fakeContext()
  const root = 'C:\\'

  const completion = ensureDefaultWorkspace(fixture.ctx, root, { retryDelaysMs: [0], timeoutMs: 500 })
  assert.equal(fixture.createCalls.length, 0)

  fixture.workspaceList.set({ baselinesReady: true, items: [] })
  const result = await completion

  assert.equal(result.status, 'created')
  assert.equal(result.workspaceId, 'workspace-default')
  assert.equal(result.sessionId, 'session-default')
  assert.equal(fixture.createCalls.length, 1)
  assert.deepEqual(Object.keys(fixture.createCalls[0]), ['path'])
  assert.equal(fixture.createCalls[0].path, root)
  assert.deepEqual(fixture.connectCalls, ['workspace-default'])
  assert.deepEqual(fixture.openCalls, ['session-default'])
  assert.equal(fixture.sessionList.getSnapshot().current, 'session-default')
})

test('default workspace waits for both rc.1 phase snapshots before creating and selecting a session', async () => {
  const ensureDefaultWorkspace = loadWorkspaceInitializer()
  const fixture = fakeContext({ ready: true, sessionReady: false, rc1Phases: true })

  const completion = ensureDefaultWorkspace(fixture.ctx, 'C:\\rc1-runtime', { retryDelaysMs: [0], timeoutMs: 500 })
  assert.equal(fixture.createCalls.length, 0)

  fixture.sessionList.set({ ...fixture.sessionList.getSnapshot(), phase: 'ready' })
  const result = await completion

  assert.equal(result.status, 'created')
  assert.equal(fixture.createCalls.length, 1)
  assert.equal(fixture.createCalls[0].path, 'C:\\rc1-runtime')
  assert.deepEqual(fixture.connectCalls, ['workspace-default'])
  assert.deepEqual(fixture.openCalls, ['session-default'])
})

test('default workspace uses rc.1 uiWorkspace navigation rather than the raw workspace controller', async () => {
  const ensureDefaultWorkspace = loadWorkspaceInitializer()
  const fixture = fakeContext({ ready: true, rc1Phases: true })

  assert.equal(fixture.ctx.workspaces.connectWorkspace, undefined)
  const result = await ensureDefaultWorkspace(fixture.ctx, 'C:\\rc1-ui-workspace', { retryDelaysMs: [0], timeoutMs: 500 })

  assert.equal(result.status, 'created')
  assert.deepEqual(fixture.connectCalls, ['workspace-default'])
  assert.deepEqual(fixture.openCalls, ['session-default'])
})

test('default workspace leaves an existing workspace untouched', async () => {
  const ensureDefaultWorkspace = loadWorkspaceInitializer()
  const existing = { workspaceId: 'workspace-existing', path: 'D:\\work' }
  const fixture = fakeContext({ ready: true, items: [existing] })

  const result = await ensureDefaultWorkspace(fixture.ctx, 'C:\\runtime', { timeoutMs: 500 })

  assert.equal(result.status, 'existing')
  assert.equal(result.workspaceId, 'workspace-existing')
  assert.equal(fixture.createCalls.length, 0)
  assert.equal(fixture.connectCalls.length, 0)
  assert.equal(fixture.openCalls.length, 0)
})

test('default workspace retries a transient create failure and then completes', async () => {
  const logs = []
  const ensureDefaultWorkspace = loadWorkspaceInitializer(logs)
  const fixture = fakeContext({ ready: true })
  const realCreate = fixture.ctx.workspaces.create
  let attempts = 0
  fixture.ctx.workspaces.create = async (input) => {
    attempts += 1
    if (attempts === 1) throw new Error('transport not ready')
    return realCreate(input)
  }

  const result = await ensureDefaultWorkspace(fixture.ctx, 'D:\\runtime', {
    retryDelaysMs: [0],
    timeoutMs: 500,
  })

  assert.equal(result.status, 'created')
  assert.equal(attempts, 2)
  assert.ok(logs.some(([level, message]) => level === 'warn' && /attempt 1\/2 failed/.test(message)))
})

test('default workspace reports a bounded permanent failure instead of swallowing it', async () => {
  const logs = []
  const ensureDefaultWorkspace = loadWorkspaceInitializer(logs)
  const fixture = fakeContext({ ready: true })
  fixture.ctx.workspaces.create = async () => { throw new Error('workspace-invalid-path') }

  const result = await ensureDefaultWorkspace(fixture.ctx, 'D:\\missing', {
    retryDelaysMs: [0],
    timeoutMs: 500,
  })

  assert.equal(result.status, 'failed')
  assert.equal(result.error, 'workspace-invalid-path')
  assert.ok(logs.some(([level, message]) => level === 'error' && /failed after 2 attempts/.test(message)))
})

test('a late create result after timeout never opens a stale workspace session', async () => {
  const ensureDefaultWorkspace = loadWorkspaceInitializer()
  const fixture = fakeContext({ ready: true })
  let resolveCreate
  fixture.ctx.workspaces.create = () => new Promise((resolve) => { resolveCreate = resolve })

  const completion = ensureDefaultWorkspace(fixture.ctx, 'D:\\slow', {
    retryDelaysMs: [],
    timeoutMs: 10,
  })
  const result = await completion
  assert.equal(result.status, 'failed')
  assert.match(result.error, /did not complete before timeout/)

  resolveCreate({ workspaceId: 'workspace-late', path: 'D:\\slow' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(fixture.connectCalls.length, 0)
  assert.equal(fixture.openCalls.length, 0)
})

test('slots readiness replays the default workspace after the Shell listener is installed', async () => {
  const client = loadSlotsClient()
  const fixture = fakeContext({ ready: true })

  assert.equal(typeof client.module.installShellMessageBridge, 'function')
  const dispose = client.module.installShellMessageBridge(fixture.ctx)
  assert.equal(client.shellMessages.length, 1)
  assert.equal(client.shellMessages[0].message.__crawshrimp, 'workspace-ready')
  assert.equal(client.shellMessages[0].origin, '*')

  client.dispatchFromShell({ __crawshrimp: 'workspace', root: 'C:\\crawshrimp-runtime' })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(fixture.createCalls.length, 1)
  assert.equal(fixture.createCalls[0].path, 'C:\\crawshrimp-runtime')
  assert.deepEqual(fixture.connectCalls, ['workspace-default'])
  assert.deepEqual(fixture.openCalls, ['session-default'])
  dispose()
})

test('a Shell-provided no-model state survives the rc.1 redirect and composer activation asks for Crawshrimp configuration', () => {
  const client = loadSlotsClient()
  const fixture = fakeContext({ ready: true, rc1Phases: true })
  client.module.installShellMessageBridge(fixture.ctx)
  client.dispatchFromShell({ __crawshrimp: 'runtime-model-configuration', apiKeyConfigured: false })
  client.shellMessages.splice(0)
  const event = {
    target: {
      closest(selector) {
        return selector === '.wSkVaW_composerSeat' ? {} : null
      },
    },
    preventDefault() { this.prevented = true },
    stopPropagation() { this.stopped = true },
    stopImmediatePropagation() { this.immediatelyStopped = true },
  }

  assert.equal(typeof client.module.requestLlmConfigFromComposer, 'function')
  client.module.requestLlmConfigFromComposer(event)

  assert.equal(event.prevented, true)
  assert.equal(event.stopped, true)
  assert.equal(event.immediatelyStopped, true)
  assert.equal(client.shellMessages.length, 1)
  assert.equal(client.shellMessages[0].message.__crawshrimp, 'llm-config-request')
  assert.equal(client.shellMessages[0].message.source, 'composer')
  assert.equal(client.shellMessages[0].origin, '*')
})

test('no-model composer gating leaves mode, workspace, and model picker controls interactive', () => {
  const client = loadSlotsClient()
  const fixture = fakeContext({ ready: true, rc1Phases: true })
  client.module.installShellMessageBridge(fixture.ctx)
  client.dispatchFromShell({ __crawshrimp: 'runtime-model-configuration', apiKeyConfigured: false })
  client.shellMessages.splice(0)
  const event = {
    target: {
      closest(selector) {
        if (selector === '.wSkVaW_composerSeat') return {}
        if (selector.includes('button')) return {}
        return null
      },
    },
    preventDefault() { this.prevented = true },
    stopPropagation() { this.stopped = true },
    stopImmediatePropagation() { this.immediatelyStopped = true },
  }

  client.module.requestLlmConfigFromComposer(event)

  assert.equal(event.prevented, undefined)
  assert.equal(event.stopped, undefined)
  assert.equal(event.immediatelyStopped, undefined)
  assert.equal(client.shellMessages.length, 0)
})

test('text-only composer paste remains available to DSH instead of being consumed by image routing', () => {
  const client = loadSlotsClient()
  const event = {
    target: {
      closest(selector) {
        return selector === '.wSkVaW_composerSeat' ? {} : null
      },
    },
    clipboardData: {
      items: [{ kind: 'string', type: 'text/plain' }],
    },
    preventDefault() { this.prevented = true },
    stopPropagation() { this.stopped = true },
    stopImmediatePropagation() { this.immediatelyStopped = true },
  }

  assert.equal(typeof client.module.handlePasteAttachments, 'function')
  client.module.handlePasteAttachments(event)

  assert.equal(event.prevented, undefined)
  assert.equal(event.stopped, undefined)
  assert.equal(event.immediatelyStopped, undefined)
})

test('browse picker backend accepts drive-qualified Windows paths and rejects ambiguous roots', async () => {
  const browseModule = resolve(
    __dirname,
    // The direct dsh-web-app dependency hoists the Web Host closure to the
    // product runtime root, where Cordis resolves profile plugins.
    '../../integrations/deepseek-harness/node_modules/@deepseek-ai/dsh-host-directory-picker-browse/lib/index.js',
  )
  const { fullyQualified } = await import(pathToFileURL(browseModule).href)

  assert.equal(fullyQualified('C:\\', 'win32'), true)
  assert.equal(fullyQualified('D:\\projects\\crawshrimp', 'win32'), true)
  assert.equal(fullyQualified('\\\\server\\share\\workspace', 'win32'), true)
  assert.equal(fullyQualified('\\workspace', 'win32'), false)
  assert.equal(fullyQualified('D:relative', 'win32'), false)
})
