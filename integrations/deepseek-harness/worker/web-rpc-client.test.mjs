import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
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
