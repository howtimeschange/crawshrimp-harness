const test = require('node:test')
const assert = require('node:assert/strict')
const { inputCommand, createBrowserInputSession } = require('./browserInput')
const { dispatchAgentBrowserInput } = require('./agentBrowser')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const viewport = { width: 1200, height: 900 }
const mouse = (type, extra = {}) => ({ kind: 'mouse', type, x: 300, y: 240, button: 'left', buttons: 1, ...extra })

test('CDP input allowlist rejects invalid coordinates, arbitrary commands and oversized input', () => {
  for (const event of [mouse('mousePressed', { x: NaN }), mouse('mousePressed', { x: 1200 }), mouse('mousePressed', { y: -1 }), mouse('navigate'), { kind: 'Runtime.evaluate' }, { kind: 'text', text: 'x'.repeat(65537) }, { kind: 'key', type: 'rawKeyDown', key: 'a', code: 'KeyA', command: 'deleteAll' }]) assert.throws(() => inputCommand(event, viewport))
  assert.deepEqual(inputCommand({ kind: 'text', text: '森马云盘🙂' }, viewport), ['Input.insertText', { text: '森马云盘🙂' }])
  assert.equal(inputCommand({ kind: 'wheel', x: 200, y: 300, deltaX: 0, deltaY: 400 }, viewport)[1].type, 'mouseWheel')
  const enter = inputCommand({ kind: 'key', type: 'rawKeyDown', key: 'Enter', code: 'Enter', keyCode: 13 }, viewport)[1]
  assert.equal(enter.type, 'keyDown'); assert.equal(enter.text, '\r')
})
test('inputs retain down/type/up order and are not replayed after a CDP error', async () => {
  const sent = []
  const session = createBrowserInputSession(async (method, params) => { sent.push([method, params]); if (method === 'Input.insertText') throw Error('timeout') }, () => true, () => viewport)
  const down = session.dispatch(mouse('mousePressed'))
  const text = session.dispatch({ kind: 'text', text: 'one' })
  const up = session.dispatch(mouse('mouseReleased', { buttons: 0 }))
  assert.equal((await down).ok, true); assert.equal((await text).ok, false); await up
  assert.deepEqual(sent.map(([m, p]) => p.type || m), ['mousePressed', 'Input.insertText', 'mouseReleased'])
  await session.dispose(); assert.equal(sent.length, 3)
})
test('closing a stream cancels queued work and releases a mouse/modifier already sent', async () => {
  const sent = []; let finish
  const session = createBrowserInputSession(async (method, params) => { sent.push([method, params]); if (params.type === 'rawKeyDown') await new Promise(resolve => finish = resolve) }, () => true, () => viewport)
  await session.dispatch(mouse('mousePressed'))
  await session.dispatch(mouse('mouseMoved', { x: 420, y: 330 }))
  const key = session.dispatch({ kind: 'key', type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', keyCode: 16 })
  await new Promise(resolve => setImmediate(resolve))
  const text = session.dispatch({ kind: 'text', text: 'must not type' })
  const disposed = session.dispose(); finish(); await key; await text; await disposed
  assert.ok(!sent.some(([m]) => m === 'Input.insertText'))
  assert.ok(sent.some(([, p]) => p.type === 'mouseReleased' && p.x === 420 && p.buttons === 0))
  assert.ok(sent.some(([, p]) => p.type === 'keyUp' && p.key === 'Shift' && p.modifiers === 0))
  assert.equal((await session.dispatch(mouse('mousePressed'))).ok, false)
})
test('manual input never falls back to an arbitrary or closed browser page', async () => {
  const wc = { isDestroyed: () => false }
  for (const targetId of ['', 'closed-page']) assert.equal((await dispatchAgentBrowserInput(wc, { targetId, event: mouse('mousePressed') })).ok, false)
})
function ownedTargetHarness() {
  const source = readFileSync(require.resolve('./agentBrowser'), 'utf8')
  const streams = new Map(), sent = [], wc = { isDestroyed: () => false }
  streams.set('owned', { targetId: 'owned', targetUrl: 'https://example.com', webContents: wc, ws: { readyState: 1 }, send: async (method, params) => {
    sent.push([method, params])
    return method === 'Browser.getWindowForTarget' ? { windowId: 42, bounds: { windowState: 'minimized' } } : {}
  }, input: { dispatch: async () => { sent.push(['input']); return { ok: true } } } })
  const body = source.slice(source.indexOf('function dispatchAgentBrowserInput'), source.indexOf('\nfunction stopAgentBrowserStream'))
  const api = vm.runInNewContext(body + '; ({dispatchAgentBrowserInput, showAgentBrowserNative})', { streams, WebSocket: { OPEN: 1 } })
  return { api, wc, sent }
}
test('input and native-window requests reject another renderer even for an existing target', async () => {
  const { api, sent } = ownedTargetHarness(), stranger = { isDestroyed: () => false }
  assert.equal((await api.dispatchAgentBrowserInput(stranger, { targetId: 'owned', event: mouse('mousePressed') })).ok, false)
  assert.equal((await api.showAgentBrowserNative(stranger, 'owned')).ok, false)
  assert.equal(sent.length, 0)
})
test('native-window action restores the same target without navigating or creating a tab', async () => {
  const { api, wc, sent } = ownedTargetHarness()
  const result = await api.showAgentBrowserNative(wc, 'owned')
  assert.equal(result.ok, true); assert.equal(result.targetId, 'owned'); assert.equal(result.windowId, 42)
  assert.deepEqual(sent.map(([method]) => method), ['Browser.getWindowForTarget', 'Browser.setWindowBounds', 'Page.bringToFront'])
  assert.equal(sent[0][1].targetId, 'owned'); assert.equal(sent[1][1].windowId, 42)
})
