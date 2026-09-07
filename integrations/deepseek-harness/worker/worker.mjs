// crawshrimp-harness Agent Worker
//
// 职责(窄 spec §10):作为 DSH runtime 的监督者——
// - stdio NDJSON JSON-RPC 2.0(protocol_version: 1)与 FastAPI 通信;
// - 懒启动官方 DSH Web profile，并通过受认证的 Web RPC/Session follow 监督会话；
// - 转发 Harness 会话事件(harness.notification);
// - 全局单 Active Run;取消、预算和绝对超时只取消当前 Session,共享 runtime/IM Host 保持常驻;
// - stdout 仅 NDJSON JSON-RPC,诊断走 stderr。
//
// 关键经验(P0 spike):
// - MCP 工具发现是 initialize 后的异步过程,首条 prompt 前必须等待(默认 3s);
// - DSH 同名 sessionId + 已有日志 + 新 runtime = id collision → 拒绝;
//   产品侧必须保证 runtime_session_id 全局唯一且不跨代复用。

import readline from 'node:readline'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { DshWebRuntime, activeTurnEvents, assertSessionHeadersExcludeNativeWebTools } from './web-rpc-client.mjs'
import { createNativeWebFollowManager } from './native-web-follow-manager.mjs'

const PROTOCOL_VERSION = 1
const MODEL_IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

const MAX_FRAME_BYTES = 4 * 1024 * 1024
const MCP_SETTLE_MS = Number(process.env.CRAWSHRIMP_AGENT_MCP_SETTLE_MS || 3000)
const RUN_ABSOLUTE_TIMEOUT_MS = Number(process.env.CRAWSHRIMP_AGENT_RUN_TIMEOUT_MS || 30 * 60 * 1000)
const RUNTIME_BOOT_TIMEOUT_MS = 45000
const RUNTIME_KILL_GRACE_MS = 3000

const state = {
  initialized: false,
  runtimeRoot: null,      // 发布态 Resources/deepseek-harness
  dataRoot: null,
  nodeExecutable: null,   // Electron 可执行文件路径(发布态)
  generation: 0,
  provider: null,
  model: null,
  maxTokens: null,
  runtime: null,          // DshWebRuntime
  startedSessions: new Set(),
  selectedModels: new Map(),
  // Trusted embedded-Web sessions are not product API runs. Keep one follow
  // per explicit renderer registration so their MCP calls receive a scoped
  // shadow run instead of falling back to an unrelated active run.
  nativeWebFollows: new Map(),
  activeRun: null,        // { runId, sessionId, resolve, timer, turnEndReason, lastSeq, messageId, follow }
}

// ---------- stdio 帧输出 ----------
function send(message) {
  const frame = JSON.stringify(message)
  if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) {
    fail(`worker frame 超过 ${MAX_FRAME_BYTES} 字节,拒绝发送: ${frame.slice(0, 120)}…`)
  }
  process.stdout.write(`${frame}\n`)
}

function fail(message) {
  console.error(`[worker] FATAL: ${message}`)
  process.exit(1)
}

function notifyWorkerStatus(status, extra = {}) {
  send({
    jsonrpc: '2.0',
    method: 'worker.status',
    params: { protocol_version: PROTOCOL_VERSION, status, generation: state.generation, ...extra },
  })
}

function extractEventText(data) {
  if (!data || typeof data !== 'object') return ''
  const chunk = data.chunk && typeof data.chunk === 'object' ? data.chunk : null
  if (chunk) {
    if (chunk.type === 'text-delta') return String(chunk.text || '')
    if (chunk.type === 'block-end' && chunk.block && typeof chunk.block === 'object') {
      return String(chunk.block.text || '')
    }
  }
  if (typeof data.text === 'string') return data.text
  const content = data.message && Array.isArray(data.message.content) ? data.message.content : null
  if (!content) return ''
  return content.map((block) => (
    block && typeof block === 'object' && typeof block.text === 'string' ? block.text : ''
  )).join('')
}

function extractEventDeltaText(data) {
  if (!data || typeof data !== 'object') return ''
  const chunk = data.chunk && typeof data.chunk === 'object' ? data.chunk : null
  if (!chunk || chunk.type !== 'text-delta') return ''
  return String(chunk.text || '')
}

function compactHarnessEvent(event) {
  if (!event || event.type !== 'user/message') return event
  const text = extractEventText(event.data || {})
  return { ...event, data: text ? { text } : {} }
}

function notifyHarness(runId, event) {
  send({
    jsonrpc: '2.0',
    method: 'harness.notification',
    params: { protocol_version: PROTOCOL_VERSION, runId, event: compactHarnessEvent(event) },
  })
}

/** web UI 原生会话(非 FastAPI run)的事件:转发给 FastAPI 做影子投影。 */
function notifyHarnessShadow(sessionId, event) {
  send({
    jsonrpc: '2.0',
    method: 'harness.notification',
    params: { protocol_version: PROTOCOL_VERSION, runId: null, sessionId, event: compactHarnessEvent(event) },
  })
}

const NATIVE_WEB_FOLLOW_FIRST_FRAME_TIMEOUT_MS = 8000

const nativeWebFollowManager = createNativeWebFollowManager({
  records: state.nativeWebFollows,
  getRuntime: () => state.runtime,
  getProductSessionId: () => state.activeRun?.sessionId || '',
  activeTurnEvents,
  notify: notifyHarnessShadow,
  logError: (message) => console.error(message),
  firstFrameTimeoutMs: NATIVE_WEB_FOLLOW_FIRST_FRAME_TIMEOUT_MS,
})

function closeNativeWebFollows(reason) {
  return nativeWebFollowManager.closeAll(reason)
}

async function observeNativeWebSession(sessionId, { refresh = false, owner = '' } = {}) {
  return await nativeWebFollowManager.observe(sessionId, { refresh, owner })
}

function unobserveNativeWebSession(sessionId, { owner = '' } = {}) {
  return nativeWebFollowManager.unobserve(sessionId, { owner })
}

// ---------- DSH runtime 生命周期 ----------
function resolveNodeExecutable() {
  // 发布态:FastAPI 通过 env 传入抓虾打包的 Electron 可执行文件
  const explicit = String(process.env.CRAWSHRIMP_NODE_EXECUTABLE || '').trim()
  if (explicit && existsSync(explicit)) return explicit
  // 开发态:Worker 自身由 Electron-as-Node 运行,直接复用自身
  return process.execPath
}

function nodeVersionOk() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  return major > 24 || (major === 24) || (major === 22 && minor >= 19)
}

async function spawnRuntime({ cwd, webPort }) {
  const { nodeExecutable, runtimeRoot } = state
  const dshBin = `${runtimeRoot}/node_modules/@deepseek-ai/dsh/lib/bin.js`
  if (!existsSync(dshBin)) {
    throw new Error(`DSH rc.1 CLI bin 不存在: ${dshBin}`)
  }
  if (!nodeVersionOk()) {
    throw new Error(`Node ${process.versions.node} 不满足 DSH engine(^22.19.0 || >=24.0.0)`)
  }

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    DSH_HOME: process.env.DSH_HOME || `${state.dataRoot}/agent/dsh-home`,
    CRAWSHRIMP_SESSION_ROOT: process.env.CRAWSHRIMP_SESSION_ROOT || `${state.dataRoot}/agent/harness-sessions`,
    CRAWSHRIMP_STORAGE_ROOT: process.env.CRAWSHRIMP_STORAGE_ROOT || `${state.dataRoot}/agent/storages`,
    CRAWSHRIMP_MCP_URL: process.env.CRAWSHRIMP_MCP_URL || 'http://127.0.0.1:18965/mcp',
    // Product policy, not a user setting: patched dsh-tool-web must never
    // register generic web_search/web_fetch in any effective preset.
    CRAWSHRIMP_DISABLE_NATIVE_WEB: '1',
  }

  const runtime = await DshWebRuntime.launch({
    runtimeRoot,
    dshHome: env.DSH_HOME,
    nodeExecutable,
    cwd,
    env,
    port: webPort,
    timeoutMs: RUNTIME_BOOT_TIMEOUT_MS,
  })
  runtime.onExit((code, signal) => {
    console.error(`[worker] DSH Web runtime 退出 code=${code} signal=${signal}`)
    const unexpected = state.runtime === runtime
    const wasActive = state.activeRun
    if (state.runtime === runtime) state.runtime = null
    state.startedSessions.clear()
    state.selectedModels.clear()
    closeNativeWebFollows({
      kind: 'interrupted',
      error: {
        code: 'RUNTIME_EXITED',
        message: `runtime exit code=${code} signal=${signal}`,
      },
    })
    if (wasActive) {
      console.error(`[worker] runtime 在 run ${wasActive.runId} 期间退出 code=${code} signal=${signal}`)
      finishRun({ status: 'interrupted', reason: { kind: 'interrupted', detail: `runtime exit code=${code} signal=${signal}` } })
    }
    notifyWorkerStatus(unexpected ? 'crashed' : 'stopped', {
      exitCode: code,
      exitSignal: signal,
      ...(unexpected ? { message: `DSH runtime 已退出 code=${code} signal=${signal}` } : {}),
    })
  })

  return runtime
}

// ---------- Run 生命周期 ----------
function finishRun(result) {
  const run = state.activeRun
  if (!run) return
  state.activeRun = null
  if (run.timer) clearTimeout(run.timer)
  run.follow?.close()
  run.resolve({ ...result, runId: run.runId, sessionId: run.sessionId })
}

function attachRunEventHandlers(run) {
  const runtime = state.runtime
  if (!runtime) throw new Error('runtime unavailable while opening Session follow stream')
  run.follow = runtime.follow(run.sessionId, {
    onSnapshotComplete: (events) => {
      // The opening snapshot is the pre-prompt gate for a resumed Session.
      assertSessionHeadersExcludeNativeWebTools(events)
    },
    onEvent: (event) => {
      // run 已结束后，follow 可能在关闭竞态中送达最后一个帧。
      if (state.activeRun !== run || !event || typeof event !== 'object') return
      // A fresh request/header arrives before the model begins the next turn.
      assertSessionHeadersExcludeNativeWebTools([event])
      const seq = Number(event.seq || 0)
      if (seq > run.lastSeq) run.lastSeq = seq
      const type = event.type
      const name = String(event.data?.name || '')
      if (type === 'step/start') run.counters.steps += 1
      if (type === 'tool/call') {
        run.counters.toolCalls += 1
        if (name.includes('browser_observe')) run.counters.observe += 1
        if (name.includes('browser_act')) run.counters.act += 1
      }
      if (type === 'assistant/chunk') {
        const text = extractEventDeltaText(event.data || {})
        if (text) recordAssistantOutput(run, text)
      }
      if (type === 'assistant/message') {
        const text = extractEventText(event.data || {})
        if (text) run.counters.outputChars = Math.max(run.counters.outputChars, text.length)
      }
      const outputExceeded = run.outputBudgetReached ? '' : outputBudgetName()
      if (outputExceeded) {
        run.outputBudgetReached = true
        run.outputBudgetMessage = outputExceeded
        notifyHarness(run.runId, event)
        cancelOutputBudgetRun(run, outputExceeded)
        return
      }
      const exceeded = budgetName()
      if (exceeded) {
        notifyHarness(run.runId, event)
        cancelActiveRuntimeSession(run, `BUDGET_EXCEEDED:${exceeded}`).finally(() => {
          if (state.activeRun !== run) return
          finishRun({ status: 'failed', reason: { kind: 'error', error: { code: 'BUDGET_EXCEEDED', message: exceeded } }, messageId: run.messageId, lastSeq: run.lastSeq })
        })
        return
      }
      notifyHarness(run.runId, event)
      if (type === 'turn/end') {
        run.turnEndReason = event.data?.reason ?? null
        settleRun(run)
      }
    },
    onError: (error) => {
      if (state.activeRun !== run) return
      console.error(`[worker] run ${run.runId} Session follow 失败: ${error.message}`)
      const code = typeof error?.code === 'string' ? error.code : 'SESSION_FOLLOW_FAILED'
      const complete = () => finishRun({
        status: 'failed',
        reason: { kind: 'error', error: { code, message: error.message } },
        messageId: run.messageId,
        lastSeq: run.lastSeq,
      })
      if (code === 'NATIVE_WEB_TOOL_POLICY') {
        cancelActiveRuntimeSession(run, code).finally(complete)
      } else {
        complete()
      }
    },
  })
  return run.follow
}

function settleRun(run) {
  const reason = run.turnEndReason
  if (run.outputBudgetReached) {
    if (continueRunAfterOutputBudget(run)) return
    finishRun({
      status: 'interrupted',
      reason: {
        kind: 'interrupted',
        error: { code: 'OUTPUT_BUDGET_REACHED', message: run.outputBudgetMessage || '输出长度预算已触达' },
        resumable: true,
        auto_continued: run.outputBudgetSegments,
      },
      messageId: run.messageId,
      lastSeq: run.lastSeq,
    })
    return
  }
  const kind = reason?.kind ?? 'error'
  const status = kind === 'completed' ? 'completed'
    : kind === 'aborted' ? 'canceled'
    : 'failed'
  finishRun({ status, reason, messageId: run.messageId, lastSeq: run.lastSeq })
}

function cancelActiveRuntimeSession(run, reason) {
  const runtime = state.runtime
  if (!runtime || !run || state.activeRun !== run) return Promise.resolve({ ok: false, canceled: false })
  if (run.cancelRequested) return run.cancelPromise || Promise.resolve({ ok: true, canceled: true })
  run.cancelRequested = true
  run.cancelPromise = runtime.cancel(run.sessionId).then((result) => ({ ok: true, canceled: true, result })).catch((error) => {
    console.error(`[worker] run ${run.runId} Session 取消失败: ${error.message}`)
    return { ok: false, canceled: false, error }
  })
  return run.cancelPromise
}

function cancelOutputBudgetRun(run, message) {
  run.outputBudgetSegments += 1
  cancelActiveRuntimeSession(run, `OUTPUT_BUDGET_REACHED:${message}`).then((result) => {
    if (result.ok || state.activeRun !== run) return
    finishRun({
      status: 'interrupted',
      reason: {
        kind: 'interrupted',
        error: { code: 'OUTPUT_BUDGET_REACHED', message },
        resumable: true,
        auto_continued: run.outputBudgetSegments,
      },
      messageId: run.messageId,
      lastSeq: run.lastSeq,
    })
  })
}

function continueRunAfterOutputBudget(run) {
  const runtime = state.runtime
  if (!runtime || run.outputBudgetSegments >= run.budget.maxOutputSegments) {
    if (run.outputBudgetSegments >= run.budget.maxOutputSegments) {
      run.outputBudgetMessage = `内容已自动分段 ${run.outputBudgetSegments} 次,达到单轮安全上限`
    }
    return false
  }
  const segment = run.outputBudgetSegments + 1
  run.outputBudgetReached = false
  run.outputBudgetMessage = ''
  run.cancelRequested = false
  run.cancelPromise = null
  run.turnEndReason = null
  run.counters.textDeltas = 0
  run.counters.outputChars = 0
  run.outputDeltaTimes = []
  const text = [
    '系统为保持核心稳定,刚才临时暂停了超长输出。',
    `请从上一段回答中断的位置继续写第 ${segment} 段,只输出后续内容,不要重复已经写过的内容。`,
    '如果内容已经完整,请用一句话自然收尾。',
  ].join('\n')
  runtime.continueOutput({
    sessionId: run.sessionId,
    text,
  }).then((result) => {
    if (state.activeRun !== run) return
    if (result?.messageId) run.messageId = result.messageId
    notifyHarness(run.runId, {
      type: 'agent/inbox/spliced',
      data: { messageId: run.messageId, sessionId: run.sessionId, internal: true, outputBudgetSegment: segment },
      seq: run.lastSeq,
    })
  }).catch((error) => {
    console.error(`[worker] run ${run.runId} 自动续写失败: ${error.message}`)
    if (state.activeRun !== run) return
    finishRun({
      status: 'interrupted',
      reason: {
        kind: 'interrupted',
        error: { code: 'OUTPUT_BUDGET_REACHED', message: error.message },
        resumable: true,
        auto_continued: run.outputBudgetSegments,
      },
      messageId: run.messageId,
      lastSeq: run.lastSeq,
    })
  })
  return true
}

const DEFAULT_BUDGET = {
  maxSteps: 60,
  maxToolCalls: 80,
  maxObserve: 40,
  maxAct: 50,
  maxTextDeltas: Number(process.env.CRAWSHRIMP_AGENT_MAX_TEXT_DELTAS || 12000),
  maxOutputChars: Number(process.env.CRAWSHRIMP_AGENT_MAX_OUTPUT_CHARS || 240000),
  maxOutputSegments: Number(process.env.CRAWSHRIMP_AGENT_MAX_OUTPUT_SEGMENTS || 6),
  minOutputDeltasBeforePause: Number(process.env.CRAWSHRIMP_AGENT_MIN_OUTPUT_DELTAS_BEFORE_PAUSE || 2500),
  maxTextDeltaRatePerSecond: Number(process.env.CRAWSHRIMP_AGENT_MAX_TEXT_DELTA_RATE_PER_SECOND || 32),
  outputRateWindowMs: Number(process.env.CRAWSHRIMP_AGENT_OUTPUT_RATE_WINDOW_MS || 10000),
  wallclockMs: 30 * 60 * 1000,
}

function normalizeBudget(budget) {
  const b = { ...DEFAULT_BUDGET, ...(budget || {}) }
  for (const key of Object.keys(b)) b[key] = Number(b[key]) || DEFAULT_BUDGET[key]
  return b
}

function budgetName() {
  const run = state.activeRun
  if (!run) return ''
  const b = run.budget
  if (run.counters.steps >= b.maxSteps) return `步数预算耗尽(${b.maxSteps})`
  if (run.counters.toolCalls >= b.maxToolCalls) return `工具调用预算耗尽(${b.maxToolCalls})`
  if (run.counters.observe >= b.maxObserve) return `页面观察预算耗尽(${b.maxObserve})`
  if (run.counters.act >= b.maxAct) return `页面操作预算耗尽(${b.maxAct})`
  return ''
}

function recordAssistantOutput(run, text) {
  run.counters.textDeltas += 1
  run.counters.outputChars += text.length
  const windowMs = Math.max(1000, Number(run.budget.outputRateWindowMs) || DEFAULT_BUDGET.outputRateWindowMs)
  const times = Array.isArray(run.outputDeltaTimes) ? run.outputDeltaTimes : (run.outputDeltaTimes = [])
  const now = Date.now()
  times.push(now)
  const cutoff = now - windowMs
  while (times.length && times[0] < cutoff) times.shift()
}

function outputPressureName(run, b) {
  const maxRate = Number(b.maxTextDeltaRatePerSecond) || DEFAULT_BUDGET.maxTextDeltaRatePerSecond
  const windowMs = Math.max(1000, Number(b.outputRateWindowMs) || DEFAULT_BUDGET.outputRateWindowMs)
  const minDeltas = Math.max(1, Number(b.minOutputDeltasBeforePause) || DEFAULT_BUDGET.minOutputDeltasBeforePause)
  if (run.counters.textDeltas < minDeltas) return ''
  const times = Array.isArray(run.outputDeltaTimes) ? run.outputDeltaTimes : []
  const minSamples = Math.max(2, Math.ceil(maxRate * (windowMs / 1000)))
  if (times.length < minSamples) return ''
  const rate = times.length * 1000 / windowMs
  return `文本输出速率过高(${rate.toFixed(1)}/s>${maxRate}/s,${Math.round(windowMs / 1000)}s窗口)`
}

function outputBudgetName() {
  const run = state.activeRun
  if (!run) return ''
  const b = run.budget
  const pressureExceeded = outputPressureName(run, b)
  if (pressureExceeded) return pressureExceeded
  if (run.counters.outputChars >= b.maxOutputChars) return `输出长度预算耗尽(${b.maxOutputChars})`
  if (run.counters.textDeltas >= b.maxTextDeltas) return `文本增量预算耗尽(${b.maxTextDeltas})`
  return ''
}

async function startRun(params) {
  if (state.activeRun) {
    return { ok: false, error: { code: 'BUSY', message: '已有一个 active run' } }
  }
  if (!state.runtime) {
    return { ok: false, error: { code: 'RUNTIME_NOT_READY', message: 'runtime 未启动,先调用 worker.start_generation' } }
  }
  const { runId, sessionId, text } = params
  if (!runId || !sessionId || typeof text !== 'string') {
    return { ok: false, error: { code: 'INVALID_PARAMS', message: 'runId/sessionId/text 必填' } }
  }

  const budget = normalizeBudget(params.budget)
  const run = {
    runId, sessionId,
    messageId: null, turnEndReason: null, lastSeq: 0, follow: null,
    outputBudgetReached: false, outputBudgetMessage: '', outputBudgetSegments: 0, cancelRequested: false, cancelPromise: null,
    outputDeltaTimes: [],
    budget, counters: { steps: 0, toolCalls: 0, observe: 0, act: 0, textDeltas: 0, outputChars: 0 },
    resolve: null,
    timer: setTimeout(() => {
      console.error(`[worker] run ${runId} 超过 ${RUN_ABSOLUTE_TIMEOUT_MS}ms 绝对上限,终止`)
      cancelActiveRuntimeSession(run, 'RUN_TIMEOUT').finally(() => {
        if (state.activeRun !== run) return
        finishRun({ status: 'failed', reason: { kind: 'error', error: { code: 'RUN_TIMEOUT' } }, lastSeq: run.lastSeq })
      })
    }, RUN_ABSOLUTE_TIMEOUT_MS),
  }
  const done = new Promise((resolve) => { run.resolve = resolve })
  state.activeRun = run
  const automationPolicy = params.automationPolicy && typeof params.automationPolicy === 'object'
    ? params.automationPolicy
    : null
  let policyInstalled = false

  try {
    const contentBlocks = []
    for (const image of Array.isArray(params.images) ? params.images.slice(0, 5) : []) {
      const imagePath = String(image?.path || '')
      const mediaType = String(image?.mediaType || '')
      if (!imagePath || !MODEL_IMAGE_MEDIA_TYPES.has(mediaType)) continue
      try {
        if (!existsSync(imagePath) || statSync(imagePath).size > 8 * 1024 * 1024) continue
        contentBlocks.push({
          type: 'image',
          mediaType,
          data: readFileSync(imagePath).toString('base64'),
          name: String(image?.name || 'image'),
        })
      } catch {
        // 附件在登记后被移动/删除时跳过该图片，不让整条文本 prompt 失败。
      }
    }
    contentBlocks.push({ type: 'text', text })
    if (!state.startedSessions.has(sessionId)) {
      await state.runtime.createSession({
        sessionId,
        cwd: String(params.cwd || `${state.dataRoot}/agent/runtime-workdir`),
        agentPreset: 'crawshrimp-standard',
      })
      state.startedSessions.add(sessionId)
    }
    if (automationPolicy) {
      // The bridge snapshots this policy in the authenticated DSH Web Host;
      // inherited Automations therefore never inherit a source Session's
      // temporary danger-full-access selection.
      await state.runtime.setAutomationPolicy({ sessionId, runId, policy: automationPolicy })
      policyInstalled = true
    }
    const provider = String(params.provider || state.provider || '')
    const model = String(params.model || state.model || '')
    if (!provider || !model) throw new Error('runtime model selection is missing provider or model')
    const selected = state.selectedModels.get(sessionId)
    if (!selected || selected.provider !== provider || selected.model !== model) {
      await state.runtime.selectModel({ sessionId, provider, model })
      state.selectedModels.set(sessionId, { provider, model })
    }
    const follow = attachRunEventHandlers(run)
    await follow.ready
    const requestId = `crawshrimp-run-${runId}`
    await state.runtime.prompt({
      sessionId,
      content: contentBlocks,
      requestId,
    })
    run.messageId = requestId
    notifyHarness(runId, { type: 'agent/inbox/spliced', data: { messageId: run.messageId, sessionId }, seq: 0 })
    const summary = await done
    return { ok: true, summary }
  } catch (error) {
    console.error(`[worker] run ${runId} prompt 失败: ${error.message}`)
    const code = typeof error?.code === 'string' ? error.code : 'PROMPT_FAILED'
    finishRun({ status: 'failed', reason: { kind: 'error', error: { code, message: error.message } } })
    return { ok: false, error: { code, message: error.message } }
  } finally {
    if (policyInstalled && state.runtime) {
      try {
        await state.runtime.clearAutomationPolicy({ sessionId, runId })
      } catch (error) {
        // Leaving a restrictive policy on an inherited interactive Session is
        // worse than restarting this private runtime: stop it so the in-memory
        // policy map is discarded rather than mutating user permissions.
        console.error(`[worker] Automation policy cleanup failed: ${error.message}`)
        await stopRuntime()
      }
    }
  }
}

function cancelActiveRun() {
  const run = state.activeRun
  if (run) {
    cancelActiveRuntimeSession(run, 'session/cancel:user').finally(() => {
      if (state.activeRun !== run) return
      finishRun({ status: 'canceled', reason: { kind: 'aborted', reason: { kind: 'user' } }, messageId: run.messageId, lastSeq: run.lastSeq })
    })
  }
  return { ok: true, canceled: Boolean(run) }
}

async function stopRuntime() {
  const runtime = state.runtime
  if (!runtime) return { ok: true, stopped: false }
  notifyWorkerStatus('stopping')
  state.runtime = null
  state.startedSessions.clear()
  state.selectedModels.clear()
  closeNativeWebFollows({
    kind: 'interrupted',
    error: { code: 'RUNTIME_STOPPED', message: 'runtime stopped' },
  })
  if (state.activeRun) {
    finishRun({
      status: 'interrupted',
      reason: { kind: 'interrupted', detail: 'runtime stopped' },
      messageId: state.activeRun.messageId,
      lastSeq: state.activeRun.lastSeq,
    })
  }
  const killTimer = setTimeout(() => {
    // DshWebRuntime.stop() sends SIGTERM first. The child is intentionally
    // private to that client, so a forced second signal remains encapsulated.
    console.error('[worker] DSH Web runtime did not stop before grace period')
  }, RUNTIME_KILL_GRACE_MS)
  try {
    await runtime.stop()
  } finally {
    clearTimeout(killTimer)
  }
  return { ok: true, stopped: true }
}

// ---------- worker 方法 ----------
async function handleRequest(method, params) {
  switch (method) {
    case 'worker.initialize': {
      state.initialized = true
      state.runtimeRoot = params.runtimeRoot
      state.dataRoot = params.dataRoot
      state.nodeExecutable = params.nodeExecutable || resolveNodeExecutable()
      if (params.mcpUrl) process.env.CRAWSHRIMP_MCP_URL = params.mcpUrl
      if (params.sessionRoot) process.env.CRAWSHRIMP_SESSION_ROOT = params.sessionRoot
      return {
        ok: true,
        protocol_version: PROTOCOL_VERSION,
        node: process.versions.node,
        nodeExecutable: state.nodeExecutable,
      }
    }
    case 'worker.start_generation': {
      if (state.runtime) await stopRuntime()
      state.generation = params.generation || state.generation + 1
      state.provider = params.provider
      state.model = params.model
      state.maxTokens = params.maxTokens
      notifyWorkerStatus('starting')
      try {
        const runtime = await spawnRuntime({
          // Web profiles expose the product workspace. The runtime must
          // default to that same directory so native sessions stay visible.
          cwd: params.cwd || `${state.dataRoot}/agent/workspace`,
          webPort: params.webPort || process.env.CRAWSHRIMP_WEB_PORT || 0,
        })
        state.runtime = runtime
        const serverInfo = {
          profile: 'web',
          agentPreset: 'crawshrimp-standard',
          webOrigin: runtime.origin,
          webLaunchUrl: runtime.launchUrl,
          provider: state.provider,
          model: state.model,
          maxTokens: state.maxTokens,
        }
        // Web profile 先完成 host composition，再向 Python 报告 ready；Session
        // follow 自己会以初始 snapshot 作为每次 prompt 前的同步栅栏。
        await new Promise((r) => setTimeout(r, Math.min(MCP_SETTLE_MS, 500)))
        if (state.runtime !== runtime) {
          throw new Error('DSH runtime 在启动完成前已退出')
        }
        notifyWorkerStatus('ready', { serverInfo })
        return { ok: true, serverInfo }
      } catch (error) {
        console.error(`[worker] start_generation 失败: ${error.message}`)
        await stopRuntime()
        notifyWorkerStatus('crashed', { message: error.message })
        return { ok: false, error: { code: 'RUNTIME_BOOT_FAILED', message: error.message } }
      }
    }
    case 'worker.health': {
      return {
        ok: true,
        protocol_version: PROTOCOL_VERSION,
        node: process.versions.node,
        runtimeAlive: Boolean(state.runtime),
        generation: state.generation,
        activeRun: state.activeRun?.runId ?? null,
      }
    }
    case 'worker.run':
      return startRun(params)
    case 'worker.cancel_active':
      return cancelActiveRun()
    case 'worker.observe_web_session':
      return await observeNativeWebSession(params.sessionId, {
        refresh: params.refresh === true,
        owner: params.owner,
      })
    case 'worker.unobserve_web_session':
      return unobserveNativeWebSession(params.sessionId, { owner: params.owner })
    case 'worker.request_approval': {
      if (!state.runtime) {
        return { ok: false, error: { code: 'RUNTIME_UNAVAILABLE', message: 'DSH Web runtime is not ready' } }
      }
      try {
        const result = await state.runtime.requestApproval(params)
        return { ok: true, result }
      } catch (error) {
        console.error(`[worker] DSH native approval route failed: ${error.message}`)
        return { ok: false, error: { code: 'NATIVE_APPROVAL_FAILED', message: error.message } }
      }
    }
    case 'worker.stop_generation':
      return await stopRuntime()
    case 'worker.shutdown':
      await stopRuntime()
      return { ok: true }
    default:
      return { ok: false, error: { code: 'UNKNOWN_METHOD', message: method } }
  }
}

// ---------- stdio 入口 ----------
const rl = readline.createInterface({ input: process.stdin, terminal: false })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let msg
  try { msg = JSON.parse(trimmed) } catch {
    fail(`来自 Python 的非 JSON 帧: ${trimmed.slice(0, 160)}`)
  }
  const isRequest = typeof msg.id === 'number' || typeof msg.id === 'string'
  const params = msg.params || {}
  if (params.protocol_version !== PROTOCOL_VERSION) {
    fail(`protocol_version 不匹配: ${params.protocol_version}`)
  }
  if (isRequest) {
    Promise.resolve(handleRequest(msg.method, params)).then((result) => {
      send({ jsonrpc: '2.0', id: msg.id, result })
      if (msg.method === 'worker.shutdown') {
        setTimeout(() => process.exit(0), 150)
      }
    }).catch((error) => {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: error.message } })
    })
  } else {
    // 通知(当前无 Python → Worker 通知协议,预留)
    console.error(`[worker] 忽略未知通知: ${msg.method}`)
  }
})

process.stdin.on('end', () => {
  console.error('[worker] stdin EOF,退出')
  stopRuntime().finally(() => setTimeout(() => process.exit(0), 200))
})

process.on('SIGTERM', () => {
  console.error('[worker] SIGTERM,有序关闭')
  stopRuntime().finally(() => setTimeout(() => process.exit(0), 500))
})
process.on('SIGINT', () => {
  console.error('[worker] SIGINT,有序关闭')
  stopRuntime().finally(() => setTimeout(() => process.exit(0), 500))
})

console.error(`[worker] started node=${process.versions.node} pid=${process.pid}`)
notifyWorkerStatus('idle')
