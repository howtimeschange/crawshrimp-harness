// P0 spike driver:以 ELECTRON_RUN_AS_NODE=1 启动 Electron 内置 Node,
// 运行 dsh-jsonrpc-agent 发布 bin,验证 initialize → shutdown 全链路;
// 设 SPIKE_PROMPT=1 时追加无密钥 prompt 冒烟(事件流 + turn/end error 语义)。
import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const appRoot = resolve(root, '../../app')
const electronBin = resolve(appRoot, 'node_modules/.bin/electron')
const demoBin = resolve(root, 'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js')
const cordisPath = resolve(root, 'spike.cordis.yml')

const env = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: '1',
  DSH_CORDIS_CONFIG: cordisPath,
  CRAWSHRIMP_SESSION_ROOT: process.env.CRAWSHRIMP_SESSION_ROOT || resolve(root, '.spike-sessions'),
}

console.log('[spike] electron bin:', electronBin)
console.log('[spike] dsh bin:     ', demoBin)
console.log('[spike] cordis:      ', cordisPath)

const child = spawn(electronBin, [demoBin], { env, stdio: ['pipe', 'pipe', 'pipe'] })

let buffer = ''
const pending = new Map()
let stderrTail = ''

// 冒烟收集器(仅在 SPIKE_PROMPT=1 时激活)
const smoke = { active: false, seen: [], done: null }

function handleNotification(msg) {
  if (msg.method === 'session.event' && smoke.active) {
    const type = msg.params?.event?.type ?? 'unknown'
    smoke.seen.push(type)
    console.log('[smoke] event:', type)
    if (type === 'turn/end') {
      console.log('[smoke] turn/end payload:', JSON.stringify(msg.params.event).slice(0, 900))
      smoke.done?.(smoke.seen)
      smoke.done = null
    }
  } else if (msg.method === 'session.status' && smoke.active) {
    console.log('[smoke] status:', msg.params?.status, 'session:', msg.params?.sessionId)
  } else {
    console.log('[spike] notification:', JSON.stringify(msg).slice(0, 260))
  }
}

child.stdout.on('data', (chunk) => {
  buffer += String(chunk)
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch {
      console.error('[spike] non-json stdout:', line.slice(0, 300))
      continue
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else {
      handleNotification(msg)
    }
  }
})

child.stderr.on('data', (chunk) => {
  stderrTail = (stderrTail + String(chunk)).slice(-4000)
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

function cleanup(code) {
  try { child.stdin.end() } catch {}
  setTimeout(() => {
    try { child.kill() } catch {}
  }, 1500)
  process.exitCode = code
}

// 无密钥 prompt 冒烟:验证 durable inbox 回执、事件流词汇与 turn/end error 语义。
async function smokePrompt() {
  const sessionId = process.env.SPIKE_SESSION_ID || 'spike-smoke-1'
  smoke.active = true

  const turnEnded = new Promise((resolveTurn) => {
    smoke.done = resolveTurn
  })

  const prompt = await rpc('session/prompt', {
    sessionId,
    contentBlocks: [{ type: 'text', text: '你好,请只回复两个字:收到' }],
  }, 3, 30000)
  if (prompt.error) {
    console.error('[smoke] prompt 被拒绝:', JSON.stringify(prompt.error))
    smoke.active = false
    return
  }
  console.log('[smoke] PROMPT QUEUED → messageId:', prompt.result?.messageId)

  const timeout = new Promise((resolveTimeout) => setTimeout(() => resolveTimeout(null), 90000))
  const seen = await Promise.race([turnEnded, timeout])
  smoke.active = false
  if (seen) {
    console.log('[smoke] 事件序列:', seen.join(' → '))
  } else {
    console.error('[smoke] 90s 内未见 turn/end;已见事件:', smoke.seen.join(', ') || '(无)')
  }
}

async function main() {
  try {
    const init = await rpc('initialize', {
      cwd: resolve(root, 'workspace'),
      provider: process.env.CRAWSHRIMP_PROVIDER || 'crawshrimp-overseas-openai',
      model: process.env.CRAWSHRIMP_AGENT_MODEL || 'gpt-5.6-terra',
      maxTokens: 8000,
    }, 1, 45000)

    if (init.error) {
      console.error('[spike] initialize 失败:', JSON.stringify(init.error))
      cleanup(1)
      return
    }
    console.log('[spike] INITIALIZE OK →', JSON.stringify(init.result))
    console.log('[spike] serverInfo:', JSON.stringify(init.result?.serverInfo))

    if (String(process.env.SPIKE_PROMPT || '') === '1') {
      await smokePrompt()
    }

    const shut = await rpc('shutdown', {}, 2, 15000)
    console.log('[spike] SHUTDOWN →', JSON.stringify(shut.result ?? shut.error))
    cleanup(0)
  } catch (error) {
    console.error('[spike] FAILED:', error.message)
    console.error('[spike] stderr tail:\n', stderrTail.slice(-2500))
    cleanup(1)
  }
}

void main()
