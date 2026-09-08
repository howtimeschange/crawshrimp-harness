const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const runtime = process.env.CRAWSHRIMP_TIME_CONTEXT_TEST_ROOT || resolve(__dirname, '../../integrations/deepseek-harness')
const patcherPath = resolve(__dirname, '../../integrations/deepseek-harness/scripts/patch-runtime-dependencies.mjs')
const user = text => ({ source: { kind: 'user', rpcId: text, clientTimeZone: 'Asia/Shanghai' }, content: [{ type: 'text', text }] })
const plugin = name => ({ source: { kind: 'plugin', plugin: name }, content: [{ type: 'text', text: name }] })

async function harness(events = []) {
  const patcher = await import(pathToFileURL(patcherPath).href)
  const result = patcher.patchTimeContext(runtime)
  if (process.env.CRAWSHRIMP_TIME_CONTEXT_TEST_ROOT) assert.equal(result.patched, false, 'staging already applied the patch')
  const source = readFileSync(result.entry, 'utf8')
  assert.equal(patcher.patchTimeContextSource(source), source, 'patch is idempotent')
  const { apply } = await import(pathToFileURL(result.entry).href)
  let projection, preStep
  let state
  const ctx = {
    sessionProjections: {
      register(value) { projection = value; state = value.init() },
      stateOf() { return state },
    },
    on(name, callback) { assert.equal(name, 'agent/pre-step'); preStep = callback },
  }
  apply(ctx, {})
  const history = []
  const append = (type, data, time = Date.now()) => {
    const event = { type, data, time }
    history.push(event)
    state = projection.apply(state, event)
  }
  for (const event of events) append(event.type, event.data, event.time)
  const session = { get seq() { return history.length }, eventAt: seq => history[seq] }
  return {
    history, append,
    async prepare(messages = [], { turn = 1, step = 1, kind = 'enter', aborted = false } = {}) {
      return preStep({ agent: { session }, turn, step, signal: { aborted } }, async () => ({ kind, messages }))
    },
    commit(decision) { for (const message of decision.messages) append('user/message', message) },
  }
}
const readings = decision => decision.messages.filter(message => message.source.plugin === 'time-context')

test('one input injects once across 162 tool steps; the next turn refreshes immediately', async () => {
  const h = await harness()
  h.append('turn/start', { turn: 1 })
  const first = await h.prepare([user('read announcements')])
  assert.equal(readings(first).length, 1)
  assert.match(readings(first)[0].content[0].text, /Asia\/Shanghai/)
  h.commit(first)
  for (let step = 2; step <= 162; step++) {
    h.append('assistant/message', {})
    h.append('tool/result', {})
    assert.equal(readings(await h.prepare([], { step })).length, 0)
  }
  h.append('turn/end', { turn: 1 })
  h.append('turn/start', { turn: 2 })
  assert.equal(readings(await h.prepare([user('continue')], { turn: 2 })).length, 1)
})

test('mid-turn user input refreshes once while plugin updates do not', async () => {
  const h = await harness()
  h.append('turn/start', { turn: 1 })
  h.commit(await h.prepare([user('start')]))
  assert.equal(readings(await h.prepare([plugin('instructions')], { step: 2 })).length, 0)
  const update = await h.prepare([user('new direction')], { step: 3 })
  assert.equal(readings(update).length, 1)
  h.commit(update)
  assert.equal(readings(await h.prepare([], { step: 4 })).length, 0)
})

test('restoring durable history suppresses duplicates and detects already-entered user input', async () => {
  const h = await harness()
  h.append('turn/start', { turn: 1 })
  h.commit(await h.prepare([user('start')]))
  const restored = await harness(h.history)
  assert.equal(readings(await restored.prepare([], { step: 2 })).length, 0)
  // Equal/older timestamps must not hide a new input: event ordering is truth.
  restored.append('user/message', user('continue after restore'), 1)
  const update = await restored.prepare([], { step: 3 })
  assert.equal(readings(update).length, 1)
  restored.commit(update)
  assert.equal(readings(await restored.prepare([], { step: 4 })).length, 0)
})

test('rejected, cancelled and empty preparations add nothing; scheduled turns retain an initial clock', async () => {
  const h = await harness()
  h.append('turn/start', { turn: 1 })
  assert.equal(readings(await h.prepare()).length, 0)
  assert.equal(readings(await h.prepare([user('start')], { kind: 'reject' })).length, 0)
  assert.equal(readings(await h.prepare([user('start')], { aborted: true })).length, 0)
  const initial = await h.prepare([plugin('schedule')])
  assert.equal(readings(initial).length, 1)
  h.commit(initial)
  assert.equal(readings(await h.prepare([], { step: 2 })).length, 0)
})

test('a clean upstream patch fails closed when its injection anchor changes', async () => {
  const { patchTimeContextSource } = await import(pathToFileURL(patcherPath).href)
  assert.throws(() => patchTimeContextSource('upstream changed'), /time-context pre-step clock sampling/)
})
