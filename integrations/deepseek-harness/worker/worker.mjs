// crawshrimp-harness Agent Worker
//
// 职责(窄 spec §10):作为 DSH runtime 的监督者——
// - stdio NDJSON JSON-RPC 2.0(protocol_version: 1)与 FastAPI 通信;
// - 懒启动 DSH runtime(Electron-as-Node + dsh-jsonrpc-agent);
// - 转发 Harness 会话事件(harness.notification);
// - 全局单 Active Run;取消、预算和绝对超时只取消当前 Session,共享 runtime/IM Host 保持常驻;
// - stdout 仅 NDJSON JSON-RPC,诊断走 stderr。
//
// 关键经验(P0 spike):
// - MCP 工具发现是 initialize 后的异步过程,首条 prompt 前必须等待(默认 3s);
// - DSH 同名 sessionId + 已有日志 + 新 runtime = id collision → 拒绝;
//   产品侧必须保证 runtime_session_id 全局唯一且不跨代复用。

import readline from 'node:readline'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'

const PROTOCOL_VERSION = 1
const MODEL_IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

// 影子投影转发的事件类型(web UI 原生会话 → FastAPI)
const SHADOW_EVENT_TYPES = [
  'turn/start', 'turn/end', 'user/message', 'assistant/message', 'assistant/chunk',
  'tool/call', 'tool/result', 'session/title', 'session/status',
]
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
  cordisPath: null,
  generation: 0,
  provider: null,
  model: null,
  maxTokens: null,
  runtime: null,          // { child, sdk, alive }
  activeRun: null,        // { runId, sessionId, resolve, timer, sawTurnEnd, sawIdle, turnEndReason, lastSeq, messageId }
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

function spawnRuntime() {
  const { nodeExecutable, runtimeRoot, cordisPath } = state
  const demoBin = `${runtimeRoot}/node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js`
  if (!existsSync(demoBin)) {
    throw new Error(`dsh-jsonrpc-agent bin 不存在: ${demoBin}`)
  }
  if (!existsSync(cordisPath)) {
    throw new Error(`cordis 配置不存在: ${cordisPath}`)
  }
  if (!nodeVersionOk()) {
    throw new Error(`Node ${process.versions.node} 不满足 DSH engine(^22.19.0 || >=24.0.0)`)
  }

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    DSH_CORDIS_CONFIG: cordisPath,
    DSH_HOME: process.env.DSH_HOME || `${state.dataRoot}/agent/dsh-home`,
    CRAWSHRIMP_SESSION_ROOT: process.env.CRAWSHRIMP_SESSION_ROOT || `${state.dataRoot}/agent/harness-sessions`,
    CRAWSHRIMP_STORAGE_ROOT: process.env.CRAWSHRIMP_STORAGE_ROOT || `${state.dataRoot}/agent/storages`,
    CRAWSHRIMP_MCP_URL: process.env.CRAWSHRIMP_MCP_URL || 'http://127.0.0.1:18965/mcp',
  }

  const child = spawn(nodeExecutable, [demoBin], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const sdk = createSdkClient(child)
  // 全局影子转发:web UI 原生会话(非 FastAPI run)的 turn 事件 → FastAPI 投影,
  // 使其拥有 active run 语义(任务准备/审批/产物全链路可用)。
  sdk.onEvent((method, params) => {
    if (method !== 'session.event') return
    const sessionId = params.sessionId
    if (!sessionId) return
    if (state.activeRun && sessionId === state.activeRun.sessionId) return // run 处理器已转发
    const event = params.event || {}
    if (SHADOW_EVENT_TYPES.includes(event.type)) notifyHarnessShadow(sessionId, event)
  })
  child.stderr.on('data', (chunk) => {
    console.error(`[worker][harness] ${String(chunk).trimEnd()}`)
  })
  child.on('exit', (code, signal) => {
    console.error(`[worker] harness runtime 退出 code=${code} signal=${signal}`)
    const wasActive = state.activeRun
    state.runtime = null
    if (wasActive) {
      console.error(`[worker] runtime 在 run ${wasActive.runId} 期间退出 code=${code} signal=${signal}`)
      finishRun({ status: 'interrupted', reason: { kind: 'interrupted', detail: `runtime exit code=${code} signal=${signal}` } })
    }
    notifyWorkerStatus('stopped', { exitCode: code, exitSignal: signal })
  })

  return { child, sdk }
}

// ---------- 极简 SDK wire client(session/prompt 协议) ----------
function createSdkClient(child) {
  let buffer = ''
  let nextId = 1
  const pending = new Map()
  const onEvent = []

  child.stdout.on('data', (chunk) => {
    buffer += String(chunk)
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch {
        fail(`harness stdout 非 JSON,按协议错误处理: ${line.slice(0, 160)}`)
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        else resolve(msg.result)
      } else if (msg.method === 'session.event' || msg.method === 'session.status') {
        for (const handler of onEvent) {
          try { handler(msg.method, msg.params || {}) } catch (error) {
            console.error(`[worker] event handler error: ${error.message}`)
          }
        }
      } else {
        console.error(`[worker] harness 未知通知: ${JSON.stringify(msg).slice(0, 160)}`)
      }
    }
  })

  return {
    onEvent: (handler) => onEvent.push(handler),
    request: (method, params, timeoutMs = 30000) => new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} })}\n`)
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error(`sdk ${method} 超时`))
        }
      }, timeoutMs)
    }),
  }
}

// ---------- Run 生命周期 ----------
function finishRun(result) {
  const run = state.activeRun
  if (!run) return
  state.activeRun = null
  if (run.timer) clearTimeout(run.timer)
  run.resolve({ ...result, runId: run.runId, sessionId: run.sessionId })
}

function attachRunEventHandlers(run) {
  const { sdk } = state.runtime
  sdk.onEvent((method, params) => {
    // run 已结束的事件不再转发(handler 持续挂在 sdk 上)
    if (state.activeRun !== run) return
    if (method === 'session.event') {
      const event = params.event || {}
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
        run.sawTurnEnd = true
        run.turnEndReason = event.data?.reason ?? null
        if (run.sawIdle) settleRun(run)
      }
    } else if (method === 'session.status') {
      if (String(params.sessionId) === run.sessionId && params.status === 'idle') {
        run.sawIdle = true
      }
      if (run.sawTurnEnd && run.sawIdle) settleRun(run)
    }
  })
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
  const sdk = state.runtime?.sdk
  if (!sdk || !run || state.activeRun !== run) return Promise.resolve({ ok: false, canceled: false })
  if (run.cancelRequested) return run.cancelPromise || Promise.resolve({ ok: true, canceled: true })
  run.cancelRequested = true
  run.cancelPromise = sdk.request('session/cancel', {
    sessionId: run.sessionId,
    reason: String(reason || 'canceled'),
    keepInbox: true,
  }, 30000).then((result) => ({ ok: true, canceled: true, result })).catch((error) => {
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
  const sdk = state.runtime?.sdk
  if (!sdk || run.outputBudgetSegments >= run.budget.maxOutputSegments) {
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
  run.sawTurnEnd = false
  run.sawIdle = false
  run.turnEndReason = null
  run.counters.textDeltas = 0
  run.counters.outputChars = 0
  run.outputDeltaTimes = []
  const text = [
    '系统为保持核心稳定,刚才临时暂停了超长输出。',
    `请从上一段回答中断的位置继续写第 ${segment} 段,只输出后续内容,不要重复已经写过的内容。`,
    '如果内容已经完整,请用一句话自然收尾。',
  ].join('\n')
  sdk.request('session/prompt', {
    sessionId: run.sessionId,
    contentBlocks: [{ type: 'text', text }],
    internal: true,
  }, 30000).then((result) => {
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
    messageId: null, sawTurnEnd: false, sawIdle: false, turnEndReason: null, lastSeq: 0,
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
  attachRunEventHandlers(run)

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
    const result = await state.runtime.sdk.request('session/prompt', {
      sessionId,
      contentBlocks,
    }, 30000)
    run.messageId = result?.messageId ?? null
    notifyHarness(runId, { type: 'agent/inbox/spliced', data: { messageId: run.messageId, sessionId }, seq: 0 })
    const summary = await done
    return { ok: true, summary }
  } catch (error) {
    console.error(`[worker] run ${runId} prompt 失败: ${error.message}`)
    finishRun({ status: 'failed', reason: { kind: 'error', error: { code: 'PROMPT_FAILED', message: error.message } } })
    return { ok: false, error: { code: 'PROMPT_FAILED', message: error.message } }
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

function stopRuntime() {
  const runtime = state.runtime
  if (!runtime) return { ok: true, stopped: false }
  notifyWorkerStatus('stopping')
  state.runtime = null
  try { runtime.child.stdin.end() } catch {}
  const killTimer = setTimeout(() => {
    try { runtime.child.kill('SIGKILL') } catch {}
  }, RUNTIME_KILL_GRACE_MS)
  runtime.child.once('exit', () => clearTimeout(killTimer))
  try { runtime.child.kill('SIGTERM') } catch {}
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
      state.cordisPath = params.cordisPath
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
      if (state.runtime) stopRuntime()
      state.generation = params.generation || state.generation + 1
      state.provider = params.provider
      state.model = params.model
      state.maxTokens = params.maxTokens
      if (params.cordisPath) state.cordisPath = params.cordisPath
      notifyWorkerStatus('starting')
      try {
        const runtime = spawnRuntime()
        state.runtime = runtime
        const serverInfo = await runtime.sdk.request('initialize', {
          cwd: params.cwd || `${state.dataRoot}/agent/runtime-workdir`,
          provider: state.provider,
          model: state.model,
          maxTokens: state.maxTokens,
        }, RUNTIME_BOOT_TIMEOUT_MS)
        // P0 经验:等 MCP 工具发现完成,否则首条 prompt 看不到工具
        await new Promise((r) => setTimeout(r, MCP_SETTLE_MS))
        notifyWorkerStatus('ready', { serverInfo })
        return { ok: true, serverInfo }
      } catch (error) {
        console.error(`[worker] start_generation 失败: ${error.message}`)
        stopRuntime()
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
    case 'worker.stop_generation':
      return stopRuntime()
    case 'worker.shutdown':
      stopRuntime()
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
  stopRuntime()
  setTimeout(() => process.exit(0), 200)
})

process.on('SIGTERM', () => {
  console.error('[worker] SIGTERM,有序关闭')
  stopRuntime()
  setTimeout(() => process.exit(0), 500)
})
process.on('SIGINT', () => {
  console.error('[worker] SIGINT,有序关闭')
  stopRuntime()
  setTimeout(() => process.exit(0), 500)
})

console.error(`[worker] started node=${process.versions.node} pid=${process.pid}`)
notifyWorkerStatus('idle')
