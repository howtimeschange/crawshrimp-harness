const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const runtime = resolve(__dirname, '../../integrations/deepseek-harness')

async function loadGate() {
  const patcher = await import(pathToFileURL(resolve(runtime, 'scripts/patch-runtime-dependencies.mjs')).href)
  const result = patcher.patchRuntimeDependencies(runtime)
  const source = readFileSync(result.deepseekReadImage.entry, 'utf8')
  assert.equal(patcher.patchDeepSeekReadImageSource(source), source)
  const start = source.indexOf('async function assertImageCapableRoute(')
  const end = source.indexOf('\n/** Refuse a media type', start)
  return new Function(`${source.slice(start, end)}; return assertImageCapableRoute;`)()
}

test('read_image admits both official text models through the paired Vision route only', async () => {
  const gate = await loadGate()
  for (const model of ['deepseek-v4-flash', 'deepseek-v4-pro']) {
    const calls = []
    const ctx = { get: () => ({ resolveModelInfo: async (provider, name) => {
      calls.push([provider, name]); return { inputModalities: name.endsWith('vision-exp') ? ['text', 'image'] : ['text'] }
    } }) }
    const exec = { agent: { session: { requestHeader: () => ({ config: { provider: 'crawshrimp-deepseek-official', model } }) } } }
    await gate(ctx, exec, '/workspace/result.png')
    assert.deepEqual(calls.map(c => c[1]), [model, 'deepseek-v4-flash-vision-exp'])
  }
})

test('read_image keeps unrelated text routes and unavailable Vision routes rejected', async () => {
  const gate = await loadGate()
  for (const [provider, model] of [['other', 'deepseek-v4-flash'], ['crawshrimp-deepseek-official', 'other-model'], ['crawshrimp-deepseek-official', 'deepseek-v4-pro']]) {
    const ctx = { get: () => ({ resolveModelInfo: async () => ({ inputModalities: ['text'] }) }) }
    const exec = { agent: { options: { provider, model }, session: { requestHeader: () => undefined } } }
    await assert.rejects(gate(ctx, exec, '/workspace/result.png'), /does not declare image input/)
  }
})

test('read_image retains native image routes and the original sandbox / file validation', async () => {
  const gate = await loadGate()
  await gate({ get: () => ({ resolveModelInfo: async () => ({ inputModalities: ['image'] }) }) },
    { agent: { options: { provider: 'native', model: 'vision' }, session: { requestHeader: () => undefined } } }, '/workspace/result.png')
  const source = readFileSync(resolve(runtime, 'node_modules/@deepseek-ai/dsh-tool-fs/lib/index.js'), 'utf8')
  assert.match(source, /await resolveRegularReadTarget\(ctx, exec, args.file_path\)/)
  assert.match(source, /await ctx.fs.readBytes\(target, exec.signal, byteCap\)/)
  assert.match(source, /await attachments.saveImage\(/)
})

test('image blocks nested in read_image tool results reach Vision and become text for Flash/Pro', () => {
  const source = readFileSync(resolve(runtime, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js'), 'utf8')
  const start = source.indexOf('function crawshrimpLatestImageUserMessageIndex(')
  const end = source.indexOf('function crawshrimpImageOptions(', start)
  const hasImage = blocks => blocks.some(b => b.type === 'image' || (b.type === 'tool-result' && hasImage(b.content)))
  const helpers = new Function('contentHasImage', source.slice(start, end) + '; return {crawshrimpLatestImageUserMessageIndex, crawshrimpTextOnlyOptionsFromVision};')(hasImage)
  const options = { messages: [{ role: 'user', content: [{ type: 'tool-result', toolCallId: 'read-1', content: [{ type: 'text', text: 'result.png' }, { type: 'image', attachment: { attachmentId: 'test-image' } }] }] }] }
  assert.equal(helpers.crawshrimpLatestImageUserMessageIndex(options.messages), 0)
  const replay = helpers.crawshrimpTextOnlyOptionsFromVision(options, '图片标题为冬季羽绒服')
  assert.equal(hasImage(replay.messages[0].content), false)
  assert.match(JSON.stringify(replay), /图片标题为冬季羽绒服/)
  assert.equal(replay.messages[0].content[0].toolCallId, 'read-1')
})
