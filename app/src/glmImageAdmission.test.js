const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

const runtime = resolve(__dirname, '../../integrations/deepseek-harness')
const paths = {
  piAi: resolve(runtime, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js'),
  session: resolve(runtime, 'node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js'),
  fsTool: resolve(runtime, 'node_modules/@deepseek-ai/dsh-tool-fs/lib/index.js'),
  mcp: resolve(runtime, 'node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js'),
  patcher: resolve(runtime, 'scripts/glm-vision.mjs'),
}

const OFFICIAL = 'crawshrimp-glm-official'
const CUSTOM = 'custom-glm'

function source(path) {
  return readFileSync(path, 'utf8')
}

async function patcher() {
  return import(pathToFileURL(paths.patcher).href)
}

function modelInfoFor(calls, availableVisionIds = ['glm-5.3-flash']) {
  return {
    async resolveModelInfo(provider, model) {
      calls.push([provider, model])
      if (provider === OFFICIAL && availableVisionIds.includes(model)) return { inputModalities: ['text', 'image'] }
      return { inputModalities: ['text'] }
    },
  }
}

function execFor(provider, model) {
  return {
    signal: new AbortController().signal,
    agent: {
      options: { provider, model },
      session: { requestHeader: () => undefined },
    },
  }
}

function extractReadImageGate() {
  const text = source(paths.fsTool)
  const start = text.indexOf('async function assertImageCapableRoute(')
  const end = text.indexOf('\n/** Refuse a media type', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  return new Function(`${text.slice(start, end)}; return assertImageCapableRoute;`)()
}

function extractOfficeMcpGate() {
  const text = source(paths.mcp)
  const start = text.indexOf('async function resolveImageAdmission(')
  const end = text.indexOf('\n/** Stable diagnostic text', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  return new Function(`${text.slice(start, end)}; return resolveImageAdmission;`)()
}

function extractSessionAdmissionCheck() {
  const text = source(paths.session)
  const start = text.indexOf('const crawshrimpGlmVisionBridgeAllowsImageAdmission =')
  const end = text.indexOf('\n\t\t\t\t}', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const body = text.slice(start, end)
  return new Function('current', 'model', `
    class RemoteError extends Error {}
    try {
      ${body}
      return true
    } catch (error) {
      return false
    }
  `)
}

test('installed read_image admits official GLM 5.3/5.2 through same-provider Flash only', async () => {
  const gate = extractReadImageGate()
  for (const model of ['glm-5.3', 'glm-5.2']) {
    const calls = []
    await gate({ get: () => modelInfoFor(calls) }, execFor(OFFICIAL, model), '/workspace/page.png')
    assert.deepEqual(calls, [[OFFICIAL, model], [OFFICIAL, 'glm-5.3-flash']])
  }
  for (const [provider, model] of [[CUSTOM, 'glm-5.3'], [OFFICIAL, 'glm-6-future']]) {
    const calls = []
    await assert.rejects(
      gate({ get: () => modelInfoFor(calls) }, execFor(provider, model), '/workspace/page.png'),
      /does not declare image input/,
    )
    assert.deepEqual(calls, [[provider, model]])
  }
})

test('installed read_image falls back to official GLM FlashX when Flash is unavailable', async () => {
  const gate = extractReadImageGate()
  const calls = []
  await gate({ get: () => modelInfoFor(calls, ['glm-5.3-flashx']) }, execFor(OFFICIAL, 'glm-5.3'), '/workspace/page.png')
  assert.deepEqual(calls, [[OFFICIAL, 'glm-5.3'], [OFFICIAL, 'glm-5.3-flash'], [OFFICIAL, 'glm-5.3-flashx']])
})

test('installed Office MCP admission mirrors GLM same-provider Flash and FlashX boundaries', async () => {
  const gate = extractOfficeMcpGate()
  for (const [availableVisionIds, expected] of [
    [['glm-5.3-flash'], [[OFFICIAL, 'glm-5.2'], [OFFICIAL, 'glm-5.3-flash']]],
    [['glm-5.3-flashx'], [[OFFICIAL, 'glm-5.2'], [OFFICIAL, 'glm-5.3-flash'], [OFFICIAL, 'glm-5.3-flashx']]],
  ]) {
    const calls = []
    const attachments = { ok: true }
    const result = await gate({ get: name => name === 'attachments' ? attachments : modelInfoFor(calls, availableVisionIds) }, execFor(OFFICIAL, 'glm-5.2'))
    assert.equal(result, attachments)
    assert.deepEqual(calls, expected)
  }

  for (const [provider, model] of [[CUSTOM, 'glm-5.2'], [OFFICIAL, 'glm-6-future']]) {
    const calls = []
    await assert.rejects(
      gate({ get: name => name === 'attachments' ? {} : modelInfoFor(calls) }, execFor(provider, model)),
      /no verified paired vision route/,
    )
    assert.deepEqual(calls, [[provider, model]])
  }
})

test('installed Session admission admits only official GLM 5.3/5.2 text routes', () => {
  const admit = extractSessionAdmissionCheck()
  const textOnly = { inputModalities: ['text'] }
  assert.equal(admit({ provider: OFFICIAL, model: 'glm-5.3' }, textOnly), true)
  assert.equal(admit({ provider: OFFICIAL, model: 'glm-5.2' }, textOnly), true)
  assert.equal(admit({ provider: CUSTOM, model: 'glm-5.3' }, textOnly), false)
  assert.equal(admit({ provider: OFFICIAL, model: 'glm-6-future' }, textOnly), false)
  assert.equal(admit({ provider: CUSTOM, model: 'vision' }, { inputModalities: ['text', 'image'] }), true)
})

test('GLM admission patchers handle fresh anchors and are idempotent on installed runtime', async () => {
  const p = await patcher()
  const current = {
    readImage: source(paths.fsTool),
    officeMcp: source(paths.mcp),
    session: source(paths.session),
    piAi: source(paths.piAi),
  }

  assert.equal(p.patchGlmReadImageSource(current.readImage), current.readImage)
  assert.equal(p.patchGlmOfficeMcpSource(current.officeMcp), current.officeMcp)
  assert.equal(p.patchGlmSessionAdmissionSource(current.session), current.session)
  assert.equal(p.patchGlmVisionSource(current.piAi), current.piAi)

  const freshReadImage = '\tif (provider === "crawshrimp-deepseek-official" && (model === "deepseek-v4-flash" || model === "deepseek-v4-pro")) {\n\t\tconst vision = await llm.resolveModelInfo(provider, "deepseek-flash", exec.signal);\n\t\tif (vision.inputModalities?.includes("image")) return;\n\t}'
  const patchedReadImage = p.patchGlmReadImageSource(freshReadImage)
  assert.match(patchedReadImage, /crawshrimp-glm-read-image-vision-v1/)
  assert.match(patchedReadImage, /"glm-5\.3-flashx"/)
  assert.equal(p.patchGlmReadImageSource(patchedReadImage), patchedReadImage)

  const freshOffice = '\tif (!officeImageAllowed && provider === "crawshrimp-deepseek-official" && (model === "deepseek-v4-flash" || model === "deepseek-v4-pro")) {\n\t\tconst vision = await llm.resolveModelInfo(provider, "deepseek-flash", exec.signal);\n\t\tofficeImageAllowed = vision.inputModalities?.includes("image") === true;\n\t}'
  const patchedOffice = p.patchGlmOfficeMcpSource(freshOffice)
  assert.match(patchedOffice, /crawshrimp-glm-office-mcp-image-v1/)
  assert.match(patchedOffice, /"glm-5\.3-flashx"/)
  assert.equal(p.patchGlmOfficeMcpSource(patchedOffice), patchedOffice)

  const freshSession = 'const crawshrimpVisionBridgeAllowsImageAdmission = current.provider === "crawshrimp-deepseek-official" && (current.model === "deepseek-v4-flash" || current.model === "deepseek-v4-pro");'
  const patchedSession = p.patchGlmSessionAdmissionSource(freshSession)
  assert.match(patchedSession, /crawshrimp-glm-vision-admission-v1/)
  assert.match(patchedSession, /current\.provider === "crawshrimp-glm-official"/)
  assert.equal(p.patchGlmSessionAdmissionSource(patchedSession), patchedSession)
})
