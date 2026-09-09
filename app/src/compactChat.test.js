const assert = require('node:assert/strict')
const test = require('node:test')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const modulePromise = import('../../integrations/deepseek-harness/scripts/compact-chat.mjs')
const node = (kind, turn = 1) => ({ kind, location: { kind: 'step', turn: { turn } } })

test('tool groups retain order and split at prose, reasoning, errors and turn boundaries', async () => {
  const { groupToolCalls } = await modulePromise
  const entries = [['a',node('tool-call')],['b',node('tool-call')],['text',node('assistant-step')],['c',node('tool-call')],['error',node('turn-error')],['d',node('tool-call')],['e',node('tool-call',2)]]
  const groups = groupToolCalls(entries.map(([key])=>key),new Map(entries))
  assert.deepEqual(groups.map(g=>g.keys), [['a','b'],['text'],['c'],['error'],['d'],['e']])
  assert.deepEqual(groups.flatMap(g=>g.keys), entries.map(([key])=>key))
})

test('a streaming group keeps its identity as new calls arrive', async () => {
  const { groupToolCalls } = await modulePromise
  const nodes = new Map(['a','b','c'].map(key=>[key,node('tool-call')]))
  assert.equal(groupToolCalls(['a'], nodes)[0].key, groupToolCalls(['a','b','c'], nodes)[0].key)
  assert.deepEqual(groupToolCalls(['a','b','c'],nodes)[0].keys, ['a','b','c'])
  assert.deepEqual(groupToolCalls([],nodes), [])
})

test('runtime overlays are idempotent and reject changed upstream anchors', async () => {
  const { patchCompactChatSource, patchConversationSource } = await modulePromise
  for (const [name,patch] of [['chat',patchCompactChatSource],['conversation',patchConversationSource]]) {
    const source = readFileSync(resolve(__dirname, '../../integrations/deepseek-harness/node_modules/@deepseek-ai/dsh-client-ui-'+name+'/lib/client.js'),'utf8')
    const result = patch(source)
    assert.equal(patch(result), result)
    assert.throws(()=>patch('unrecognized upstream'), /boundary changed|anchor changed/)
  }
})

test('invisible protocol steps do not split consecutive visible tool calls', async () => {
  const { groupToolCalls } = await modulePromise
  const nodes = new Map([['a',node('tool-call')], ['protocol',{...node('assistant-step'),data:{status:'completed',blocks:[{kind:'tool-call'}]}}], ['b',node('tool-call')]])
  assert.deepEqual(groupToolCalls([...nodes.keys()],nodes).map(g=>g.keys), [['a','b'],['protocol']])
  nodes.get('protocol').data.status='interrupted'
  assert.deepEqual(groupToolCalls([...nodes.keys()],nodes).map(g=>g.keys), [['a'],['protocol'],['b']])
})
