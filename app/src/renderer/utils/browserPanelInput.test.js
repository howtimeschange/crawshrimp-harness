import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { createBrowserInputQueue } from './browserInput.js'

const require = createRequire(import.meta.url)
const { createBrowserInputSession } = require('../../browserInput.js')
const source = fs.readFileSync(new URL('../components/agent/AgentBrowserPanel.vue', import.meta.url), 'utf8')
function harness() {
  const sent = [], releases = [], watches = []
  let finish
  const backend = createBrowserInputSession(async (_, params) => {
    sent.push(params.type)
    if (params.type === 'mousePressed' || params.type === 'rawKeyDown') await new Promise(resolve => { finish = resolve })
  }, () => true, () => ({ width: 1200, height: 900 }))
  const context = {
    props: { tabId: 'owned' }, window: { cs: { sendAgentBrowserInput: (id, event) => {
      if (event.kind === 'release') releases.push(id)
      return backend.dispatch(event)
    } } }, document: { hidden: false }, canInteract: { value: true }, inputError: { value: '' },
    inputSink: { value: { value: '', focus() {}, blur() { context.releaseBrowserInput() } } },
    frameImage: { value: {} }, displayedFrame: { value: {} }, frame: { value: null }, frameUrl: { value: '' },
    statusState: { value: 'connected' }, statusMessage: { value: '' }, offPreview: null,
    pointer: null, lastClick: null, composing: false, compositionCommit: '', remoteKeys: new Set(),
    createBrowserInputQueue, browserPoint: () => ({ x: 100, y: 100 }), browserButton: () => 'left', browserModifiers: () => 0,
    safelySetPointerCapture() {}, safelyReleasePointerCapture() {}, watch: (_, fn) => watches.push(fn), setTimeout,
  }
  vm.createContext(context)
  vm.runInContext(source.slice(source.indexOf('let inputQueue = makeInputQueue()'), source.indexOf('\nwatch(() => props.minimizeSignal')), context)
  return { context, sent, releases, watches, finish: () => finish() }
}
const mouse = { button: 0, pointerId: 1, currentTarget: {}, buttons: 1, timeStamp: 1, preventDefault() {} }
const key = { key: 'Shift', code: 'ShiftLeft', keyCode: 16, preventDefault() {} }
const settle = () => new Promise(resolve => setImmediate(resolve))

for (const kind of ['mouse', 'key']) test(`hidden panel releases delayed ${kind} down after local up emptied held state`, async () => {
  const h = harness(), c = h.context
  if (kind === 'mouse') c.onBrowserPointerDown(mouse); else c.onBrowserKeyDown(key)
  await settle()
  if (kind === 'mouse') c.onBrowserPointerUp({ ...mouse, buttons: 0 }); else c.onBrowserKeyUp(key)
  c.canInteract.value = false; h.watches.at(-1)(false)
  h.finish(); await settle()
  assert.deepEqual(h.sent, kind === 'mouse' ? ['mousePressed', 'mouseReleased'] : ['rawKeyDown', 'keyUp'])
  assert.deepEqual(h.releases, ['owned'])
})

test('normal pointer capture loss after mouseup does not release held keyboard modifiers', async () => {
  const h = harness(), c = h.context
  c.onBrowserPointerDown(mouse); await settle()
  c.remoteKeys.add('ShiftLeft')
  c.onBrowserPointerUp({ ...mouse, buttons: 0 }); c.onBrowserPointerCaptureLost({ pointerId: 1 })
  h.finish(); await settle()
  assert.deepEqual(h.sent, ['mousePressed', 'mouseReleased'])
  assert.equal(c.remoteKeys.has('ShiftLeft'), true); assert.equal(h.releases.length, 0)
})

test('forced blur discards queued typing and releases in-flight input without replay', async () => {
  const h = harness(), c = h.context
  c.onBrowserKeyDown(key); await settle()
  c.sendBrowserInput({ kind: 'text', text: 'queued' }); c.releaseBrowserInput(true)
  h.finish(); await settle()
  assert.deepEqual(h.sent, ['rawKeyDown', 'keyUp'])
  assert.equal(c.remoteKeys.size, 0)
})

test('target teardown releases only the old target after its in-flight press', async () => {
  const h = harness(), c = h.context
  c.onBrowserPointerDown(mouse); await settle()
  c.props.tabId = 'replacement'; h.watches[0]('replacement', 'owned')
  h.finish(); await settle()
  assert.deepEqual(h.releases, ['owned']); assert.deepEqual(h.sent, ['mousePressed', 'mouseReleased'])
  assert.equal(c.displayedFrame.value, null)
})
