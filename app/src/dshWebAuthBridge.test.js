'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { createDshWebAuthBridge, exchangeLaunchCookie } = require('./dshWebAuthBridge')

const launch = 'http://127.0.0.1:19066/?token=test-token'
const snapshot = { state: 'ready', web_launch_url: launch }
function fixture(exchange = async () => ({ cookie: 'dsh-auth-test=credential', expiresAt: Date.now() + 120000 })) {
  let listener
  const mainFrame = { url: 'file:///app/index.html', parent: null }
  const frame = { url: 'http://127.0.0.1:19066/', parent: mainFrame }
  const contents = { id: 42, mainFrame, isDestroyed: () => false }
  const bridge = createDshWebAuthBridge({
    session: { webRequest: { onBeforeSendHeaders: (filter, handler) => { listener = handler } } },
    getWebContents: () => contents,
    isTrustedRendererUrl: url => url === mainFrame.url,
    exchange,
  })
  return { bridge, frame, request(overrides = {}) {
    let result
    listener({ url: frame.url, webContentsId: 42, frame, resourceType: 'xhr', requestHeaders: {}, ...overrides }, value => { result = value })
    return result
  } }
}

test('authenticates the shell iframe, API and websocket without exposing the launch token', async () => {
  const f = fixture()
  assert.deepEqual(await f.bridge.prepare(snapshot), { state: 'ready', web_launch_url: 'http://127.0.0.1:19066/' })
  for (const request of [{ resourceType: 'subFrame' }, {}, { resourceType: 'webSocket', url: 'ws://127.0.0.1:19066/events' }]) {
    assert.equal(f.request(request).requestHeaders.Cookie, 'dsh-auth-test=credential')
  }
  assert.equal(f.request({ requestHeaders: { cookie: 'other=keep; dsh-auth-test=stale' } }).requestHeaders.Cookie, 'other=keep; dsh-auth-test=credential')
})

test('never supplies credentials to other windows, ports, hosts, top-level navigation or untrusted frames', async () => {
  const f = fixture()
  await f.bridge.prepare(snapshot)
  const evil = { url: 'https://example.com/', parent: f.frame.parent }
  for (const request of [
    { webContentsId: 43 }, { url: 'http://127.0.0.1:19067/' }, { url: 'https://example.com/' },
    { resourceType: 'mainFrame' }, { frame: null }, { frame: evil },
    { resourceType: 'subFrame', frame: { url: '', parent: evil } },
    { frame: { url: f.frame.url, parent: evil } },
  ]) assert.deepEqual(f.request(request), {})
})

test('coalesces exchanges and removes old credentials when the runtime changes or stops', async () => {
  let calls = 0
  const f = fixture(async () => { calls++; return { cookie: `dsh-auth-test=value${calls}`, expiresAt: Date.now() + 120000 } })
  await Promise.all([f.bridge.prepare(snapshot), f.bridge.prepare(snapshot)])
  await f.bridge.prepare(snapshot)
  assert.equal(calls, 1)
  await f.bridge.prepare({ ...snapshot, web_launch_url: launch.replace('test-token', 'next-token') })
  assert.equal(f.request().requestHeaders.Cookie, 'dsh-auth-test=value2')
  await f.bridge.prepare({ state: 'stopped' })
  assert.deepEqual(f.request(), {})
})

test('a late exchange cannot re-enable credentials after stop or disposal', async () => {
  for (const action of ['stop', 'dispose']) {
    let resolve
    const f = fixture(() => new Promise(done => { resolve = done }))
    const pending = f.bridge.prepare(snapshot)
    if (action === 'stop') await f.bridge.prepare({ state: 'stopped' })
    else f.bridge.dispose()
    resolve({ cookie: 'dsh-auth-test=late', expiresAt: Date.now() + 120000 })
    await assert.rejects(pending, /已切换/)
    if (action === 'stop') assert.deepEqual(f.request(), {})
  }
})

test('rejects non-loopback launch URLs and retries a failed exchange', async () => {
  let calls = 0
  const f = fixture(async () => {
    if (++calls === 1) throw new Error('offline')
    return { cookie: 'dsh-auth-test=credential', expiresAt: Date.now() + 120000 }
  })
  for (const url of ['https://example.com/?token=x', 'http://localhost:19066/?token=x', 'http://127.0.0.1:19066/', 'http://u:p@127.0.0.1:19066/?token=x']) {
    await assert.rejects(f.bridge.prepare({ ...snapshot, web_launch_url: url }), /地址无效/)
  }
  assert.equal(calls, 0)
  await assert.rejects(f.bridge.prepare(snapshot), /offline/)
  await f.bridge.prepare(snapshot)
  assert.equal(calls, 2)
})

test('exchanges a real HTTP redirect without following it, and rejects invalid responses', async t => {
  let requests = 0
  const server = http.createServer((req, res) => {
    requests++
    res.writeHead(req.url.includes('bad') ? 401 : 303, {
      location: '/',
      'set-cookie': 'dsh-auth-test=credential; Max-Age=120; Path=/; HttpOnly; SameSite=Strict',
    }).end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const url = new URL(`http://127.0.0.1:${server.address().port}/?token=test`)
  assert.equal((await exchangeLaunchCookie(url)).cookie, 'dsh-auth-test=credential')
  assert.equal(requests, 1)
  url.search = '?token=bad'
  await assert.rejects(exchangeLaunchCookie(url), /认证失败/)
})
