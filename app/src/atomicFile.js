'use strict'

const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_RETRY_DELAYS_MS = [25, 75, 150, 300]
const RETRYABLE_WINDOWS_CODES = new Set(['EACCES', 'EBUSY', 'ENOTEMPTY', 'EPERM'])

function defaultSleepSync(delayMs) {
  if (!delayMs) return
  const signal = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(signal, 0, 0, delayMs)
}

function retryWindowsFileOperationSync(operation, {
  platform = process.platform,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  sleepSync = defaultSleepSync,
} = {}) {
  const delays = Array.from(retryDelaysMs || [], value => Math.max(0, Number(value) || 0))
  for (let attempt = 0; ; attempt += 1) {
    try {
      return operation()
    } catch (error) {
      const retryable = platform === 'win32' && RETRYABLE_WINDOWS_CODES.has(String(error?.code || ''))
      if (!retryable || attempt >= delays.length) throw error
      sleepSync(delays[attempt])
    }
  }
}

function fsyncParentDirectoryBestEffort(parent, { fsApi = fs, platform = process.platform } = {}) {
  if (platform === 'win32' || typeof fsApi.fsyncSync !== 'function') return
  let descriptor
  try {
    descriptor = fsApi.openSync(parent, 'r')
    fsApi.fsyncSync(descriptor)
  } catch { /* directory fsync is unavailable on some filesystems */ } finally {
    if (descriptor !== undefined) {
      try { fsApi.closeSync(descriptor) } catch { /* best effort */ }
    }
  }
}

function atomicWriteFileSync(filePath, data, {
  fsApi = fs,
  mode = 0o600,
  platform = process.platform,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  sleepSync = defaultSleepSync,
} = {}) {
  const target = path.resolve(String(filePath || ''))
  const parent = path.dirname(target)
  const temporary = path.join(
    parent,
    `.${path.basename(target)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  )
  fsApi.mkdirSync(parent, { recursive: true })
  try {
    const descriptor = fsApi.openSync(temporary, 'wx', mode)
    try {
      fsApi.writeFileSync(descriptor, data, { encoding: 'utf8' })
      if (typeof fsApi.fsyncSync === 'function') fsApi.fsyncSync(descriptor)
    } finally {
      fsApi.closeSync(descriptor)
    }
    retryWindowsFileOperationSync(() => fsApi.renameSync(temporary, target), {
      platform,
      retryDelaysMs,
      sleepSync,
    })
    try { fsApi.chmodSync(target, mode) } catch { /* Windows uses ACLs, not POSIX modes */ }
    fsyncParentDirectoryBestEffort(parent, { fsApi, platform })
  } catch (error) {
    try {
      retryWindowsFileOperationSync(() => fsApi.unlinkSync(temporary), {
        platform,
        retryDelaysMs,
        sleepSync,
      })
    } catch { /* best effort cleanup */ }
    throw error
  }
  return target
}

function atomicWriteJsonSync(filePath, payload, options = {}) {
  return atomicWriteFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, options)
}

module.exports = {
  atomicWriteFileSync,
  atomicWriteJsonSync,
  retryWindowsFileOperationSync,
}
