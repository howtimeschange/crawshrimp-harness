// crawshrimp-harness Agent Worker
//
// 职责(窄 spec §10):作为 DSH runtime 的监督者——
// - stdio NDJSON JSON-RPC 2.0(protocol_version: 1)与 FastAPI 通信;
// - 懒启动 DSH runtime(Electron-as-Node + dsh-jsonrpc-agent);
// - 转发 Harness 会话事件(harness.notification);
// - 全局单 Active Run;取消 = 终止 runtime generation;
// - stdout 仅 NDJSON JSON-RPC,诊断走 stderr。
//
// 关键经验(P0 spike):
// - MCP 工具发现是 initialize 后的异步过程,首条 prompt 前必须等待(默认 3s);
// - DSH 同名 sessionId + 已有日志 + 新 runtime = id collision → 拒绝;
//   产品侧必须保证 runtime_session_id 全局唯一且不跨代复用。

import readline from 'node:readline'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const PROTOCOL_VERSION = 1
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

function notifyHarness(runId, event) {
  send({
    jsonrpc: '2.0',
    method: 'harness.notification',
    params: { protocol_version: PROTOCOL_VERSION, runId, event },
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
    CRAWSHRIMP_SESSION_ROOT: process.env.CRAWSHRIMP_SESSION_ROOT || `${state.dataRoot}/agent/harness-sessions`,
    CRAWSHRIMP_MCP_URL: process.env.CRAWSHRIMP_MCP_URL || 'http://127.0.0.1:18768/mcp',
  }

  const child = spawn(nodeExecutable, [demoBin], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const sdk = createSdkClient(child)
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
      notifyHarness(run.runId, event)
      if (event.type === 'turn/end') {
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
  const kind = reason?.kind ?? 'error'
  const status = kind === 'completed' ? 'completed'
    : kind === 'aborted' ? 'canceled'
    : 'failed'
  finishRun({ status, reason, messageId: run.messageId, lastSeq: run.lastSeq })
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

  const run = {
    runId, sessionId,
    messageId: null, sawTurnEnd: false, sawIdle: false, turnEndReason: null, lastSeq: 0,
    resolve: null,
    timer: setTimeout(() => {
      console.error(`[worker] run ${runId} 超过 ${RUN_ABSOLUTE_TIMEOUT_MS}ms 绝对上限,终止`)
      finishRun({ status: 'failed', reason: { kind: 'error', error: { code: 'RUN_TIMEOUT' } }, lastSeq: run.lastSeq })
    }, RUN_ABSOLUTE_TIMEOUT_MS),
  }
  const done = new Promise((resolve) => { run.resolve = resolve })
  state.activeRun = run
  attachRunEventHandlers(run)

  try {
    const result = await state.runtime.sdk.request('session/prompt', {
      sessionId,
      contentBlocks: [{ type: 'text', text }],
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
    finishRun({ status: 'canceled', reason: { kind: 'aborted', reason: { kind: 'user' } }, messageId: run.messageId, lastSeq: run.lastSeq })
  }
  stopRuntime()
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
