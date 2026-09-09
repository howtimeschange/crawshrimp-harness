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
