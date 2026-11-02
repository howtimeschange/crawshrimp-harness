import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createRenderer, nextTick } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { AI_VIDEO_CONNECTION_DEFAULTS, AI_VIDEO_MASKED_CREDENTIAL_VALUE } from './renderer/utils/aiVideoSettings.mjs'
const require = createRequire(import.meta.url)
const file = new URL('./renderer/components/VideoProviderSettings.vue', import.meta.url)
const { descriptor } = parse(readFileSync(file, 'utf8'))
// The renderless Node fixture needs asset URLs, while Vite owns their loading.
const source = compileScript(descriptor, { id: 'video-settings-test' }).content
  .replace(/import (\w+) from (['"])([^'"]+\.(?:ico|png))\2/g, (_, name, quote, specifier) => `const ${name} = ${JSON.stringify(new URL(specifier, file).href)}`)
  .replace(/from (['"])([^'"]+)\1/g, (_, quote, specifier) => `from ${JSON.stringify(specifier.startsWith('.') ? new URL(specifier, file).href : new URL('file://' + require.resolve(specifier)).href)}`)
const Component = (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default
Component.render = () => null
const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
function fixture(save, config = {}) {
  const app = renderer.createApp(Component, { save, config }), vm = app.mount({})
  return { app, state: vm.$.setupState }
}
test('Seedance editor requires an explicit route and saves only its own nonblank fields', async () => {
  const calls=[], f=fixture(async patch=>calls.push(patch), { 'ai.video.bailian_api_key':'unrelated-key', 'ai.video.bailian_upload_api_key':'unrelated-upload', 'ai.video.seedance_api_key':AI_VIDEO_MASKED_CREDENTIAL_VALUE })
  try {
    await f.state.openEditor('seedance')
    assert.equal(f.state.defaults['ai.video.seedance_base_url'], undefined)
    assert.deepEqual(f.state.draft, { 'ai.video.seedance_api_key':'', 'ai.video.seedance_base_url':'' })
    f.state.draft['ai.video.seedance_api_key']='fixture-new-key'
    f.state.draft['ai.video.seedance_base_url']='https://ai-aigw.semir.com/doubao-seedance/api/v3'
    await f.state.saveEditor()
    assert.deepEqual(calls,[{ 'ai.video.seedance_api_key':'fixture-new-key', 'ai.video.seedance_base_url':'https://ai-aigw.semir.com/doubao-seedance/api/v3' }])
    assert.deepEqual(f.state.draft,{});assert.equal(f.state.editor,'');assert.match(f.state.notice,/已保存/)
  } finally { f.app.unmount() }
})
test('new Seedance key cannot be saved without an explicit endpoint', async () => {
  const calls=[],f=fixture(async patch=>calls.push(patch))
  try {
    await f.state.openEditor('seedance');f.state.draft['ai.video.seedance_api_key']='fixture-key';await f.state.saveEditor()
    assert.match(f.state.error,/服务地址/);assert.equal(calls.length,0)
  } finally { f.app.unmount() }
})
test('OSS uploads remain separate from generation credentials', async () => {
  const calls=[],f=fixture(async patch=>calls.push(patch))
  try {
    await f.state.openEditor('upload');f.state.draft['ai.video.bailian_upload_api_key']='fixture-upload'
    await f.state.saveEditor()
    assert.deepEqual(calls,[{'ai.video.bailian_upload_api_key':'fixture-upload'}])
    await f.state.openEditor('bailian');f.state.draft['ai.video.bailian_region']='cn-shanghai';await f.state.saveEditor()
    assert.deepEqual(calls[1],{'ai.video.bailian_region':'cn-shanghai'})
  } finally { f.app.unmount() }
})
test('blank or masked credentials never replace a stored key', async () => {
  const calls=[],f=fixture(async patch=>calls.push(patch))
  try {
    await f.state.openEditor('seedance');await f.state.saveEditor();assert.equal(calls.length,0)
    await f.state.openEditor('seedance');f.state.draft['ai.video.seedance_api_key']=AI_VIDEO_MASKED_CREDENTIAL_VALUE;await f.state.saveEditor()
    assert.equal(calls.length,0);assert.deepEqual(f.state.draft,{})
  } finally { f.app.unmount() }
})
test('failure keeps a retryable draft, cancellation and unmount clear credentials', async () => {
  const f=fixture(async()=>{throw Error('fixture offline')})
  try {
    await f.state.openEditor('seedance');f.state.draft['ai.video.seedance_api_key']='fixture-key';f.state.draft['ai.video.seedance_base_url']='https://example.test';await f.state.saveEditor()
    assert.equal(f.state.error,'fixture offline');assert.equal(f.state.editor,'seedance');assert.equal(f.state.saving,false)
    assert.equal(f.state.draft['ai.video.seedance_api_key'],'fixture-key')
    f.state.closeEditor();assert.deepEqual(f.state.draft,{})
    await f.state.openEditor('upload');f.state.draft['ai.video.bailian_upload_api_key']='fixture-upload'
  } finally { f.app.unmount() }
  assert.deepEqual(f.state.draft,{})
})
test('an in-flight save cannot be submitted twice or silently dismissed', async () => {
  let release,calls=0
  const f=fixture(()=>{calls++;return new Promise(resolve=>{release=resolve})})
  try {
    await f.state.openEditor('seedance');f.state.draft['ai.video.seedance_api_key']='fixture-key';f.state.draft['ai.video.seedance_base_url']='https://example.test'
    const pending=f.state.saveEditor();await nextTick()
    await f.state.saveEditor();f.state.closeEditor();await f.state.openEditor('upload')
    assert.equal(calls,1);assert.equal(f.state.editor,'seedance');assert.equal(f.state.saving,true)
    release();await pending;assert.equal(f.state.editor,'');assert.deepEqual(f.state.draft,{})
  } finally { f.app.unmount() }
})
