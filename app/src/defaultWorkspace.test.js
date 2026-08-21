const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')
const vm = require('node:vm')

const clientBundle = resolve(__dirname, '../../integrations/deepseek-harness/crawshrimp-slots/lib/client.js')

function loadWorkspaceInitializer(logs = []) {
  let declaration
  const sandbox = {
    clearTimeout,
    console: {
      error: (...args) => logs.push(['error', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
    },
    setTimeout,
    window: {
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
  assert.equal(typeof module.ensureDefaultWorkspace, 'function')
  return module.ensureDefaultWorkspace
}

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

function fakeContext({ ready = false, items = [], current } = {}) {
  const workspaceList = snapshotStore({ baselinesReady: ready, items })
  const sessionList = snapshotStore({ current })
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

test('browse picker backend accepts drive-qualified Windows paths and rejects ambiguous roots', async () => {
  const browseModule = resolve(
    __dirname,
    '../../integrations/deepseek-harness/node_modules/@deepseek-ai/dsh-host-directory-picker-browse/lib/index.js',
  )
  const { fullyQualified } = await import(pathToFileURL(browseModule).href)

  assert.equal(fullyQualified('C:\\', 'win32'), true)
  assert.equal(fullyQualified('D:\\projects\\crawshrimp', 'win32'), true)
  assert.equal(fullyQualified('\\\\server\\share\\workspace', 'win32'), true)
  assert.equal(fullyQualified('\\workspace', 'win32'), false)
  assert.equal(fullyQualified('D:relative', 'win32'), false)
})
