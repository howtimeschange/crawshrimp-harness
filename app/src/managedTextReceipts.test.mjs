import test from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, nextTick, ssrContextKey } from 'vue'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const cacheDir = mkdtempSync(join(tmpdir(), 'harness-receipts-test-'))
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, plugins: [vue()], cacheDir, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' })
let Component
try { Component = (await server.ssrLoadModule('/src/renderer/components/ManagedTextReceipts.vue')).default }
finally { await server.close(); rmSync(cacheDir, { recursive: true, force: true }) }
Component.render = () => null
const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
const settle = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); await nextTick() } }
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const row = id => ({ request_id: id, model: 'test', state: 'unknown' })
function fixture(list, trace = async () => ({})) {
  let changed, unsubscribed = false
  globalThis.window = { cs: { listManagedTextRequests: list, traceManagedTextRequest: trace, onAccountChanged(fn) { changed = fn; return () => { unsubscribed = true } } } }
  const app = renderer.createApp(Component)
  app.provide(ssrContextKey, { modules: new Set() })
  const vm = app.mount({})
  return { app, state: vm.$.setupState, change: () => changed(), unsubscribed: () => unsubscribed }
}

test('loads pages and keeps existing rows and offset when a page fails', async () => {
  const offsets = []; let fail = true
  const f = fixture(async offset => { offsets.push(offset); if (offset === 0) return { requests: [row('a')], next_offset: 100 }; if (fail) throw Error('offline'); return { requests: [row('a'), row('b')], next_offset: null } })
  try {
    await settle(); assert.equal(f.state.nextOffset, 100)
    await f.state.loadMore(); assert.deepEqual(f.state.rows.map(x => x.request_id), ['a']); assert.equal(f.state.nextOffset, 100); assert.match(f.state.error, /更多记录暂不可用/)
    fail = false; await f.state.loadMore(); assert.deepEqual(f.state.rows.map(x => x.request_id), ['a', 'b']); assert.equal(f.state.nextOffset, null); assert.deepEqual(offsets, [0, 100, 100])
  } finally { f.app.unmount() }
  assert.equal(f.unsubscribed(), true)
})

test('checks found, missing and offline states without claiming no charge', async () => {
  let result = { status: 'found', state: 'completed' }
  const f = fixture(async () => ({ requests: [row('a')] }), async () => { if (result instanceof Error) throw result; return result })
  try {
    await settle(); f.state.manualId = 'a'; await f.state.check('a'); assert.match(f.state.manualResult, /服务端已完成/)
    result = { status: 'not_found' }; await f.state.check('a'); assert.match(f.state.manualResult, /不能证明未受理或未计费/)
    result = new Error('offline'); await f.state.check('a'); assert.match(f.state.manualResult, /不要重复提交/)
    f.state.manualId = 'b'; assert.equal(f.state.manualResult, '')
  } finally { f.app.unmount() }
})

test('account switch reloads and ignores old page and trace responses', async () => {
  let account = 'old'; const oldPage = deferred(), oldTrace = deferred()
  const f = fixture(async offset => account === 'old' ? offset === 0 ? { requests: [row('old')], next_offset: 100 } : oldPage.promise : { requests: [row('new')], next_offset: null }, async () => oldTrace.promise)
  try {
    await settle(); const page = f.state.loadMore(); const check = f.state.check('old'); account = 'new'; f.change(); await settle()
    assert.deepEqual(f.state.rows.map(x => x.request_id), ['new'])
    oldPage.resolve({ requests: [row('late')], next_offset: 200 }); oldTrace.resolve({ status: 'found', state: 'completed' }); await Promise.all([page, check]); await settle()
    assert.deepEqual(f.state.rows.map(x => x.request_id), ['new']); assert.deepEqual(f.state.results, {}); assert.equal(f.state.nextOffset, null)
  } finally { f.app.unmount() }
})

test('initial failure reports unavailable and invalid pagination cannot loop', async () => {
  let fail = true
  const f = fixture(async () => { if (fail) throw Error('offline'); return { requests: [row('a')], next_offset: 0 } })
  try { await settle(); assert.match(f.state.error, /暂不可用/); fail = false; await f.state.refresh(); assert.equal(f.state.error, ''); assert.equal(f.state.nextOffset, null) }
  finally { f.app.unmount() }
})
