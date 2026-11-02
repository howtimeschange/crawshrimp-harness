import test from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, nextTick, ssrContextKey } from 'vue'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const cacheDir = mkdtempSync(join(tmpdir(), 'harness-runtime-settings-test-'))
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, plugins: [vue()], cacheDir, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' })
let Component
try { Component = (await server.ssrLoadModule('/src/renderer/views/SettingsPage.vue')).default }
finally { await server.close(); rmSync(cacheDir, { recursive: true, force: true }) }
Component.render = () => null
const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
const settle = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); await nextTick() } }
function fixture(cs = {}) {
  globalThis.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} }
  globalThis.window = { cs: { platform: 'darwin', getSettings: async () => ({}), agentApi: async () => ({ state: 'ready', generation: 1, model: 'fixture', api_key_configured: true, web_verified: true }), ...cs }, addEventListener() {}, removeEventListener() {} }
  const app = renderer.createApp(Component, { effectiveTheme: 'dark', themePreference: 'dark' })
  app.provide(ssrContextKey, { modules: new Set() })
  const vm = app.mount({})
  return { app, state: vm.$.setupState }
}
test('runtime state describes unavailable and manual recovery without claiming success', async () => {
  const f = fixture({ agentApi: async () => { throw Error('offline') } })
  try {
    await f.state.refreshAgentRuntime()
    assert.equal(f.state.agentRuntimeLabel, '服务不可用')
    assert.equal(f.state.agentRuntimeTone, 'error')
    assert.equal(f.state.agentRuntimeKnown, false)
    assert.match(f.state.agentRuntimeDescription, /修复核心服务/)
    f.state.agentRuntime = { state: 'disabled_until_manual_restart' }
    assert.equal(f.state.agentRuntimeLabel, '需要手动重启')
    assert.equal(f.state.agentRuntimeTone, 'attention')
    f.state.agentRuntime = { state: 'new-server-state' }
    assert.equal(f.state.agentRuntimeLabel, '状态未知')
    assert.equal(f.state.agentRuntimeKnown, false)
  } finally { f.app.unmount() }
})
test('restart reports a refusal as an error and prevents concurrent actions while pending', async () => {
  let resolveRestart
  const f = fixture({ agentApi: async (method) => method === 'GET' ? { state: 'ready' } : new Promise(resolve => { resolveRestart = resolve }) })
  try {
    const pending = f.state.onAgentRestartRuntime(); await settle()
    assert.equal(f.state.agentBusy, 'runtime')
    resolveRestart({ ok: false, error: 'ACTIVE_RUN' }); await pending
    assert.equal(f.state.agentNoticeOk, false)
    assert.match(f.state.agentNotice, /ACTIVE_RUN/)
    assert.equal(f.state.agentBusy, '')
  } finally { f.app.unmount() }
})
test('core repair reports explicit failure and successful recovery separately', async () => {
  let result = { ok: false, error: '本地服务不可用' }
  const f = fixture({ restartBackend: async () => result })
  try {
    await f.state.onAgentRepairCore(); assert.equal(f.state.agentNoticeOk, false); assert.match(f.state.agentNotice, /本地服务不可用/)
    result = { ok: true }; await f.state.onAgentRepairCore()
    assert.equal(f.state.agentNoticeOk, true); assert.equal(f.state.agentNotice, '核心服务已重启。')
  } finally { f.app.unmount() }
})
