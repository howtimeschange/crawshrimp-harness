const test = require('node:test')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const { resolve } = require('node:path')
const runtime = resolve(__dirname, '../../integrations/deepseek-harness')

test('legacy Flash selections migrate only inside the official provider and patching is idempotent', async () => {
  const { normalizeDeepSeekFlash, patchDeepSeekFlashSource } = await import(pathToFileURL(resolve(runtime, 'scripts/deepseek-flash.mjs')))
  for (const model of ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4.1-flash-expires-on-0910']) {
    assert.equal(normalizeDeepSeekFlash('crawshrimp-deepseek-official', model), 'deepseek-flash')
    assert.equal(normalizeDeepSeekFlash('crawshrimp-domestic-openai', model), model)
  }
  assert.equal(normalizeDeepSeekFlash('crawshrimp-deepseek-official', 'deepseek-v4-pro'), 'deepseek-v4-pro')
  const source = '\tmodelOf(snapshot, provider, model) {\n}\n\tmodelInfo(snapshot, provider, model) {\n}\n\tasync *streamWithSnapshot(options, snapshot) {\n}'
  const patched = patchDeepSeekFlashSource(source)
  assert.equal(patchDeepSeekFlashSource(patched), patched)
  assert.throws(() => patchDeepSeekFlashSource('upstream changed'), /anchor changed/)
})

test('official Flash wire payload supports images, explicit thinking off and low/high/max with reasoning replay', async () => {
  const { stream } = await import(pathToFileURL(resolve(runtime, 'node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js')))
  const model = {
    id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', provider: 'crawshrimp-deepseek-official',
    api: 'openai-completions', baseUrl: 'https://api.deepseek.example', input: ['text', 'image'],
    contextWindow: 1000000, maxTokens: 393216, reasoning: true,
    thinkingLevelMap: { off: 'off', low: 'low', high: 'high', max: 'max' },
    compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true, requiresReasoningContentOnAssistantMessages: true },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
  const context = { messages: [
    { role: 'user', content: [{ type: 'text', text: 'Inspect this image' }, { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }], timestamp: 1 },
    { role: 'assistant', provider: model.provider, model: model.id, api: model.api,
      content: [{ type: 'thinking', thinking: 'saved reasoning', thinkingSignature: 'reasoning_content' }, { type: 'text', text: 'Observed' }], timestamp: 2 },
    { role: 'user', content: 'Continue', timestamp: 3 },
  ], tools: [{ name: 'inspect', description: 'Inspect', parameters: { type: 'object', properties: {} } }] }
  for (const effort of [undefined, 'low', 'high', 'max']) {
    let payload
    const result = await stream(model, context, {
      apiKey: 'unit-test-placeholder', reasoningEffort: effort,
      onPayload: body => { payload = body; throw new Error('payload captured; do not send') },
    }).result()
    assert.match(result.errorMessage, /payload captured/)
    assert.equal(payload.model, 'deepseek-flash')
    assert.deepEqual(payload.thinking, { type: effort ? 'enabled' : 'disabled' })
    assert.equal(payload.reasoning_effort, effort)
    assert.ok(payload.messages[0].content.some(block => block.type === 'image_url'))
    assert.equal(payload.messages.find(message => message.role === 'assistant').reasoning_content, 'saved reasoning')
  }
})
