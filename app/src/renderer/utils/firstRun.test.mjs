import test from 'node:test'
import assert from 'node:assert/strict'
import { firstRunCompletion, finishFirstRun, hasManagedTextModel } from './firstRun.mjs'
test('desktop setup persists per account, ignores corrupt values and survives storage failure', () => {
  const records = new Map(), storage = { getItem: key => records.get(key), setItem: (key, value) => records.set(key, value) }
  assert.equal(hasManagedTextModel({ user: { id: 'a' }, models: [{ kind: 'image' }] }), false)
  assert.equal(hasManagedTextModel({ user: { id: 'a' }, models: [{ kind: 'text' }] }), true)
  assert.equal(firstRunCompletion(storage, 'a'), null)
  assert.equal(finishFirstRun(storage, 'a', 'desktop'), true)
  assert.equal(firstRunCompletion(storage, 'a'), 'desktop')
  assert.equal(firstRunCompletion(storage, 'b'), null)
  assert.equal(finishFirstRun(storage, 'b', 'paired'), true)
  assert.equal(firstRunCompletion(storage, 'b'), 'paired')
  assert.equal(finishFirstRun(storage, '', 'paired'), false)
  assert.equal(finishFirstRun(storage, 'a', 'unknown'), false)
  const broken = { getItem() { throw Error('blocked') }, setItem() { throw Error('quota') } }
  assert.equal(firstRunCompletion(broken, 'a'), null)
  assert.equal(finishFirstRun(broken, 'a', 'desktop'), false)
})
