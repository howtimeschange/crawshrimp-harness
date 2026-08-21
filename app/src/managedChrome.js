'use strict'

const fs = require('fs')
const path = require('path')

const { retryWindowsFileOperationSync } = require('./atomicFile')

function normalizePathForIdentity(rawPath = '') {
  const resolved = path.resolve(String(rawPath || ''))
  try {
    return fs.realpathSync.native(resolved).replace(/\\/g, '/').toLowerCase()
  } catch {
    return resolved.replace(/\\/g, '/').toLowerCase()
  }
}

function sameRuntimePath(left = '', right = '') {
  if (!left || !right) return false
  return normalizePathForIdentity(left) === normalizePathForIdentity(right)
}

function readManagedChromeState(stateFile) {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8') || '{}')
  } catch {
    return null
  }
}

function removeManagedChromeStateFile(stateFile, {
  fsApi = fs,
  platform = process.platform,
  retryDelaysMs,
  sleepSync,
} = {}) {
  try {
    retryWindowsFileOperationSync(() => fsApi.unlinkSync(stateFile), {
      platform,
      retryDelaysMs,
      sleepSync,
    })
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return true
    return false
  }
}

async function stopManagedChrome(options = {}) {
  const stateFile = options.stateFile
  const expectedProfileDir = options.expectedProfileDir
  const expectedCdpPort = Number(options.expectedCdpPort || 0)
  const isPidAlive = options.isPidAlive || (() => false)
  const isManagedPid = options.isManagedPid || (() => true)
  const killPid = options.killPid || (() => false)
  const waitForPidExit = options.waitForPidExit || (async () => true)
  const log = options.log || (() => {})

  if (!stateFile || !expectedProfileDir || !expectedCdpPort) {
    return { stopped: false, reason: 'missing-options' }
  }

  const state = readManagedChromeState(stateFile)
  if (!state) return { stopped: false, reason: 'missing-state' }

  const pid = Number(state.pid || 0)
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return { stopped: false, reason: 'invalid-pid' }
  }
  if (Number(state.cdpPort || 0) !== expectedCdpPort) {
    return { stopped: false, reason: 'port-mismatch' }
  }
  if (!sameRuntimePath(String(state.profileDir || ''), expectedProfileDir)) {
    return { stopped: false, reason: 'profile-mismatch' }
  }
  if (!isPidAlive(pid)) {
    removeManagedChromeStateFile(stateFile, options)
    return { stopped: false, reason: 'already-exited' }
  }
  if (!isManagedPid(pid, state)) {
    return { stopped: false, reason: 'pid-identity-mismatch' }
  }

  log(`[chrome] stopping managed Chrome pid=${pid}`)
  const signaled = killPid(pid)
  if (!signaled) return { stopped: false, reason: 'kill-failed' }
  const exited = await waitForPidExit(pid)
  if (!exited) return { stopped: false, reason: 'exit-timeout' }
  removeManagedChromeStateFile(stateFile, options)
  return { stopped: true, pid }
}

module.exports = {
  readManagedChromeState,
  removeManagedChromeStateFile,
  sameRuntimePath,
  stopManagedChrome,
}
