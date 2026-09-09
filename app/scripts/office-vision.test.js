const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

test('paired MCP vision admission verifies exact provider/model and denies unconfigured routes', async () => {
  const { patchOfficeMcpImageAdmissionSource } = await import('../../integrations/deepseek-harness/scripts/office-vision.mjs')
  const original = '\tif (info.inputModalities === void 0 || !info.inputModalities.includes("image")) throw new Error(`model "${model}" does not declare image input`);'
  const source = patchOfficeMcpImageAdmissionSource(original)
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const fn = new AsyncFunction('info', 'provider', 'model', 'llm', 'exec', source)
  const llm = { resolveModelInfo: async () => ({ inputModalities: ['image'] }) }
  await fn({ inputModalities: ['text'] }, 'crawshrimp-deepseek-official', 'deepseek-v4-flash', llm, {})
  await assert.rejects(fn({ inputModalities: ['text'] }, 'other', 'deepseek-v4-flash', llm, {}))
  await assert.rejects(fn({ inputModalities: ['text'] }, 'crawshrimp-deepseek-official', 'deepseek-v4-flash', { resolveModelInfo: async () => ({ inputModalities: ['text'] }) }, {}))
  assert.equal(patchOfficeMcpImageAdmissionSource(source), source)
  assert.throws(() => patchOfficeMcpImageAdmissionSource('changed upstream'), /anchor changed/)
})

test('new tool page image takes precedence over an older user image', async () => {
  const { patchOfficeToolImageVisionSource } = await import('../../integrations/deepseek-harness/scripts/office-vision.mjs')
  const original = `for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && contentHasImage(message.content)) return index;
  } return -1;`
  const source = patchOfficeToolImageVisionSource(original)
  const hasImage = blocks => blocks.some(b => b.type === 'image' || b.type === 'tool-result' && hasImage(b.content))
  const select = new Function('messages', 'contentHasImage', source)
  assert.equal(select([{ role: 'user', content: [{ type: 'image' }] }, { role: 'tool', content: [{ type: 'tool-result', content: [{ type: 'image' }] }] }], hasImage), 1)
  assert.equal(select([{ role: 'user', content: [{ type: 'text' }] }], hasImage), -1)
  assert.equal(patchOfficeToolImageVisionSource(source), source)
})

test('Office build resources are pinned for each supported target', () => {
  const root = resolve(__dirname, '../..')
  const manifest = JSON.parse(readFileSync(resolve(root, 'runtime-locks/office-assets.json')))
  for (const target of ['mac-arm64', 'mac-x64', 'win-x64']) {
    assert.match(manifest.targets[target].sha256, /^[a-f0-9]{64}$/)
    assert.match(readFileSync(resolve(root, `runtime-locks/python/${target}-py312.txt`), 'utf8'), /python-docx==1\.2\.0/)
  }
  assert.equal(manifest.fonts.length, 4)
})

test('adapter declares paired image capability before text projection only when configured', async () => {
  const { patchOfficeBridgeTransportSource } = await import('../../integrations/deepseek-harness/scripts/office-vision.mjs')
  const original = 'inputModalities: [...resolvedModel.input],\n...crawshrimpVisionOptions(options),'
  const source = patchOfficeBridgeTransportSource(original)
  const helpers = source.slice(source.indexOf('// crawshrimp-office-bridge-transport-v2'))
  const capable = new Function('crawshrimpDeepSeekTextModelCanUseVisionBridge', 'CRAWSHRIMP_DEEPSEEK_VISION_MODEL', helpers + '\nreturn crawshrimpOfficeInputModalities;')(
    (p, m) => p === 'official' && m === 'text', 'vision')
  const snapshot = { models: { getModel: () => ({ input: ['text', 'image'] }) } }
  const config = { resolveAttachments: () => ({}) }
  assert.deepEqual(capable(['text'], 'official', 'text', snapshot, config), ['text', 'image'])
  assert.deepEqual(capable(['text'], 'other', 'text', snapshot, config), ['text'])
  assert.deepEqual(capable(['text'], 'official', 'text', snapshot, {}), ['text'])
  assert.deepEqual(capable(['text'], 'official', 'text', { models: { getModel: () => undefined } }, config), ['text'])
  assert.equal(patchOfficeBridgeTransportSource(source), source)
  assert.throws(() => patchOfficeBridgeTransportSource('changed'), /anchor changed/)
})

test('nested tool pixels reach vision as a user image without mutating durable history', async () => {
  const { patchOfficeBridgeTransportSource } = await import('../../integrations/deepseek-harness/scripts/office-vision.mjs')
  const source = patchOfficeBridgeTransportSource('inputModalities: [...resolvedModel.input],\n...crawshrimpVisionOptions(options),')
  const helpers = source.slice(source.indexOf('// crawshrimp-office-bridge-transport-v2'))
  const convert = new Function('crawshrimpLatestImageUserMessageIndex', helpers + '\nreturn crawshrimpOfficeVisionOptions;')(messages => messages.length - 1)
  const pixels = Object.freeze({ type: 'image', attachment: { attachmentId: 'sha256:page2' } })
  const options = { messages: [{ role: 'user', content: [{ type: 'text', text: 'check layout' }] },
    Object.freeze({ id: 'tool1', role: 'user', content: [{ type: 'tool-result', content: [{ type: 'text', text: 'page 2' }, pixels] }] })] }
  const result = convert(options)
  assert.equal(result.messages.length, 1)
  assert.equal(result.messages[0].role, 'user')
  assert.equal(result.messages[0].content[1], pixels)
  assert.equal(result.messages[0].content[0].text, 'page 2')
  assert.equal(options.messages[1].content[0].type, 'tool-result')
  const user = { messages: [{ role: 'user', content: [pixels] }] }
  assert.equal(convert(user).messages[0].content[0], pixels)
})
