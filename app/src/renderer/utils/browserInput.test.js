import test from 'node:test'
import assert from 'node:assert/strict'
import { browserPoint, browserWheel, browserModifiers, createBrowserInputQueue } from './browserInput.js'

test('letterboxed/downscaled frames map to CSS viewport coordinates and reject black margins', () => {
  const image = { getBoundingClientRect: () => ({ left: 100, top: 220, width: 600, height: 450 }) }
  const frame = { width: 1200, height: 900 }
  assert.deepEqual(browserPoint({ clientX: 250, clientY: 340 }, image, frame), { x: 300, y: 240 })
  assert.equal(browserPoint({ clientX: 250, clientY: 100 }, image, frame), null)
  assert.deepEqual(browserPoint({ clientX: 1000, clientY: 1000 }, image, frame, true), { x: 1199, y: 899 })
  assert.equal(browserPoint({}, image, { width: 0, height: 0 }), null)
})
test('wheel modes and modifiers match browser CDP semantics', () => {
  assert.deepEqual(browserWheel({ deltaMode: 1, deltaX: 2, deltaY: 3 }, 900), { deltaX: 32, deltaY: 48 })
  assert.deepEqual(browserWheel({ deltaMode: 2, deltaX: 0, deltaY: 1 }, 900), { deltaX: 0, deltaY: 900 })
  assert.equal(browserModifiers({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true }), 15)
})
test('motion coalesces while preserving click edges and wheel distance', async () => {
  const sent = []; let finish
  const queue = createBrowserInputQueue(async e => { sent.push(e); if (sent.length === 1) await new Promise(resolve => finish = resolve); return { ok: true } }, assert.fail)
  queue.push({ kind: 'mouse', type: 'mousePressed' })
  queue.push({ kind: 'mouse', type: 'mouseMoved', x: 1 })
  queue.push({ kind: 'mouse', type: 'mouseMoved', x: 2 })
  queue.push({ kind: 'mouse', type: 'mouseReleased' })
  queue.push({ kind: 'wheel', deltaX: 0, deltaY: 30 })
  queue.push({ kind: 'wheel', deltaX: 0, deltaY: 50 })
  finish(); await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(sent.map(e => e.type || e.kind), ['mousePressed', 'mouseMoved', 'mouseReleased', 'wheel'])
  assert.equal(sent[1].x, 2); assert.equal(sent[3].deltaY, 80)
})
test('unconfirmed input drops queued work without retry', async () => {
  const sent = [], errors = []; let finish
  const queue = createBrowserInputQueue(async e => { sent.push(e); await new Promise(resolve => finish = resolve); return { ok: false, error: 'timeout' } }, error => errors.push(error))
  queue.push({ kind: 'text', text: 'one' }); queue.push({ kind: 'text', text: 'two' }); finish()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sent.length, 1); assert.deepEqual(errors, ['timeout'])
})
