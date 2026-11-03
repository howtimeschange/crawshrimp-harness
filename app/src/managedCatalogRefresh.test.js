const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createManagedCatalogRefresh } = require('./managedCatalogRefresh')
const tick = () => new Promise(resolve => setImmediate(resolve))

test('returning from redemption refreshes immediately; visible polling is bounded and disposed', async () => {
  let poll, active = true, calls = 0, cleared = false, time = 0
  const watcher = createManagedCatalogRefresh({ refresh: async () => { calls++ }, isActive: () => active, now: () => time,
    timers: { setInterval(fn, ms) { poll = fn; assert.equal(ms, 30000); return 1 }, clearInterval(id) { assert.equal(id, 1); cleared = true } } })
  await watcher.focus(); assert.equal(calls, 1)
  await watcher.focus(); assert.equal(calls, 1)
  poll(); await tick(); assert.equal(calls, 2)
  active = false; time = 2000; poll(); await watcher.focus(); assert.equal(calls, 2)
  active = true; await watcher.focus(); assert.equal(calls, 3)
  watcher.dispose(); time += 2000; poll(); await watcher.focus()
  assert.equal(calls, 3); assert.equal(cleared, true)
})

test('focus during a pre-redemption read requests one newer read; polling never overlaps', async () => {
  let release, poll, calls = 0, time = 0
  const watcher = createManagedCatalogRefresh({ refresh: async () => { if (++calls === 1) await new Promise(resolve => { release = resolve }) }, isActive: () => true, now: () => time,
    timers: { setInterval(fn) { poll = fn; return 1 }, clearInterval() {} } })
  const oldRead = watcher.focus(); poll(); poll(); assert.equal(calls, 1)
  time = 2000; const returned = watcher.focus(); release()
  await Promise.all([oldRead, returned]); assert.equal(calls, 2)
  watcher.dispose()
})

test('offline focus does not throw or spin; next poll can recover', async () => {
  let poll, calls = 0
  const watcher = createManagedCatalogRefresh({ refresh: async () => { if (++calls === 1) throw Error('offline') }, isActive: () => true,
    timers: { setInterval(fn) { poll = fn; return 1 }, clearInterval() {} } })
  await watcher.focus(); assert.equal(calls, 1)
  poll(); await tick(); assert.equal(calls, 2)
  watcher.dispose()
})
