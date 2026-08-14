// P0 spike:真实模型 + MCP 工具全链路往返。
// 前置:venv 里启动 spike/mcp-spike-server.py(127.0.0.1:18766)。
// 用法:CRAWSHRIMP_LLM_API_KEY=... node spike/run-roundtrip.mjs
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const appRoot = resolve(root, '../../app')
const electronBin = resolve(appRoot, 'node_modules/.bin/electron')
const demoBin = resolve(root, 'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js')
const cordisPath = process.env.DSH_CORDIS_CONFIG
  ? resolve(process.env.DSH_CORDIS_CONFIG)
  : resolve(root, 'spike.cordis.yml')

const apiKey = String(process.env.CRAWSHRIMP_LLM_API_KEY || '')
if (!apiKey) {
  console.error('[roundtrip] 缺少 CRAWSHRIMP_LLM_API_KEY')
  process.exit(1)
}

const env = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: '1',
  DSH_CORDIS_CONFIG: cordisPath,
  CRAWSHRIMP_SESSION_ROOT: resolve(root, '.spike-sessions-roundtrip'),
  CRAWSHRIMP_MCP_URL: process.env.CRAWSHRIMP_MCP_URL || 'http://127.0.0.1:18766/mcp',
  CRAWSHRIMP_LLM_API_KEY: apiKey,
}

const provider = process.env.CRAWSHRIMP_PROVIDER || 'crawshrimp-overseas-openai'
const model = process.env.CRAWSHRIMP_AGENT_MODEL || 'gpt-5.6-terra'
console.log(`[roundtrip] provider=${provider} model=${model} mcp=${env.CRAWSHRIMP_MCP_URL}`)

const child = spawn(electronBin, [demoBin], { env, stdio: ['pipe', 'pipe', 'pipe'] })

let buffer = ''
const pending = new Map()
const events = []
let stderrTail = ''

child.stdout.on('data', (chunk) => {
  buffer += String(chunk)
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method === 'session.event') {
      const type = msg.params?.event?.type ?? 'unknown'
      events.push({ type, event: msg.params.event })
      console.log('[roundtrip] event:', type)
      if (type === 'tool/call') {
        const d = msg.params.event.data
        console.log('[roundtrip]   tool/call:', JSON.stringify(d).slice(0, 300))
      } else if (type === 'tool/result') {
        console.log('[roundtrip]   tool/result:', JSON.stringify(msg.params.event.data).slice(0, 400))
      } else if (type === 'assistant/message') {
        const d = msg.params.event.data
        const text = Array.isArray(d?.content)
          ? d.content.map((b) => b?.text ?? '').join(' ')
          : JSON.stringify(d)
        console.log('[roundtrip]   assistant:', text.slice(0, 500))
      } else if (type === 'turn/end') {
        console.log('[roundtrip]   turn/end:', JSON.stringify(msg.params.event.data).slice(0, 600))
      }
    } else if (msg.method === 'session.status') {
      console.log('[roundtrip] status:', msg.params?.status)
    }
  }
})

child.stderr.on('data', (chunk) => {
  stderrTail = (stderrTail + String(chunk)).slice(-6000)
  process.stderr.write(`[runtime-stderr] ${String(chunk)}`)
})

function rpc(method, params, id, timeoutMs = 30000) {
  return new Promise((resolveRpc, reject) => {
    pending.set(id, resolveRpc)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} })}\n`)
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
    const init = await rpc('initialize', {
      cwd: resolve(root, 'workspace'),
      provider,
      model,
      maxTokens: 8000,
    }, 1, 45000)
    if (init.error) {
      console.error('[roundtrip] initialize 失败:', JSON.stringify(init.error))
      return 1
    }
    console.log('[roundtrip] INITIALIZE OK:', JSON.stringify(init.result?.serverInfo))
    // 等 MCP 工具发现完成(避免与 prompt 竞争)
    const settleMs = Number(process.env.ROUNDTRIP_SETTLE_MS || 3000)
    console.log(`[roundtrip] 等待 ${settleMs}ms 让工具发现完成…`)
    await new Promise((r) => setTimeout(r, settleMs))

    const prompt = await rpc('session/prompt', {
      sessionId: `roundtrip-${Date.now()}`,
      contentBlocks: [{
        type: 'text',
        text: '请调用你可见的 MCP 工具(名字形如 mcp__crawshrimp__echo),把参数 text 设为 "hello-harness"。拿到工具返回后,只回复工具返回的原文,不要解释。',
      }],
    }, 2, 30000)
    if (prompt.error) {
      console.error('[roundtrip] prompt 失败:', JSON.stringify(prompt.error))
      return 1
    }
    console.log('[roundtrip] PROMPT QUEUED → messageId:', prompt.result?.messageId)

    const deadline = Date.now() + 120000
    let done = false
    while (Date.now() < deadline) {
      const ended = events.find((e) => e.type === 'turn/end')
      if (ended) {
        done = true
        break
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    if (!done) {
      console.error('[roundtrip] 120s 内未收到 turn/end;事件:', events.map((e) => e.type).join(', '))
      return 1
    }

    const toolCall = events.find((e) => e.type === 'tool/call')
    const toolResult = events.find((e) => e.type === 'tool/result')
    const turnEnd = events.find((e) => e.type === 'turn/end')
    const reason = turnEnd?.event?.data?.reason

    console.log('\n[roundtrip] === 结果 ===')
    console.log('[roundtrip] tool/call 出现:', Boolean(toolCall))
    console.log('[roundtrip] tool/result 出现:', Boolean(toolResult))
    console.log('[roundtrip] turn/end reason:', JSON.stringify(reason))
    const ok = Boolean(toolCall) && Boolean(toolResult) && reason?.kind === 'completed'
    console.log('[roundtrip] 判定:', ok ? 'PASS ✅' : 'FAIL ❌')

    await rpc('shutdown', {}, 9, 15000)
    return ok ? 0 : 1
  } catch (error) {
    console.error('[roundtrip] FAILED:', error.message)
    console.error('[roundtrip] stderr tail:\n', stderrTail.slice(-2000))
    return 1
  } finally {
    try { child.stdin.end() } catch {}
    setTimeout(() => {
      try { child.kill() } catch {}
    }, 1500)
  }
}

main().then((code) => {
  process.exit(code)
})
