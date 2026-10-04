import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { createBrowserInputQueue } from './browserInput.js'

const require = createRequire(import.meta.url)
const { createBrowserInputSession } = require('../../browserInput.js')
const source = fs.readFileSync(new URL('../components/agent/AgentBrowserPanel.vue', import.meta.url), 'utf8')
function harness(options = {}) {
  const sent = [], sentWithTarget = [], releases = [], releasedCaptures = [], watches = []
  const sessions = new Map()
  let finish, rejectHeldFailure
  let failNextInput = false
  let holdNextFailure = false
  const sessionFor = id => {
    if (!sessions.has(id)) sessions.set(id, createBrowserInputSession(async (_, params) => {
      sentWithTarget.push(`${id}:${params.type}`)
      sent.push(params.type)
      if (failNextInput) { failNextInput = false; throw new Error(options.failMessage || 'CDP 命令超时: Input.dispatchMouseEvent') }
      if (holdNextFailure) {
        holdNextFailure = false
        await new Promise((_, reject) => { rejectHeldFailure = () => reject(new Error(options.failMessage || 'CDP 命令超时: Input.dispatchMouseEvent')) })
      }
      if (params.type === 'mousePressed' || params.type === 'rawKeyDown') await new Promise(resolve => { finish = resolve })
    }, () => true, () => ({ width: 1200, height: 900 })))
    return sessions.get(id)
  }
  const context = {
    props: { tabId: 'owned' }, window: { cs: { sendAgentBrowserInput: (id, event) => {
      if (event.kind === 'release') releases.push(id)
      return sessionFor(id).dispatch(event)
    } } }, document: { hidden: false }, canInteract: { value: true }, inputError: { value: '' },
    inputSink: { value: { value: '', focus() {}, blur() { context.releaseBrowserInput() } } },
    frameImage: { value: {} }, displayedFrame: { value: {} }, frame: { value: null }, frameUrl: { value: '' },
    statusState: { value: 'connected' }, statusMessage: { value: '' }, offPreview: null,
    pointer: null, lastClick: null, composing: false, compositionCommit: '', remoteKeys: new Set(),
    createBrowserInputQueue, browserPoint: () => ({ x: 100, y: 100 }), browserButton: () => 'left', browserModifiers: () => 0,
    safelySetPointerCapture() {}, safelyReleasePointerCapture(_, id) { releasedCaptures.push(id) }, watch: (_, fn) => watches.push(fn), setTimeout,
  }
  vm.createContext(context)
  vm.runInContext(source.slice(source.indexOf('let inputQueue = makeInputQueue()'), source.indexOf('\nwatch(() => props.minimizeSignal')), context)
  return { context, sent, sentWithTarget, releases, releasedCaptures, watches, finish: () => finish?.(), failNextInput: () => { failNextInput = true }, holdNextFailure: () => { holdNextFailure = true }, rejectHeldFailure: () => rejectHeldFailure?.() }
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

test('unconfirmed mouse input clears local held state without replaying queued input', async () => {
  const h = harness(), c = h.context
  h.failNextInput()
  c.onBrowserPointerDown(mouse)
  c.remoteKeys.add('ShiftLeft'); c.composing = true
  c.inputSink.value.value = 'draft'
  c.sendBrowserInput({ kind: 'text', text: 'queued' })
  await settle()
  assert.deepEqual(h.sent, ['mousePressed', 'mouseReleased'])
  assert.deepEqual(h.releases, ['owned'])
  assert.deepEqual(h.releasedCaptures, [1])
  assert.equal(c.pointer, null)
  assert.equal(c.remoteKeys.size, 0)
  assert.equal(c.composing, false)
  assert.equal(c.inputSink.value.value, '')
  assert.match(c.inputError.value, /浏览器输入未确认/)
})

test('target teardown releases only the old target after its in-flight press', async () => {
  const h = harness(), c = h.context
  c.onBrowserPointerDown(mouse); await settle()
  c.props.tabId = 'replacement'; h.watches[0]('replacement', 'owned')
  h.finish(); await settle()
  assert.deepEqual(h.releases, ['owned']); assert.deepEqual(h.sent, ['mousePressed', 'mouseReleased'])
  assert.equal(c.displayedFrame.value, null)
})

test('late failure from old target does not clear current target input state or error', async () => {
  const h = harness(), c = h.context
  h.holdNextFailure()
  c.onBrowserPointerDown(mouse); await settle()
  c.props.tabId = 'replacement'; h.watches[0]('replacement', 'owned')
  c.inputError.value = ''
  c.onBrowserPointerDown({ ...mouse, pointerId: 2, currentTarget: {}, timeStamp: 2 })
  c.remoteKeys.add('ShiftLeft'); c.composing = true
  h.rejectHeldFailure(); await settle(); await settle()
  assert.deepEqual(h.releases, ['owned'])
  assert.deepEqual(h.sentWithTarget, ['owned:mousePressed', 'replacement:mousePressed', 'owned:mouseReleased'])
  assert.equal(c.inputError.value, '')
  assert.equal(c.pointer?.id, 2)
  assert.equal(c.remoteKeys.has('ShiftLeft'), true)
  assert.equal(c.composing, true)
})

test('late failure from an A-B-A replaced queue cannot release or clear the new same target queue', async () => {
  const h = harness(), c = h.context
  h.holdNextFailure()
  c.onBrowserPointerDown(mouse); await settle()
  c.props.tabId = 'replacement'; h.watches[0]('replacement', 'owned')
  c.props.tabId = 'owned'; h.watches[0]('owned', 'replacement')
  c.inputError.value = ''
  c.onBrowserPointerDown({ ...mouse, pointerId: 2, currentTarget: {}, timeStamp: 2 })
  c.remoteKeys.add('ShiftLeft'); c.composing = true
  h.rejectHeldFailure(); await settle(); await settle()
  assert.deepEqual(h.releases, ['owned', 'replacement'])
  assert.deepEqual(h.sentWithTarget, ['owned:mousePressed', 'owned:mouseReleased', 'owned:mousePressed'])
  assert.equal(c.inputError.value, '')
  assert.equal(c.pointer?.id, 2)
  assert.equal(c.remoteKeys.has('ShiftLeft'), true)
  assert.equal(c.composing, true)
})
