export const LLM_MASKED_CREDENTIAL_VALUE = '••••••••••••••••••••••••••••••••'

// Legacy shared gateway key. It is kept as a migration fallback only.
export const LLM_API_KEY_FIELD = 'ai.llm.api_key'

export const OVERSEAS_OPENAI_API_KEY_FIELD = 'ai.llm.overseas_openai_api_key'
export const OVERSEAS_ANTHROPIC_API_KEY_FIELD = 'ai.llm.overseas_anthropic_api_key'
export const DOMESTIC_API_KEY_FIELD = 'ai.llm.domestic_api_key'

// DeepSeek 原生接入:独立 Key 与 Base URL(官方 API,不走公司网关)
export const DEEPSEEK_API_KEY_FIELD = 'ai.llm.deepseek_api_key'
export const DEEPSEEK_BASE_URL_FIELD = 'ai.llm.deepseek_base_url'
export const DEEPSEEK_OFFICIAL_BASE_URL_DEFAULT = 'https://api.deepseek.com'
export const DEEPSEEK_PLATFORM_URL = 'https://platform.deepseek.com/'
export const GLM_API_KEY_FIELD = 'ai.llm.glm_api_key'
export const GLM_BASE_URL_FIELD = 'ai.llm.glm_base_url'
export const GLM_OFFICIAL_BASE_URL_DEFAULT = 'https://open.bigmodel.cn/api/paas/v4'

export const LLM_CUSTOM_PROVIDERS_FIELD = 'ai.llm.custom_providers'

export const LLM_DEFAULTS = Object.freeze({
  'ai.llm.overseas_openai_base_url': 'https://ai-aigw.semir.com/overseas-openai-vip/v1',
  'ai.llm.overseas_anthropic_base_url': 'https://ai-aigw.semir.com/overseas-anthropic-vip',
  'ai.llm.domestic_base_url': 'https://ai-aigw.semir.com/bailian-codingplan/v1',
  'ai.llm.deepseek_base_url': DEEPSEEK_OFFICIAL_BASE_URL_DEFAULT,
  'ai.llm.glm_base_url': GLM_OFFICIAL_BASE_URL_DEFAULT,
  'ai.llm.default_model': 'deepseek-official-v4-flash',
})

const OVERSEAS_OPENAI_MODELS = Object.freeze([
  { value: 'gpt-5.6-sol', label: '海外 · GPT-5.6 Sol' },
  { value: 'gpt-5.6-terra', label: '海外 · GPT-5.6 Terra' },
  { value: 'gpt-5.6-luna', label: '海外 · GPT-5.6 Luna' },
  { value: 'gpt-5.5', label: '海外 · GPT-5.5' },
  { value: 'gemini-3.1-pro-preview', label: '海外 · Gemini 3.1 Pro Preview' },
  { value: 'gemini-3.5-flash', label: '海外 · Gemini 3.5 Flash' },
])

const OVERSEAS_ANTHROPIC_MODELS = Object.freeze([
  { value: 'claude-opus-4-8', label: '海外 · Claude Opus 4.8' },
  { value: 'claude-sonnet-5', label: '海外 · Claude Sonnet 5' },
])

const DOMESTIC_OPENAI_MODELS = Object.freeze([
  { value: 'qwen3.8-max-preview', label: '国内 · Qwen 3.8 Max Preview' },
  { value: 'qwen3.7-plus', label: '国内 · Qwen 3.7 Plus' },
  { value: 'deepseek-v4-flash', label: '国内 · DeepSeek V4 Flash(网关)' },
  { value: 'deepseek-v4-pro', label: '国内 · DeepSeek V4 Pro(网关)' },
  { value: 'glm-5.2', label: '国内 · GLM 5.2' },
  { value: 'kimi-k3', label: '国内 · Kimi K3' },
  { value: 'kimi-k2.7-code', label: '国内 · Kimi K2.7 Code' },
])

export const DEEPSEEK_OFFICIAL_MODELS_UI = Object.freeze([
  { value: 'deepseek-official-v4-flash', label: 'DeepSeek 官方 · V4 Flash' },
  { value: 'deepseek-official-v4-pro', label: 'DeepSeek 官方 · V4 Pro' },
  { value: 'deepseek-official-v4-flash-vision-exp', label: 'DeepSeek 官方 · V4 Flash Vision Exp' },
])

export const GLM_OFFICIAL_MODELS_UI = Object.freeze([
  { value: 'glm-official-5.3-flash', label: '智谱官方 · GLM-5.3-Flash' },
  { value: 'glm-official-5.3', label: '智谱官方 · GLM-5.3' },
  { value: 'glm-official-5.2', label: '智谱官方 · GLM-5.2' },
])

export const LLM_BUILTIN_PROVIDERS = Object.freeze([
  {
    id: 'crawshrimp-deepseek-official',
    name: 'DeepSeek 官方',
    brand: 'deepseek',
    kind: 'builtin',
    protocol: 'openai',
    compatibility: 'OpenAI 兼容',
    apiKeyField: DEEPSEEK_API_KEY_FIELD,
    configuredField: 'ai.llm.deepseek_configured',
    baseUrlField: DEEPSEEK_BASE_URL_FIELD,
    defaultBaseUrl: DEEPSEEK_OFFICIAL_BASE_URL_DEFAULT,
    models: DEEPSEEK_OFFICIAL_MODELS_UI,
    officialUrl: DEEPSEEK_PLATFORM_URL,
  },
  {
    id: 'crawshrimp-glm-official',
    name: '智谱官方',
    brand: 'glm',
    kind: 'builtin',
    protocol: 'openai',
    compatibility: 'OpenAI 兼容',
    apiKeyField: GLM_API_KEY_FIELD,
    configuredField: 'ai.llm.glm_configured',
    baseUrlField: GLM_BASE_URL_FIELD,
    defaultBaseUrl: GLM_OFFICIAL_BASE_URL_DEFAULT,
    models: GLM_OFFICIAL_MODELS_UI,
  },
  {
    id: 'crawshrimp-overseas-openai',
    name: '森马海外 OpenAI',
    brand: 'semir',
    kind: 'builtin',
    protocol: 'openai',
    compatibility: 'OpenAI 兼容',
    apiKeyField: OVERSEAS_OPENAI_API_KEY_FIELD,
    legacyApiKeyField: LLM_API_KEY_FIELD,
    configuredField: 'ai.llm.overseas_openai_configured',
    baseUrlField: 'ai.llm.overseas_openai_base_url',
    defaultBaseUrl: LLM_DEFAULTS['ai.llm.overseas_openai_base_url'],
    models: OVERSEAS_OPENAI_MODELS,
  },
  {
    id: 'crawshrimp-overseas-anthropic',
    name: '森马海外 Anthropic',
    brand: 'semir',
    kind: 'builtin',
    protocol: 'anthropic',
    compatibility: 'Anthropic 兼容',
    apiKeyField: OVERSEAS_ANTHROPIC_API_KEY_FIELD,
    legacyApiKeyField: LLM_API_KEY_FIELD,
    configuredField: 'ai.llm.overseas_anthropic_configured',
    baseUrlField: 'ai.llm.overseas_anthropic_base_url',
    defaultBaseUrl: LLM_DEFAULTS['ai.llm.overseas_anthropic_base_url'],
    models: OVERSEAS_ANTHROPIC_MODELS,
  },
  {
    id: 'crawshrimp-domestic-openai',
    name: '森马国内 OpenAI',
    brand: 'semir',
    kind: 'builtin',
    protocol: 'openai',
    compatibility: 'OpenAI 兼容',
    apiKeyField: DOMESTIC_API_KEY_FIELD,
    legacyApiKeyField: LLM_API_KEY_FIELD,
    configuredField: 'ai.llm.domestic_configured',
    baseUrlField: 'ai.llm.domestic_base_url',
    defaultBaseUrl: LLM_DEFAULTS['ai.llm.domestic_base_url'],
    models: DOMESTIC_OPENAI_MODELS,
  },
])

export const LLM_CREDENTIAL_FIELDS = Object.freeze([
  LLM_API_KEY_FIELD,
  OVERSEAS_OPENAI_API_KEY_FIELD,
  OVERSEAS_ANTHROPIC_API_KEY_FIELD,
  DOMESTIC_API_KEY_FIELD,
  DEEPSEEK_API_KEY_FIELD,
  GLM_API_KEY_FIELD,
])

// 默认模型下拉覆盖官方 DeepSeek 与森马网关模型;运行时只展示已配置 key 的路由。
export const LLM_MODELS = Object.freeze([
  ...DEEPSEEK_OFFICIAL_MODELS_UI,
  ...GLM_OFFICIAL_MODELS_UI,
  ...OVERSEAS_OPENAI_MODELS,
  ...OVERSEAS_ANTHROPIC_MODELS,
  ...DOMESTIC_OPENAI_MODELS,
])

export const LLM_PANEL_FIELDS = Object.freeze([
  ...LLM_CREDENTIAL_FIELDS,
  ...Object.keys(LLM_DEFAULTS),
  LLM_CUSTOM_PROVIDERS_FIELD,
])

export function isMaskedCredential(value) {
  return String(value ?? '').includes(LLM_MASKED_CREDENTIAL_VALUE)
}

function hasPlainCredential(value) {
  const text = String(value ?? '').trim()
  return Boolean(text && !isMaskedCredential(text))
}

export function normalizeLlmProtocol(protocol = 'openai') {
  return String(protocol || '').toLowerCase() === 'anthropic' ? 'anthropic' : 'openai'
}

export function parseLlmModelsText(text = '') {
  return String(text || '')
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter((item, index, list) => item && list.indexOf(item) === index)
    .map(id => ({ id, label: id }))
}

function normalizeModelEntries(models = []) {
  const raw = Array.isArray(models) ? models : parseLlmModelsText(models)
  const seen = new Set()
  const normalized = []
  for (const item of raw) {
    const model = typeof item === 'string' ? { id: item } : (item && typeof item === 'object' ? item : {})
    const id = String(model.id || model.value || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const inputModalities = Array.isArray(model.input_modalities)
      ? model.input_modalities
      : (Array.isArray(model.input) ? model.input : ['text'])
    const normalizedInputModalities = inputModalities.map(item => String(item || '').trim()).filter(Boolean)
    normalized.push({
      id,
      label: String(model.label || model.name || id).trim(),
      context_window: Number(model.context_window || model.contextWindow || 64000) || 64000,
      max_output_tokens: Number(model.max_output_tokens || model.maxTokens || 8192) || 8192,
      supports_tools: model.supports_tools !== false && model.supportsTools !== false,
      input_modalities: normalizedInputModalities.length ? normalizedInputModalities : ['text'],
    })
  }
  return normalized
}

export function normalizeCustomLlmProviders(value = []) {
  const raw = Array.isArray(value) ? value : []
  return raw
    .map((item) => {
      const provider = item && typeof item === 'object' ? item : {}
      const id = String(provider.id || '').trim()
      const name = String(provider.name || provider.displayName || id).trim()
      const baseUrl = String(provider.base_url || provider.baseURL || '').trim()
      const models = normalizeModelEntries(provider.models)
      if (!id || !name) return null
      return {
        id,
        name,
        protocol: normalizeLlmProtocol(provider.protocol || provider.api),
        base_url: baseUrl,
        api_key: provider.api_key ?? provider.apiKey ?? '',
        configured: Boolean(provider.configured) || hasPlainCredential(provider.api_key ?? provider.apiKey),
        models,
      }
    })
    .filter(Boolean)
}

export function llmProviderConfigured(cfg = {}, provider = {}) {
  if (!provider) return false
  if (typeof cfg?.[provider.configuredField] === 'boolean') return cfg[provider.configuredField]
  if (provider.apiKeyField && hasPlainCredential(cfg?.[provider.apiKeyField])) return true
  if (provider.legacyApiKeyField && hasPlainCredential(cfg?.[provider.legacyApiKeyField])) return true
  return false
}

export function isDeepSeekConfigured(cfg = {}) {
  const provider = LLM_BUILTIN_PROVIDERS.find(item => item.id === 'crawshrimp-deepseek-official')
  return llmProviderConfigured(cfg, provider)
}

export function isGlmConfigured(cfg = {}) {
  const provider = LLM_BUILTIN_PROVIDERS.find(item => item.id === 'crawshrimp-glm-official')
  return llmProviderConfigured(cfg, provider)
}

export function isLlmConfigured(cfg = {}) {
  if (LLM_BUILTIN_PROVIDERS.some(provider => llmProviderConfigured(cfg, provider))) return true
  if (typeof cfg?.['ai.llm.configured'] === 'boolean' && cfg['ai.llm.configured']) return true
  return normalizeCustomLlmProviders(cfg?.[LLM_CUSTOM_PROVIDERS_FIELD]).some(provider => provider.configured)
}

function sanitizeCustomProviderForPatch(provider = {}) {
  const normalized = normalizeCustomLlmProviders([provider])[0]
  if (!normalized) return null
  const out = {
    id: normalized.id,
    name: normalized.name,
    protocol: normalized.protocol,
    base_url: normalized.base_url,
    models: normalized.models,
  }
  if (hasPlainCredential(normalized.api_key)) out.api_key = String(normalized.api_key).trim()
  return out
}

export function buildLlmSettingsPatch(cfg = {}) {
  const patch = {}
  for (const key of LLM_PANEL_FIELDS) {
    if (key === LLM_CUSTOM_PROVIDERS_FIELD) continue
    const value = String(cfg?.[key] ?? '').trim()
    if (!value) continue
    if (LLM_CREDENTIAL_FIELDS.includes(key) && isMaskedCredential(value)) continue
    patch[key] = value
  }
  if (Object.prototype.hasOwnProperty.call(cfg, LLM_CUSTOM_PROVIDERS_FIELD)) {
    patch[LLM_CUSTOM_PROVIDERS_FIELD] = normalizeCustomLlmProviders(cfg[LLM_CUSTOM_PROVIDERS_FIELD])
      .map(sanitizeCustomProviderForPatch)
      .filter(Boolean)
  }
  return patch
}

export function clearWrittenLlmSettings(cfg = {}, patch = {}) {
  for (const provider of LLM_BUILTIN_PROVIDERS) {
    if (provider.apiKeyField && Object.prototype.hasOwnProperty.call(patch, provider.apiKeyField)) {
      cfg[provider.apiKeyField] = LLM_MASKED_CREDENTIAL_VALUE
      if (provider.configuredField) cfg[provider.configuredField] = true
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, LLM_API_KEY_FIELD)) {
    cfg[LLM_API_KEY_FIELD] = LLM_MASKED_CREDENTIAL_VALUE
    cfg['ai.llm.configured'] = true
    for (const provider of LLM_BUILTIN_PROVIDERS.filter(item => item.legacyApiKeyField === LLM_API_KEY_FIELD)) {
      cfg[provider.apiKeyField] = LLM_MASKED_CREDENTIAL_VALUE
      cfg[provider.configuredField] = true
    }
  }
  if (Array.isArray(patch[LLM_CUSTOM_PROVIDERS_FIELD])) {
    const writtenById = new Map(patch[LLM_CUSTOM_PROVIDERS_FIELD].map(provider => [provider.id, provider]))
    cfg[LLM_CUSTOM_PROVIDERS_FIELD] = normalizeCustomLlmProviders(cfg[LLM_CUSTOM_PROVIDERS_FIELD]).map((provider) => {
      const written = writtenById.get(provider.id)
      if (written?.api_key) return { ...provider, api_key: LLM_MASKED_CREDENTIAL_VALUE, configured: true }
      return provider
    })
  }
  return cfg
}
