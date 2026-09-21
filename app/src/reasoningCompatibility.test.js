import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import {
  normalizeStoredReasoning, normalizeCatalogReasoning, applyReasoningWireIntent,
  patchReasoningAgentSource, patchReasoningControllerSource, patchReasoningMenuSource, patchReasoningAdapterSource,
} from '../../integrations/deepseek-harness/scripts/reasoning-compatibility.mjs'
import { stream, streamSimple } from '../../integrations/deepseek-harness/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js'
import { PiAiAdapter } from '../../integrations/deepseek-harness/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js'
import { createUserMessage } from '../../integrations/deepseek-harness/node_modules/@deepseek-ai/dsh-llm/lib/index.js'
import YAML from 'yaml'

const source = name => readFileSync(new URL(`../../integrations/deepseek-harness/node_modules/@deepseek-ai/${name}`, import.meta.url), 'utf8')
const clone = value => JSON.parse(JSON.stringify(value))
const stale = { provider: 'custom-test', model: 'deepseek-v4-pro', reasoningEffort: 'high' }
const plain = { provider: stale.provider, model: stale.model }
const llm = { async resolveCallConfig(config) {
  if (config.provider === 'custom-test' && config.reasoningEffort !== undefined) throw Object.assign(new Error('unsupported'), { code: 'UNSUPPORTED_REASONING_EFFORT' })
  return { ...config }
} }

test('only incompatible stored effort is cleared, preserving route and other errors', async () => {
  assert.deepEqual(await normalizeStoredReasoning(llm, stale), plain)
  const supported = { ...stale, provider: 'supported' }
  assert.equal(await normalizeStoredReasoning(llm, supported), supported)
  for (const code of ['NO_ADAPTER', 'UNKNOWN_MODEL', 'MISSING_CREDENTIAL']) {
    await assert.rejects(normalizeStoredReasoning({ resolveCallConfig() { throw Object.assign(new Error(code), { code }) } }, stale), { code })
  }
})

test('old pending/default/logged selection repairs before request and is durable on reload', async () => {
  const patched = patchReasoningAgentSource(source('dsh-agent/lib/index.js'))
  const start = patched.indexOf('function installModelSelection(')
  const end = patched.indexOf('\n//#endregion', start)
  const install = vm.runInNewContext(patched.slice(start, end) + '; installModelSelection', { normalizeStoredReasoning })
  const handlers = new Map(), persisted = []
  const selection = { current: clone(stale) }
  install({ llm, on(name, handler) { handlers.set(name, handler); return () => {} } }, selection, next => persisted.push(clone(next)))
  const assembly = await handlers.get('system-prompt/assemble')({}, {}, async () => ({ variables: {} }))
  assert.equal(assembly.variables.model, stale.model)
  const request = await handlers.get('agent/request')({}, async () => ({ ...stale, maxTokens: 4096 }))
  assert.deepEqual(clone(request), { ...plain, maxTokens: 4096 })
  assert.deepEqual(persisted, [plain])
  selection.current = clone(persisted[0])
  await handlers.get('system-prompt/assemble')({}, {}, async () => ({ variables: {} }))
  assert.equal(persisted.length, 1)
})

test('model switching drops unsupported carried effort; explicit same-model invalid selection still rejects', async () => {
  const patched = patchReasoningControllerSource(source('dsh-api-session-controller/lib/index.js'))
  const start = patched.indexOf('var SessionCommandController = class {')
  const end = patched.indexOf('\n//#endregion', start)
  class RemoteError extends Error { constructor(code, message) { super(message); this.code = code } }
  const Controller = vm.runInNewContext(patched.slice(start, end) + '; SessionCommandController', {
    normalizeStoredReasoning, ReasoningEffortId: value => value, remoteErrorOf: () => undefined, RemoteError,
  })
  let current = { provider: 'official', model: 'deepseek-flash', reasoningEffort: 'high' }
  let saved
  const controller = new Controller({ llm, agentDefaultModel: { async saveSelection(next) { saved = clone(next) } }, logger: { warn() {} } }, {
    serializeImageAdmission: (_agent, fn) => fn(), selectionFor: () => ({ current }),
    selectForNextRequest: (_agent, next) => { current = next },
  })
  controller.resolveAgent = async () => ({})
  assert.deepEqual(clone(await controller.selectModel({ ...stale, sessionId: 'test' })), { selected: plain })
  assert.deepEqual(saved, plain)
  await assert.rejects(controller.selectModel({ ...stale, sessionId: 'test' }), /unsupported/)
  // Default must remain absent in persisted selection even if adapter materializes a default.
  controller.ctx.llm = { resolveCallConfig: async c => ({ ...c, reasoningEffort: 'high' }) }
  await controller.selectModel({ ...plain, sessionId: 'test' })
  assert.deepEqual(saved, plain)
})

test('menu follows exact provider/model capabilities and does not borrow another route', () => {
  const groups = [{ id: 'official', models: [{ id: stale.model, reasoning: { efforts: [{ id: 'high' }] } }] }, { id: stale.provider, models: [{ id: stale.model }] }]
  assert.deepEqual(normalizeCatalogReasoning(stale, groups), plain)
  const supported = { ...stale, provider: 'official' }
  assert.equal(normalizeCatalogReasoning(supported, groups), supported)
  assert.equal(normalizeCatalogReasoning(stale, []), stale)
})

test('rendered effort menu updates from capabilities and Default/Off submit different selections', async () => {
  const patched = patchReasoningMenuSource(source('dsh-client-ui-model-selection/lib/client.js'))
  const start = patched.indexOf('function ModelSelect(')
  const end = patched.indexOf('\n\t\t//#endregion', start)
  const jsx = (type, props, key) => ({ type, props, key })
  const render = state => {
    let hook = 0
    const selected = []
    const Component = vm.runInNewContext(patched.slice(start, end) + '; ModelSelect', {
      react: {
        useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
        useState: value => [[true, 'effort', null][hook++] ?? value, () => {}],
        useRef: value => ({ current: value }), useId: () => 'test', useMemo: fn => fn(), useEffect: () => {},
      },
      react_jsx_runtime: { jsx, jsxs: jsx, Fragment: 'fragment' },
      ModelSelect_module_css_default: {}, _deepseek_ai_dsh_client_ui_primitives: {},
      clsx: () => '', queueMicrotask,
    })
    const tree = Component({ available: true, locked: false, directory: { subscribe() {}, getSnapshot: () => state }, load() {}, select: async value => { selected.push(clone(value)); return true }, t: key => key })
    const nodes = []
    const visit = node => {
      if (Array.isArray(node)) return node.forEach(visit)
      if (!node || typeof node !== 'object') return
      nodes.push(node)
      visit(node.props?.children)
    }
    visit(tree)
    return { buttons: nodes.filter(node => node.props?.role === 'menuitemradio'), selected }
  }
  const state = { current: stale, status: 'ready', error: null, failures: [], groups: [{ id: stale.provider, models: [{ id: stale.model, name: 'Test', reasoning: { efforts: ['off', 'low', 'high', 'max'].map(id => ({ id, name: id })) } }] }] }
  const active = render(state)
  assert.deepEqual(active.buttons.map(node => node.key), ['provider-default', 'effort:off', 'effort:low', 'effort:high', 'effort:max'])
  active.buttons[0].props.onClick()
  active.buttons[1].props.onClick()
  assert.deepEqual(active.selected, [plain, { ...plain, reasoningEffort: 'off' }])
  state.groups[0].models[0].reasoning = undefined
  state.current = normalizeCatalogReasoning(stale, state.groups)
  assert.equal(render(state).buttons.length, 0)
})

test('actual OpenAI serializer emits distinct Default, Off, Low, High and Max payloads', async () => {
  for (const format of ['deepseek', 'openai']) for (const effort of [undefined, 'off', 'low', 'high', 'max']) {
    if (format === 'openai' && effort === 'off') continue
    const model = {
      id: stale.model, name: 'Test', provider: stale.provider, api: 'openai-completions',
      baseUrl: 'https://example.invalid/v1', input: ['text'], contextWindow: 256000, maxTokens: 32768,
      reasoning: true, thinkingLevelMap: { off: 'off', minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' },
      compat: { thinkingFormat: format, supportsReasoningEffort: true, requiresReasoningContentOnAssistantMessages: true },
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }
    let payload
    const result = await stream(model, { messages: [{ role: 'user', content: 'OK', timestamp: 1 }] }, {
      apiKey: 'test-only', reasoningEffort: effort === 'off' ? undefined : effort,
      onPayload(body) { payload = applyReasoningWireIntent(body, model, effort); throw new Error('captured without network') },
    }).result()
    assert.match(result.errorMessage, /captured without network/)
    if (effort === undefined) {
      assert.equal(payload.reasoning_effort, undefined)
      assert.equal(payload.thinking, undefined)
    } else if (effort === 'off') {
      assert.deepEqual(payload.thinking, { type: 'disabled' })
      assert.equal(payload.reasoning_effort, undefined)
    } else {
      assert.equal(payload.reasoning_effort, effort)
      if (format === 'deepseek') assert.deepEqual(payload.thinking, { type: 'enabled' })
    }
  }
})

test('runtime overlays are idempotent and fail on unexpected upstream code', () => {
  for (const [file, patch] of [
    ['dsh-agent/lib/index.js', patchReasoningAgentSource],
    ['dsh-api-session-controller/lib/index.js', patchReasoningControllerSource],
    ['dsh-client-ui-model-selection/lib/client.js', patchReasoningMenuSource],
    ['dsh-llm-pi-ai/lib/index.js', patchReasoningAdapterSource],
  ]) {
    const patched = patch(source(file))
    assert.equal(patch(patched), patched)
    assert.throws(() => patch('upstream changed'), /anchor changed/)
  }
})

test('packaged YAML gates DeepSeek capabilities on the verified Semir route', () => {
  const text = readFileSync(new URL('../../integrations/deepseek-harness/profile/web/cordis.patch.yml', import.meta.url), 'utf8')
  const parsed = YAML.parse(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: expression => ({ expression }) }] })
  const provider = parsed.find(row => row.id === 'llm-pi-ai').config.providers['crawshrimp-domestic-openai']
  for (const model of provider.models.filter(model => model.id.startsWith('deepseek-'))) {
    const expression = model.reasoningEfforts.expression
    assert.deepEqual(clone(vm.runInNewContext(expression, { process: { env: {} } })), { off: 'off', low: 'low', high: 'high', max: 'max' })
    assert.equal(vm.runInNewContext(expression, { process: { env: { CRAWSHRIMP_DOMESTIC_OPENAI_BASE_URL: 'https://ai-aigw.semir.com/bigdata/v1' } } }), false)
  }
})

test('full patched pi adapter passes Default/Off intent through streamSimple to HTTP payload', async () => {
  const model = {
    id: stale.model, name: 'Test', provider: stale.provider, api: 'openai-completions', baseUrl: 'https://example.invalid/v1',
    input: ['text'], contextWindow: 256000, maxTokens: 32768, reasoning: true,
    thinkingLevelMap: { off: 'off', minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' },
    compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true, requiresReasoningContentOnAssistantMessages: true },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
  const profiles = new Map([[stale.provider, { configuredMaxTokens: new Map(), streamIdleTimeoutMs: 10000 }]])
  const adapter = new PiAiAdapter({ profiles: () => profiles, resolveApiKey: async () => 'test-only' })
  let payload
  adapter.snapshot = { profiles, models: {
    getModel: () => model,
    streamSimple(m, context, options) {
      return streamSimple(m, context, { ...options, onPayload(body) {
        payload = options.onPayload(body)
        throw new Error('adapter captured without network')
      } })
    },
  } }
  const info = await adapter.resolveModel(stale.provider, stale.model)
  assert.deepEqual(info.reasoning.efforts.map(e => e.id), ['off', 'low', 'high', 'max'])
  for (const effort of [undefined, 'off', 'high']) {
    const chunks = []
    for await (const chunk of adapter.stream({ ...plain, reasoningEffort: effort, messages: [createUserMessage({ content: [{ type: 'text', text: 'OK' }], source: { kind: 'user' } })] })) chunks.push(chunk)
    assert.match(JSON.stringify(chunks), /adapter captured without network/)
    assert.equal(payload.reasoning_effort, effort === 'high' ? 'high' : undefined)
    assert.deepEqual(payload.thinking, effort === undefined ? undefined : { type: effort === 'off' ? 'disabled' : 'enabled' })
  }
})
