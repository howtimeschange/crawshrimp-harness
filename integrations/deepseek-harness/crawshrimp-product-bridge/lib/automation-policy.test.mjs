import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  apply,
  automationNativeToolDecision,
  automationToolPresentationHints,
} from './index.js'

async function postAutomationPolicy(webHandler, body) {
  const req = new EventEmitter()
  req.url = '/api/crawshrimp/session/automation-policy'
  req.method = 'POST'
  req.headers = new Map()
  const response = {}
  const res = {
    writeHead(status, headers) {
      response.status = status
      response.headers = headers
    },
    end(payload) {
      response.body = payload
    },
  }
  const pending = webHandler(req, res)
  req.emit('data', JSON.stringify(body))
  req.emit('end')
  await pending
  response.json = JSON.parse(response.body || '{}')
  return response
}

function fixture() {
  let webHandler
  let preExecute
  const errors = []
  const ctx = {
    provide() {},
    approval: { decide: async () => 'approved' },
    agents: { roots: () => [] },
    connection: {},
    logger: { error: (message) => errors.push(String(message)) },
    effect(fn) { return fn() },
    webServer: {
      register(route) {
        webHandler = route.handler
        return () => {}
      },
    },
    on(name, handler) {
      if (name === 'tools/pre-execute') preExecute = handler
    },
  }
  apply(ctx)
  assert.equal(typeof webHandler, 'function')
  assert.equal(typeof preExecute, 'function')

  const postPolicy = (body) => postAutomationPolicy(webHandler, body)

  const runPreExecute = async (name, sessionId = 'session-a') => {
    const calls = []
    const agent = { id: sessionId, cancel: (reason) => calls.push({ cancel: reason }) }
    const result = await preExecute({ name, agent }, async (decision) => {
      calls.push({ next: decision })
      return decision || { kind: 'next' }
    })
    return { result, calls }
  }

  return { errors, postPolicy, runPreExecute }
}

test('native_toolset authorizes exact native tools without changing ordinary next flow', async () => {
  const f = fixture()
  await f.postPolicy({
    sessionId: 'session-a',
    runId: 'run-1',
    policy: {
      toolset: ['mcp__crawshrimp__browser_observe'],
      execution_policy: {
        native_toolset: ['read', 'web_fetch'],
        allowed_risks: ['read_only'],
        allow_filesystem: true,
        allow_network: true,
      },
    },
  })

  assert.deepEqual(automationToolPresentationHints('session-a').sort(), [
    'mcp__crawshrimp__browser_observe',
    'read',
    'web_fetch',
  ])
  const allowed = await f.runPreExecute('read')
  assert.deepEqual(allowed.result, { kind: 'allow' })
  assert.deepEqual(allowed.calls, [])
  assert.deepEqual((await f.runPreExecute('mcp__crawshrimp__browser_observe')).calls, [{ next: undefined }])

  await f.postPolicy({ sessionId: 'session-a', runId: 'run-1', clear: true })
  assert.deepEqual(automationToolPresentationHints('session-a'), [])
  assert.deepEqual((await f.runPreExecute('read')).calls, [{ next: undefined }])
})

test('native policy denies missing tools, false flags, wrong risks, and delegation', () => {
  const policy = {
    execution_policy: {
      native_toolset: ['read', 'write_file', 'bash', 'web_fetch', 'subagent', 'crawshrimp_tool_domains'],
      allowed_risks: ['read_only'],
      allow_filesystem: true,
      allow_network: true,
    },
  }
  assert.deepEqual(automationNativeToolDecision(policy, 'read'), { kind: 'allow' })
  assert.deepEqual(automationNativeToolDecision(policy, 'web_fetch'), { kind: 'allow' })
  assert.deepEqual(automationNativeToolDecision(policy, 'crawshrimp_tool_domains'), { kind: 'allow' })
  assert.match(automationNativeToolDecision(policy, 'write_file'), /^AUTOMATION_POLICY_DENIED/)
  assert.match(automationNativeToolDecision(policy, 'bash'), /^AUTOMATION_POLICY_DENIED/)
  assert.match(automationNativeToolDecision(policy, 'subagent'), /^AUTOMATION_POLICY_DENIED/)
  assert.match(automationNativeToolDecision(policy, 'unknown_native'), /^AUTOMATION_POLICY_DENIED/)
  assert.equal(automationNativeToolDecision(policy, 'mcp__crawshrimp__browser_observe'), undefined)
  assert.deepEqual(automationNativeToolDecision({
    execution_policy: {
      native_toolset: ['skill_read', 'read_image', 'write', 'str_replace_editor'],
      allowed_risks: ['read_only'],
    },
  }, 'skill_read'), { kind: 'allow' })
  assert.deepEqual(automationNativeToolDecision({
    execution_policy: {
      native_toolset: ['skill_read', 'read_image', 'write', 'str_replace_editor'],
      allowed_risks: ['read_only'],
    },
  }, 'read_image'), { kind: 'allow' })
  assert.match(automationNativeToolDecision({
    execution_policy: {
      native_toolset: ['skill_read', 'read_image', 'write', 'str_replace_editor'],
      allowed_risks: ['read_only'],
    },
  }, 'write'), /^AUTOMATION_POLICY_DENIED/)
  assert.deepEqual(automationNativeToolDecision({
    execution_policy: {
      native_toolset: ['write', 'str_replace_editor'],
      allowed_risks: ['local_write'],
      allow_filesystem: true,
    },
  }, 'write'), { kind: 'allow' })
  assert.deepEqual(automationNativeToolDecision({
    execution_policy: {
      native_toolset: ['write', 'str_replace_editor'],
      allowed_risks: ['local_write'],
      allow_filesystem: true,
    },
  }, 'str_replace_editor'), { kind: 'allow' })

  assert.match(automationNativeToolDecision({
    execution_policy: {
      native_toolset: ['read'],
      allowed_risks: ['read_only'],
      allow_filesystem: false,
    },
  }, 'read'), /^AUTOMATION_POLICY_DENIED/)
  assert.match(automationNativeToolDecision({
    execution_policy: {
      native_toolset: ['web_fetch'],
      allowed_risks: ['read_only'],
    },
  }, 'web_fetch'), /^AUTOMATION_POLICY_DENIED/)
  assert.match(automationNativeToolDecision({
    execution_policy: {
      native_toolset: ['web_fetch'],
      allowed_risks: ['read_only'],
      allow_network: false,
    },
  }, 'web_fetch'), /^AUTOMATION_POLICY_DENIED/)
  assert.match(automationNativeToolDecision({
    execution_policy: {
      native_toolset: ['bash'],
      allowed_risks: ['local_write', 'external_write'],
      allow_network: true,
    },
  }, 'bash'), /^AUTOMATION_POLICY_DENIED/)
  assert.match(automationNativeToolDecision({
    execution_policy: {
      native_toolset: ['bash'],
      allowed_risks: ['local_write', 'external_write'],
      allow_filesystem: true,
    },
  }, 'bash'), /^AUTOMATION_POLICY_DENIED/)
  assert.match(automationNativeToolDecision({
    execution_policy: {
      native_toolset: ['bash'],
      allowed_risks: ['local_write', 'external_write'],
      allow_filesystem: true,
      allow_browser: true,
      allow_network: false,
    },
  }, 'bash'), /^AUTOMATION_POLICY_DENIED/)
  assert.deepEqual(automationNativeToolDecision({
    execution_policy: {
      native_toolset: ['bash'],
      allowed_risks: ['local_write', 'external_write'],
      allow_filesystem: true,
      allow_browser: true,
      allow_network: true,
      allow_external_messages: true,
      allow_script_publish: true,
    },
  }, 'bash'), { kind: 'allow' })
  assert.match(automationNativeToolDecision({
    execution_policy: {
      native_toolset: ['bash'],
      allowed_risks: ['local_write', 'external_write'],
      allow_external_messages: false,
    },
  }, 'bash'), /^AUTOMATION_POLICY_DENIED/)
})

test('legacy policy without native_toolset keeps previous native-tool behavior', () => {
  assert.equal(automationNativeToolDecision({
    toolset: ['read'],
    allow_filesystem: true,
    allow_network: false,
  }, 'read'), undefined)
  assert.match(automationNativeToolDecision({
    toolset: ['read'],
    allow_filesystem: false,
    allow_network: true,
  }, 'read'), /^AUTOMATION_POLICY_DENIED/)
  assert.equal(automationNativeToolDecision({
    toolset: ['bash'],
    allow_filesystem: true,
    allow_network: true,
  }, 'bash'), undefined)
  assert.match(automationNativeToolDecision({
    toolset: ['bash'],
    allow_filesystem: true,
    allow_network: false,
  }, 'bash'), /^AUTOMATION_POLICY_DENIED/)
})

test('legacy policy snapshot keeps legacy behavior through the real hook', async () => {
  const f = fixture()
  await f.postPolicy({
    sessionId: 'legacy-session',
    runId: 'legacy-run',
    policy: { toolset: ['read'], allow_filesystem: true, allow_network: false },
  })
  const legacy = await f.runPreExecute('read', 'legacy-session')
  assert.deepEqual(legacy.result, { kind: 'next' })
  assert.deepEqual(legacy.calls, [{ next: undefined }])
  await f.postPolicy({ sessionId: 'legacy-session', runId: 'legacy-run', clear: true })
})

test('real hook denies unauthorized native tools and monotonic cleanup preserves newer run snapshots', async () => {
  const f = fixture()
  await f.postPolicy({
    sessionId: 'session-b',
    runId: 'old-run',
    policy: { execution_policy: { native_toolset: ['read'], allowed_risks: ['read_only'], allow_filesystem: true } },
  })
  await f.postPolicy({
    sessionId: 'session-b',
    runId: 'new-run',
    policy: { execution_policy: { native_toolset: ['web_fetch'], allowed_risks: ['read_only'], allow_network: true } },
  })
  await f.postPolicy({ sessionId: 'session-b', runId: 'old-run', clear: true })

  assert.deepEqual(automationToolPresentationHints('session-b'), ['web_fetch'])
  const allowed = await f.runPreExecute('web_fetch', 'session-b')
  assert.deepEqual(allowed.result, { kind: 'allow' })
  assert.deepEqual(allowed.calls, [])
  const denied = await f.runPreExecute('read', 'session-b')
  assert.deepEqual(denied.result.kind, 'deny')
  assert.equal(denied.calls.length, 1)
  assert.match(denied.calls[0].cancel.reason, /^AUTOMATION_POLICY_DENIED/)

  await f.postPolicy({ sessionId: 'session-b', runId: 'new-run', clear: true })
  assert.deepEqual((await f.runPreExecute('web_fetch', 'session-b')).calls, [{ next: undefined }])
})

test('real Cordis Tools execution skips downstream ask on native allow while guards still apply', async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt')
  const { default: Tools, defineTool } = await import('@deepseek-ai/dsh-tools')
  const ctx = new Context()
  try {
    const systemPromptFiber = ctx.plugin(SystemPrompt, { persona: 'policy' })
    await systemPromptFiber.await()
    const toolsFiber = ctx.plugin(Tools)
    await toolsFiber.await()
    const fiber = ctx.inject(['tools', 'systemPrompt'], async (host) => {
      let webHandler
      const bridgeCtx = Object.create(host)
      Object.defineProperties(bridgeCtx, {
        approval: { value: { decide: async () => 'approved' } },
        agents: { value: { roots: () => [] } },
        connection: { value: {} },
        logger: { value: { error() {} } },
        webServer: { value: {
          register(route) {
            webHandler = route.handler
            return () => {}
          },
        } },
      })
      apply(bridgeCtx)
      assert.equal(typeof webHandler, 'function')

      let readCalls = 0
      let writeCalls = 0
      const def = (name, execute) => defineTool({
        name,
        description: `${name} fixture`,
        parameters: {},
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        execute,
      })
      host.tools.register(def('read', async () => ({ ok: true, tool: 'read', calls: ++readCalls })))
      host.tools.register(def('write', async () => ({ ok: true, tool: 'write', calls: ++writeCalls })))

      let downstreamAskCalls = 0
      host.on('tools/pre-execute', async () => {
        downstreamAskCalls += 1
        return { kind: 'ask', reason: 'downstream approval should be skipped' }
      })

      await postAutomationPolicy(webHandler, {
        sessionId: 'cordis-session',
        runId: 'cordis-run',
        policy: {
          execution_policy: {
            native_toolset: ['read', 'write'],
            allowed_risks: ['read_only', 'local_write'],
            allow_filesystem: true,
          },
        },
      })

      const agent = {
        id: 'cordis-session',
        session: { id: 'cordis-session', snapshotEvents: () => [], requestHeader: () => undefined },
      }
      const readResult = await host.tools.execute({
        name: 'read',
        arguments: {},
        callId: 'read-call',
        agent,
        signal: new AbortController().signal,
      })
      assert.equal(readResult.isError, false)
      assert.equal(readCalls, 1)
      assert.equal(downstreamAskCalls, 0)

      host.tools.guard((exec) => exec.name === 'write' ? 'guard blocked write' : undefined)
      const writeResult = await host.tools.execute({
        name: 'write',
        arguments: {},
        callId: 'write-call',
        agent,
        signal: new AbortController().signal,
      })
      assert.equal(writeResult.isError, true)
      assert.match(writeResult.error.message, /guard blocked write/)
      assert.equal(writeCalls, 0)
      assert.equal(downstreamAskCalls, 0)

      await postAutomationPolicy(webHandler, { sessionId: 'cordis-session', runId: 'cordis-run', clear: true })
      const ordinaryResult = await host.tools.execute({
        name: 'read',
        arguments: {},
        callId: 'ordinary-read-call',
        agent,
        signal: new AbortController().signal,
      })
      assert.equal(ordinaryResult.isError, true)
      assert.match(ordinaryResult.error.message, /downstream approval should be skipped/)
      assert.equal(readCalls, 1)
      assert.equal(downstreamAskCalls, 1)
    })
    await fiber.await()
  } finally {
    await ctx.fiber.dispose()
  }
})

test('current session model reads latest model selection event and preserves reasoning effort', async () => {
  const { getCrawshrimpSessionModel } = await import('./index.js')
  const agent = {
    session: {
      id: 'session-a',
      snapshotEvents: () => [
        { type: 'model/selection', data: { provider: 'official', model: 'older' } },
        { type: 'model/selection', data: { provider: 'official', model: 'deepseek-flash', reasoningEffort: 'high' } },
      ],
      requestHeader: () => ({ config: { provider: 'fallback', model: 'fallback' } }),
    },
  }

  const result = await getCrawshrimpSessionModel({ agents: { roots: () => [agent] } }, 'session-a')
  assert.deepEqual(result, {
    ok: true,
    status: 200,
    selected: { provider: 'official', model: 'deepseek-flash', reasoningEffort: 'high' },
  })
})

test('current session model falls back to request header without adapter default effort', async () => {
  const { getCrawshrimpSessionModel } = await import('./index.js')
  const agent = {
    session: {
      id: 'session-header',
      snapshotEvents: () => [],
      requestHeader: () => ({
        config: { provider: 'official', model: 'deepseek-flash', reasoningEffort: 'high' },
        adapterDefaults: { reasoningEffort: true },
      }),
    },
  }

  const result = await getCrawshrimpSessionModel({ agents: { roots: () => [agent] } }, 'session-header')
  assert.deepEqual(result, {
    ok: true,
    status: 200,
    selected: { provider: 'official', model: 'deepseek-flash' },
  })
})
