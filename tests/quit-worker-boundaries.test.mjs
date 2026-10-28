import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, cpSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureSource = `
import {appendFileSync} from 'node:fs'
const note = event => appendFileSync(process.env.QUIT_LEDGER,event+'\\n')
export const activeTurnEvents = events => events
export const assertSessionHeadersExcludeNativeWebTools = () => {}
export class DshWebRuntime {
 static async launch() { note('launch'); return new DshWebRuntime() }
 origin='http://127.0.0.1:1'; launchUrl='http://127.0.0.1:1/?fixture=1'
 onExit(callback) { this.exit=callback }
 async createSession() { note('create-session') }
 async currentModel() { return {provider:'fixture',model:'fixture'} }
 async selectModel() { note('select-model') }
 async setAutomationPolicy() { note('install-policy') }
 async clearAutomationPolicy() { note('clear-policy') }
 follow(_id, handlers) { queueMicrotask(()=>handlers.onSnapshotComplete([])); return {ready:Promise.resolve(),close(){note('follow-close')}} }
 async prompt() { note('prompt'); if(process.env.QUIT_CASE==='unknown')throw Error('accepted prompt, response lost');return {queued:true} }
 async stop() { note('stop-enter'); await new Promise(r=>setTimeout(r,25)); note('stop-complete');this.exit?.(0,null) }
}
`

for (const mode of ['unknown', 'active']) {
  test(`shutdown preserves ${mode} outcome without replaying a submitted prompt`, { timeout: 10000 }, async () => {
    const dir = mkdtempSync(path.join(process.env.QUIT_TEST_ARTIFACTS || tmpdir(), `quit-worker-${mode}-`))
    const workerDir = path.join(dir, 'worker')
    cpSync(path.join(root, 'integrations/deepseek-harness/worker'), workerDir, { recursive: true })
    // Fixture replaces only the model/runtime transport. Worker lifecycle code is byte-identical.
    const baseline = readFileSync(path.join(root, 'integrations/deepseek-harness/worker/worker.mjs'))
    assert.deepEqual(readFileSync(path.join(workerDir, 'worker.mjs')), baseline)
    writeFileSync(path.join(workerDir, 'web-rpc-client.mjs'), fixtureSource)
    const runtimeRoot = path.join(dir, 'runtime')
    mkdirSync(path.join(runtimeRoot, 'node_modules/@deepseek-ai/dsh/lib'), { recursive: true })
    writeFileSync(path.join(runtimeRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '// Never executed by fake runtime\n')
    const ledger = path.join(dir, 'ledger.txt')
    const child = spawn(process.execPath, [path.join(workerDir, 'worker.mjs')], { env: { ...process.env, QUIT_CASE: mode, QUIT_LEDGER: ledger, CRAWSHRIMP_AGENT_MCP_SETTLE_MS: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = '', stdout = '', sequence = 0
    const pending = new Map()
    child.stderr.on('data', chunk => { stderr += chunk })
    child.stdout.on('data', chunk => { stdout += chunk })
    const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
    readline.createInterface({ input: child.stdout }).on('line', line => { const message = JSON.parse(line); if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) } })
    const request = (method, params = {}) => new Promise(resolve => { const id = ++sequence; pending.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: { protocol_version: 1, ...params } }) + '\n') })
    const events = () => existsSync(ledger) ? readFileSync(ledger, 'utf8').trim().split('\n') : []
    try {
      assert.equal((await request('worker.initialize', { runtimeRoot, dataRoot: dir })).result.ok, true)
      assert.equal((await request('worker.start_generation', { provider: 'fixture', model: 'fixture' })).result.ok, true)
      const run = request('worker.run', { runId: 'fixture-run', sessionId: 'fixture-session', text: 'local synthetic lifecycle', provider: 'fixture', model: 'fixture', automationPolicy: { mode: 'fixture' } })
      const until = Date.now() + 3000
      while (!events().includes('prompt') && Date.now() < until) await new Promise(r => setTimeout(r, 10))
      assert.ok(events().includes('prompt'))
      let result
      if (mode === 'unknown') {
        result = (await run).result
        assert.equal(result.error.code, 'PROMPT_RESULT_UNKNOWN')
        assert.ok(events().includes('stop-complete'), 'Host stopped before unknown result returned')
        assert.ok(!events().includes('clear-policy'), 'Policy retained until uncertain Host was reaped')
        await request('worker.shutdown')
      } else {
        assert.equal((await request('worker.shutdown')).result.ok, true)
        result = (await run).result
        assert.equal(result.summary.status, 'interrupted')
      }
      assert.deepEqual(await exit, { code: 0, signal: null })
      assert.equal(events().filter(e => e === 'prompt').length, 1)
      assert.equal(events().filter(e => e === 'launch').length, 1)
      assert.equal(events().filter(e => e === 'stop-complete').length, 1)
      writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ mode, result, events: events(), externalModelCalls: 0, realWorkerUnmodified: true }, null, 2))
    } finally {
      writeFileSync(path.join(dir, 'stdout.log'), stdout)
      writeFileSync(path.join(dir, 'stderr.log'), stderr)
      if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
      await exit
    }
  })
}
