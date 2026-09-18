const test = require('node:test')
const assert = require('node:assert/strict')
const { ensureWindowsConsole } = require('../../integrations/deepseek-harness/worker/windows-console.cjs')
const { builtinRuntimeEnvironment } = require('../../integrations/deepseek-harness/worker/builtin-runtime.cjs')

function fixture({ existing = false, attached = false, allocated = true } = {}) {
  const calls = []
  let ready = existing
  const handlers = {
    GetConsoleWindow: () => ready ? 'window' : null,
    GetStdHandle: id => `pipe-${id}`,
    SetStdHandle: (id, handle) => { calls.push(['restore', id, handle]); return 1 },
    AttachConsole: () => { ready = attached; calls.push(['attach']); return Number(attached) },
    AllocConsole: () => { ready = allocated; calls.push(['allocate']); return Number(allocated) },
    GetLastError: () => 5,
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
test('runner can attach without hiding its parent console; allocation failures fail closed', () => {
  const f = fixture({ attached: true })
  assert.equal(ensureWindowsConsole({ platform: 'win32', load: f.load }).allocated, false)
  assert.equal(f.calls.some(c => c[0] === 'hide' || c[0] === 'allocate'), false)
  const failed = fixture({ allocated: false })
  assert.throws(() => ensureWindowsConsole({ platform: 'win32', load: failed.load }), /initialization failed \(5\)/)
  assert.equal(failed.calls.filter(c => c[0] === 'restore').length, 3)
})
test('Windows child preload preserves user Node options and is not duplicated', () => {
  const options = { runtimeRoot: '/test/中文 空格/runtime', platform: 'win32', env: { NODE_OPTIONS: '--max-old-space-size=4096', Path: 'C:\\Windows' } }
  const first = builtinRuntimeEnvironment(options)
  const second = builtinRuntimeEnvironment({ ...options, env: first })
  assert.match(first.NODE_OPTIONS, /^--max-old-space-size=4096 --require=".*中文 空格.*windows-console\.cjs"$/)
  assert.equal(first.NODE_OPTIONS, second.NODE_OPTIONS)
  assert.equal(builtinRuntimeEnvironment({ ...options, platform: 'darwin' }).NODE_OPTIONS, '--max-old-space-size=4096')
})
