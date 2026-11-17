import test from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, markRaw, nextTick, ssrContextKey } from 'vue'
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
function fixture(cs = {}, props = {}) {
  globalThis.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} }
  globalThis.window = { cs: { platform: 'darwin', getSettings: async () => ({}), agentApi: async () => ({ state: 'ready', generation: 1, model: 'fixture', api_key_configured: true, web_verified: true }), ...cs }, addEventListener() {}, removeEventListener() {} }
  const app = renderer.createApp(Component, { effectiveTheme: 'dark', themePreference: 'dark', ...props })
  app.provide(ssrContextKey, { modules: new Set() })
  const vm = app.mount({})
  return { app, state: vm.$.setupState, props: vm.$.props }
}

const imRuntime = (generation = 1) => ({
  state: 'ready',
  generation,
  web_origin: 'http://127.0.0.1:19065/',
})

function markImReady(state, frameWindow) {
  state.onImSettingsMessage({
    source: frameWindow,
    origin: 'http://127.0.0.1:19065',
    data: { __crawshrimp: 'im-settings-ready' },
  })
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

test('IM follows runtime generations without navigating away and preserves a healthy frame on probe failure', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let runtime = imRuntime()
  let offline = false
  const f = fixture({ agentApi: async () => {
    if (offline) throw Error('status probe timed out')
    return runtime
  } }, { focusPanelId: 'im-bots', active: true })
  const oldFrame = markRaw({ postMessage() {} })
  const newFrame = markRaw({ postMessage() {} })
  try {
    await settle()
    f.state.imSettingsFrame = { contentWindow: oldFrame }
    markImReady(f.state, oldFrame)
    await settle()
    assert.equal(f.state.imSettingsReady, true)

    runtime = imRuntime(2)
    t.mock.timers.tick(5000)
    await settle()
    assert.equal(new URL(f.state.imSettingsUrl).searchParams.get('csRuntimeGeneration'), '2')
    assert.equal(f.state.imSettingsReady, false)

    f.state.imSettingsFrame = { contentWindow: newFrame }
    markImReady(f.state, oldFrame)
    assert.equal(f.state.imSettingsReady, false)
    f.state.onImSettingsMessage({ source: newFrame, origin: 'https://example.com', data: { __crawshrimp: 'im-settings-ready' } })
    assert.equal(f.state.imSettingsReady, false)
    markImReady(f.state, newFrame)
    await settle()

    const loadedUrl = f.state.imSettingsUrl
    t.mock.timers.tick(5000)
    await settle()
    assert.equal(f.state.imSettingsUrl, loadedUrl)
    assert.equal(f.state.imSettingsReady, true)

    offline = true
    t.mock.timers.tick(5000)
    await settle()
    assert.equal(f.state.imSettingsUrl, loadedUrl)
    assert.equal(f.state.imSettingsReady, true)
  } finally { f.app.unmount() }
})

test('IM waits through runtime startup and stops polling when its retained settings view is hidden', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  let runtime = { state: 'starting' }
  const f = fixture({ agentApi: async () => { calls++; return runtime } }, { focusPanelId: 'im-bots', active: true })
  try {
    await settle()
    assert.equal(f.state.imSettingsUrl, '')
    runtime = imRuntime()
    t.mock.timers.tick(5000)
    await settle()
    assert.equal(f.state.imSettingsUrl, 'http://127.0.0.1:19065/?csImSettings=1&csRuntimeGeneration=1')

    f.props.active = false
    await settle()
    const hiddenCalls = calls
    t.mock.timers.tick(60000)
    await settle()
    assert.equal(calls, hiddenCalls)
    assert.equal(f.state.imSettingsError, '')

    runtime = imRuntime(3)
    f.props.active = true
    await settle()
    assert.equal(calls, hiddenCalls + 1)
    assert.equal(new URL(f.state.imSettingsUrl).searchParams.get('csRuntimeGeneration'), '3')
  } finally { f.app.unmount() }
  const stoppedCalls = calls
  t.mock.timers.tick(60000)
  await settle()
  assert.equal(calls, stoppedCalls)
})

test('IM load timeout offers a fresh frame attempt and a late valid handshake clears the error', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture({ agentApi: async () => imRuntime() }, { focusPanelId: 'im-bots', active: true })
  const frameWindow = markRaw({ postMessage() {} })
  try {
    await settle()
    const originalUrl = f.state.imSettingsUrl
    t.mock.timers.tick(30000)
    await settle()
    assert.match(f.state.imSettingsError, /加载超时/)

    f.state.retryImSettings()
    await settle()
    assert.equal(f.state.imSettingsError, '')
    assert.equal(f.state.imSettingsReload, 1)
    assert.equal(f.state.imSettingsUrl, originalUrl)
    assert.equal(f.state.imSettingsReady, false)

    t.mock.timers.tick(30000)
    await settle()
    assert.match(f.state.imSettingsError, /加载超时/)
    f.state.imSettingsFrame = { contentWindow: frameWindow }
    markImReady(f.state, frameWindow)
    await settle()
    assert.equal(f.state.imSettingsError, '')
    assert.equal(f.state.imSettingsReady, true)
    t.mock.timers.tick(30000)
    await settle()
    assert.equal(f.state.imSettingsError, '')
  } finally { f.app.unmount() }
})

test('switching settings panels retains an authenticated IM frame when the runtime is unchanged', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture({ agentApi: async () => imRuntime() }, { focusPanelId: 'im-bots', active: true })
  const frameWindow = markRaw({ postMessage() {} })
  try {
    await settle()
    f.state.imSettingsFrame = { contentWindow: frameWindow }
    markImReady(f.state, frameWindow)
    await settle()
    const originalUrl = f.state.imSettingsUrl

    f.props.focusPanelId = 'notify-dingtalk'
    await settle()
    t.mock.timers.tick(30000)
    await settle()
    f.props.focusPanelId = 'im-bots'
    await settle()
    assert.equal(f.state.imSettingsUrl, originalUrl)
    assert.equal(f.state.imSettingsReload, 0)
    assert.equal(f.state.imSettingsReady, true)
    assert.equal(f.state.imSettingsError, '')
  } finally { f.app.unmount() }
})

test('late runtime reads cannot overwrite a newer generation or mutate an unmounted settings page', async () => {
  const replies = []
  const f = fixture({ agentApi: () => new Promise(resolve => { replies.push(resolve) }) })
  try {
    const oldRead = f.state.refreshAgentRuntime()
    const newRead = f.state.refreshAgentRuntime()
    replies[1](imRuntime(2))
    await newRead
    replies[0](imRuntime(1))
    await oldRead
    assert.equal(f.state.agentRuntime.generation, 2)

    const pending = f.state.refreshAgentRuntime()
    f.app.unmount()
    replies[2](imRuntime(3))
    await pending
    assert.equal(f.state.agentRuntime.generation, 2)
  } finally { f.app.unmount() }
})
