const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { tmpdir } = require('node:os')
const root = path.resolve(__dirname, '../../integrations/deepseek-harness')

function cancellationFixture(cancel) {
  const source = fs.readFileSync(path.join(root, 'worker/worker.mjs'), 'utf8')
  function body(start, end) {
    const index = source.indexOf(start)
    assert.ok(index >= 0)
    return source.slice(index, source.indexOf(end, index))
  }
  const run = { runId: 'run-A', sessionId: 'session-A' }
  const terminal = []
  run.done = new Promise(resolve => { run.resolve = resolve })
  const state = { activeRun: run, runtime: { cancel } }
  let stopped = 0
  const context = { state, console, setTimeout, clearTimeout,
    RUNTIME_KILL_GRACE_MS: 50,
    finishRun(result) {
      terminal.push(result)
      state.activeRun = null
      run.resolve(result)
    },
    async stopRuntime() {
      stopped++
      state.runtime = null
      context.finishRun({ status: 'interrupted' })
    },
  }
  vm.createContext(context)
  vm.runInContext(body('function cancelActiveRuntimeSession(', '\nfunction cancelOutputBudgetRun(')
    + '\n' + body(source.includes('async function cancelActiveRun(') ? 'async function cancelActiveRun(' : 'function cancelActiveRun(', '\nasync function stopRuntime('), context)
  return { run, state, terminal, context, stopped: () => stopped,
    cancel: (params = {}) => context.cancelActiveRun(params),
  }
}

test('cancel RPC failure cannot publish canceled or release a still-running host', async () => {
  const f = cancellationFixture(async () => { throw Error('HTTP 503') })
  const reply = await f.cancel({ runId: 'run-A' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reply.ok, false)
  assert.ok(!f.terminal.some(result => result.status === 'canceled'))
  assert.ok(f.state.activeRun === f.run || f.stopped() === 1)
})

test('cancel acknowledgment waits for the run terminal event', async () => {
  const f = cancellationFixture(async () => ({}))
  let settled = false
  const pending = Promise.resolve(f.cancel({ runId: 'run-A' })).then(result => { settled = true; return result })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)
  assert.equal(f.state.activeRun, f.run)
  f.context.finishRun({ status: 'canceled' })
  assert.equal((await pending).ok, true)
  assert.equal(f.stopped(), 0)
})

test('stale cancellation cannot cancel a different run', async () => {
  let calls = 0
  const f = cancellationFixture(async () => { calls++; return {} })
  const reply = await f.cancel({ runId: 'previous-run' })
  assert.equal(reply.ok, false)
  assert.equal(calls, 0)
  assert.equal(f.state.activeRun, f.run)
})

test('Windows staging preserves executable and script paths containing spaces', () => {
  let source = fs.readFileSync(path.join(root, 'scripts/stage-runtime-targets.mjs'), 'utf8')
  source = source.replace(/^import .*$/gm, '').replaceAll('import.meta.url', JSON.stringify('file:///C:/Work%20Space/scripts/stage-runtime-targets.mjs'))
  let call
  vm.runInNewContext(source, {
    process: { platform: 'win32', arch: 'x64', execPath: 'C:\\Program Files\\nodejs\\node.exe', argv: ['node', 'script', 'win32-x64'], exit(code) { throw Error(String(code)) } },
    spawnSync(executable, args, options) { call = { executable, args, options }; return { status: 0 } },
    dirname: () => 'C:\\Work Space\\scripts', resolve: path.win32.resolve,
    fileURLToPath: () => 'C:\\Work Space\\scripts\\stage-runtime-targets.mjs', console,
  })
  assert.equal(call.executable, 'C:\\Program Files\\nodejs\\node.exe')
  assert.equal(call.args[0], 'C:\\Work Space\\scripts\\stage-runtime.mjs')
  assert.equal(call.options.shell, false)
})

function fakeRuntime(t, script) {
  const runtimeRoot = fs.mkdtempSync(path.join(tmpdir(), 'harness boot recovery '))
  const profile = path.join(runtimeRoot, 'profiles/web')
  fs.mkdirSync(path.join(profile, 'agent-presets/crawshrimp-standard'), { recursive: true })
  for (const name of ['package.json', 'cordis.yml', 'cordis.patch.yml', 'pnpm-workspace.yaml', 'agent-presets/crawshrimp-standard/agent.cordis.yml', 'agent-presets/crawshrimp-standard/preset.yml']) {
    fs.writeFileSync(path.join(profile, name), name === 'package.json' ? '{}' : '')
  }
  for (const name of ['@xmanrui/dsh-im', 'crawshrimp-product-bridge', 'crawshrimp-slots', '@deepseek-ai/dsh/lib']) {
    fs.mkdirSync(path.join(runtimeRoot, 'node_modules', name), { recursive: true })
  }
  const pidFile = path.join(runtimeRoot, 'child.pid')
  fs.writeFileSync(path.join(runtimeRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));${script}`)
  t.after(() => {
    if (fs.existsSync(pidFile)) {
      try { process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 'SIGKILL') } catch {}
    }
    fs.rmSync(runtimeRoot, { recursive: true, force: true })
  })
  return { runtimeRoot, pidFile, dshHome: path.join(runtimeRoot, 'home'), cwd: runtimeRoot, nodeExecutable: process.execPath, timeoutMs: 1000 }
}

for (const mode of ['missing launch URL', 'stalled cookie exchange']) {
  test(`failed boot reaps its child: ${mode}`, { timeout: 10000 }, async t => {
    const { DshWebRuntime } = await import(pathToFileURL(path.join(root, 'worker/web-rpc-client.mjs')).href)
    const fixture = fakeRuntime(t, mode === 'missing launch URL'
      ? 'setInterval(()=>{},1000)'
      : "require('http').createServer(()=>{}).listen(0,'127.0.0.1',function(){console.log('dsh web: http://127.0.0.1:'+this.address().port+'/?launch=fixture')})")
    const launch = DshWebRuntime.launch(fixture)
    const watchdog = new Promise((_, reject) => {
      const timer = setTimeout(() => reject(Error('test watchdog: launch never settled')), 6000)
      t.after(() => clearTimeout(timer))
    })
    await assert.rejects(Promise.race([launch, watchdog]), error => !error.message.includes('test watchdog'))
    const pid = Number(fs.readFileSync(fixture.pidFile, 'utf8'))
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  })
}

function workerFixture({ stop = async () => {}, cancel = async () => ({ accepted: true }) } = {}) {
  const source = fs.readFileSync(path.join(root, 'worker/worker.mjs'), 'utf8')
    .split('// ---------- stdio 入口 ----------')[0].replace(/^import .*$/gm, '')
  let events
  let stopCalls = 0
  let cancelCalls = 0
  const runtime = {
    createSession: async () => ({}), selectModel: async () => ({}), prompt: async () => ({}),
    follow(_id, handlers) { events = handlers; return { ready: Promise.resolve(), close() {} } },
    async cancel() { cancelCalls++; return await cancel() },
    async stop() { stopCalls++; return await stop() },
  }
  const context = { console, setTimeout, clearTimeout, Buffer, runtime,
    createNativeWebFollowManager: () => ({ closeAll() {} }),
    assertSessionHeadersExcludeNativeWebTools() {}, activeTurnEvents: x => x,
    process: { env: {}, versions: process.versions, stdout: { write() {} }, exit() { throw Error('worker exit') } },
  }
  vm.createContext(context)
  vm.runInContext(source, context)
  vm.runInContext("state.runtime = runtime; state.provider = 'p'; state.model = 'm'", context)
  return { context, runtime, events: () => events,
    start: () => context.startRun({ runId: 'r', sessionId: 's', text: 'fixture', budget: { maxToolCalls: 1 } }),
    state: () => vm.runInContext('state', context),
    stopCalls: () => stopCalls, cancelCalls: () => cancelCalls,
  }
}

test('budget cancellation accepts turn/end even while counters remain over budget', async () => {
  const f = workerFixture()
  const pending = f.start()
  await new Promise(resolve => setImmediate(resolve))
  f.events().onEvent({ type: 'tool/call', data: { name: 'fixture' }, seq: 1 })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.cancelCalls(), 1)
  assert.ok(f.state().activeRun)
  f.events().onEvent({ type: 'turn/end', data: { reason: { kind: 'aborted' } }, seq: 2 })
  const result = await pending
  assert.equal(result.summary.status, 'failed')
  assert.equal(result.summary.reason.error.code, 'BUDGET_EXCEEDED')
  assert.equal(f.stopCalls(), 0)
})

test('failed cancellation holds the run until forced Host shutdown actually finishes', async () => {
  let releaseStop
  const stop = new Promise(resolve => { releaseStop = resolve })
  const f = workerFixture({ cancel: async () => { throw Error('HTTP 503') }, stop: () => stop })
  const pending = f.start()
  await new Promise(resolve => setImmediate(resolve))
  const cancel = f.context.cancelActiveRun({ runId: 'r' })
  await new Promise(resolve => setImmediate(resolve))
  try {
    assert.equal(f.stopCalls(), 1)
    assert.ok(f.state().activeRun)
    assert.equal((await f.start()).error.code, 'BUSY')
  } finally { releaseStop() }
  assert.equal((await cancel).ok, false)
  assert.equal((await pending).summary.status, 'interrupted')
  assert.equal(f.state().activeRun, null)
})

for (const step of ['createSession', 'selectModel', 'follow']) {
  test(`cancellation during ${step} preserves the run reply and never submits a prompt`, async () => {
    const f = workerFixture()
    let release
    const gate = new Promise(resolve => { release = resolve })
    let prompts = 0
    f.runtime.prompt = async () => { prompts++ }
    if (step === 'follow') f.runtime.follow = () => ({ ready: gate, close() {} })
    else f.runtime[step] = () => gate
    const pending = f.start()
    await new Promise(resolve => setImmediate(resolve))
    f.state().activeRun.cancelRequested = true
    f.context.finishRun({ status: 'canceled' })
    release({})
    const result = await pending
    assert.equal(result.ok, true)
    assert.equal(result.summary.status, 'canceled')
    assert.equal(prompts, 0)
  })
}
