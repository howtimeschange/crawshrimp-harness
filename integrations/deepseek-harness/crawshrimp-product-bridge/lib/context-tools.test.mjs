import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, projectTools, createDomainState, DOMAIN_TOOL, DOMAINS, toolDomain } from './context-tools.js'
import { automationNativeToolDecision } from './index.js'
const schemas = [
  { name: 'read', description: 'read file', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
  { name: 'mcp__crawshrimp__skill_read', parameters: { type: 'object' } },
  { name: 'mcp__crawshrimp__browser_act', parameters: { type: 'object' } },
  { name: 'mcp__crawshrimp__office_render', parameters: { type: 'object' } },
  { name: 'mcp__crawshrimp__automation_create', description: 'full contract', parameters: { type: 'object' } },
  { name: 'mcp__crawshrimp__image_generate', description: 'long media description', parameters: { type: 'object', required: ['prompt'] } },
  { name: 'workflow', parameters: { type: 'object' } },
  { name: 'future_plugin_tool', parameters: { type: 'object' } },
]
function fixture(mode = 'domains') {
  let tool, hook
  const ctx = { tools: { register(t) { tool = t }, schemas() { return [...schemas, tool] } }, on(name, h) { assert.equal(name, 'system-prompt/assemble'); hook = h } }
  apply(ctx, { mode })
  const agent = { id: 's', session: { requestHeader: () => undefined, snapshotEvents: () => [] } }
  const assemble = a => hook({}, { agent: a || agent }, async () => ({ tools: [...schemas, tool], sections: [{ text: 'permission policy unchanged' }], contexts: [] }))
  const enable = (domains, a = agent) => tool.execute({ domains }, { agent: a, signal: new AbortController().signal })
  return { agent, assemble, enable, tool }
}
test('unrelated tools are deferred; generic, skill and unknown extension tools remain', () => {
  const before = structuredClone(schemas)
  const result = projectTools(schemas, new Set(), 'domains')
  assert.deepEqual(result.map(t => t.name), ['read', 'mcp__crawshrimp__skill_read', 'future_plugin_tool'])
  assert.deepEqual(schemas, before)
  const compact = projectTools(schemas, new Set(), 'compact')
  assert.equal(compact.length, schemas.length)
  assert.deepEqual(compact.map(t => t.parameters), schemas.map(t => t.parameters))
})
test('domain tool actually exposes callable registered schemas next request and never shrinks', async () => {
  const f = fixture(); const baseline = await f.assemble()
  assert(!baseline.tools.some(t => t.name.includes('browser_act')))
  const loaded = await f.enable(['browser'])
  assert(loaded.tools.includes('mcp__crawshrimp__browser_act'))
  assert.match(loaded.instructions.workflow, /抓虾 CDP/)
  const browser = await f.assemble()
  assert(browser.tools.some(t => t.name.includes('browser_act')))
  assert.deepEqual((await f.assemble()).tools, browser.tools)
  await f.enable(['office'])
  const both = await f.assemble()
  assert(both.tools.some(t => t.name.includes('browser_act')))
  assert(both.tools.some(t => t.name.includes('office_render')))
  assert.deepEqual(both.sections, baseline.sections)
  assert.equal(automationNativeToolDecision({ toolset: [], allow_filesystem: false, allow_network: false }, DOMAIN_TOOL)?.startsWith('AUTOMATION_POLICY_DENIED'), true)
})
test('empty discovery, unavailable domain and invalid input do not enable unrelated tools', async () => {
  const f = fixture(); const before = await f.assemble()
  assert.deepEqual((await f.enable([])).active, [])
  assert.deepEqual((await f.enable(['repo'])).unavailable, ['repo'])
  await assert.rejects(f.enable(['not-a-domain']), { name: 'ToolArgsError' })
  assert.deepEqual((await f.assemble()).tools, before.tools)
})
test('activation cannot leak across agents or bypass a pre-existing restricted registry', async () => {
  const f = fixture(); await f.enable(['office'])
  const other = { id: 'other', session: { requestHeader: () => undefined, snapshotEvents: () => [] } }
  assert(!(await f.assemble(other)).tools.some(t => t.name.includes('office_render')))
  assert(!(await f.enable(['repo'])).tools.some(t => t.includes('repo_')))
})
test('resume preserves logged activation, including before next header; failed/forged results ignored', () => {
  const result = (callId, active, error = false) => ({ type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: callId, isError: error, content: [{ type: 'text', text: JSON.stringify({ kind: 'crawshrimp-tool-domains-v1', active }) }] }] } } })
  const agent = { session: { requestHeader: () => ({ tools: [{ name: 'mcp__crawshrimp__browser_act' }] }), snapshotEvents: () => [
    { type: 'tool/call', data: { name: DOMAIN_TOOL, callId: '1' } }, result('1', ['office']), result('bad', ['automation']),
    { type: 'tool/call', data: { name: DOMAIN_TOOL, callId: '2' } }, result('2', ['media'], true),
  ] } }
  assert.deepEqual([...createDomainState()(agent)].sort(), ['browser', 'office'])
})

test('real Cordis scoped assembly exposes tools on the next request while restrictions and guards survive', async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt')
  const { default: Tools, defineTool } = await import('@deepseek-ai/dsh-tools')
  const { createScope } = await import('@deepseek-ai/dsh-scope')
  const plugin = await import('./context-tools.js')
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt, { persona: 'policy' }); await ctx.plugin(Tools)
    await ctx.inject(['tools', 'systemPrompt'], async host => {
      const def = name => defineTool({ name, description: 'fixture', parameters: {}, output: { schema: { type: 'object', additionalProperties: true }, render: () => [] }, execute: async () => ({}) })
      host.tools.register(def('mcp__crawshrimp__repo_install'))
      const agent = { id: 'real-test', session: { requestHeader: () => undefined, snapshotEvents: () => [] } }
      const scope = createScope(host, agent); agent.ctx = scope.ctx
      try {
        scope.ctx.tools.register(def('mcp__crawshrimp__browser_act'))
        scope.ctx.tools.restrict({ deny: ['mcp__crawshrimp__repo_install'] })
        scope.ctx.tools.guard(exec => exec.name === 'mcp__crawshrimp__browser_act' ? 'must approve' : undefined)
        await scope.ctx.plugin(plugin, { mode: 'domains' })
        const assemble = () => host.systemPrompt.assemble({ agent, scope: agent })
        assert.deepEqual((await assemble()).tools.map(t => t.name), [DOMAIN_TOOL])
        const enabled = await scope.ctx.tools.get(DOMAIN_TOOL, agent).execute({ domains: ['browser', 'repo'] }, { agent, signal: new AbortController().signal })
        assert.deepEqual(enabled.unavailable, ['repo'])
        assert.deepEqual((await assemble()).tools.map(t => t.name), [DOMAIN_TOOL, 'mcp__crawshrimp__browser_act'])
        assert.equal(host.tools.get('mcp__crawshrimp__repo_install', agent), undefined)
        assert.equal(host.tools.guardReason({ agent, name: 'mcp__crawshrimp__browser_act' }), 'must approve')
        assert.deepEqual((await assemble()).tools, (await assemble()).tools)
      } finally { await scope.dispose() }
    })
  } finally { await ctx.fiber.dispose() }
})


test('every domain can be loaded together; script and skill tools keep their parameter schemas', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../../../../core/agent/mcp_gateway.py', import.meta.url), 'utf8')
  const expected = source.match(/EXPECTED_TOOLS\s*=\s*\[([\s\S]*?)\]/)?.[1]
  assert(expected, 'use the actual product registry')
  const names = [...expected.matchAll(/"([a-z_]+)"/g)].map(match => `mcp__crawshrimp__${match[1]}`)
  assert(names.length > 50)
  const all = names.map(name => ({ name, parameters: { type: 'object' } }))
  const active = new Set(Object.keys(DOMAINS))
  assert.deepEqual(projectTools(all, active, 'domains'), projectTools(all, active, 'compact'))
  for (const name of ['tasks_search','task_describe','task_prepare','task_run','script_create_draft','script_test','script_publish']) {
    assert(names.includes(`mcp__crawshrimp__${name}`))
    assert.equal(toolDomain(`mcp__crawshrimp__${name}`), 'tasks')
  }
  for (const name of ['skill_list','skill_read','fs_read','fs_exec']) {
    assert.equal(toolDomain(`mcp__crawshrimp__${name}`), undefined)
  }
  const f = fixture()
  const enabled = await f.enable(['browser', 'office', 'automation', 'media', 'delegation'])
  assert.deepEqual(Object.keys(enabled.instructions).sort(), ['automation', 'media', 'office', 'workflow'])
  assert.deepEqual((await f.assemble()).tools.map(t => t.name), [...schemas.map(t => t.name), DOMAIN_TOOL])
})
