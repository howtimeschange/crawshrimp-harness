import test from 'node:test'
import assert from 'node:assert/strict'
import { bridgeMessagesVision, patchMessagesVisionSource } from './messages-vision.mjs'
import { readFileSync } from 'node:fs'
const options = { provider: 'crawshrimp-deepseek-official', model: 'deepseek-v4-pro', tools: [{ name: 'write' }], messages: [{ role: 'user', content: [{ type: 'text', text: 'read screenshot' }, { type: 'image', source: { id: 'test' } }] }] }
const collect = async stream => { const chunks = []; for await (const c of stream) chunks.push(c); return chunks }
test('Messages Pro preserves paired vision, tool continuation and accounts for preflight usage', async () => {
  const requests = []
  const ctx = { async *crawshrimpRawGenerate(request) {
    requests.push(request)
    if (request.model === 'deepseek-flash') { assert.equal(request.tools, undefined); yield { type: 'text-delta', text: '7319' } }
    else { assert.equal(request.tools, options.tools); assert.ok(!JSON.stringify(request.messages).includes('"type":"image"')); assert.match(JSON.stringify(request.messages), /7319/); yield { type: 'text-delta', text: 'confirmed' } }
    yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 1, cacheReadTokens: 2, totalTokens: 6 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
  const result = await collect(bridgeMessagesVision.call(ctx, options, {}))
  assert.deepEqual(requests.map(r => r.model), ['deepseek-flash', 'deepseek-v4-pro'])
  assert.equal(result.filter(c => c.type === 'finish').length, 1)
  assert.equal(result.find(c => c.type === 'usage').usage.totalTokens, 12)
  assert.equal(options.messages[0].content[1].type, 'image')
})
for (const mode of ['error', 'incomplete', 'cancel']) test(`vision ${mode} never continues into Pro`, async () => {
  let calls = 0; const abort = new AbortController()
  const ctx = { async *crawshrimpRawGenerate() { calls++; if (mode === 'error') throw Error('offline'); yield { type: 'text-delta', text: 'partial' }; if (mode === 'cancel') abort.abort(); } }
  await assert.rejects(collect(bridgeMessagesVision.call(ctx, { ...options, signal: abort.signal }, {})))
  assert.equal(calls, 1)
})
test('other providers bypass vision and the installed patch is idempotent', async () => {
  let count = 0
  const request = { ...options, provider: 'custom' }
  await collect(bridgeMessagesVision.call({ async *crawshrimpRawGenerate(r) { count++; assert.equal(r, request); yield { type: 'finish' } } }, request, {}))
  assert.equal(count, 1)
  const raw = readFileSync(new URL('../node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js', import.meta.url), 'utf8')
  assert.equal(patchMessagesVisionSource(raw), raw)
  assert.throws(() => patchMessagesVisionSource('changed'), /anchor changed/)
})

test('native catalog restores old Flash identifiers without renaming other routes', async () => {
  const { DeepSeekAdapter, resolveAdapterOptions } = await import('@deepseek-ai/dsh-llm-deepseek')
  const adapter = new DeepSeekAdapter({ options: () => resolveAdapterOptions({}, { get: () => undefined }) })
  for (const alias of ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4.1-flash-expires-on-0910']) {
    const info = await adapter.resolveModel('crawshrimp-deepseek-official', alias)
    assert.equal(info.id, 'deepseek-flash')
    assert.deepEqual(info.inputModalities, ['text', 'image'])
    assert.equal((await adapter.resolveModel('other', alias)).id, alias)
  }
  const pro = await adapter.resolveModel('crawshrimp-deepseek-official', 'deepseek-v4-pro')
  assert.deepEqual(pro.inputModalities, ['text', 'image'])
})
