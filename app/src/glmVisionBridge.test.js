const test = require('node:test')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const { resolve } = require('node:path')

const runtime = resolve(__dirname, '../../integrations/deepseek-harness')
const PROVIDER = 'crawshrimp-glm-official'
const OTHER_PROVIDER = 'custom-glm'
const FLASH_MODEL = 'glm-5.3-flash'
const FLASHX_MODEL = 'glm-5.3-flashx'
const TEXT_MODELS = ['glm-5.3', 'glm-5.2']
const FUTURE_MODEL = 'glm-6-future'
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0xkAAAAASUVORK5CYII='
const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64')

function usage() {
  return { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
}

function assistant(model, text, extra = {}) {
  return {
    role: 'assistant',
    content: text === undefined ? [] : [{ type: 'text', text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: usage(),
    stopReason: 'stop',
    timestamp: 0,
    ...extra,
  }
}

function streamOf(events) {
  const terminal = events.findLast?.(event => event.type === 'done' || event.type === 'error')
    ?? [...events].reverse().find(event => event.type === 'done' || event.type === 'error')
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event
    },
    async result() {
      if (terminal?.type === 'done') return terminal.message
      if (terminal?.type === 'error') return terminal.error
      return undefined
    },
  }
}

function doneStream(model, text = 'final response') {
  return streamOf([{ type: 'done', message: assistant(model, text) }])
}

function errorStream(model, message, prelude = []) {
  return streamOf([...prelude, { type: 'error', error: assistant(model, undefined, { stopReason: 'error', errorMessage: message }) }])
}

function textPrelude(textValue = 'partial output') {
  return [
    { type: 'text_start', contentIndex: 0 },
    { type: 'text_delta', contentIndex: 0, delta: textValue },
    { type: 'text_end', contentIndex: 0, content: textValue },
  ]
}

function toolPrelude() {
  const toolCall = { type: 'toolCall', id: 'call-1', name: 'inspect', arguments: {} }
  return [
    { type: 'toolcall_start', contentIndex: 0, partial: { content: [toolCall] } },
    { type: 'toolcall_delta', contentIndex: 0, delta: '{}' },
    { type: 'toolcall_end', contentIndex: 0, toolCall },
  ]
}

function thinkingPrelude(thinking = 'partial reasoning') {
  return [
    { type: 'thinking_start', contentIndex: 0 },
    { type: 'thinking_delta', contentIndex: 0, delta: thinking },
    { type: 'thinking_end', contentIndex: 0, content: thinking },
  ]
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
    contextWindow: 128000,
    maxTokens: id === FLASH_MODEL || id === FLASHX_MODEL ? 8192 : 16384,
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

async function makeAdapter({
  includeFlash = true,
  includeFlashX = false,
  includeOtherFlash = false,
  includeFuture = false,
  otherInput = ['text', 'image'],
  serializePayloads = false,
  visionFailure,
  streamPlan,
} = {}) {
  const { PiAiAdapter } = await import(pathToFileURL(resolve(runtime, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js')).href)
  const { stream: openAiStream } = await import(pathToFileURL(resolve(runtime, 'node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js')).href)
  const captures = { vision: [], final: [], preflights: [], visionPayloads: [], finalPayloads: [] }
  const models = new Map()
  for (const id of TEXT_MODELS) models.set(`${PROVIDER}:${id}`, model(PROVIDER, id, ['text']))
  models.set(`${OTHER_PROVIDER}:glm-5.3`, model(OTHER_PROVIDER, 'glm-5.3', otherInput))
  if (includeFuture) models.set(`${PROVIDER}:${FUTURE_MODEL}`, model(PROVIDER, FUTURE_MODEL, ['text', 'image']))
  if (includeFlash) models.set(`${PROVIDER}:${FLASH_MODEL}`, model(PROVIDER, FLASH_MODEL, ['text', 'image']))
  if (includeFlashX) models.set(`${PROVIDER}:${FLASHX_MODEL}`, model(PROVIDER, FLASHX_MODEL, ['text', 'image']))
  if (includeOtherFlash) models.set(`${OTHER_PROVIDER}:${FLASH_MODEL}`, model(OTHER_PROVIDER, FLASH_MODEL, ['text', 'image']))
  const profiles = new Map([
    [PROVIDER, profile(PROVIDER)],
    [OTHER_PROVIDER, profile(OTHER_PROVIDER)],
  ])
  let finalCallIndex = 0
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
      getModels(provider) {
        return [...models.values()].filter(item => item.provider === provider)
      },
      async completeSimple(requestModel, context, options) {
        captures.vision.push({ model: requestModel, context, options })
        if (serializePayloads) captures.visionPayloads.push(await captureOpenAiPayload(openAiStream, requestModel, context, options))
        if (visionFailure) return assistant(requestModel, undefined, { stopReason: 'error', errorMessage: visionFailure })
        return assistant(requestModel, 'GLM Flash saw a red jacket and SKU A123.')
      },
      streamSimple(requestModel, context, options) {
        const call = { model: requestModel, context, options }
        captures.final.push(call)
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
        finalCallIndex += 1
        return streamPlan?.({ ...call, index: finalCallIndex }) ?? doneStream(requestModel)
      },
    },
  }
  return { adapter, captures }
}

test('official GLM modelInfo and listModels expose paired image capability only for same-provider official routes', async () => {
  const { adapter } = await makeAdapter({ includeOtherFlash: true, otherInput: ['text'] })
  for (const id of TEXT_MODELS) {
    const info = await adapter.resolveModel(PROVIDER, id)
    assert.deepEqual(info.inputModalities, ['text', 'image'])
  }
  assert.deepEqual((await adapter.resolveModel(PROVIDER, FLASH_MODEL)).inputModalities, ['text', 'image'])
  assert.deepEqual((await adapter.resolveModel(OTHER_PROVIDER, 'glm-5.3')).inputModalities, ['text'])

  const listed = await adapter.listModels(PROVIDER)
  const byId = new Map(listed.map(item => [item.id, item]))
  assert.deepEqual(byId.get('glm-5.3').inputModalities, ['text', 'image'])
  assert.deepEqual(byId.get('glm-5.2').inputModalities, ['text', 'image'])
  assert.deepEqual(byId.get(FLASH_MODEL).inputModalities, ['text', 'image'])
})

test('official GLM 5.3 and 5.2 user images use same-provider Flash vision, then original model receives text with tools intact', async () => {
  for (const requested of TEXT_MODELS) {
    const { adapter, captures } = await makeAdapter({ serializePayloads: true })
    const tools = [{ name: 'lookup', description: 'Lookup', parameters: { type: 'object', properties: {} } }]
    await collect(adapter.stream({
      provider: PROVIDER,
      model: requested,
      sessionId: `session-${requested}`,
      tools,
      messages: [{ role: 'user', content: [text('请看图'), image()], source: { kind: 'user' } }],
    }))

    assert.equal(captures.vision.length, 1)
    assert.equal(captures.vision[0].model.id, FLASH_MODEL)
    assert.equal(contextsContainImage(captures.vision[0].context), true)
    assert.equal(captures.vision[0].context.tools, undefined)
    assert.equal(captures.visionPayloads[0].model, FLASH_MODEL)
    const flashImage = captures.visionPayloads[0].messages.flatMap(message => message.content || []).find(block => block.type === 'image_url')
    assert.equal(flashImage.image_url.url, `data:image/png;base64,${PNG_BASE64}`)
    assert.equal(captures.final.length, 1)
    assert.equal(captures.final[0].model.id, requested)
    assert.equal(contextsContainImage(captures.final[0].context), false)
    assert.match(contextText(captures.final[0].context), /GLM Flash saw a red jacket/)
    assert.deepEqual(captures.final[0].context.tools, tools)
    assert.equal(captures.finalPayloads[0].model, requested)
    assert.doesNotMatch(JSON.stringify(captures.finalPayloads[0].messages), /image_url/)
    assert.deepEqual(captures.finalPayloads[0].tools.map(tool => tool.function.name), ['lookup'])
  }
})

test('official GLM uses FlashX as the paired vision fallback when Flash is not configured', async () => {
  const { adapter, captures } = await makeAdapter({ includeFlash: false, includeFlashX: true })
  await collect(adapter.stream({
    provider: PROVIDER,
    model: 'glm-5.3',
    messages: [{ role: 'user', content: [text('请看图'), image()], source: { kind: 'user' } }],
  }))

  assert.equal(captures.vision.length, 1)
  assert.equal(captures.vision[0].model.id, FLASHX_MODEL)
  assert.equal(captures.final.length, 1)
  assert.equal(captures.final[0].model.id, 'glm-5.3')
  assert.equal(contextsContainImage(captures.final[0].context), false)
})

test('official GLM bridge handles nested read_image tool-result pictures', async () => {
  const { adapter, captures } = await makeAdapter()
  await collect(adapter.stream({
    provider: PROVIDER,
    model: 'glm-5.3',
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
  assert.match(JSON.stringify(finalTool.content), /GLM Flash saw a red jacket/)
})

test('official GLM text models fail closed without same-provider Flash and never borrow another provider', async () => {
  const { adapter, captures } = await makeAdapter({ includeFlash: false, includeOtherFlash: true })
  await assert.rejects(collect(adapter.stream({
    provider: PROVIDER,
    model: 'glm-5.3',
    messages: [{ role: 'user', content: [text('请看图'), image()], source: { kind: 'user' } }],
  })), error => {
    assert.equal(error.code, 'UNSUPPORTED_CONTENT')
    assert.match(error.message, /does not support image input/)
    return true
  })
  assert.equal(captures.vision.length, 0)
  assert.equal(captures.final.length, 0)
})

test('official GLM Flash image requests go directly to Flash without bridge', async () => {
  const { adapter, captures } = await makeAdapter()
  await collect(adapter.stream({
    provider: PROVIDER,
    model: FLASH_MODEL,
    messages: [{ role: 'user', content: [text('Flash 直接看图'), image()], source: { kind: 'user' } }],
  }))
  assert.equal(captures.vision.length, 0)
  assert.equal(captures.final.length, 1)
  assert.equal(captures.final[0].model.id, FLASH_MODEL)
  assert.equal(contextsContainImage(captures.final[0].context), true)
})

test('official GLM pure text requests do not invoke the vision bridge', async () => {
  const { adapter, captures } = await makeAdapter()
  await collect(adapter.stream({
    provider: PROVIDER,
    model: 'glm-5.3',
    tools: [{ name: 'lookup', description: 'Lookup', parameters: { type: 'object', properties: {} } }],
    messages: [{ role: 'user', content: [text('纯文本问题')], source: { kind: 'user' } }],
  }))
  assert.equal(captures.vision.length, 0)
  assert.equal(captures.final.length, 1)
  assert.equal(captures.final[0].model.id, 'glm-5.3')
  assert.equal(contextsContainImage(captures.final[0].context), false)
  assert.deepEqual(captures.final[0].context.tools.map(tool => tool.name), ['lookup'])
})

test('future official GLM image routes retry once through Flash on text-only 400/1210 with no prior output', async () => {
  const textOnlyError = "Error code: 400 - {'error': {'code': '1210', 'message': \"messages.content.type 参数非法，取值范围 ['text']\"}}"
  const { adapter, captures } = await makeAdapter({
    includeFuture: true,
    streamPlan: ({ model: requestModel, index }) => index === 1 ? errorStream(requestModel, textOnlyError) : doneStream(requestModel, 'retried'),
  })
  const chunks = await collect(adapter.stream({
    provider: PROVIDER,
    model: FUTURE_MODEL,
    messages: [{ role: 'user', content: [text('未来 GLM 看图'), image()], source: { kind: 'user' } }],
  }))

  assert.equal(captures.final.length, 2)
  assert.equal(captures.final[0].model.id, FUTURE_MODEL)
  assert.equal(contextsContainImage(captures.final[0].context), true)
  assert.equal(captures.vision.length, 1)
  assert.equal(captures.vision[0].model.id, FLASH_MODEL)
  assert.equal(captures.final[1].model.id, FUTURE_MODEL)
  assert.equal(contextsContainImage(captures.final[1].context), false)
  assert.match(contextText(captures.final[1].context), /GLM Flash saw a red jacket/)
  assert.equal(chunks.at(-1).reason.kind, 'stop')
})

test('future GLM fallback retries at most once when the replay sees the same text-only image error', async () => {
  const textOnlyError = "Error code: 400 - {'error': {'code': '1210', 'message': \"messages.content.type 参数非法，取值范围 ['text']\"}}"
  const { adapter, captures } = await makeAdapter({
    includeFuture: true,
    streamPlan: ({ model: requestModel }) => errorStream(requestModel, textOnlyError),
  })
  const chunks = await collect(adapter.stream({
    provider: PROVIDER,
    model: FUTURE_MODEL,
    messages: [{ role: 'user', content: [text('未来 GLM 看图'), image()], source: { kind: 'user' } }],
  }))

  assert.equal(captures.vision.length, 1)
  assert.equal(captures.final.length, 2)
  assert.equal(contextsContainImage(captures.final[0].context), true)
  assert.equal(contextsContainImage(captures.final[1].context), false)
  assert.equal(chunks.at(-1).reason.kind, 'error')
})

test('non-official same-name GLM does not borrow official Flash after the same 400/1210 image rejection', async () => {
  const textOnlyError = "Error code: 400 - {'error': {'code': '1210', 'message': \"messages.content.type 参数非法，取值范围 ['text']\"}}"
  const { adapter, captures } = await makeAdapter({
    streamPlan: ({ model: requestModel }) => errorStream(requestModel, textOnlyError),
  })
  const chunks = await collect(adapter.stream({
    provider: OTHER_PROVIDER,
    model: 'glm-5.3',
    messages: [{ role: 'user', content: [text('非官方同名 GLM 看图'), image()], source: { kind: 'user' } }],
  }))

  assert.equal(captures.vision.length, 0)
  assert.equal(captures.final.length, 1)
  assert.equal(captures.final[0].model.provider, OTHER_PROVIDER)
  assert.equal(contextsContainImage(captures.final[0].context), true)
  assert.equal(chunks.at(-1).reason.kind, 'error')
})

test('future GLM retry does not run for auth, rate-limit, server, timeout or content-policy failures', async () => {
  const cases = [
    'Error code: 401 - unauthorized',
    'Error code: 429 - rate limit exceeded',
    'Error code: 500 - internal server error',
    'request timed out while reading response',
    'Error code: 400 - content policy violation',
    "Error code: 400 - {'error': {'code': '1210', 'message': 'request.format 参数非法'}}",
  ]
  for (const message of cases) {
    const { adapter, captures } = await makeAdapter({
      includeFuture: true,
      streamPlan: ({ model: requestModel }) => errorStream(requestModel, message),
    })
    const chunks = await collect(adapter.stream({
      provider: PROVIDER,
      model: FUTURE_MODEL,
      messages: [{ role: 'user', content: [text('未来 GLM 看图'), image()], source: { kind: 'user' } }],
    }))
    assert.equal(captures.vision.length, 0, message)
    assert.equal(captures.final.length, 1, message)
    assert.equal(chunks.at(-1).reason.kind, 'error')
  }
})

test('future GLM retry does not replay after text, tool or thinking output has already streamed', async () => {
  const textOnlyError = "Error code: 400 - {'error': {'code': '1210', 'message': \"messages.content.type 参数非法，取值范围 ['text']\"}}"
  for (const prelude of [textPrelude(), toolPrelude(), thinkingPrelude()]) {
    const { adapter, captures } = await makeAdapter({
      includeFuture: true,
      streamPlan: ({ model: requestModel }) => errorStream(requestModel, textOnlyError, prelude),
    })
    const chunks = await collect(adapter.stream({
      provider: PROVIDER,
      model: FUTURE_MODEL,
      messages: [{ role: 'user', content: [text('未来 GLM 看图'), image()], source: { kind: 'user' } }],
    }))
    assert.equal(captures.vision.length, 0)
    assert.equal(captures.final.length, 1)
    assert.equal(chunks.at(-1).reason.kind, 'error')
  }
})

test('GLM Flash vision preflight failure is propagated and original text model is not called', async () => {
  const { adapter, captures } = await makeAdapter({ visionFailure: 'Flash unavailable' })
  await assert.rejects(collect(adapter.stream({
    provider: PROVIDER,
    model: 'glm-5.3',
    messages: [{ role: 'user', content: [text('请看图'), image()], source: { kind: 'user' } }],
  })), error => {
    assert.equal(error.code, 'UNSUPPORTED_CONTENT')
    assert.match(error.message, /Flash unavailable/)
    return true
  })
  assert.equal(captures.vision.length, 1)
  assert.equal(captures.final.length, 0)
})
