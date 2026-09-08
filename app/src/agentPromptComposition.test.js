const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const vm = require('node:vm')
const test = require('node:test')

const root = resolve(__dirname, '../../integrations/deepseek-harness')
const patcher = () => import(pathToFileURL(resolve(root, 'scripts/patch-runtime-dependencies.mjs')).href)

test('Web orientation keeps the actual URL without developer instructions; source context is omitted', async () => {
  const { patchHarnessSurfaceSource } = await patcher()
  for (const brand of ['DeepSeek Harness', '抓虾 Harness']) {
    const source = `function webSurfacePrompt(webUrl) {\nreturn \`${brand} at \${webUrl}; HMR pnpm run dev:web window.__DSH_BOOT__\`;\n}`
    const patched = patchHarnessSurfaceSource(source, 'web')
    const rendered = vm.runInNewContext(`(${patched})('http://127.0.0.1:12345')`)
    assert.match(rendered, /抓虾 Harness.*12345/)
    assert.doesNotMatch(rendered, /HMR|pnpm|DSH_BOOT|DeepSeek Harness/)
    assert.equal(patchHarnessSurfaceSource(patched, 'web'), patched)
  }
  const source = 'function addHarnessSourceSection(ctx, sourceRoot) {\nreturn ctx.systemPrompt.section({text: sourceRoot});\n}'
  const patched = patchHarnessSurfaceSource(source, 'source')
  let sections = 0
  vm.runInNewContext(`(${patched})(ctx, '/private/integration')`, { ctx: { systemPrompt: { section() { sections++ } } } })
  assert.equal(sections, 0)
  assert.equal(patchHarnessSurfaceSource(patched, 'source'), patched)
  assert.throws(() => patchHarnessSurfaceSource('changed upstream', 'web'), /anchor changed/)
})

test('file guidance is registered with the available tool, and respects automatic delivery', async () => {
  const { installOutboundArtifactTool } = await import(pathToFileURL(resolve(root, 'node_modules/@xmanrui/dsh-im/src/channels/shared/semantic/artifact.mjs')).href)
  const sections = []
  const tools = []
  const ctx = { systemPrompt: { section: value => sections.push(value) }, on() {} }
  assert.equal(installOutboundArtifactTool(ctx), false)
  assert.equal(sections.length, 0)
  ctx.tools = { register: tool => tools.push(tool) }
  assert.equal(installOutboundArtifactTool(ctx), true)
  assert.equal(tools.length, 1)
  assert.equal(sections.length, 1)
  assert.match(sections[0].text, /requires_file_return=false/)
  assert.match(sections[0].text, /当前工具目录包含 dsh_im_return_file/)
  assert.doesNotMatch(sections[0].text, /When the user asks to receive/)
  const bundle = readFileSync(resolve(root, 'node_modules/@xmanrui/dsh-im/lib/index.js'), 'utf8')
  assert.ok(bundle.includes('requires_file_return=false'))
  assert.ok(!bundle.includes('When the user asks to receive a file or generated image'))
})
