import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { requestArchivedSessions } from './renderer/utils/archivedSessions.mjs'

test('shell request correlates replies and propagates backend errors', async () => {
  const target = new EventTarget()
  target.addEventListener('cs-archive-request', event => {
    target.dispatchEvent(new CustomEvent('cs-archive-response', { detail: { requestId: 'unrelated', items: [] } }))
    target.dispatchEvent(new CustomEvent('cs-archive-response', { detail: { requestId: event.detail.requestId, ...(event.detail.action === 'restore' ? { error: '写入失败' } : { items: [{ id: 'a' }] }) } }))
  })
  assert.deepEqual(await requestArchivedSessions('list', '', target), [{ id: 'a' }])
  await assert.rejects(requestArchivedSessions('restore', 'a', target), /写入失败/)
})

test('iframe uses live archive authority and restores through controller', async () => {
  const source = readFileSync(new URL('../../integrations/deepseek-harness/crawshrimp-slots/lib/client.js', import.meta.url), 'utf8')
  const start = source.indexOf('async function handleArchivedSessionsRequest(')
  const end = source.indexOf('    function installShellMessageBridge', start)
  let response
  const navigation = source.slice(source.indexOf('    function selectedSessionId('), source.indexOf('    function defaultWorkspaceNavigator('))
  const handler = vm.runInNewContext(navigation + '(' + source.slice(start, end).trim() + ')', { postToShell: value => { response = value } })
  let ids = ['a', 'missing']; let calls = 0; let current; let refreshes = 0; let blankSession = true
  const ctx = {
    workspaces: { list: { getSnapshot: () => ({ phase: 'ready', archivedSessionIds: ids }) }, unarchiveSession: async (id) => { calls++; ids = ids.filter(item => item !== id) } },
    sessions: { refresh: async () => { refreshes++ }, open: id => { current = id }, list: { getSnapshot: () => ({ phase: 'ready', current, byId: { a: { id: 'a', blank: blankSession, displayTitle: '测试会话', updatedAt: 1790581183361 } } }) } }
  }
  await handler(ctx, { action: 'list', requestId: '1' })
  assert.equal(response.items[0].title, '测试会话')
  assert.equal(response.items[0].updatedAt, 1790581183361)
  assert.equal(response.items[1].updatedAt, null)
  assert.equal(response.items[1].id, 'missing')
  assert.equal(calls, 0)
  await handler(ctx, { action: 'restore', requestId: '2', sessionId: 'a' })
  assert.equal(calls, 1)
  assert.equal(current, 'a')
  assert.equal(refreshes, 0)
  assert.equal(response.items.length, 1)
  // The real sidebar predicate must admit the restored blank session.
  const workspace = readFileSync(new URL('../../integrations/deepseek-harness/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js', import.meta.url), 'utf8')
  const predicate = workspace.slice(workspace.indexOf('function sessionVisible('), workspace.indexOf('\n\t\t}', workspace.indexOf('function sessionVisible(')) + 4)
  const visible = vm.runInNewContext('(' + predicate + ')')
  const blank = { id: 'a', blank: true }
  assert.equal(visible(blank, undefined, new Set(), "default"), false)
  assert.equal(visible(blank, current, new Set(ids), "default"), true)
  blankSession = false
  current = 'existing-current-session'
  ids = ['a', 'missing']
  await handler(ctx, { action: 'restore', requestId: 'regular', sessionId: 'a' })
  assert.equal(current, 'existing-current-session', 'restoring regular sessions must not navigate')
  assert.equal(refreshes, 0, 'restoring must not rebuild the session scope and reset layout')
  ctx.workspaces.unarchiveSession = async () => { throw Error('disk full') }
  await handler(ctx, { action: 'restore', requestId: '3', sessionId: 'missing' })
  assert.equal(response.error, 'disk full')
  assert.deepEqual(ids, ['missing'])
})
