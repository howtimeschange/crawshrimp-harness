const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')

const agentBrowserPath = require.resolve('./agentBrowser')
const nextTick = () => new Promise(resolve => setImmediate(resolve))

function resultFor(method) {
  if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 1200, clientHeight: 900 } }
  if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main-frame' } } }
  if (method === 'Runtime.evaluate') return { result: { value: 'https://example.test/' } }
  return {}
}

function fakeWebSocketClass({ hold = new Set(), fail = new Map() } = {}) {
  return class FakeWebSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSED = 3
    static instances = []
    constructor(url) {
      this.url = url
      this.readyState = FakeWebSocket.CONNECTING
      this.sent = []
      this.answered = new Set()
      this.listeners = new Map()
      FakeWebSocket.instances.push(this)
      setImmediate(() => {
        if (this.readyState !== FakeWebSocket.CONNECTING) return
        this.readyState = FakeWebSocket.OPEN
        this.emit('open')
      })
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set())
      this.listeners.get(type).add(fn)
    }
    removeEventListener(type, fn) {
      this.listeners.get(type)?.delete(fn)
    }
    emit(type, event = {}) {
      if (type === 'message') this.onmessage?.(event)
      if (type === 'close') this.onclose?.(event)
      if (type === 'error') this.onerror?.(event)
      for (const fn of this.listeners.get(type) || []) fn(event)
    }
    send(data) {
      const message = JSON.parse(String(data))
      this.sent.push(message)
      const failure = fail.get(message.method)
      if (failure) {
        setImmediate(() => this.reply(message, null, failure))
      } else if (!hold.has(message.method)) {
        setImmediate(() => this.reply(message, resultFor(message.method)))
      }
    }
    reply(message, result = {}, error = null) {
      if (this.readyState !== FakeWebSocket.OPEN || this.answered.has(message.id)) return
      this.answered.add(message.id)
      this.emit('message', { data: JSON.stringify(error ? { id: message.id, error: { message: error } } : { id: message.id, result }) })
    }
    respond(method, result = {}) {
      const message = this.sent.find(item => item.method === method && !this.answered.has(item.id))
      assert.ok(message, `missing pending ${method}`)
      this.reply(message, result)
    }
    close() {
      if (this.readyState === FakeWebSocket.CLOSED) return
      this.readyState = FakeWebSocket.CLOSED
      this.emit('close')
    }
  }
}

async function withAgentBrowser(options, run) {
  const originalEnv = process.env.CRAWSHRIMP_CDP_PORT
  const originalWebSocket = global.WebSocket
  const FakeWebSocket = fakeWebSocketClass(options)
  const server = http.createServer((req, res) => {
    if (req.url !== '/json') {
      res.writeHead(404).end()
      return
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify([{ id: 'owned', type: 'page', url: 'https://example.test/', title: 'Owned', webSocketDebuggerUrl: 'ws://fake/owned' }]))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.CRAWSHRIMP_CDP_PORT = String(server.address().port)
  global.WebSocket = FakeWebSocket
  delete require.cache[agentBrowserPath]
  const api = require('./agentBrowser')
  try {
    await run(api, FakeWebSocket)
  } finally {
    try { api.stopAgentBrowserStream() } catch {}
    delete require.cache[agentBrowserPath]
    global.WebSocket = originalWebSocket
    if (originalEnv === undefined) delete process.env.CRAWSHRIMP_CDP_PORT
    else process.env.CRAWSHRIMP_CDP_PORT = originalEnv
    await new Promise(resolve => server.close(resolve))
  }
}

function webContents() {
  const messages = []
  return { messages, isDestroyed: () => false, send: (channel, payload) => messages.push([channel, payload]) }
}

async function start(api, wc = webContents()) {
  const result = await api.startAgentBrowserStream(wc, 'owned')
  assert.equal(result.ok, true)
  assert.equal(result.targetId, 'owned')
  return wc
}

test('manual input waits for focus emulation ACK before dispatching the real input command', async () => {
  const hold = new Set()
  await withAgentBrowser({ hold }, async (api, FakeWebSocket) => {
    const wc = await start(api)
    const ws = FakeWebSocket.instances[0]
    hold.add('Emulation.setFocusEmulationEnabled')
    const beforeInput = ws.sent.length
    const pending = api.dispatchAgentBrowserInput(wc, { targetId: 'owned', event: { kind: 'mouse', type: 'mousePressed', x: 100, y: 120, button: 'left', buttons: 1, clickCount: 1 } })
    await nextTick()
    assert.deepEqual(ws.sent.slice(beforeInput).map(item => item.method), ['Emulation.setFocusEmulationEnabled'])
    ws.respond('Emulation.setFocusEmulationEnabled')
    await nextTick()
    assert.deepEqual(ws.sent.slice(beforeInput).map(item => item.method), ['Emulation.setFocusEmulationEnabled', 'Input.dispatchMouseEvent'])
    assert.equal(ws.sent.at(-1).params.type, 'mousePressed')
    assert.equal((await pending).ok, true)
    hold.clear()
  })
})

test('manual input does not send Input.dispatchMouseEvent when focus emulation fails', async () => {
  const fail = new Map()
  await withAgentBrowser({ fail }, async (api, FakeWebSocket) => {
    const wc = await start(api)
    const ws = FakeWebSocket.instances[0]
    fail.set('Emulation.setFocusEmulationEnabled', 'focus denied')
    const beforeInput = ws.sent.length
    const result = await api.dispatchAgentBrowserInput(wc, { targetId: 'owned', event: { kind: 'wheel', x: 100, y: 120, deltaX: 0, deltaY: 80 } })
    assert.equal(result.ok, false)
    assert.match(result.error, /focus denied/)
    assert.deepEqual(ws.sent.slice(beforeInput).map(item => item.method), ['Emulation.setFocusEmulationEnabled'])
  })
})

test('preview startup waits for focus emulation before measuring or casting a background tab', async () => {
  const hold = new Set(['Emulation.setFocusEmulationEnabled'])
  await withAgentBrowser({ hold }, async (api, FakeWebSocket) => {
    const wc = webContents()
    const pending = api.startAgentBrowserStream(wc, 'owned')
    let ws
    for (let attempt = 0; attempt < 50; attempt++) {
      ws = FakeWebSocket.instances[0]
      if (ws?.sent.some(item => item.method === 'Emulation.setFocusEmulationEnabled')) break
      await nextTick()
    }
    assert.deepEqual(ws.sent.map(item => item.method), ['Page.enable', 'Emulation.setFocusEmulationEnabled'])
    ws.respond('Emulation.setFocusEmulationEnabled')
    hold.clear()
    assert.equal((await pending).ok, true)
    const methods = ws.sent.map(item => item.method)
    assert.ok(methods.indexOf('Emulation.setFocusEmulationEnabled') < methods.indexOf('Page.getLayoutMetrics'))
    assert.ok(methods.indexOf('Emulation.setFocusEmulationEnabled') < methods.indexOf('Page.startScreencast'))
    assert.ok(!methods.includes('Page.bringToFront'))
    assert.ok(!methods.includes('Browser.setWindowBounds'))
  })
})

test('release input also reasserts focus emulation before releasing held remote state', async () => {
  await withAgentBrowser({}, async (api, FakeWebSocket) => {
    const wc = await start(api)
    const ws = FakeWebSocket.instances[0]
    assert.equal((await api.dispatchAgentBrowserInput(wc, { targetId: 'owned', event: { kind: 'mouse', type: 'mousePressed', x: 100, y: 120, button: 'left', buttons: 1, clickCount: 1 } })).ok, true)
    const beforeRelease = ws.sent.length
    assert.equal((await api.dispatchAgentBrowserInput(wc, { targetId: 'owned', event: { kind: 'release' } })).ok, true)
    assert.deepEqual(ws.sent.slice(beforeRelease).map(item => item.method), ['Emulation.setFocusEmulationEnabled', 'Input.dispatchMouseEvent'])
    assert.deepEqual(ws.sent.at(-1).params, { x: 100, y: 120, modifiers: 0, button: 'left', buttons: 0, type: 'mouseReleased', clickCount: 1 })
  })
})

test('manual input is limited to the owning renderer and stops after its stream is closed', async () => {
  await withAgentBrowser({}, async (api, FakeWebSocket) => {
    const wc = await start(api)
    const ws = FakeWebSocket.instances[0]
    const beforeRejected = ws.sent.length
    const stranger = { isDestroyed: () => false, send() {} }
    assert.equal((await api.dispatchAgentBrowserInput(stranger, { targetId: 'owned', event: { kind: 'mouse', type: 'mousePressed', x: 100, y: 120, button: 'left', buttons: 1 } })).ok, false)
    assert.equal(ws.sent.length, beforeRejected)
    assert.equal(api.stopAgentBrowserStream('owned').stopped, true)
    const beforeStopped = ws.sent.length
    assert.equal((await api.dispatchAgentBrowserInput(wc, { targetId: 'owned', event: { kind: 'mouse', type: 'mousePressed', x: 100, y: 120, button: 'left', buttons: 1 } })).ok, false)
    assert.equal(ws.sent.length, beforeStopped)
  })
})
