'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { Readable, Writable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { managedInferenceStream } = require('./managedInferenceStream')
async function consume(value, pathname = '/v1/chat/completions') {
  const buffer = Buffer.from(value), chunks = []
  await pipeline(Readable.from(Array.from(buffer, byte => Buffer.from([byte]))), managedInferenceStream('text/event-stream; charset=utf-8', pathname), new Writable({ write(chunk, encoding, cb) { chunks.push(chunk); cb() } }))
  assert.equal(Buffer.concat(chunks).toString(), value)
}
test('SSE observer preserves split UTF-8/CRLF data and requires a complete terminal frame', async () => {
  await consume('data: {"text":"中文😀"}\r\n\r\ndata: [DONE]\r\n\r\n')
  for (const value of ['data: [DONE]', 'data: [DONE]\n', 'data: {"finish_reason":"stop"}\n\n', '']) await assert.rejects(consume(value), /outcome unknown/)
})
test('Responses observer requires completed status and response ID and tolerates multiline data', async () => {
  await consume('event: response.completed\ndata: {"type":"response.completed",\ndata: "response":{"id":"fixture-response","status":"completed"}}\n\n', '/v1/responses')
  for (const id of [undefined, '', null, 123]) await assert.rejects(consume('data: ' + JSON.stringify({type: 'response.completed', response: {status: 'completed', id}}) + '\n\n', '/v1/responses'), /outcome unknown/)
  for (const status of ['failed', 'incomplete', 'in_progress']) await assert.rejects(consume(`data: {"type":"response.completed","response":{"status":"${status}"}}\n\n`, '/v1/responses'), /outcome unknown/)
})
test('large content frames do not prevent later terminal detection', async () => {
  await consume('data: ' + 'x'.repeat(70000) + '\n\ndata: [DONE]\n\n')
  assert.equal(managedInferenceStream('application/json', '/v1/chat/completions'), null)
  assert.equal(managedInferenceStream('text/event-stream', '/v1/images/generations'), null)
})
