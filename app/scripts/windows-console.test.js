const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { ensureWindowsConsole } = require('../../integrations/deepseek-harness/worker/windows-console.cjs')
const { builtinRuntimeEnvironment } = require('../../integrations/deepseek-harness/worker/builtin-runtime.cjs')

function fixture({ existing = false, visible = true, attached = false, allocated = true,
  processCounts = [], attachError = 6, allocationError = 5, restoreFailures = [] } = {}) {
  const calls = []
  let ready = existing
  let error = 0
  const handlers = {
    GetConsoleWindow: () => ready && visible ? 'window' : null,
    GetConsoleProcessList: (processes, count) => {
      assert.equal(processes.length, 1)
      assert.equal(count, 1)
      return processCounts.length ? processCounts.shift() : Number(ready)
    },
    GetStdHandle: id => `pipe-${id}`,
    SetStdHandle: (id, handle) => {
      calls.push(['restore', id, handle])
      error = restoreFailures.includes(id) ? 6 : 0
      return Number(!error)
    },
    AttachConsole: () => { ready ||= attached; error = attachError; calls.push(['attach']); return Number(attached) },
    AllocConsole: () => { ready ||= allocated; error = allocationError; calls.push(['allocate']); return Number(allocated) },
    GetLastError: () => error,
    ShowWindow: (...args) => { calls.push(['hide', ...args]); return 1 },
  }
  const load = () => ({ load: () => ({ func: signature => {
    const name = signature.match(/__stdcall (\w+)/)[1]
    assert.ok(handlers[name], name)
    return handlers[name]
  } }) })
  return { load, calls }
}
test('console bootstrap leaves non-Windows and existing consoles alone', () => {
  ensureWindowsConsole({ platform: 'darwin', load() { throw Error('must not load Windows FFI') } })
  const f = fixture({ existing: true })
  ensureWindowsConsole({ platform: 'win32', load: f.load })
  assert.deepEqual(f.calls, [])
})
test('GUI runner allocates a hidden console and restores every original pipe', () => {
  const f = fixture()
  assert.equal(ensureWindowsConsole({ platform: 'win32', load: f.load }).allocated, true)
  assert.deepEqual(f.calls.slice(0, 3), [['attach'], ['allocate'], ['hide', 'window', 0]])
  assert.deepEqual(f.calls.slice(3), [-10, -11, -12].map(id => ['restore', id >>> 0, `pipe-${id >>> 0}`]))
})
test('runner attaches without hiding its parent console', () => {
  const f = fixture({ attached: true })
  assert.equal(ensureWindowsConsole({ platform: 'win32', load: f.load }).allocated, false)
  assert.equal(f.calls.some(c => c[0] === 'hide' || c[0] === 'allocate'), false)
})
test('existing windowless consoles and console lists larger than the probe buffer are reused', () => {
  for (const processCount of [1, 3]) {
    const f = fixture({ existing: true, visible: false, processCounts: [processCount] })
    assert.deepEqual(ensureWindowsConsole({ platform: 'win32', load: f.load }), { allocated: false })
    assert.deepEqual(f.calls, [])
  }
})
test('console bootstrap is idempotent when the console has no window', () => {
  const f = fixture({ visible: false })
  assert.deepEqual(ensureWindowsConsole({ platform: 'win32', load: f.load }), { allocated: true })
  assert.deepEqual(ensureWindowsConsole({ platform: 'win32', load: f.load }), { allocated: false })
  assert.equal(f.calls.filter(call => call[0] === 'allocate').length, 1)
  assert.equal(f.calls.some(call => call[0] === 'hide'), false)
})
test('console attachment during bootstrap is reused after AttachConsole or AllocConsole fails', () => {
  for (const processCounts of [[0, 2], [0, 0, 2]]) {
    const f = fixture({ processCounts, attached: false, allocated: false, attachError: 5 })
    assert.deepEqual(ensureWindowsConsole({ platform: 'win32', load: f.load }), { allocated: false })
    assert.equal(f.calls.filter(call => call[0] === 'restore').length, 3)
    assert.equal(f.calls.some(call => call[0] === 'hide'), false)
  }
})
test('genuine initialization failures retain both Windows API error codes and restore pipes', () => {
  const failed = fixture({ allocated: false, attachError: 6, allocationError: 5 })
  assert.throws(() => ensureWindowsConsole({ platform: 'win32', load: failed.load }),
    /initialization failed \(5\).*AttachConsole failed \(6\)/)
  assert.equal(failed.calls.filter(c => c[0] === 'restore').length, 3)
})
test('a standard handle restoration failure still restores the remaining handles', () => {
  const f = fixture({ restoreFailures: [(-10) >>> 0] })
  assert.throws(() => ensureWindowsConsole({ platform: 'win32', load: f.load }), /standard handle restoration failed \(6\)/)
  assert.equal(f.calls.filter(call => call[0] === 'restore').length, 3)
})
test('simultaneous initialization and pipe restoration failures retain both causes', () => {
  const f = fixture({ allocated: false, restoreFailures: [(-10) >>> 0] })
  assert.throws(() => ensureWindowsConsole({ platform: 'win32', load: f.load }), error => {
    assert.ok(error instanceof AggregateError)
    assert.match(error.message, /initialization failed \(5\).*AttachConsole failed \(6\).*restoration failed \(6\)/)
    assert.equal(error.errors.length, 2)
    return true
  })
  assert.equal(f.calls.filter(call => call[0] === 'restore').length, 3)
})
test('automatic preload initializes only the Electron-as-Node main thread', () => {
  const source = fs.readFileSync(require.resolve('../../integrations/deepseek-harness/worker/windows-console.cjs'), 'utf8')
  for (const isMainThread of [true, false]) {
    let loads = 0
    const f = fixture({ existing: true })
    vm.runInNewContext(source, {
      process: { platform: 'win32', versions: { electron: '43.1.0' }, env: { ELECTRON_RUN_AS_NODE: '1' } },
      require(name) {
        if (name === 'node:worker_threads') return { isMainThread }
        assert.equal(name, 'koffi')
        loads += 1
        return f.load()
      },
      module: { exports: {} },
    })
    assert.equal(loads, Number(isMainThread))
  }
})
test('Windows child preload preserves user Node options and is not duplicated', () => {
  const options = { runtimeRoot: '/test/中文 空格/runtime', platform: 'win32', env: { NODE_OPTIONS: '--max-old-space-size=4096', Path: 'C:\\Windows' } }
  const first = builtinRuntimeEnvironment(options)
  const second = builtinRuntimeEnvironment({ ...options, env: first })
  assert.match(first.NODE_OPTIONS, /^--max-old-space-size=4096 --require=".*中文 空格.*windows-console\.cjs"$/)
  assert.equal(first.NODE_OPTIONS, second.NODE_OPTIONS)
  assert.equal(builtinRuntimeEnvironment({ ...options, platform: 'darwin' }).NODE_OPTIONS, '--max-old-space-size=4096')
})
