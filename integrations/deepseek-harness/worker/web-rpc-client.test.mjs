import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import { WebSocketServer } from 'ws'

import { DshWebRuntime } from './web-rpc-client.mjs'

test('native Web follow closes and rejects when the socket never sends its first snapshot', async (t) => {
  const server = new WebSocketServer({ port: 0 })
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(async () => {
    for (const client of server.clients) client.terminate()
    await new Promise((resolve) => server.close(resolve))
  })
  const port = server.address().port
  const child = new EventEmitter()
  child.exitCode = 0
  const runtime = new DshWebRuntime({
    child,
    origin: `http://127.0.0.1:${port}`,
    cookie: 'dsh=test',
    launchUrl: '',
  })

  const follow = runtime.follow('web-session:never-ready', { firstFrameTimeoutMs: 25 })
  await assert.rejects(follow.ready, /initial snapshot timed out/)
  assert.equal(follow.state, 'failed')
})

test('output continuation sends the runtime token and a text-only body to the private Host route', async (t) => {
  let received
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      received = {
        method: request.method,
        url: request.url,
        cookie: request.headers.cookie,
        runtimeToken: request.headers['x-crawshrimp-runtime-token'],
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true, messageId: 'continuation-message' }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => await new Promise((resolve) => server.close(resolve)))

  const child = new EventEmitter()
  child.exitCode = 0
  const runtime = new DshWebRuntime({
    child,
    origin: `http://127.0.0.1:${server.address().port}`,
    cookie: 'dsh=trusted-browser-cookie',
    launchUrl: '',
    runtimeToken: 'runtime-only-secret',
  })

  const result = await runtime.continueOutput({
    sessionId: 'web-session:continue',
    text: '只输出上一段之后的内容。',
  })

  assert.deepEqual(result, { ok: true, messageId: 'continuation-message' })
  assert.deepEqual(received, {
    method: 'POST',
    url: '/api/crawshrimp/session/output-continuation',
    cookie: 'dsh=trusted-browser-cookie',
    runtimeToken: 'runtime-only-secret',
    body: {
      sessionId: 'web-session:continue',
      text: '只输出上一段之后的内容。',
    },
  })
})
