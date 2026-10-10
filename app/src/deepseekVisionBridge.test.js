const test = require('node:test')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const { resolve } = require('node:path')

const runtime = resolve(__dirname, '../../integrations/deepseek-harness')
const OFFICIAL_PROVIDER = 'crawshrimp-deepseek-official'
const CUSTOM_PROVIDER = 'custom-deepseek'
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0xkAAAAASUVORK5CYII='
const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64')

function usage() {
  return { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
}

function assistant(model, text) {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: usage(),
    stopReason: 'stop',
    timestamp: 0,
  }
}

async function *doneStream(model, text) {
  yield { type: 'done', message: assistant(model, text) }
}

async function captureOpenAiPayload(openAiStream, requestModel, context, options) {
  let payload
  const result = await openAiStream(requestModel, context, {
    ...options,
    apiKey: 'unit-test-placeholder',
    onPayload(body) {
      payload = options?.onPayload ? options.onPayload(body) : body
      throw new Error('payload captured without network')
    },
  }).result()
  assert.match(result.errorMessage, /payload captured/)
  return payload
}

function model(provider, id, input) {
  return {
    id,
    name: id,
    provider,
    api: 'openai-completions',
    baseUrl: 'https://example.invalid/v1',
    input,
    contextWindow: 1000000,
    maxTokens: 32768,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
}

function profile(provider) {
  return {
    displayName: provider,
    configuredMaxTokens: new Map(),
    streamIdleTimeoutMs: 10000,
    maxRequestImageBytes: 1024 * 1024,
    requestImagePixelBudget: 4096,
    requestImageMaxBytes: 1024 * 1024,
    headers: {},
  }
}

function image(id = 'attachment-user') {
  return {
    type: 'image',
    attachment: {
      attachmentId: id,
      filename: `${id}.png`,
      mediaType: 'image/png',
      bytes: PNG_BYTES.length,
      width: 1,
      height: 1,
      sha256: `sha256-${id}`,
    },
  }
}

function text(value) {
  return { type: 'text', text: value }
}

function hasImageContent(content) {
  return Array.isArray(content) && content.some(block => block.type === 'image' || (block.type === 'tool-result' && hasImageContent(block.content)))
}

function contextsContainImage(context) {
  return context.messages.some(message => hasImageContent(message.content))
}

function contextText(context) {
  return JSON.stringify(context.messages)
}

async function collect(iterator) {
  const chunks = []
  for await (const chunk of iterator) chunks.push(chunk)
  return chunks
}

async function makeAdapter({ includeOfficialFlash = true, includeCustomFlash = false, serializePayloads = false } = {}) {
  const { PiAiAdapter } = await import(pathToFileURL(resolve(runtime, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js')).href)
  const { stream: openAiStream } = await import(pathToFileURL(resolve(runtime, 'node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js')).href)
  const captures = { vision: [], final: [], preflights: [], visionPayloads: [], finalPayloads: [] }
  const officialPro = model(OFFICIAL_PROVIDER, 'deepseek-v4-pro', ['text'])
  const officialFlash = model(OFFICIAL_PROVIDER, 'deepseek-flash', ['text', 'image'])
  const customPro = model(CUSTOM_PROVIDER, 'deepseek-v4-pro', ['text', 'image'])
  const customFlash = model(CUSTOM_PROVIDER, 'deepseek-flash', ['text', 'image'])
  const models = new Map([
    [`${OFFICIAL_PROVIDER}:deepseek-v4-pro`, officialPro],
    [`${CUSTOM_PROVIDER}:deepseek-v4-pro`, customPro],
  ])
  if (includeOfficialFlash) models.set(`${OFFICIAL_PROVIDER}:deepseek-flash`, officialFlash)
  if (includeCustomFlash) models.set(`${CUSTOM_PROVIDER}:deepseek-flash`, customFlash)
  const profiles = new Map([
    [OFFICIAL_PROVIDER, profile(OFFICIAL_PROVIDER)],
    [CUSTOM_PROVIDER, profile(CUSTOM_PROVIDER)],
  ])
  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: async () => 'unit-test-placeholder',
    resolveAttachments: () => ({
      async readImageRequest(ref) {
        return { data: PNG_BYTES, mediaType: ref.mediaType, bytes: PNG_BYTES.length, width: 1, height: 1 }
      },
    }),
    resolveImageAccess: (_attachments, ref) => `/unit-test/${ref.filename}`,
    onVisionPreflight: event => captures.preflights.push(event),
  })
  adapter.snapshot = {
    profiles,
    models: {
      getModel(provider, id) {
        return models.get(`${provider}:${id}`)
      },
      async completeSimple(requestModel, context, options) {
        captures.vision.push({ model: requestModel, context, options })
        if (serializePayloads) captures.visionPayloads.push(await captureOpenAiPayload(openAiStream, requestModel, context, options))
        return assistant(requestModel, 'Flash saw a red jacket and SKU A123.')
      },
      streamSimple(requestModel, context, options) {
        captures.final.push({ model: requestModel, context, options })
        if (serializePayloads) {
          return openAiStream(requestModel, context, {
            ...options,
            apiKey: 'unit-test-placeholder',
            onPayload(body) {
              const payload = options?.onPayload ? options.onPayload(body) : body
              captures.finalPayloads.push(payload)
              throw new Error('payload captured without network')
            },
          })
        }
        return doneStream(requestModel, 'final response')
      },
    },
  }
  return { adapter, captures }
}

test('official DeepSeek V4 Pro user images use paired Flash vision, then Pro receives text with tools intact', async () => {
  const { adapter, captures } = await makeAdapter({ serializePayloads: true })
  const tools = [{ name: 'lookup', description: 'Lookup', parameters: { type: 'object', properties: {} } }]
  const chunks = await collect(adapter.stream({
    provider: OFFICIAL_PROVIDER,
    model: 'deepseek-v4-pro',
    sessionId: 'session-1',
    tools,
    messages: [{ role: 'user', content: [text('请看图'), image()], source: { kind: 'user' } }],
  }))

  assert.equal(chunks.at(-1).type, 'finish')
  assert.equal(captures.vision.length, 1)
  assert.equal(captures.vision[0].model.id, 'deepseek-flash')
  assert.equal(captures.vision[0].options.sessionId, 'session-1:vision')
  assert.equal(contextsContainImage(captures.vision[0].context), true)
  assert.equal(captures.vision[0].context.tools, undefined)
  assert.equal(captures.visionPayloads.length, 1)
  assert.equal(captures.visionPayloads[0].model, 'deepseek-flash')
  const flashImage = captures.visionPayloads[0].messages
    .flatMap(message => message.content || [])
    .find(block => block.type === 'image_url')
  assert.equal(flashImage.image_url.url, `data:image/png;base64,${PNG_BASE64}`)
  assert.deepEqual(captures.preflights, [{ provider: OFFICIAL_PROVIDER, model: 'deepseek-v4-pro', visionModel: 'deepseek-flash', sessionId: 'session-1' }])

  assert.equal(captures.final.length, 1)
  assert.equal(captures.final[0].model.id, 'deepseek-v4-pro')
  assert.equal(contextsContainImage(captures.final[0].context), false)
  assert.match(contextText(captures.final[0].context), /Flash saw a red jacket/)
  assert.deepEqual(captures.final[0].context.tools, tools)
  assert.equal(captures.finalPayloads.length, 1)
  assert.equal(captures.finalPayloads[0].model, 'deepseek-v4-pro')
  assert.doesNotMatch(JSON.stringify(captures.finalPayloads[0].messages), /image_url/)
  assert.deepEqual(captures.finalPayloads[0].tools.map(tool => tool.function.name), ['lookup'])
})

test('official DeepSeek V4 Pro bridges nested read_image tool-result images', async () => {
  const { adapter, captures } = await makeAdapter()
  await collect(adapter.stream({
    provider: OFFICIAL_PROVIDER,
    model: 'deepseek-v4-pro',
    messages: [{
      role: 'user',
      source: { kind: 'tool', callId: 'read-1' },
      content: [{
        type: 'tool-result',
        toolCallId: 'read-1',
        content: [text('result.png'), image('attachment-tool')],
      }],
    }],
  }))

  assert.equal(captures.vision.length, 1)
  assert.equal(contextsContainImage(captures.vision[0].context), true)
  assert.equal(captures.vision[0].context.messages.some(message => message.role === 'toolResult'), false)
  const finalTool = captures.final[0].context.messages.find(message => message.role === 'toolResult')
  assert.ok(finalTool)
  assert.equal(hasImageContent(finalTool.content), false)
  assert.match(JSON.stringify(finalTool.content), /Flash saw a red jacket/)
})

test('official DeepSeek V4 Pro fails closed when paired Flash vision is unavailable', async () => {
  const { adapter, captures } = await makeAdapter({ includeOfficialFlash: false, includeCustomFlash: true })
  await assert.rejects(collect(adapter.stream({
    provider: OFFICIAL_PROVIDER,
    model: 'deepseek-v4-pro',
    messages: [{ role: 'user', content: [text('请看图'), image()], source: { kind: 'user' } }],
  })), error => {
    assert.equal(error.code, 'UNSUPPORTED_CONTENT')
    assert.match(error.message, /does not support image input/)
    return true
  })
  assert.equal(captures.vision.length, 0)
  assert.equal(captures.final.length, 0)
})

test('plain text and non-official same-name routes do not use the official Flash bridge', async () => {
  const textOnly = await makeAdapter()
  await collect(textOnly.adapter.stream({
    provider: OFFICIAL_PROVIDER,
    model: 'deepseek-v4-pro',
    messages: [{ role: 'user', content: [text('纯文本')], source: { kind: 'user' } }],
  }))
  assert.equal(textOnly.captures.vision.length, 0)
  assert.equal(textOnly.captures.final[0].model.id, 'deepseek-v4-pro')

  const custom = await makeAdapter({ includeCustomFlash: true })
  await collect(custom.adapter.stream({
    provider: CUSTOM_PROVIDER,
    model: 'deepseek-v4-pro',
    messages: [{ role: 'user', content: [text('同名模型看图'), image()], source: { kind: 'user' } }],
  }))
  assert.equal(custom.captures.vision.length, 0)
  assert.equal(custom.captures.final.length, 1)
  assert.equal(custom.captures.final[0].model.provider, CUSTOM_PROVIDER)
  assert.equal(contextsContainImage(custom.captures.final[0].context), true)

  const flash = await makeAdapter()
  await collect(flash.adapter.stream({
    provider: OFFICIAL_PROVIDER,
    model: 'deepseek-flash',
    messages: [{ role: 'user', content: [text('Flash 直接看图'), image()], source: { kind: 'user' } }],
  }))
  assert.equal(flash.captures.vision.length, 0)
  assert.equal(flash.captures.final[0].model.id, 'deepseek-flash')
  assert.equal(contextsContainImage(flash.captures.final[0].context), true)
})
