import test from 'node:test'
import assert from 'node:assert/strict'
import { compactUserMessage } from './user-message.mjs'
test('compaction retains human versus synthetic provenance without source metadata', () => {
  for (const kind of ['user', 'runtime-context', 'time-context']) {
    const event = { type: 'user/message', seq: 2, data: { source: { kind, rpcId: 'private' }, content: [] } }
    assert.deepEqual(compactUserMessage(event, 'text'), { type: 'user/message', seq: 2, data: { text: 'text', source: { kind } } })
  }
  assert.deepEqual(compactUserMessage({ type: 'user/message', data: {} }, 'legacy').data, { text: 'legacy' })
})
