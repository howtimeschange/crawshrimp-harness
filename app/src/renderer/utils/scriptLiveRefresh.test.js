import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../views/ScriptList.vue', import.meta.url), 'utf8')
const start = source.indexOf('async function refreshLiveTasks()')
const end = source.indexOf('\nasync function loadGroups', start)

function fixture(request) {
  const groups = { value: [{ adapter_id: 'demo', tasks: [{ task_id: 'one', live: { status: 'running' }, last_run: { status: 'old' } }] }] }
  const context = vm.createContext({ groups, document: { hidden: false }, window: { cs: { getTasksLive: request } }, liveRefreshInFlight: false, disposed: false })
  vm.runInContext(source.slice(start, end), context)
  return { groups, context }
}

test('live refresh updates progress without reloading the script catalog and preserves it on failure', async () => {
  let calls = 0
  const f = fixture(async () => {
    calls++
    if (calls > 1) throw new Error('offline')
    return [{ adapter_id: 'demo', task_id: 'one', live: { status: 'completed' }, last_run: { status: 'completed' } }]
  })
  await f.context.refreshLiveTasks()
  assert.equal(f.groups.value[0].tasks[0].live.status, 'completed')
  await f.context.refreshLiveTasks()
  assert.equal(f.groups.value[0].tasks[0].last_run.status, 'completed')
  f.context.document.hidden = true
  await f.context.refreshLiveTasks()
  assert.equal(calls, 2)
})
