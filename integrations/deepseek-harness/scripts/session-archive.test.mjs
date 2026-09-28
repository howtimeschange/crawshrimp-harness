import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { patchArchiveSource } from './session-archive.mjs'

const base = new URL('../node_modules/@deepseek-ai/', import.meta.url)
const kinds = { 'dsh-workspace/lib/index.js': 'registry', 'dsh-api-workspace-controller/lib/index.js': 'controller', 'dsh-api-workspace-controller/lib/typert.host.js': 'schema', 'dsh-api-workspace-controller/lib/typert.remote-client.js': 'schema', 'dsh-api-workspace-controller/lib/client.js': 'client', 'dsh-client-ui-workspace/lib/client.js': 'ui' }
const read = path => patchArchiveSource(readFileSync(new URL(path, base), 'utf8'), kinds[path])

test('archive/restore preserves workspace membership and survives persisted readback', async () => {
  const source = read('dsh-workspace/lib/index.js')
  const start = source.indexOf('archiveSession(sessionId, archived = true) {')
  const end = source.indexOf('\n\t/**', start)
  const method = vm.runInNewContext('({' + source.slice(start, end) + '}).archiveSession')
  let state = { archivedSessionIds: ['older'], items: [{ sessionIds: ['older', 'target'] }] }
  let disk = JSON.stringify(state)
  let writes = 0
  const ctx = { enqueueOperation: fn => fn(), requireState: () => state, sessionKnown: async () => true, setState: async next => { disk = JSON.stringify(next); state = JSON.parse(disk); writes++ } }
  await method.call(ctx, 'target')
  assert.deepEqual(state.archivedSessionIds, ['older', 'target'])
  await method.call(ctx, 'target')
  assert.equal(writes, 1)
  await method.call(ctx, 'target', false)
  assert.deepEqual(JSON.parse(disk), { archivedSessionIds: ['older'], items: [{ sessionIds: ['older', 'target'] }] })
  await method.call(ctx, 'target', false)
  assert.equal(writes, 2)
  ctx.setState = async () => { throw Error('disk full') }
  await assert.rejects(method.call(ctx, 'target'), /disk full/)
  assert.deepEqual(state.archivedSessionIds, ['older'])
})

test('all shipped patches are idempotent and client bundles parse', () => {
  for (const [path, kind] of [
    ['dsh-workspace/lib/index.js', 'registry'], ['dsh-api-workspace-controller/lib/index.js', 'controller'],
    ['dsh-api-workspace-controller/lib/typert.host.js', 'schema'], ['dsh-api-workspace-controller/lib/typert.remote-client.js', 'schema'],
    ['dsh-api-workspace-controller/lib/client.js', 'client'], ['dsh-client-ui-workspace/lib/client.js', 'ui']
  ]) {
    const source = read(path)
    assert.equal(patchArchiveSource(source, kind), source)
    if (path.endsWith('/client.js')) new vm.Script(source)
  }
  assert.throws(() => patchArchiveSource('changed upstream', 'registry'), /anchor changed/)
})

test('archive action waits for confirmation; cancellation sends no request; failures retain dialog', async () => {
  const source = read('dsh-client-ui-workspace/lib/client.js')
  const start = source.indexOf('const [archiveTarget, setArchiveTarget]')
  const end = source.indexOf('const [deleteTarget, setDeleteTarget]', start)
  const states = []; let cursor = 0; let calls = 0; let reject = false
  const react = { useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], v => states[i] = v] }, useRef() { return lock } }
  const lock = { current: false }
  const render = () => { cursor = 0; return vm.runInNewContext('(function(){' + source.slice(start, end) + ';return {onSessionArchive, closeArchive, confirmArchive};})()', { react, archiveSession: async () => { calls++; if (reject) throw Error('offline') } }) }
  let ui = render(); ui.onSessionArchive('target'); assert.equal(calls, 0)
  ui = render(); ui.closeArchive(); assert.equal(states[0], null); assert.equal(calls, 0)
  ui.onSessionArchive('target'); ui = render(); reject = true; await ui.confirmArchive()
  assert.equal(states[0], 'target'); assert.equal(states[2], 'offline')
  reject = false; ui = render(); await ui.confirmArchive(); assert.equal(states[0], null); assert.equal(calls, 2)
})

test('archive dialog points to shell settings without registering a DSH settings section', () => {
  const source = read('dsh-client-ui-workspace/lib/client.js')
  assert.ok(source.includes('抓虾设置 → 存储 → 已归档会话'))
  assert.ok(!source.includes('CrawshrimpArchivedSessions'))
  assert.ok(!source.includes('id: "archived-sessions"'))
})

test('browser wire schema preserves restore flag instead of silently archiving again', async () => {
  const raw = readFileSync(new URL('dsh-api-remotes/lib/client.js', base), 'utf8')
  const source = patchArchiveSource(raw, 'browser-schema')
  const expression = source.match(/workspace_archiveSession_parameter_0\$schema = ([^;]+);/)[1]
  const { z } = await import('../node_modules/zod/index.js')
  const schema = vm.runInNewContext(expression, z)
  assert.equal(schema.parse({ sessionId: 'a', archived: false }).archived, false)
  assert.equal(schema.parse({ sessionId: 'a', archived: true }).archived, true)
  assert.equal(patchArchiveSource(source, 'browser-schema'), source)
})
