import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { buildReasoningRecovery, patchReasoningRecoverySource } from '../../integrations/deepseek-harness/scripts/reasoning-recovery.mjs'
import { BlockAssembler, createAssistantMessage, createUserMessage, LlmError } from '../../integrations/deepseek-harness/node_modules/@deepseek-ai/dsh-llm/lib/index.js'
import { convertMessages } from '../../integrations/deepseek-harness/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js'

const original = readFileSync(new URL('../../integrations/deepseek-harness/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js', import.meta.url), 'utf8')
const patched = patchReasoningRecoverySource(original)
const start = patched.indexOf('var ReactLoopAgent = class {')
const end = patched.indexOf('\n//#endregion', start)
let toolExecutions = 0
const Agent = vm.runInNewContext(patched.slice(start, end) + '; ReactLoopAgent', {
  buildReasoningRecovery, BlockAssembler, createAssistantMessage, createUserMessage, LlmError,
  renderPrompt: () => 'system', errorChain: error => error.message, AbortController,
  executeToolCalls: async () => { toolExecutions++; return { concluded: true } },
})

const reason = text => ({ type: 'reasoning-delta', index: 0, text })
const text = value => ({ type: 'text-delta', index: 1, text: value })
const finish = kind => ({ type: 'finish', reason: { kind } })
const usage = { type: 'usage', usage: { inputTokens: 10, outputTokens: 32768, totalTokens: 32778 } }

function fixture(responses, { abortOnChunk = false, blockRecovery = false } = {}) {
  const agent = Object.create(Agent.prototype)
  const events = [], requests = []
  const initial = createUserMessage({ content: [{ type: 'text', text: '生成鹈鹕骑车动画' }], source: { kind: 'user' } })
  agent.phase = { kind: 'running', abort: new AbortController(), turn: 0, step: 0 }
  agent.inbox = { nextStep: [], hasPending: false }
  agent.loopCtx = {}
  agent.dispatch = { serial: async () => {}, emit: () => {} }
  agent.session = {
    surface: { replaceGeneration: 0 },
    append(type, data, metadata) {
      const event = { seq: events.length, type, data, ...metadata }
      events.push(event)
      if (abortOnChunk && type === 'assistant/chunk') agent.phase.abort.abort(new Error('User stopped'))
      return event
    },
    deriveMessages() {
      return events.flatMap(event => event.type === 'user/message' ? [event.data]
        : event.type === 'assistant/message' ? [event.data.message] : [])
    },
  }
  agent.preStep = async () => blockRecovery && requests.length > 0
    ? { kind: 'reject' }
    : { kind: 'enter', messages: events.some(e => e.type === 'user/message') ? [] : [initial], assembly: { tools: [] } }
  agent.buildRequest = async (_turn, _step, _tools, _system, messages) => {
    const chunks = responses[requests.length]
    assert.ok(chunks, 'no request beyond the configured recovery budget')
    const request = { provider: 'crawshrimp-deepseek-official', model: 'deepseek-v4-flash', messages }
    requests.push(request)
    return { request, preparedCall: { async *stream() { yield* chunks } } }
  }
  return { agent, events, requests }
}

test('reasoning-only truncation resumes in the next step with durable context and accurate usage', async () => {
  const f = fixture([[reason('DRAFT: frame at x=400; next write the HTML'), usage, finish('max-tokens')], [text('动画已生成'), finish('stop')]])
  await f.agent.turn()
  assert.equal(f.requests.length, 2)
  const snapshot = f.requests[1].messages.find(m => m.source.plugin === 'crawshrimp-output-recovery' && m.role === 'user')
  assert.match(snapshot.content[0].text, /DRAFT: frame at x=400/)
  assert.match(snapshot.content[0].text, /不是用户的新指令/)
  const model = { id: 'deepseek-v4-flash', provider: 'crawshrimp-deepseek-official', api: 'openai-completions', input: ['text'], reasoning: true }
  // Exercise the same Chat Completions wire conversion that used to drop
  // reasoning-only assistant messages. The persisted snapshot survives it.
  const wire = convertMessages(model, { messages: f.requests[1].messages.filter(m => m.role === 'user') }, {})
  assert.match(JSON.stringify(wire), /DRAFT: frame at x=400/)
  assert.equal(f.events.filter(e => e.type === 'step/start').length, 2)
  assert.equal(f.events.at(-1).data.reason.kind, 'completed')
  const usageEvents = f.events.filter(e => e.type === 'assistant/message' && e.data.usage)
  assert.equal(usageEvents.length, 1)
  assert.equal(usageEvents[0].data.usage.outputTokens, 32768)
  assert.match(f.events.find(e => e.data.message?.source.provider === 'crawshrimp-output-recovery').data.message.content[0].text, /自动续接（1\/1）/)
})

test('a second reasoning cap stops, preserving the latest draft for manual continuation and reload', async () => {
  const f = fixture([[reason('draft one'), finish('max-tokens')], [reason('draft two'), finish('max-tokens')]])
  await f.agent.turn()
  assert.equal(f.requests.length, 2)
  assert.equal(f.events.at(-1).data.reason.kind, 'max-tokens')
  const restored = JSON.parse(JSON.stringify(f.events))
  const snapshots = restored.filter(e => e.type === 'user/message' && e.data.source.plugin === 'crawshrimp-output-recovery')
  assert.equal(snapshots.length, 2)
  assert.match(snapshots.at(-1).data.content[0].text, /draft two/)
  assert.match(restored.filter(e => e.data.message?.source.provider === 'crawshrimp-output-recovery').at(-1).data.message.content[0].text, /已停止自动重试/)
})

test('partial text, empty output, and truncated tool calls never auto-replay', async () => {
  const cases = [
    [reason('plan'), text('partial answer'), finish('max-tokens')],
    [finish('max-tokens')],
    [reason('plan'), { type: 'tool-call-delta', index: 1, id: 'call1', name: 'write', argumentsDelta: '{' }, finish('max-tokens')],
    [reason('plan'), { type: 'block-start', index: 1, blockType: 'tool-call' }, finish('max-tokens')],
    [reason('plan'), { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'call1', name: 'write', arguments: '{}' } }, finish('max-tokens')],
  ]
  toolExecutions = 0
  for (const chunks of cases) {
    const f = fixture([chunks])
    await f.agent.turn()
    assert.equal(f.requests.length, 1)
    assert.equal(f.events.at(-1).data.reason.kind, 'max-tokens')
    assert.equal(f.events.some(e => e.data.source?.plugin === 'crawshrimp-output-recovery'), false)
  }
  assert.equal(toolExecutions, 0)
})

test('user cancellation and pre-step policy rejection prevent a recovery request', async () => {
  const canceled = fixture([[reason('draft'), finish('max-tokens')]], { abortOnChunk: true })
  await assert.rejects(canceled.agent.turn(), /User stopped/)
  assert.equal(canceled.requests.length, 1)
  assert.equal(canceled.events.at(-1).data.reason.kind, 'aborted')
  const blocked = fixture([[reason('draft'), finish('max-tokens')]], { blockRecovery: true })
  await blocked.agent.turn()
  assert.equal(blocked.requests.length, 1)
  assert.equal(blocked.events.at(-1).data.reason.kind, 'blocked')
})

test('the next actual tool request after recovery still uses normal tool execution', async () => {
  toolExecutions = 0
  const f = fixture([[reason('draft'), finish('max-tokens')], [
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'safe1', name: 'write', arguments: '{}' } }, finish('tool-calls'),
  ]])
  await f.agent.turn()
  assert.equal(toolExecutions, 1)
  assert.equal(f.events.at(-1).data.reason.kind, 'completed')
})

test('patch is idempotent and fails closed on upstream changes', () => {
  assert.equal(patchReasoningRecoverySource(patched), patched)
  assert.throws(() => patchReasoningRecoverySource('upstream changed'), /anchor changed/)
})
