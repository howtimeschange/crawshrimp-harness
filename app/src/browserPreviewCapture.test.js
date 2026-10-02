const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const source = readFileSync(new URL('./agentBrowser.js', `file://${__filename}`), 'utf8')
function captureHarness() {
  const notifications = [], frames = [], commands = [], streams = new Map()
  const st = { targetId: 'owned', width: 800, height: 600, frameCount: 0, targetUrl: 'https://example.com', ws: {readyState:1} }
  const mode = { fail: false, reject: null, failMetadata: false, readUrl: null }, webContents = { isDestroyed: () => false, send: (name,payload) => (name.endsWith('status') ? notifications : frames).push(payload) }
  st.webContents = webContents
  streams.set('owned',st)
  const updateStreamUrl = vm.runInNewContext(source.slice(source.indexOf('function updateStreamUrl('), source.indexOf('\nfunction dispatchAgentBrowserInput')) + '; updateStreamUrl', { streams })
  let tick
  const body = source.slice(source.indexOf('  st.timer = setInterval(async () => {'),source.indexOf("\n  notify(webContents, 'connected', { url: target.url"))
  vm.runInNewContext(body, { st, streams, actualTid:'owned', webContents, target:{url:'https://example.com'}, WebSocket:{OPEN:1}, FRAME_INTERVAL_MS:800, SCREENSHOT_QUALITY:55,
    setInterval: fn => {tick=fn;return 1}, updateStreamUrl, notify: (wc,state,data)=>notifications.push({state,...data}),
    send: async method => { commands.push(method); if (method === 'Page.getLayoutMetrics' && mode.failMetadata) throw new Error('metadata timeout'); if (method === 'Runtime.evaluate' && mode.readUrl) return mode.readUrl(); if (method==='Page.captureScreenshot') { if(mode.reject) return new Promise((resolve,reject)=>mode.reject(reject)); if(mode.fail) throw new Error('capture timeout'); return {data:'frame'} } return method==='Runtime.evaluate' ? {result:{value:'https://iana.org'}} : {cssVisualViewport:{clientWidth:800,clientHeight:600}} }
  })
  return {tick,mode,st,streams,notifications,frames,commands}
}
test('three consecutive capture failures show one error and a fresh frame clears it without browser actions',async()=>{
  const h=captureHarness();h.mode.fail=true
  await h.tick();await h.tick();assert.equal(h.notifications.length,0)
  await h.tick();await h.tick();assert.equal(h.notifications.length,1);assert.equal(h.notifications[0].state,'error')
  h.mode.fail=false;await h.tick();assert.equal(h.notifications.at(-1).state,'connected');assert.equal(h.frames.length,1);assert.equal(h.st.captureFailures,0)
  assert.ok(h.commands.every(method=>['Page.getLayoutMetrics','Page.captureScreenshot','Runtime.evaluate'].includes(method)))
})
test('late failed capture from a stopped stream cannot overwrite replacement status',async()=>{
  const h=captureHarness();h.st.captureFailures=2;let reject
  h.mode.reject=fn=>reject=fn
  const pending=h.tick();while(!reject) await Promise.resolve()
  h.streams.set('owned',{});reject(new Error('old capture'))
  await pending;assert.equal(h.notifications.length,0);assert.equal(h.frames.length,0)
})
test('compositor streaming keeps the timer for metadata without polling screenshots', async () => {
  const h = captureHarness(); h.st.screencastStarted = true
  h.st.width = 815
  await h.tick(); await h.tick()
  assert.equal(h.st.width, 815, 'layout metrics must not remove a visible scrollbar gutter from input coordinates')
  assert.ok(!h.commands.includes('Page.captureScreenshot'))
  assert.ok(h.commands.includes('Page.getLayoutMetrics'))
  assert.ok(h.commands.includes('Runtime.evaluate'))
  assert.equal(h.st.targetUrl, 'https://iana.org')
  assert.equal(h.notifications.length, 1, 'unchanged URL does not repeatedly publish metadata')
  assert.equal(h.notifications[0].metadataOnly, true)
  assert.equal(h.notifications[0].url, 'https://iana.org')
  assert.equal(h.frames.length, 0, 'address updates must not manufacture a new image')
})
test('late URL reads cannot update a replacement stream or publish metadata', async () => {
  const h = captureHarness(); h.st.screencastStarted = true
  h.streams.set('owned', {})
  await h.tick()
  assert.equal(h.notifications.length, 0); assert.equal(h.st.targetUrl, 'https://example.com')
})
test('static compositor pages recover from metadata errors without another paint', async () => {
  const h = captureHarness(); h.st.screencastStarted = true; h.mode.failMetadata = true
  await h.tick(); await h.tick(); await h.tick()
  assert.equal(h.notifications.at(-1).state, 'error')
  h.mode.failMetadata = false
  await h.tick()
  assert.equal(h.notifications.at(-1).state, 'connected')
  assert.equal(h.st.captureFailures, 0)
  assert.equal(h.frames.length, 0)
  assert.ok(!h.commands.includes('Page.captureScreenshot'))
  await h.tick()
  assert.equal(h.notifications.filter(item => item.state === 'connected').length, 1)
})
test('a successful metadata poll resets consecutive failures before the error threshold', async () => {
  const h = captureHarness(); h.st.screencastStarted = true; h.mode.failMetadata = true
  await h.tick(); await h.tick()
  h.mode.failMetadata = false; await h.tick()
  h.mode.failMetadata = true; await h.tick()
  assert.equal(h.st.captureFailures, 1)
  assert.ok(!h.notifications.some(item => item.state === 'error'))
})
test('late successful metadata recovery cannot mark a replacement connected', async () => {
  const h = captureHarness(); h.st.screencastStarted = true; h.st.captureFailures = 3
  let finish
  h.mode.readUrl = () => new Promise(resolve => { finish = resolve })
  const pending = h.tick(); while (!finish) await Promise.resolve()
  h.streams.set('owned', {})
  finish({ result: { value: 'https://iana.org' } }); await pending
  assert.equal(h.notifications.length, 0)
})
test('screencast acknowledges late frames but only publishes the currently owned target', async () => {
  const sent = [], frames = [], streams = new Map()
  const st = { targetId: 'owned', targetUrl: 'https://example.com', width: 1200, height: 900, send: async (method, params) => sent.push([method, params]) }
  const webContents = { isDestroyed: () => false, send: (_, frame) => frames.push(frame) }
  streams.set('owned', st)
  const body = source.slice(source.indexOf('function publishScreencastFrame'), source.indexOf('\nfunction dispatchAgentBrowserInput'))
  const publish = vm.runInNewContext(body + '; publishScreencastFrame', { streams, Date })
  publish(st, webContents, { sessionId: 12, data: 'jpeg', metadata: { deviceWidth: 1200, deviceHeight: 900, pageScaleFactor: 1, offsetTop: 0 } })
  assert.equal(frames.length, 1); assert.equal(frames[0].width, 1200); assert.equal(frames[0].targetId, 'owned')
  streams.set('owned', {})
  publish(st, webContents, { sessionId: 13, data: 'late' })
  assert.equal(frames.length, 1); assert.equal(sent.length, 2)
  assert.equal(sent[1][0], 'Page.screencastFrameAck'); assert.equal(sent[1][1].sessionId, 13)
})
test('closed or failed old websocket cannot mark a replacement disconnected',()=>{
  const notifications=[],st={},ws={},streams=new Map([['owned',st]])
  const body=source.slice(source.indexOf('  const ownsStream ='),source.indexOf('\n  const send ='))
  vm.runInNewContext(body,{st,ws,streams,actualTid:'owned',startKey:'owned',startingSockets:new Map(),pending:new Map(),webContents:{},clearTimeout(){},clearInterval(){},notify:(_,state)=>notifications.push(state)})
  streams.set('owned',{});ws.onerror();ws.onclose();assert.deepEqual(notifications,[]);assert.equal(streams.size,1)
})
