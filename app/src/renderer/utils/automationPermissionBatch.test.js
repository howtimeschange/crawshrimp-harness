const test = require('node:test')
const assert = require('node:assert/strict')
test('batch serializes requests, deduplicates selection and preserves denial', async () => {
  const { runPermissionBatch } = await import('./automationPermissionBatch.mjs')
  const order = [], results = []
  await runPermissionBatch({ ids: ['a', 'b', 'a'], call: async id => { order.push(id); return { status: id === 'a' ? 'denied_or_restricted' : 'authorized' } }, onResult: (id, result) => { order.push(id + '-done'); results.push(result.status) } })
  assert.deepEqual(order, ['a','a-done','b','b-done'])
  assert.deepEqual(results, ['denied_or_restricted','authorized'])
})
test('stop prevents later prompts and unknown outcomes are not retried', async () => {
  const { runPermissionBatch } = await import('./automationPermissionBatch.mjs')
  let stopped = false, calls = 0
  const completed = await runPermissionBatch({ ids: ['a','b'], call: async () => { calls++; throw new Error('timeout') }, onResult: (_id, result) => { assert.equal(result.status,'unknown'); stopped = true }, shouldStop: () => stopped })
  assert.deepEqual(completed, ['a']); assert.equal(calls,1)
})
