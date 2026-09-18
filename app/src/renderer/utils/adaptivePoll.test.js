import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptivePoll } from './adaptivePoll.js'
test('hidden polling is sparse, visibility refresh is immediate, pending calls never overlap', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let visibility, release, calls = 0
  const doc = { hidden: true, addEventListener(_, fn) { visibility = fn }, removeEventListener() { visibility = null } }
  const stop = adaptivePoll(() => { calls++; return new Promise(resolve => { release = resolve }) }, { document: doc })
  t.mock.timers.tick(5000); assert.equal(calls, 0)
  doc.hidden = false; visibility(); assert.equal(calls, 1)
  visibility(); assert.equal(calls, 1)
  release(); await Promise.resolve(); await Promise.resolve()
  t.mock.timers.tick(0); assert.equal(calls, 2)
  stop(); release(); await Promise.resolve()
  t.mock.timers.tick(60000); assert.equal(calls, 2); assert.equal(visibility, null)
})
