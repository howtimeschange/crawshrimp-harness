import test from 'node:test'
import assert from 'node:assert/strict'
import { reactive } from 'vue'

import {
  mergeCustomLlmModelDraft,
  customLlmBudgetError,
  LLM_API_KEY_FIELD,
  DEEPSEEK_API_KEY_FIELD,
  DEEPSEEK_OFFICIAL_MODELS_UI,
  DEEPSEEK_PLATFORM_URL,
  DOMESTIC_API_KEY_FIELD,
  GLM_API_KEY_FIELD,
  GLM_OFFICIAL_BASE_URL_DEFAULT,
  GLM_OFFICIAL_MODELS_UI,
  LLM_BUILTIN_PROVIDERS,
  LLM_CUSTOM_PROVIDERS_FIELD,
  LLM_BUILTIN_PROVIDER_MODELS_FIELD,
  normalizeBuiltinProviderModels,
  builtinLlmProviderModelIds,
  builtinLlmProviderModels,
  mergeDiscoveredLlmModels,
  LLM_DEFAULTS,
  LLM_MASKED_CREDENTIAL_VALUE,
  LLM_MODELS,
  OVERSEAS_ANTHROPIC_API_KEY_FIELD,
  OVERSEAS_OPENAI_API_KEY_FIELD,
  buildLlmSettingsPatch,
  clearWrittenLlmSettings,
  isDeepSeekConfigured,
  isGlmConfigured,
  isLlmConfigured,
  llmProviderConfigured,
} from './llmSettings.mjs'

test('custom reasoning survives reactive save and unrelated edits; Default removes the opt-in', () => {
  const model = { id: 'deepseek-v4-pro', reasoning_protocol: 'deepseek', reasoning_efforts: ['off', 'low', 'high', 'max'] }
  const models = mergeCustomLlmModelDraft('deepseek-v4-pro\nother', [model])
  assert.deepEqual(models[0].reasoning_efforts, model.reasoning_efforts)
  assert.equal(models[1].reasoning_protocol, undefined)
  const cfg = reactive({ [LLM_CUSTOM_PROVIDERS_FIELD]: [{ id: 'custom-test', name: 'Test', protocol: 'openai', base_url: 'https://example.invalid', models }] })
  const saved = structuredClone(buildLlmSettingsPatch(cfg))[LLM_CUSTOM_PROVIDERS_FIELD][0]
  assert.deepEqual(saved.models[0].reasoning_efforts, model.reasoning_efforts)
  assert.equal(customLlmBudgetError(saved.models), '')
  saved.models[0].reasoning_efforts = ['off']
  assert.match(customLlmBudgetError(saved.models), /至少选择/)
  assert.equal(customLlmBudgetError(saved.models, 'anthropic'), '')
  saved.models[0].reasoning_protocol = 'default'
  const reset = mergeCustomLlmModelDraft('deepseek-v4-pro', saved.models)[0]
  assert.equal(reset.reasoning_protocol, undefined)
  assert.equal(reset.reasoning_efforts, undefined)
})

test('LLM settings expose all configured gateway defaults and supported model ids', () => {
  assert.equal(LLM_DEFAULTS['ai.llm.default_model'], 'deepseek-official-flash')
  assert.equal(LLM_DEFAULTS['ai.llm.deepseek_base_url'], 'https://api.deepseek.com')
  assert.equal(LLM_DEFAULTS['ai.llm.glm_base_url'], GLM_OFFICIAL_BASE_URL_DEFAULT)
  assert.equal(DEEPSEEK_PLATFORM_URL, 'https://platform.deepseek.com/')
  assert.equal(LLM_MODELS.length, 26)
  assert.deepEqual(
    LLM_MODELS.map(item => item.value),
    [
      'deepseek-official-flash',
      'deepseek-official-v4-pro',
      'glm-official-5.3-flash',
      'glm-official-5.3',
      'glm-official-5.2',
      'gpt-6.1-sol',
      'gpt-6-astra',
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gemini-3.1-pro-preview',
      'gemini-3.5-flash',
      'claude-opus-4-8',
      'claude-sonnet-5',
      'qwen3.8-max',
      'qwen3.8-max-preview',
      'qwen3.7-plus',
      'deepseek-v4.1-flash',
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'glm-5.2',
      'kimi-k3',
      'kimi-k2.7-code',
    ],
  )
  assert.deepEqual(DEEPSEEK_OFFICIAL_MODELS_UI.map(item => item.value), [
    'deepseek-official-flash',
    'deepseek-official-v4-pro',
  ])
  assert.deepEqual(GLM_OFFICIAL_MODELS_UI.map(item => item.value), [
    'glm-official-5.3-flash',
    'glm-official-5.3',
    'glm-official-5.2',
  ])
})

test('masked or blank LLM credentials are never posted back to settings', () => {
  assert.deepEqual(buildLlmSettingsPatch({
    [LLM_API_KEY_FIELD]: LLM_MASKED_CREDENTIAL_VALUE,
    [OVERSEAS_OPENAI_API_KEY_FIELD]: LLM_MASKED_CREDENTIAL_VALUE,
    [DEEPSEEK_API_KEY_FIELD]: LLM_MASKED_CREDENTIAL_VALUE,
    [GLM_API_KEY_FIELD]: LLM_MASKED_CREDENTIAL_VALUE,
    'ai.llm.overseas_openai_base_url': LLM_DEFAULTS['ai.llm.overseas_openai_base_url'],
    'ai.llm.overseas_anthropic_base_url': '',
    'ai.llm.glm_base_url': GLM_OFFICIAL_BASE_URL_DEFAULT,
    'ai.llm.default_model': 'claude-sonnet-5',
  }), {
    'ai.llm.overseas_openai_base_url': LLM_DEFAULTS['ai.llm.overseas_openai_base_url'],
    'ai.llm.glm_base_url': GLM_OFFICIAL_BASE_URL_DEFAULT,
    'ai.llm.default_model': 'claude-sonnet-5',
  })
})

test('DeepSeek official key is posted as its own field and cleared after write', () => {
  assert.deepEqual(buildLlmSettingsPatch({
    [DEEPSEEK_API_KEY_FIELD]: 'sk-deepseek-unit',
    'ai.llm.deepseek_base_url': 'https://api.deepseek.com',
    'ai.llm.default_model': 'deepseek-official-flash',
  }), {
    [DEEPSEEK_API_KEY_FIELD]: 'sk-deepseek-unit',
    'ai.llm.deepseek_base_url': 'https://api.deepseek.com',
    'ai.llm.default_model': 'deepseek-official-flash',
  })
  const cfg = { [DEEPSEEK_API_KEY_FIELD]: 'sk-deepseek-unit' }
  clearWrittenLlmSettings(cfg, { [DEEPSEEK_API_KEY_FIELD]: 'sk-deepseek-unit' })
  assert.equal(cfg[DEEPSEEK_API_KEY_FIELD], LLM_MASKED_CREDENTIAL_VALUE)
  assert.equal(cfg['ai.llm.deepseek_configured'], true)
  assert.equal(isDeepSeekConfigured(cfg), true)
})

test('GLM official key is posted as its own field and cleared after write', () => {
  assert.deepEqual(buildLlmSettingsPatch({
    [GLM_API_KEY_FIELD]: 'glm-unit-key',
    'ai.llm.glm_base_url': GLM_OFFICIAL_BASE_URL_DEFAULT,
    'ai.llm.default_model': 'glm-official-5.3-flash',
  }), {
    [GLM_API_KEY_FIELD]: 'glm-unit-key',
    'ai.llm.glm_base_url': GLM_OFFICIAL_BASE_URL_DEFAULT,
    'ai.llm.default_model': 'glm-official-5.3-flash',
  })
  const cfg = { [GLM_API_KEY_FIELD]: 'glm-unit-key' }
  clearWrittenLlmSettings(cfg, { [GLM_API_KEY_FIELD]: 'glm-unit-key' })
  assert.equal(cfg[GLM_API_KEY_FIELD], LLM_MASKED_CREDENTIAL_VALUE)
  assert.equal(cfg['ai.llm.glm_configured'], true)
  assert.equal(isGlmConfigured(cfg), true)
})

test('LLM settings patch is structured-clone safe when custom models are reactive', () => {
  const cfg = reactive({
    [DEEPSEEK_API_KEY_FIELD]: 'sk-deepseek-unit',
    'ai.llm.deepseek_base_url': 'https://api.deepseek.com',
    'ai.llm.default_model': 'deepseek-official-flash',
    [LLM_CUSTOM_PROVIDERS_FIELD]: [
      {
        id: 'custom-reactive',
        name: 'Reactive Provider',
        protocol: 'openai',
        base_url: 'https://api.example.com/v1',
        api_key: LLM_MASKED_CREDENTIAL_VALUE,
        configured: true,
        models: [
          {
            id: 'reactive-model',
            label: 'Reactive Model',
            input_modalities: ['text'],
          },
        ],
      },
    ],
  })

  const patch = buildLlmSettingsPatch(cfg)
  assert.doesNotThrow(() => structuredClone(patch))
  assert.deepEqual(patch[LLM_CUSTOM_PROVIDERS_FIELD][0].models[0].input_modalities, ['text', 'image'])
})

test('DeepSeek official configured badge uses backend boolean without receiving the key', () => {
  assert.equal(isDeepSeekConfigured({ 'ai.llm.deepseek_configured': true }), true)
  assert.equal(isDeepSeekConfigured({ 'ai.llm.deepseek_configured': false }), false)
  assert.equal(isDeepSeekConfigured({ [DEEPSEEK_API_KEY_FIELD]: 'sk-deepseek-unit' }), true)
  assert.equal(isDeepSeekConfigured({ [DEEPSEEK_API_KEY_FIELD]: LLM_MASKED_CREDENTIAL_VALUE }), false)
})

test('GLM official configured badge uses backend boolean without receiving the key', () => {
  assert.equal(isGlmConfigured({ 'ai.llm.glm_configured': true }), true)
  assert.equal(isGlmConfigured({ 'ai.llm.glm_configured': false }), false)
  assert.equal(isGlmConfigured({ [GLM_API_KEY_FIELD]: 'glm-unit-key' }), true)
  assert.equal(isGlmConfigured({ [GLM_API_KEY_FIELD]: LLM_MASKED_CREDENTIAL_VALUE }), false)
})

test('successful LLM key writes are cleared from renderer memory', () => {
  const cfg = {
    [LLM_API_KEY_FIELD]: 'unit-secret',
    'ai.llm.configured': false,
  }
  clearWrittenLlmSettings(cfg, { [LLM_API_KEY_FIELD]: 'unit-secret' })
  assert.equal(cfg[LLM_API_KEY_FIELD], LLM_MASKED_CREDENTIAL_VALUE)
  assert.equal(cfg['ai.llm.configured'], true)
  assert.equal(cfg[OVERSEAS_OPENAI_API_KEY_FIELD], LLM_MASKED_CREDENTIAL_VALUE)
  assert.equal(cfg[OVERSEAS_ANTHROPIC_API_KEY_FIELD], LLM_MASKED_CREDENTIAL_VALUE)
  assert.equal(cfg[DOMESTIC_API_KEY_FIELD], LLM_MASKED_CREDENTIAL_VALUE)
  assert.equal(cfg[GLM_API_KEY_FIELD], undefined)
  assert.equal(isLlmConfigured(cfg), true)
})

test('legacy shared gateway key fills all Semir provider configured states', () => {
  const cfg = { [LLM_API_KEY_FIELD]: 'legacy-gateway-secret' }
  for (const provider of LLM_BUILTIN_PROVIDERS.filter(item => item.legacyApiKeyField === LLM_API_KEY_FIELD)) {
    assert.equal(llmProviderConfigured(cfg, provider), true)
  }
})

test('saved official Flash defaults migrate without renaming gateway models', async () => {
  const { normalizeDeepSeekModelId } = await import('./llmSettings.mjs')
  assert.equal(normalizeDeepSeekModelId('deepseek-official-v4-flash'), 'deepseek-official-flash')
  assert.equal(normalizeDeepSeekModelId('deepseek-official-v4-flash-vision-exp'), 'deepseek-official-flash')
  assert.equal(normalizeDeepSeekModelId('deepseek-v4-flash'), 'deepseek-v4-flash')
})


test('custom models default to 256K/32K and preserve edited budgets', () => {
  const defaults = mergeCustomLlmModelDraft('example-model')
  assert.equal(defaults[0].context_window, 256000)
  assert.equal(defaults[0].max_output_tokens, 32768)
  const edited = [{ ...defaults[0], context_window: 512000, max_output_tokens: 48000, input_modalities: ['text', 'image'] }]
  const saved = mergeCustomLlmModelDraft('example-model\nsecond-model', edited)
  assert.deepEqual(saved[0], edited[0])
  assert.equal(saved[1].max_output_tokens, 32768)
  assert.equal(customLlmBudgetError(saved), '')
  for (const value of [0, -1, 1.5, Infinity, '', 512000]) {
    assert.ok(customLlmBudgetError([{ ...edited[0], max_output_tokens: value }]))
  }
})

test('built-in model lists replace presets and save metadata without copying credentials', () => {
  const provider = LLM_BUILTIN_PROVIDERS.find(item => item.id === 'crawshrimp-overseas-openai')
  const cfg = reactive({
    [OVERSEAS_OPENAI_API_KEY_FIELD]: LLM_MASKED_CREDENTIAL_VALUE,
    [LLM_BUILTIN_PROVIDER_MODELS_FIELD]: {
      [provider.id]: [{ id: 'future-model', label: '自定义模型', context_window: 512000, max_output_tokens: 48000,
        input_modalities: ['text', 'image'], reasoning_protocol: 'openai', reasoning_efforts: ['low', 'high'], api_key: 'must-not-copy' }],
      unknown: [{ id: 'ignored' }],
    },
  })
  const ids = builtinLlmProviderModelIds(provider, cfg)
  assert.deepEqual(ids, ['future-model'])
  const saved = structuredClone(buildLlmSettingsPatch(cfg))
  assert.equal(saved[OVERSEAS_OPENAI_API_KEY_FIELD], undefined)
  assert.equal(saved[LLM_BUILTIN_PROVIDER_MODELS_FIELD].unknown, undefined)
  const model = saved[LLM_BUILTIN_PROVIDER_MODELS_FIELD][provider.id][0]
  assert.equal(model.label, '自定义模型')
  assert.equal(model.context_window, 512000)
  assert.deepEqual(model.reasoning_efforts, ['low', 'high'])
  assert.equal(model.api_key, undefined)
  cfg[LLM_BUILTIN_PROVIDER_MODELS_FIELD][provider.id] = [{ id: provider.models[0].value }]
  assert.equal(builtinLlmProviderModelIds(provider, cfg).length, 1)
  cfg[LLM_BUILTIN_PROVIDER_MODELS_FIELD][provider.id] = []
  assert.deepEqual(normalizeBuiltinProviderModels(cfg[LLM_BUILTIN_PROVIDER_MODELS_FIELD]), { [provider.id]: [] })
  assert.deepEqual(builtinLlmProviderModelIds(provider, cfg), [])
})

test('each preset supports editing, deletion, empty lists and restoring accurate defaults', () => {
  for (const provider of LLM_BUILTIN_PROVIDERS) {
    const defaults = builtinLlmProviderModels(provider)
    const edited = [{ ...defaults[0], label: 'Edited', context_window: 2000000, reasoning_protocol: 'default' },
      { id: 'new-model', context_window: 512000, max_output_tokens: 48000 }]
    const cfg = {
      [LLM_BUILTIN_PROVIDER_MODELS_FIELD]: { [provider.id]: edited },
      'ai.llm.builtin_provider_model_defaults': { [provider.id]: defaults.map(model => ({ ...model, context_window: 1234567 })) },
    }
    assert.deepEqual(builtinLlmProviderModelIds(provider, cfg), [defaults[0].id, 'new-model'])
    assert.equal(builtinLlmProviderModels(provider, cfg)[0].label, 'Edited')
    assert.equal(mergeCustomLlmModelDraft(defaults[0].id, edited, true)[0].reasoning_protocol, 'default')
    assert.equal(builtinLlmProviderModels(provider, cfg, true)[0].context_window, 1234567)
    cfg[LLM_BUILTIN_PROVIDER_MODELS_FIELD][provider.id] = builtinLlmProviderModels(provider, cfg, true)
    assert.deepEqual(builtinLlmProviderModelIds(provider, cfg), defaults.map(model => model.id))
  }
})

test('importing only selected discovered models preserves edits and avoids duplicates', () => {
  const existing = mergeCustomLlmModelDraft('first')
  existing[0].context_window = 512000
  existing[0].reasoning_protocol = 'default'
  const discovered = [{ id: 'first', context_window: 2000000 }, { id: 'second' }, { id: 'third' }]
  const merged = mergeDiscoveredLlmModels(existing, discovered, ['first', 'second'])
  assert.deepEqual(merged.map(model => model.id), ['first', 'second'])
  assert.equal(merged[0].context_window, 512000)
  assert.equal(merged[0].reasoning_protocol, 'default')
  assert.equal(buildLlmSettingsPatch({ 'ai.llm.default_model': '' })['ai.llm.default_model'], '')
})

test('all preset requests forward images and enable tools', () => {
  const defaults = LLM_BUILTIN_PROVIDERS.flatMap(provider => builtinLlmProviderModels(provider))
  const byId = new Map(defaults.map(model => [model.id, model]))
  for (const model of defaults.filter(model => /^(gpt-|gemini-|claude-)/.test(model.id))) {
    assert.deepEqual(model.input_modalities, ['text', 'image'], model.id)
    assert.equal(model.supports_tools, true)
  }
  assert.equal(byId.get('gpt-6.1-sol').max_output_tokens, 65536)
  assert.equal(byId.get('gemini-3.5-flash').context_window, 1000000)
  assert.equal(byId.get('claude-sonnet-5').max_output_tokens, 64000)
  assert.deepEqual(byId.get('deepseek-official-flash').input_modalities, ['text', 'image'])
  assert.equal(byId.get('deepseek-official-flash').max_output_tokens, 393216)
  assert.deepEqual(byId.get('glm-official-5.3-flash').input_modalities, ['text', 'image'])
  assert.equal(byId.get('glm-official-5.3-flash').max_output_tokens, 8192)
  for (const id of ['deepseek-official-v4-pro', 'glm-official-5.3', 'glm-official-5.2']) {
    assert.deepEqual(byId.get(id).input_modalities, ['text', 'image'], id)
  }
})

test('backend and saved budgets take precedence while legacy image flags cannot drop attachments', () => {
  const provider = LLM_BUILTIN_PROVIDERS.find(item => item.id === 'crawshrimp-overseas-openai')
  const cfg = {
    'ai.llm.builtin_provider_model_defaults': { [provider.id]: [
      { id: 'gpt-6.1-sol', input_modalities: ['text'], max_output_tokens: 48000 },
    ] },
  }
  const backend = builtinLlmProviderModels(provider, cfg)[0]
  assert.deepEqual(backend.input_modalities, ['text', 'image'])
  assert.equal(backend.max_output_tokens, 48000)
  assert.equal(backend.context_window, 256000)
  cfg[LLM_BUILTIN_PROVIDER_MODELS_FIELD] = { [provider.id]: [{ ...backend, max_output_tokens: 32000 }] }
  const saved = builtinLlmProviderModels(provider, cfg)[0]
  assert.deepEqual(saved.input_modalities, ['text', 'image'])
  assert.equal(saved.max_output_tokens, 32000)
  assert.deepEqual(builtinLlmProviderModels(provider, cfg, true)[0], backend)
})

test('known and custom model additions both forward images while preserving budget defaults', () => {
  const added = mergeCustomLlmModelDraft('gpt-6.1-sol\nunknown-vision-name', [], true)
  assert.deepEqual(added[0].input_modalities, ['text', 'image'])
  assert.equal(added[0].max_output_tokens, 65536)
  assert.deepEqual(added[1].input_modalities, ['text', 'image'])
  const edited = [{ ...added[0], input_modalities: ['text'] }]
  assert.deepEqual(mergeCustomLlmModelDraft('gpt-6.1-sol', edited, true)[0].input_modalities, ['text', 'image'])
  const legacy = [{ id: 'old-custom', supports_tools: false, input_modalities: ['text'], max_output_tokens: 48000 }]
  const migrated = mergeCustomLlmModelDraft('old-custom', legacy)[0]
  assert.equal(migrated.supports_tools, true)
  assert.deepEqual(migrated.input_modalities, ['text', 'image'])
  assert.equal(migrated.max_output_tokens, 48000)
})
