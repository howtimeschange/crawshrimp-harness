// Worker 协议冒烟:initialize → start_generation → run(真实模型 + MCP 工具)→ shutdown。
// 前置:spike/mcp-spike-server.py 运行中(18766)。
// 用法:CRAWSHRIMP_LLM_API_KEY=... node spike/test-worker.mjs
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const appRoot = resolve(root, '../../app')
const electronBin = resolve(appRoot, 'node_modules/.bin/electron')
const workerEntry = resolve(root, 'worker/worker.mjs')
const cordisPath = resolve(root, 'spike-mcp-debug.cordis.yml')

const apiKey = String(process.env.CRAWSHRIMP_LLM_API_KEY || '')
if (!apiKey) {
  console.error('[worker-test] 缺少 CRAWSHRIMP_LLM_API_KEY')
  process.exit(1)
}

const env = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: '1',
  CRAWSHRIMP_LLM_API_KEY: apiKey,
  CRAWSHRIMP_MCP_URL: 'http://127.0.0.1:18766/mcp',
  CRAWSHRIMP_SESSION_ROOT: resolve(root, '.spike-sessions-worker'),
}

console.log('[worker-test] electron:', electronBin)
console.log('[worker-test] worker:', workerEntry)

const child = spawn(electronBin, [workerEntry], { env, stdio: ['pipe', 'pipe', 'pipe'] })

let buffer = ''
const pending = new Map()
const events = []
let nextId = 1

child.stdout.on('data', (chunk) => {
  buffer += String(chunk)
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch {
      console.error('[worker-test] 非 JSON 帧:', line.slice(0, 200))
      continue
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method === 'harness.notification') {
      const event = msg.params?.event || {}
      events.push(event)
      const type = event.type
      console.log('[worker-test] event:', type)
      if (type === 'tool/call') console.log('[worker-test]   call:', JSON.stringify(event.data).slice(0, 240))
      if (type === 'tool/result') console.log('[worker-test]   result:', JSON.stringify(event.data).slice(0, 300))
      if (type === 'turn/end') console.log('[worker-test]   reason:', JSON.stringify(event.data?.reason).slice(0, 300))
    } else if (msg.method === 'worker.status') {
      console.log('[worker-test] status:', msg.params?.status, msg.params?.serverInfo ? JSON.stringify(msg.params.serverInfo) : '')
    }
  }
})

child.stderr.on('data', (d) => process.stderr.write(`[worker-stderr] ${d}`))

function rpc(method, params, timeoutMs = 60000) {
  return new Promise((resolveRpc, reject) => {
    const id = nextId++
    pending.set(id, resolveRpc)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: { protocol_version: 1, ...(params || {}) } })}\n`)
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`rpc ${method} 超时`))
      }
    }, timeoutMs)
  })
}

async function main() {
  try {
    const init = await rpc('worker.initialize', {
      runtimeRoot: root,
      dataRoot: resolve(root, '.worker-data'),
      cordisPath,
      mcpUrl: 'http://127.0.0.1:18766/mcp',
      sessionRoot: resolve(root, '.spike-sessions-worker'),
    }, 15000)
    console.log('[worker-test] initialize:', JSON.stringify(init.result))
    if (!init.result?.ok) throw new Error('initialize 失败')

    const gen = await rpc('worker.start_generation', {
      generation: 1,
      provider: 'crawshrimp-overseas-openai',
      model: 'gpt-5.6-terra',
      maxTokens: 8000,
    }, 90000)
    console.log('[worker-test] start_generation:', JSON.stringify(gen.result))
    if (!gen.result?.ok) throw new Error('start_generation 失败')

    const health = await rpc('worker.health', {}, 10000)
    console.log('[worker-test] health:', JSON.stringify(health.result))

    const runId = `test-run-${Date.now()}`
    const sessionId = `test-session-${Date.now()}`
    const run = await rpc('worker.run', {
      runId,
      sessionId,
      text: '请调用你可见的 MCP 工具(名字形如 mcp__crawshrimp__echo),把参数 text 设为 "worker-hello"。拿到工具返回后,只回复工具返回的原文。',
    }, 150000)
    console.log('[worker-test] run result:', JSON.stringify(run.result))

    const toolCall = events.find((e) => e.type === 'tool/call')
    const toolResult = events.find((e) => e.type === 'tool/result')
    const turnEnd = events.find((e) => e.type === 'turn/end')
    const summary = run.result?.summary || {}

    const ok = run.result?.ok
      && Boolean(toolCall) && Boolean(toolResult)
      && summary.status === 'completed'
      && turnEnd?.data?.reason?.kind === 'completed'
    console.log('[worker-test] 判定:', ok ? 'PASS ✅' : 'FAIL ❌')

    await rpc('worker.shutdown', {}, 10000)
    console.log('[worker-test] shutdown done')
    return ok ? 0 : 1
  } catch (error) {
    console.error('[worker-test] FAILED:', error.message)
    return 1
  } finally {
    try { child.stdin.end() } catch {}
    setTimeout(() => {
      try { child.kill() } catch {}
    }, 1500)
  }
}

main().then((code) => process.exit(code))
