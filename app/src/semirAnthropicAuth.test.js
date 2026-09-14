const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const modulePath = '../../integrations/deepseek-harness/scripts/semir-anthropic-auth.mjs'
const model = { api: 'anthropic-messages', baseUrl: 'https://ai-aigw.semir.com/overseas-anthropic-vip' }

test('Semir Anthropic uses the current resolved credential on each request', async () => {
  const { semirAnthropicHeaders } = await import(modulePath)
  const headers = { 'x-client': 'test' }
  assert.deepEqual(semirAnthropicHeaders(headers, model, 'first'), { ...headers, Authorization: 'Bearer first' })
  assert.equal(semirAnthropicHeaders(headers, { ...model, baseUrl: model.baseUrl + '/v1/' }, 'rotated').Authorization, 'Bearer rotated')
  assert.deepEqual(headers, { 'x-client': 'test' })
})

test('other endpoints, protocols and explicit auth retain their original headers', async () => {
  const { semirAnthropicHeaders } = await import(modulePath)
  const headers = { 'x-client': 'test' }
  for (const baseUrl of ['https://api.anthropic.com', 'https://ai-aigw.semir.com.evil.test/overseas-anthropic-vip', 'http://ai-aigw.semir.com/overseas-anthropic-vip', 'https://ai-aigw.semir.com/another-route', 'invalid']) {
    assert.equal(semirAnthropicHeaders(headers, { ...model, baseUrl }, 'secret'), headers)
  }
  assert.equal(semirAnthropicHeaders(headers, { ...model, api: 'openai-completions' }, 'secret'), headers)
  assert.equal(semirAnthropicHeaders(headers, model, ''), headers)
  const explicit = { AUTHORIZATION: 'Bearer explicit' }
  assert.equal(semirAnthropicHeaders(explicit, model, 'secret'), explicit)
})

test('runtime patch reaches real streaming call, is idempotent and fails on upstream drift', async () => {
  const { patchSemirAnthropicAuthSource } = await import(modulePath)
  const source = readFileSync(resolve(__dirname, '../../integrations/deepseek-harness/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js'), 'utf8')
  const patched = patchSemirAnthropicAuthSource(source)
  assert.match(patched, /streamSimple\(model, context,[\s\S]*?headers: semirAnthropicHeaders\(requestHeaders\(profile.headers\), model, apiKey\)/)
  assert.equal(patchSemirAnthropicAuthSource(patched), patched)
  assert.throws(() => patchSemirAnthropicAuthSource('changed upstream'), /anchor changed/)
})
