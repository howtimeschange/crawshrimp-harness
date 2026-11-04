'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createManagedAccount } = require('./managedAccount')

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-managed-inference-'))
  let scenario = 'done', posts = 0, lastId, traceReads = 0
  const server = http.createServer(async (req, res) => {
    if (req.url === '/account/me') return res.end(JSON.stringify({ user: { id: 'synthetic-owner' } }))
    if (req.url === '/account/models') return res.end(JSON.stringify({ models: [{ id: 'fixture', name: 'Fixture', protocol: 'openai', kind: 'text' }] }))
    if (req.url.startsWith('/account/requests/')) { traceReads++; assert.equal(req.method, 'GET'); assert.equal(req.headers.authorization, 'Bearer synthetic-token'); return res.end(JSON.stringify({ request: { requestId: lastId, state: 'unknown', billingRequestId: 'billing_fixture' } })) }
    if (req.url === '/account/session') return res.end('{}')
    assert.ok(req.url.startsWith('/account/inference/v1/'))
    posts++; lastId = req.headers['x-request-id']
    const chunks = []; for await (const c of req) chunks.push(c)
    assert.equal(JSON.parse(Buffer.concat(chunks)).model, 'fixture')
    if (scenario === 'disconnect') return req.socket.destroy()
    if (scenario === 'timeout') { const timer = setTimeout(() => res.end(), 500); timer.unref(); return }
    if (typeof scenario === 'number') { res.writeHead(scenario, { 'content-type': 'application/json', 'x-oneapi-request-id': 'billing_fixture' }); return res.end('{"error":{"message":"fixture uncertain result"}}') }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'x-oneapi-request-id': 'billing_fixture' })
    if (req.url.endsWith('/responses')) {
      const send = (type, data) => res.write('event: ' + type + '\ndata: ' + JSON.stringify({ type, ...data }) + '\n\n')
      send('response.created', { response: { id: 'fixture', status: 'in_progress', output: [] } })
      send('response.output_item.added', { output_index: 0, item: { id: 'msg', type: 'message', role: 'assistant', status: 'in_progress', content: [] } })
      send('response.content_part.added', { item_id: 'msg', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } })
      send('response.output_text.delta', { item_id: 'msg', output_index: 0, content_index: 0, delta: 'PARTIAL' })
      if (scenario === 'done') send('response.completed', { response: { id: 'fixture', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 } } } })
    } else {
      res.write('data: ' + JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: 'PARTIAL' }, finish_reason: null }] }) + '\n\n')
      if (scenario === 'done' || scenario === 'finish-only') res.write('data: ' + JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n')
      if (scenario === 'done') res.write('data: [DONE]\n\n')
    }
    if (scenario === 'cancel' || scenario === 'logout') { const timer = setTimeout(() => res.end(), 250); timer.unref(); return }
    // Give the runtime a chance to observe a delta before the transport fails.
    setTimeout(() => scenario === 'destroy' ? res.destroy() : res.end(), 25)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  fs.writeFileSync(path.join(dir, 'modeljetty-session.enc'), JSON.stringify({ session: JSON.stringify({ access_token: 'synthetic-token', expiresAt: Date.now() + 3600000 }) }))
  const account = createManagedAccount({ issuer: `http://127.0.0.1:${server.address().port}/oidc`, directory: dir, runtimeDirectory: () => dir, development: true, openExternal: async () => {}, safeStorage: { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() } })
  t.after(() => { account.dispose(); server.closeAllConnections(); server.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  await account.run('status')
  const broker = JSON.parse(fs.readFileSync(path.join(dir, 'managed-model-session.json')))
  return { account, broker, set: s => { scenario = s }, count: () => posts, id: () => lastId, traces: () => traceReads }
}

test('real managed broker and installed providers never replay unknown streams or cancellation', async t => {
  const f = await fixture(t)
  for (const api of ['openai-completions', 'openai-responses']) {
    const { streamSimple } = await import(pathToFileURL(path.resolve(__dirname, '../../integrations/deepseek-harness/node_modules/@earendil-works/pi-ai/dist/api/' + api + '.js')))
    for (const scenario of ['done', 'disconnect', 'timeout', 408, 409, 500, 502, 503, 'destroy', 'eof', ...(api === 'openai-completions' ? ['finish-only'] : []), 'cancel']) {
      await t.test(api + ' ' + scenario, async () => {
        f.set(scenario); const before = f.count(), controller = new AbortController()
        const model = { id: 'managed-fixture', name: 'Fixture', api, provider: 'crawshrimp-managed-' + (api === 'openai-responses' ? 'openai-responses' : 'openai'), baseUrl: f.broker.baseURL + '/v1', reasoning: false, input: ['text'], contextWindow: 64000, maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
        let terminal, partial = false
        for await (const event of streamSimple(model, { messages: [{ role: 'user', content: 'fixture', timestamp: Date.now() }] }, { apiKey: f.broker.brokerToken, maxRetries: 0, maxTokens: 8, timeoutMs: scenario === 'timeout' ? 40 : 3000, signal: controller.signal })) {
          if (event.type === 'text_delta') { partial = true; if (scenario === 'cancel') controller.abort() }
          if (event.type === 'done' || event.type === 'error') terminal = event.type
        }
        assert.equal(terminal, scenario === 'done' ? 'done' : 'error')
        if (['done', 'destroy', 'eof', 'finish-only', 'cancel'].includes(scenario)) assert.ok(partial)
        assert.equal(f.count(), before + 1)
      })
    }
  }
})

test('broker preserves original request and billing identity and lookup is GET only', async t => {
  const f = await fixture(t); f.set(409)
  const r = await fetch(f.broker.baseURL + '/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + f.broker.brokerToken }, body: JSON.stringify({ model: 'managed-fixture' }) })
  await r.text(); assert.equal(r.status, 409); assert.equal(r.headers.get('x-request-id'), f.id()); assert.equal(r.headers.get('x-oneapi-request-id'), 'billing_fixture')
  const before = f.count(), result = await f.account.run('request-trace', { requestId: f.id() })
  assert.equal(result.request.billingRequestId, 'billing_fixture'); assert.equal(f.count(), before); assert.equal(f.traces(), 1)
  for (const requestId of ['../other', 'a'.repeat(101), '', 'good-request-12345?x=1']) await assert.rejects(f.account.run('request-trace', { requestId }), /请求编号无效/)
  assert.equal(f.traces(), 1)
  f.set('disconnect')
  const failed = await fetch(f.broker.baseURL + '/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + f.broker.brokerToken }, body: JSON.stringify({ model: 'managed-fixture' }) })
  assert.equal(failed.status, 409); assert.equal((await failed.json()).error.request_id, failed.headers.get('x-request-id'))
})

test('logout closes active broker without replay and revokes capability', async t => {
  const f = await fixture(t); f.set('logout')
  const r = await fetch(f.broker.baseURL + '/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + f.broker.brokerToken }, body: JSON.stringify({ model: 'managed-fixture' }) })
  const reader = r.body.getReader(); assert.equal((await reader.read()).done, false)
  await f.account.run('logout'); await assert.rejects(reader.read()); assert.equal(f.count(), 1)
  await assert.rejects(fetch(f.broker.baseURL + '/v1/chat/completions'))
})
