'use strict'

// Electron is a GUI executable even in RUN_AS_NODE mode. Windows restricted
// token children cannot create their own console (STATUS_DLL_INIT_FAILED).
// Give the unrestricted runner a hidden console before it confines the child;
// neither the token's restrictions nor the workspace ACLs are changed.
function ensureWindowsConsole({ platform = process.platform, load = () => require('koffi') } = {}) {
  if (platform !== 'win32') return { allocated: false }
  const ffi = load()
  const kernel = ffi.load('kernel32.dll')
  const getWindow = kernel.func('void * __stdcall GetConsoleWindow()')
  if (getWindow()) return { allocated: false }
  const getHandle = kernel.func('void * __stdcall GetStdHandle(uint32)')
  const setHandle = kernel.func('int __stdcall SetStdHandle(uint32, void *)')
  const attach = kernel.func('int __stdcall AttachConsole(uint32)')
  const allocate = kernel.func('int __stdcall AllocConsole()')
  const lastError = kernel.func('uint32 __stdcall GetLastError()')
  const handles = [-10, -11, -12].map(id => [id >>> 0, getHandle(id >>> 0)])
  let allocated = false
  try {
    if (!attach(0xffffffff)) {
      if (!allocate()) throw new Error(`Windows console initialization failed (${lastError()})`)
      allocated = true
      ffi.load('user32.dll').func('int __stdcall ShowWindow(void *, int)')(getWindow(), 0)
    }
  } finally {
    // AllocConsole/AttachConsole replace standard handles. Keep the existing
    // JSON-RPC and shell pipes intact, including NUL used for ignored stdin.
    for (const [id, handle] of handles) {
      if (!setHandle(id, handle)) throw new Error(`Windows standard handle restoration failed (${lastError()})`)
    }
  }
  return { allocated }
}

if (process.platform === 'win32' && process.versions.electron && process.env.ELECTRON_RUN_AS_NODE) {
  ensureWindowsConsole()
}
module.exports = { ensureWindowsConsole }
