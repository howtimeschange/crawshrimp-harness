// 确定性启动对照:同一配置多次启动,统计 CRASH/OK。
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import http from 'node:http'

const root = process.cwd()
const [,, cfgPath, label, runsStr] = process.argv
const runs = Number(runsStr || 3)

async function bootOnce(round) {
  return new Promise((res) => {
    const c = spawn('../../app/node_modules/.bin/electron', ['node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_CORDIS_CONFIG: resolve(cfgPath),
        CRAWSHRIMP_SESSION_ROOT: resolve(root, `.t-${label}-${Date.now()}-sess`),
        CRAWSHRIMP_STORAGE_ROOT: resolve(root, `.t-${label}-${Date.now()}-stor`),
        CRAWSHRIMP_WORKSPACE_ROOT: resolve(root, 'workspace'), CRAWSHRIMP_WEB_PORT: '3090',
        CRAWSHRIMP_LLM_API_KEY: process.env.CRAWSHRIMP_LLM_API_KEY, CRAWSHRIMP_MCP_TOKEN: 't',
        CRAWSHRIMP_MCP_URL: 'http://127.0.0.1:18965/mcp' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let err = ''
    c.stderr.on('data', (d) => { err = (err + String(d)).slice(-2500) })
    c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { cwd: resolve(root, 'workspace'), provider: 'crawshrimp-overseas-openai', model: 'gpt-5.6-terra', maxTokens: 8000 } }) + '\n')
    setTimeout(() => {
      http.get('http://127.0.0.1:3090/', (r) => {
        res(`run${round}: HTTP ${r.statusCode}`)
        try { c.kill() } catch {}
      }).on('error', () => {
        const hit = err.split('\n').find((l) => /^Error:|startsWith/.test(l))
        res(`run${round}: ${hit ? hit.slice(0, 120) : 'FAIL-no-error'}`)
        try { c.kill() } catch {}
      })
    }, 40000)
  })
}

for (let i = 1; i <= runs; i++) {
  console.log(await bootOnce(i))
}
process.exit(0)
