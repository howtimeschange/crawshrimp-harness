const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const source = readFileSync(new URL('./agentBrowser.js', `file://${__filename}`), 'utf8')
function captureHarness() {
  const notifications = [], frames = [], commands = [], streams = new Map()
  const st = { width: 800, height: 600, frameCount: 0, targetUrl: 'https://example.com', ws: {readyState:1} }
  const mode = { fail: false, reject: null }, webContents = { isDestroyed: () => false, send: (name,payload) => frames.push(payload) }
  streams.set('owned',st)
  let tick
  const body = source.slice(source.indexOf('  st.timer = setInterval(async () => {'),source.indexOf("\n  notify(webContents, 'connected', { url: target.url"))
  vm.runInNewContext(body, { st, streams, actualTid:'owned', webContents, target:{url:'https://example.com'}, WebSocket:{OPEN:1}, FRAME_INTERVAL_MS:800, SCREENSHOT_QUALITY:55,
    setInterval: fn => {tick=fn;return 1}, notify: (wc,state,data)=>notifications.push({state,...data}),
    send: async method => { commands.push(method); if (method==='Page.captureScreenshot') { if(mode.reject) return new Promise((resolve,reject)=>mode.reject(reject)); if(mode.fail) throw new Error('capture timeout'); return {data:'frame'} } return method==='Runtime.evaluate' ? {result:{value:'https://iana.org'}} : {cssVisualViewport:{clientWidth:800,clientHeight:600}} }
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
test('closed or failed old websocket cannot mark a replacement disconnected',()=>{
  const notifications=[],st={},ws={},streams=new Map([['owned',st]])
  const body=source.slice(source.indexOf('  const ownsStream ='),source.indexOf('\n  const send ='))
  vm.runInNewContext(body,{st,ws,streams,actualTid:'owned',startKey:'owned',startingSockets:new Map(),pending:new Map(),webContents:{},clearTimeout(){},clearInterval(){},notify:(_,state)=>notifications.push(state)})
  streams.set('owned',{});ws.onerror();ws.onclose();assert.deepEqual(notifications,[]);assert.equal(streams.size,1)
})
