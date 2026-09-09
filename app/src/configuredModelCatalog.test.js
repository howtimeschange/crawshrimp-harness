const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const runtime = resolve(__dirname, '../../integrations/deepseek-harness')

async function fixture() {
  const patcher = await import(pathToFileURL(resolve(runtime, 'scripts/configured-model-catalog.mjs')).href)
  const original = readFileSync(resolve(runtime, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js'), 'utf8')
  const source = patcher.patchConfiguredModelCatalogSource(original)
  assert.equal(patcher.patchConfiguredModelCatalogSource(source), source)
  const method = source.slice(source.indexOf('\tlistModels(provider) {'), source.indexOf('\tresolveModel(provider, model, _signal) {'))
  const adapter = new Function(`return {${method}}`)()
  const keys = new Map()
  const providers = ['crawshrimp-deepseek-official', 'crawshrimp-overseas-openai', 'custom-acme']
  adapter.config = { resolveApiKey: async provider => {
    const key = keys.get(provider)
    if (key instanceof Error) throw key
    return key
  } }
  adapter.current = () => ({ models: { getModels: provider => [{ id: 'shared-model-id', name: 'Shared model', input: ['text'] }] } })
  adapter.profileOf = (_, provider) => ({ apiKeyEnv: `${provider}-key` })
  const api = readFileSync(resolve(runtime, 'node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js'), 'utf8')
  const start = api.indexOf('async function buildModelCatalog(')
  const end = api.indexOf('\n}', start) + 2
  const build = new Function(`${api.slice(start, end)}; return buildModelCatalog`)()
  const ctx = { llm: {
    listProviders: () => providers.map(id => ({ id, name: id })),
    listModels: provider => adapter.listModels(provider),
    resolveModelInfo: async () => ({}),
  } }
  return { adapter, keys, patcher, catalog: () => build(ctx, {}), providers }
}

test('model picker hides missing-key built-in and custom providers including empty headings', async () => {
  const f = await fixture()
  f.keys.set(f.providers[0], 'test-key-present')
  f.keys.set(f.providers[1], Object.assign(new Error('missing'), { code: 'MISSING_CREDENTIAL' }))
  const result = await f.catalog()
  assert.deepEqual(result.groups.map(g => g.id), [f.providers[0]])
  assert.equal(result.groups[0].models[0].id, 'shared-model-id')
  assert.deepEqual(result.failures, [])
})

test('adding, replacing and removing a custom key takes effect on the next catalog read', async () => {
  const f = await fixture()
  assert.deepEqual((await f.catalog()).groups, [])
  f.keys.set('custom-acme', 'test-custom-key')
  assert.deepEqual((await f.catalog()).groups.map(g => g.id), ['custom-acme'])
  f.keys.set('custom-acme', 'replacement-test-key')
  assert.equal((await f.catalog()).groups.length, 1)
  f.keys.delete('custom-acme')
  assert.deepEqual((await f.catalog()).groups, [])
})

test('blank or malformed keys stay hidden without hiding a configured unrelated route', async () => {
  const f = await fixture()
  f.keys.set(f.providers[0], '   ')
  f.keys.set(f.providers[1], 'test-key-present')
  f.keys.set(f.providers[2], Object.assign(new Error('invalid'), { code: 'INVALID_CREDENTIAL' }))
  assert.deepEqual((await f.catalog()).groups.map(g => g.id), [f.providers[1]])
})

test('unexpected credential-service failures remain observable and patch anchors fail closed', async () => {
  const f = await fixture()
  const error = new Error('credential store unavailable')
  f.keys.set('custom-acme', error)
  await assert.rejects(f.adapter.listModels('custom-acme'), error)
  assert.throws(() => f.patcher.patchConfiguredModelCatalogSource('changed upstream'), /anchor changed/)
})
