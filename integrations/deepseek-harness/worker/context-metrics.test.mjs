import test from 'node:test'
import assert from 'node:assert/strict'
import { compactRequestEvent } from './context-metrics.mjs'
test('projection preserves model provenance but omits prompt and tool contents', () => {
  const original = { type: 'request/header', seq: 42, data: { header: { config: { provider: 'p', model: 'm', apiKey: 'secret' }, system: 'private', tools: [{ name: 'allowed', description: 'x'.repeat(10000) }] } } }
  const result = compactRequestEvent(original)
  assert.equal(result.seq, 42); assert.equal(result.data.header.config.model, 'm')
  assert.equal(result.data.context_metrics.tools_count, 1)
  assert.ok(result.data.context_metrics.tools_bytes > 10000)
  assert.ok(!JSON.stringify(result).includes('secret')); assert.ok(!JSON.stringify(result).includes('private'))
  assert.equal(original.data.header.tools.length, 1)
})
test('projection keeps authoritative tool result and assistant data intact', () => {
  const event = { type: 'tool/result', data: { result: 'value' } }
  assert.equal(compactRequestEvent(event), event)
})
test('request metadata is not mislabeled as model history bytes', () => {
  const result = compactRequestEvent({ type: 'request/context', data: { provider: 'p', model: 'm', contextWindow: 128000 } })
  assert.equal(result.data.context_metrics.context_window, 128000)
  assert.ok(result.data.context_metrics.request_metadata_bytes > 0)
  assert.equal(result.data.context_metrics.context_bytes, undefined)
})
