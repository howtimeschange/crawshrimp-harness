import test from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, nextTick, ssrContextKey } from 'vue'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
// Compile the real component graph, including Vue children and brand assets.
// These tests exercise account state; visual rendering has its own UI checks.
const cacheDir = mkdtempSync(join(tmpdir(), 'harness-usage-test-'))
const server = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)),
  configFile: false,
  plugins: [vue()],
  cacheDir,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
})
let Component
try { Component = (await server.ssrLoadModule('/src/renderer/components/UsagePanel.vue')).default }
finally { await server.close(); rmSync(cacheDir, { recursive: true, force: true }) }
Component.render = () => null
const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
const settle = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); await nextTick() } }
function fixture(accountAction) {
  let changed, unsubscribed = false
  globalThis.window = { cs: { accountAction, onAccountChanged(fn) { changed = fn; return () => { unsubscribed = true } } } }
  const app = renderer.createApp(Component, { active: true })
  app.provide(ssrContextKey, { modules: new Set() })
  const vm = app.mount({})
  return { app, state: vm.$.setupState, props: vm.$.props, change: () => changed(), unsubscribed: () => unsubscribed }
}
const account = { user: { id: 'test-account' }, plan: 'pro' }
const sub = { active: false, plan: 'free', expiresAt: null }
const quota = { currency: 'CNY', available: 55, monthly: { total: 0, remaining: 0, used: 0, reserved: 0 }, permanent: { total: 60, remaining: 55, used: 5, reserved: 0 }, asOf: '2026-10-24T00:00:00Z' }
test('returning to usage reuses fresh data, refresh coalesces and retains values on error', async () => {
  let calls = 0, rejectUsage
  const f = fixture(async name => { if (name === 'status') return account; if (name === 'subscription') return sub; assert.equal(name, 'allowance'); calls++; if (calls === 1) return quota; return new Promise((_, reject) => { rejectUsage = reject }) })
  try {
    await settle(); assert.deepEqual(f.state.usage, quota)
    f.props.active = false; await settle(); f.props.active = true; await settle()
    assert.equal(calls, 1)
    const refresh = f.state.refresh(); await settle()
    await f.state.refresh(); assert.equal(calls, 2)
    assert.deepEqual(f.state.usage, quota)
    rejectUsage(new Error('offline')); await refresh
    assert.deepEqual(f.state.usage, quota); assert.equal(f.state.error, 'offline')
  } finally { f.app.unmount() }
  assert.equal(f.unsubscribed(), true)
})
test('account changes clear hidden caches and reject late wallet and subscription replies', async () => {
  const replies = {}
  const f = fixture(async name => name === 'status' ? account : new Promise(resolve => { replies[name] = resolve }))
  try {
    await settle(); f.props.active = false; await settle(); f.change()
    replies.allowance(quota); replies.subscription(sub); await settle()
    assert.equal(f.state.usage, null); assert.equal(f.state.subscription, null); assert.equal(f.state.state, null)
    assert.equal(f.state.loading, false)
  } finally { f.app.unmount() }
})
test('subscription failure does not hide a valid wallet or imply an inactive subscription', async () => {
  const f = fixture(async name => { if (name === 'status') return account; if (name === 'allowance') return quota; throw new Error('unavailable') })
  try {
    await settle(); assert.deepEqual(f.state.usage, quota)
    assert.equal(f.state.error, ''); assert.equal(f.state.subscription, null)
    assert.match(f.state.subscriptionError, /订阅状态暂不可用/)
    assert.equal(f.state.view.monthly.expiryText, '有效账期待确认')
  } finally { f.app.unmount() }
})
test('malformed wallet preserves last valid balance; first-load failure stays unknown', async () => {
  let value = quota
  const f = fixture(async name => name === 'status' ? account : name === 'subscription' ? sub : value)
  try {
    await settle(); value = { data: { total_available: 500000 } }
    await f.state.refresh()
    assert.deepEqual(f.state.usage, quota); assert.match(f.state.error, /额度数据暂不可用/)
    f.props.active = false; await settle(); f.change()
    assert.equal(f.state.usage, null)
    await f.state.refresh()
    assert.equal(f.state.view.totalAvailable, '—'); assert.equal(f.state.view.monthly.percent, null)
  } finally { f.app.unmount() }
})
test('switching to a new account cannot keep the previous wallet when reading fails', async () => {
  let current = account, fail = false
  const f = fixture(async name => { if (name === 'status') return current; if (name === 'subscription') return sub; if (fail) throw Error('offline'); return quota })
  try {
    await settle(); current = { user: { id: 'new-account' }, plan: 'free' }; fail = true
    await f.state.refresh()
    assert.equal(f.state.usage, null); assert.equal(f.state.state.user.id, 'new-account')
    assert.equal(f.state.view.totalAvailable, '—')
  } finally { f.app.unmount() }
})
test('an active account switch loads the new wallet before late old-account replies settle', async () => {
  let owner = account
  const old = {}
  const freeQuota = { ...quota, available: 5, permanent: { total: 5, remaining: 5, used: 0, reserved: 0 } }
  const f = fixture(async name => {
    if (name === 'status') return owner
    if (owner === account) return new Promise(resolve => { old[name] = resolve })
    return name === 'subscription' ? sub : freeQuota
  })
  try {
    await settle(); owner = { user: { id: 'free-account' }, plan: 'free' }; f.change(); await settle()
    assert.deepEqual(f.state.usage, freeQuota)
    old.allowance(quota); old.subscription({ active: true, plan: 'pro' }); await settle()
    assert.deepEqual(f.state.usage, freeQuota); assert.equal(f.state.state.user.id, 'free-account')
    assert.equal(f.state.view.totalAvailable, '¥5.00'); assert.equal(f.state.subscription.active, false)
  } finally { f.app.unmount() }
})
test('a failed external action does not mark successfully read balances as stale', async () => {
  const f = fixture(async name => {
    if (name === 'status') return account
    if (name === 'allowance') return quota
    if (name === 'subscription') return sub
    throw Error('无法打开套餐页')
  })
  try {
    await settle(); await f.state.action('plans')
    assert.equal(f.state.error, '无法打开套餐页'); assert.equal(f.state.readError, false)
    assert.equal(f.state.view.totalAvailable, '¥55.00'); assert.equal(f.state.actionBusy, false)
  } finally { f.app.unmount() }
})
