import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { mcpPagination, composerSubmit } from './backports/index.mjs'
const read = (pkg, file) => readFileSync(new URL(`../node_modules/@deepseek-ai/${pkg}/lib/${file}`, import.meta.url), 'utf8')
const mcp = mcpPagination(read('dsh-mcp-client', 'index.js'))
const ui = composerSubmit(read('dsh-client-ui-conversation', 'client.js'))
test('backports are idempotent and reject unknown source', () => {
  assert.equal(mcpPagination(mcp), mcp); assert.equal(composerSubmit(ui), ui)
  assert.throws(() => mcpPagination('changed'), /anchor/)
  assert.throws(() => composerSubmit('changed'), /anchor/)
  assert.throws(() => mcpPagination(mcp.replace('seenCursors.add(cursor);', '')), /incomplete/)
  assert.throws(() => composerSubmit(ui.replace('keyboard.submit(primarySubmitMode);', '')), /incomplete/)
})
function sync(pages) {
  let calls = 0, disposed = 0, registered = 0
  const context = { Map, Set, Error, listToolsUncached: async () => { if (calls >= 10) throw new Error('unbounded'); const page = pages[calls++]; if (page instanceof Error) throw page; return { tools: [], ...page } } }
  const body = mcp.slice(mcp.indexOf('async function syncTools('), mcp.indexOf('/** Keep a supported advertised schema'))
  vm.runInNewContext(body + '\nglobalThis.sync = syncTools;', context)
  return { run: () => context.sync({}, { tools: { register: () => registered++ } }, { serverName: 'fixture' }, new Map([['old', () => disposed++]])), state: () => ({ calls, disposed, registered }) }
}
test('normal pagination swaps only after all pages', async () => {
  const h = sync([{ nextCursor: 'A' }, { nextCursor: 'B' }, {}]); await h.run()
  assert.deepEqual(h.state(), { calls: 3, disposed: 1, registered: 0 })
})
for (const cursors of [['A', 'A'], ['A', 'B', 'A']]) test(`cycle ${cursors.join('→')} rejects and retains old tools`, async () => {
  const h = sync(cursors.map(nextCursor => ({ nextCursor })))
  await assert.rejects(h.run, /repeated.*cursor/)
  assert.deepEqual(h.state(), { calls: cursors.length, disposed: 0, registered: 0 })
})
test('transport cancellation retains old generation', async () => {
  const h = sync([{ nextCursor: 'A' }, new Error('cancelled')]); await assert.rejects(h.run, /cancelled/); assert.equal(h.state().disposed, 0)
})
for (const mode of ['queue', 'steer']) for (const running of [false, true]) test(`button uses Enter policy ${mode}/${running}`, () => {
  const calls = [], context = { running, subagent: null, empty: false, blocked: undefined, continuable: true, disabled: false, machineBusy: false, input: { phase: 'plain' }, draft: 'hello', resolveSubmitMode: (...args) => { calls.push(args); return mode }, t: x => x, keyboard: { submit: x => calls.push(x) }, stop: () => calls.push('stop') }
  const body = ui.slice(ui.indexOf('const primaryStops ='), ui.indexOf('const accessSelect =', ui.indexOf('const primaryStops =')))
  vm.runInNewContext(body + '\nonPrimary()', context)
  assert.deepEqual(calls, [[running, 'enter', true], mode])
  context.empty = true; calls.length = 0; vm.runInNewContext(body + '\nonPrimary()', { ...context })
  assert.equal(calls.at(-1), running ? 'stop' : calls[0])
})
