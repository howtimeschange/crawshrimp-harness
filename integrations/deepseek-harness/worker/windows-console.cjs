'use strict'

// Electron is a GUI executable even in RUN_AS_NODE mode. Windows restricted
// token children cannot create their own console (STATUS_DLL_INIT_FAILED).
// Give the unrestricted runner a hidden console before it confines the child;
// neither the token's restrictions nor the workspace ACLs are changed.
function ensureWindowsConsole({ platform = process.platform, load = () => require('koffi') } = {}) {
  if (platform !== 'win32') return { allocated: false }
  const ffi = load()
  const kernel = ffi.load('kernel32.dll')
  const getProcesses = kernel.func('uint32 __stdcall GetConsoleProcessList(_Out_ uint32 *processes, uint32 count)')
  // A console can exist without a window. A count larger than this one-entry
  // buffer also confirms attachment; the process IDs themselves are unused.
  const hasConsole = () => getProcesses([0], 1) > 0
  if (hasConsole()) return { allocated: false }
  const getWindow = kernel.func('void * __stdcall GetConsoleWindow()')
  const getHandle = kernel.func('void * __stdcall GetStdHandle(uint32)')
  const setHandle = kernel.func('int __stdcall SetStdHandle(uint32, void *)')
  const attach = kernel.func('int __stdcall AttachConsole(uint32)')
  const allocate = kernel.func('int __stdcall AllocConsole()')
  const lastError = kernel.func('uint32 __stdcall GetLastError()')
  const handles = [-10, -11, -12].map(id => [id >>> 0, getHandle(id >>> 0)])
  let allocated = false
  let initializationError
  try {
    if (!attach(0xffffffff)) {
      const attachError = lastError()
      // Another initializer may have attached this process since the probe.
      if (hasConsole()) return { allocated: false }
      if (!allocate()) {
        const allocationError = lastError()
        if (hasConsole()) return { allocated: false }
        throw new Error(`Windows console initialization failed (${allocationError}), AttachConsole failed (${attachError})`)
      }
      allocated = true
      const window = getWindow()
      if (window) ffi.load('user32.dll').func('int __stdcall ShowWindow(void *, int)')(window, 0)
    }
  } catch (error) {
    initializationError = error
    throw error
  } finally {
    // AllocConsole/AttachConsole replace standard handles. Keep the existing
    // JSON-RPC and shell pipes intact, including NUL used for ignored stdin.
    let restorationError
    for (const [id, handle] of handles) {
      if (!setHandle(id, handle)) {
        const code = lastError()
        restorationError ??= new Error(`Windows standard handle restoration failed (${code})`)
      }
    }
    if (restorationError) {
      if (initializationError) {
        throw new AggregateError([initializationError, restorationError], `${initializationError.message}, ${restorationError.message}`)
      }
      throw restorationError
    }
  }
  return { allocated }
}

// NODE_OPTIONS preloads also run in worker_threads. Console attachment and
// standard handles belong to the process and are initialized by its main thread.
if (process.platform === 'win32' && process.versions.electron && process.env.ELECTRON_RUN_AS_NODE
    && require('node:worker_threads').isMainThread) {
  ensureWindowsConsole()
}
module.exports = { ensureWindowsConsole }
