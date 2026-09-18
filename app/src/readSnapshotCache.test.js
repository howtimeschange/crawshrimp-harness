const test = require('node:test')
const assert = require('node:assert/strict')
const { createReadSnapshotCache } = require('./readSnapshotCache')
test('coalesces pending reads, isolates consumer mutations, invalidates after writes', async () => {
  const cache = createReadSnapshotCache(); let calls = 0, release
  const load = () => { calls++; return new Promise(resolve => { release = resolve }) }
  const a = cache.read('runtime', load), b = cache.read('runtime', load)
  await Promise.resolve(); release({ state: 'ready' })
  const result = await a; result.state = 'bad'
  assert.equal((await b).state, 'ready'); assert.equal(calls, 1)
  cache.invalidate()
  assert.equal((await cache.read('runtime', async () => ({ state: 'starting' }))).state, 'starting')
})
test('stale in-flight response cannot overwrite a post-mutation snapshot', async () => {
  const cache = createReadSnapshotCache(); let release
  const old = cache.read('k', () => new Promise(resolve => { release = resolve }))
  await Promise.resolve(); cache.invalidate()
  await cache.read('k', async () => ({ n: 2 })); release({ n: 1 }); await old
  assert.equal((await cache.read('k', () => { throw Error('must use new snapshot') })).n, 2)
})
