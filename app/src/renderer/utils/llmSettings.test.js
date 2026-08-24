import test from 'node:test'
import assert from 'node:assert/strict'
import { reactive } from 'vue'

import {
  LLM_API_KEY_FIELD,
  DEEPSEEK_API_KEY_FIELD,
  DEEPSEEK_OFFICIAL_MODELS_UI,
  DEEPSEEK_PLATFORM_URL,
  DOMESTIC_API_KEY_FIELD,
  LLM_BUILTIN_PROVIDERS,
  LLM_CUSTOM_PROVIDERS_FIELD,
  LLM_DEFAULTS,
  LLM_MASKED_CREDENTIAL_VALUE,
  LLM_MODELS,
  OVERSEAS_ANTHROPIC_API_KEY_FIELD,
  OVERSEAS_OPENAI_API_KEY_FIELD,
  buildLlmSettingsPatch,
  clearWrittenLlmSettings,
  isDeepSeekConfigured,
  isLlmConfigured,
  llmProviderConfigured,
} from './llmSettings.mjs'

test('LLM settings expose all configured gateway defaults and supported model ids', () => {
  assert.equal(LLM_DEFAULTS['ai.llm.default_model'], 'deepseek-official-v4-flash')
  assert.equal(LLM_DEFAULTS['ai.llm.deepseek_base_url'], 'https://api.deepseek.com')
  assert.equal(DEEPSEEK_PLATFORM_URL, 'https://platform.deepseek.com/')
  assert.equal(LLM_MODELS.length, 16)
  assert.deepEqual(
    LLM_MODELS.map(item => item.value),
    [
      'deepseek-official-v4-flash',
      'deepseek-official-v4-pro',
      'deepseek-official-v4-flash-vision-exp',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gemini-3.1-pro-preview',
      'gemini-3.5-flash',
      'claude-opus-4-8',
      'claude-sonnet-5',
      'qwen3.8-max-preview',
      'qwen3.7-plus',
      'deepseek-v4-pro',
      'glm-5.2',
      'kimi-k2.7-code',
    ],
  )
  assert.deepEqual(DEEPSEEK_OFFICIAL_MODELS_UI.map(item => item.value), [
    'deepseek-official-v4-flash',
    'deepseek-official-v4-pro',
    'deepseek-official-v4-flash-vision-exp',
  ])
})

test('masked or blank LLM credentials are never posted back to settings', () => {
  assert.deepEqual(buildLlmSettingsPatch({
    [LLM_API_KEY_FIELD]: LLM_MASKED_CREDENTIAL_VALUE,
    [OVERSEAS_OPENAI_API_KEY_FIELD]: LLM_MASKED_CREDENTIAL_VALUE,
    [DEEPSEEK_API_KEY_FIELD]: LLM_MASKED_CREDENTIAL_VALUE,
    'ai.llm.overseas_openai_base_url': LLM_DEFAULTS['ai.llm.overseas_openai_base_url'],
    'ai.llm.overseas_anthropic_base_url': '',
    'ai.llm.default_model': 'claude-sonnet-5',
  }), {
    'ai.llm.overseas_openai_base_url': LLM_DEFAULTS['ai.llm.overseas_openai_base_url'],
    'ai.llm.default_model': 'claude-sonnet-5',
  })
})

test('DeepSeek official key is posted as its own field and cleared after write', () => {
  assert.deepEqual(buildLlmSettingsPatch({
    [DEEPSEEK_API_KEY_FIELD]: 'sk-deepseek-unit',
    'ai.llm.deepseek_base_url': 'https://api.deepseek.com',
    'ai.llm.default_model': 'deepseek-official-v4-flash',
  }), {
    [DEEPSEEK_API_KEY_FIELD]: 'sk-deepseek-unit',
    'ai.llm.deepseek_base_url': 'https://api.deepseek.com',
    'ai.llm.default_model': 'deepseek-official-v4-flash',
  })
  const cfg = { [DEEPSEEK_API_KEY_FIELD]: 'sk-deepseek-unit' }
  clearWrittenLlmSettings(cfg, { [DEEPSEEK_API_KEY_FIELD]: 'sk-deepseek-unit' })
  assert.equal(cfg[DEEPSEEK_API_KEY_FIELD], LLM_MASKED_CREDENTIAL_VALUE)
  assert.equal(cfg['ai.llm.deepseek_configured'], true)
  assert.equal(isDeepSeekConfigured(cfg), true)
})

test('LLM settings patch is structured-clone safe when custom models are reactive', () => {
  const cfg = reactive({
    [DEEPSEEK_API_KEY_FIELD]: 'sk-deepseek-unit',
    'ai.llm.deepseek_base_url': 'https://api.deepseek.com',
    'ai.llm.default_model': 'deepseek-official-v4-flash',
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
  assert.deepEqual(patch[LLM_CUSTOM_PROVIDERS_FIELD][0].models[0].input_modalities, ['text'])
})

test('DeepSeek official configured badge uses backend boolean without receiving the key', () => {
  assert.equal(isDeepSeekConfigured({ 'ai.llm.deepseek_configured': true }), true)
  assert.equal(isDeepSeekConfigured({ 'ai.llm.deepseek_configured': false }), false)
  assert.equal(isDeepSeekConfigured({ [DEEPSEEK_API_KEY_FIELD]: 'sk-deepseek-unit' }), true)
  assert.equal(isDeepSeekConfigured({ [DEEPSEEK_API_KEY_FIELD]: LLM_MASKED_CREDENTIAL_VALUE }), false)
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
  assert.equal(isLlmConfigured(cfg), true)
})

test('legacy shared gateway key fills all Semir provider configured states', () => {
  const cfg = { [LLM_API_KEY_FIELD]: 'legacy-gateway-secret' }
  for (const provider of LLM_BUILTIN_PROVIDERS.filter(item => item.legacyApiKeyField === LLM_API_KEY_FIELD)) {
    assert.equal(llmProviderConfigured(cfg, provider), true)
  }
})
