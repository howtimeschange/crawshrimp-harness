const assert = require('node:assert/strict')
const test = require('node:test')
const { pathToFileURL } = require('node:url')
const { resolve } = require('node:path')

const managerUrl = pathToFileURL(resolve(
  __dirname,
  '../../integrations/deepseek-harness/worker/native-web-follow-manager.mjs',
))

function deferred() {
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

function fakeRuntime({ ready = true } = {}) {
  const streams = []
  return {
    streams,
    follow(sessionId, handlers) {
      const gate = deferred()
      const stream = {
        sessionId,
        handlers,
        ready: gate.promise,
        closed: false,
        close() {
          this.closed = true
          gate.reject(new Error('closed'))
        },
        markReady() { gate.resolve() },
      }
      streams.push(stream)
      if (ready) queueMicrotask(() => stream.markReady())
      return stream
    },
  }
}

test('native Web follow refresh preserves existing owners and releases only recovery ownership', async () => {
  const { createNativeWebFollowManager } = await import(`${managerUrl.href}?owners=${Date.now()}`)
  const runtime = fakeRuntime()
  const manager = createNativeWebFollowManager({
    getRuntime: () => runtime,
    activeTurnEvents: (events) => events,
    notify: () => {},
  })

  assert.equal((await manager.observe('web-session', { owner: 'renderer-a' })).state, 'ready')
  const refreshed = await manager.observe('web-session', { refresh: true, owner: 'mcp-recovery' })

  assert.equal(runtime.streams.length, 2)
  assert.equal(runtime.streams[0].closed, true)
  assert.equal(refreshed.owners, 2)
  assert.deepEqual(manager.inspect('web-session').owners, ['mcp-recovery', 'renderer-a'])
  assert.deepEqual(manager.unobserve('web-session', { owner: 'mcp-recovery' }), {
    ok: true, following: true, owners: 1,
  })
  assert.equal(runtime.streams[1].closed, false)
  assert.equal(manager.unobserve('web-session', { owner: 'renderer-a' }).following, false)
  assert.equal(runtime.streams[1].closed, true)
})

test('native Web follow keeps an ownerless active turn until the real turn end', async () => {
  const { createNativeWebFollowManager } = await import(`${managerUrl.href}?active-turn=${Date.now()}`)
  const runtime = fakeRuntime()
  const notifications = []
  const manager = createNativeWebFollowManager({
    getRuntime: () => runtime,
    activeTurnEvents: (events) => events,
    notify: (sessionId, event) => notifications.push({ sessionId, event }),
  })

  await manager.observe('web-session', { owner: 'renderer-a' })
  runtime.streams[0].handlers.onEvent({ type: 'turn/start', data: { turn: 1 }, seq: 10 })
  const released = manager.unobserve('web-session', { owner: 'renderer-a' })

  assert.deepEqual(released, {
    ok: true, following: true, owners: 0, heldForActiveTurn: true,
  })
  assert.equal(runtime.streams[0].closed, false)
  assert.equal(manager.inspect('web-session').turnActive, true)

  runtime.streams[0].handlers.onEvent({
    type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, seq: 11,
  })
  assert.equal(runtime.streams[0].closed, true)
  assert.equal(manager.inspect('web-session'), null)
  assert.deepEqual(notifications.map(({ event }) => event.type), ['turn/start', 'turn/end'])
})

test('runtime teardown interrupts every active native Web shadow turn exactly once', async () => {
  const { createNativeWebFollowManager } = await import(`${managerUrl.href}?teardown=${Date.now()}`)
  const runtime = fakeRuntime()
  const notifications = []
  const manager = createNativeWebFollowManager({
    getRuntime: () => runtime,
    activeTurnEvents: (events) => events,
    notify: (sessionId, event) => notifications.push({ sessionId, event }),
  })

  await manager.observe('active-session', { owner: 'renderer-a' })
  await manager.observe('idle-session', { owner: 'renderer-b' })
  runtime.streams[0].handlers.onEvent({ type: 'turn/start', data: { turn: 7 }, seq: 21 })

  const interrupted = manager.closeAll({
    kind: 'interrupted',
    error: { code: 'RUNTIME_STOPPED', message: 'runtime stopped' },
  })

  assert.deepEqual(interrupted, ['active-session'])
  assert.equal(runtime.streams.every((stream) => stream.closed), true)
  assert.equal(manager.inspect('active-session'), null)
  assert.equal(manager.inspect('idle-session'), null)
  const terminal = notifications.filter(({ event }) => event.type === 'turn/end')
  assert.equal(terminal.length, 1)
  assert.equal(terminal[0].sessionId, 'active-session')
  assert.equal(terminal[0].event.data.reason.kind, 'interrupted')
})

test('a duplicate observer waits for connecting follow readiness and never reports early idempotent success', async () => {
  const { createNativeWebFollowManager } = await import(`${managerUrl.href}?connecting=${Date.now()}`)
  const runtime = fakeRuntime({ ready: false })
  const manager = createNativeWebFollowManager({
    getRuntime: () => runtime,
    activeTurnEvents: (events) => events,
    notify: () => {},
  })

  let secondSettled = false
  const first = manager.observe('web-session', { owner: 'renderer-a' })
  const second = manager.observe('web-session', { owner: 'renderer-b' }).then((value) => {
    secondSettled = true
    return value
  })
  await Promise.resolve()
  assert.equal(secondSettled, false)
  runtime.streams[0].markReady()

  assert.equal((await first).state, 'ready')
  assert.deepEqual(await second, {
    ok: true, following: true, idempotent: true, state: 'ready', owners: 2,
  })
})
