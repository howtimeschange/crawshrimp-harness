import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { patchArchiveSource, patchSessionArchive } from './session-archive.mjs'

const base = new URL('../node_modules/@deepseek-ai/', import.meta.url)
const read = path => readFileSync(new URL(path, base), 'utf8')
function method(source, signature) {
  const start = source.indexOf(signature)
  assert.ok(start >= 0, signature)
  const end = source.indexOf('\n\t/**', start)
  return vm.runInNewContext('({' + source.slice(start, end) + '})', {
    WorkspaceActiveSessionError: class extends Error {},
    WorkspaceUnknownSessionError: class extends Error {},
  })[signature.split('(')[0]]
}

test('native archive/restore preserves membership, persists, is idempotent and refuses active work', async () => {
  const source = read('dsh-workspace/lib/index.js')
  const archive = method(source, 'archiveSession(sessionId, options = {}) {')
  const restore = method(source, 'unarchiveSession(sessionId) {')
  let state = { archivedSessionIds: ['older'], pinnedSessionIds: ['target'], items: [{ sessionIds: ['older', 'target'] }] }
  let disk = JSON.stringify(state), writes = 0, active = true, stops = 0
  const ctx = { ctx: { waterfall: async () => active ? ['running'] : [] }, enqueueOperation: fn => fn(), requireState: () => state, sessionKnown: async () => true,
    stopSessionActivity: async () => { assert.ok(state.archivedSessionIds.includes('target')); stops++ },
    setState: async next => { disk = JSON.stringify(next); state = JSON.parse(disk); writes++ } }
  await assert.rejects(archive.call(ctx, 'target'))
  assert.equal(writes, 0)
  await archive.call(ctx, 'target', { stopActivity: true })
  assert.equal(stops, 1)
  assert.deepEqual(state.archivedSessionIds, ['older', 'target'])
  assert.deepEqual(state.pinnedSessionIds, [])
  await archive.call(ctx, 'target')
  assert.equal(writes, 1)
  await restore.call(ctx, 'target')
  assert.deepEqual(JSON.parse(disk), { archivedSessionIds: ['older'], pinnedSessionIds: [], items: [{ sessionIds: ['older', 'target'] }] })
  await restore.call(ctx, 'target')
  assert.equal(writes, 2)
  active = false
  ctx.setState = async () => { throw Error('disk full') }
  await assert.rejects(archive.call(ctx, 'target'), /disk full/)
  assert.deepEqual(state.archivedSessionIds, ['older'])
})

test('rc2 uses upstream archive contracts without rewriting bundles; legacy guard remains strict', () => {
  const paths = ['dsh-workspace/lib/index.js', 'dsh-api-workspace-controller/lib/client.js', 'dsh-client-ui-workspace/lib/client.js']
  const before = paths.map(read)
  for (let i = 0; i < 2; i++) assert.deepEqual(patchSessionArchive(fileURLToPath(new URL('..', import.meta.url))), { upstream: true })
  assert.deepEqual(paths.map(read), before)
  for (const path of paths.filter(p => p.endsWith('/client.js'))) new vm.Script(read(path))
  assert.throws(() => patchArchiveSource('changed upstream', 'registry'), /anchor changed/)
})

test('native confirmation cancels without request, retains failure and settles success', async () => {
  const source = read('dsh-client-ui-workspace/lib/client.js')
  const start = source.indexOf('const [archiving, setArchiving]', source.indexOf('function ArchiveConfirmForm('))
  const end = source.indexOf('return (0, react_jsx_runtime.jsxs)', start)
  const states = []; let cursor = 0, calls = 0, settled = 0, reject = true
  const react = { useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], v => states[i] = v] } }
  const render = () => { cursor = 0; return vm.runInNewContext('(function(){' + source.slice(start, end) + ';return {close, confirm};})()', { Error, react, request: { sessionId: 'target' }, onSettle: () => settled++, stopAndArchiveSession: async id => { assert.equal(id, 'target'); calls++; if (reject) throw Error('offline') } }) }
  let ui = render(); ui.close(); assert.equal(calls, 0); assert.equal(settled, 1)
  ui.confirm(); render().close(); assert.equal(settled, 1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(states[1], 'offline'); assert.equal(settled, 1)
  reject = false; render().confirm(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, 2); assert.equal(calls, 2)
})

test('restore calls the dedicated RPC and only installs a successful response', async () => {
  const source = read('dsh-api-workspace-controller/lib/client.js')
  const start = source.indexOf('async unarchiveSession(sessionId) {')
  const end = source.indexOf('\n\t\t\t/**', start)
  const restore = vm.runInNewContext('({' + source.slice(start, end) + '}).unarchiveSession')
  let ids = ['target'], calls = 0, fail = false
  const ctx = { archiveRequestSeq: 0, installArchived: value => ids = value, remote: { unarchiveSession: async request => { assert.equal(request.sessionId, 'target'); calls++; return fail ? { ok: false, error: { code: 'IO' } } : { ok: true, value: { archivedSessionIds: [] } } } } }
  await restore.call(ctx, 'target'); assert.deepEqual(ids, []); assert.equal(calls, 1)
  ids = ['target']; fail = true; assert.equal((await restore.call(ctx, 'target')).ok, false); assert.deepEqual(ids, ['target'])
  assert.match(read('dsh-api-remotes/lib/client.js'), /workspace_unarchiveSession_parameter_0\$schema/)
})
