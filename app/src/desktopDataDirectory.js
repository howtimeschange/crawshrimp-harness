'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads')
const { assertNoLinkComponentsSync } = require('./pathIdentity')
const { assertSafeWindowsDataRootSync, hardenWindowsPathsSync } = require('./windowsAcl')
const { atomicWriteFileSync } = require('./atomicFile')

function prepareDesktopDataDirectory({ candidates, homeDir, platform = process.platform, env = process.env }) {
  const errors = [], seen = new Set()
  for (const candidate of candidates) {
    const root = path.resolve(candidate)
    const identity = platform === 'win32' ? root.toLowerCase() : root
    if (seen.has(identity)) continue
    seen.add(identity)
    try {
      assertSafeWindowsDataRootSync(root, { homeDir, platform, env })
      if (platform === 'win32') assertNoLinkComponentsSync(root, { allowMissing: true })
      const dirs = [root, ...['adapters', 'adapter-meta', 'data', 'logs'].map(name => path.join(root, name))]
      for (const dir of dirs) {
        if (platform === 'win32') assertNoLinkComponentsSync(dir, { allowMissing: true })
        fs.mkdirSync(dir, { recursive: true })
        if (platform === 'win32') assertNoLinkComponentsSync(dir)
      }
      const tokenPath = path.join(root, 'api-token')
      if (fs.existsSync(tokenPath)) {
        if (platform === 'win32') assertNoLinkComponentsSync(tokenPath)
        else if (fs.lstatSync(tokenPath).isSymbolicLink()) throw new Error('API token cannot be a symbolic link')
      }
      // Protect parents before writing any secret; never cache ACLs by path alone.
      hardenWindowsPathsSync([...dirs, ...(fs.existsSync(tokenPath) ? [tokenPath] : [])], { platform })
      for (const dir of dirs) {
        const probe = path.join(dir, `.write-test-${crypto.randomUUID()}`)
        fs.writeFileSync(probe, 'ok', { flag: 'wx', mode: 0o600 }); fs.unlinkSync(probe)
      }
      let token = env.CRAWSHRIMP_API_TOKEN || (fs.existsSync(tokenPath) ? fs.readFileSync(tokenPath, 'utf8').trim() : '')
      if (!token) {
        token = crypto.randomBytes(32).toString('hex')
        atomicWriteFileSync(tokenPath, token)
        hardenWindowsPathsSync([tokenPath], { platform })
      }
      return { root: fs.realpathSync.native(root), token, errors }
    } catch (error) { errors.push(`${root}: ${error.message}`) }
  }
  throw new Error(`No writable CRAWSHRIMP_DATA directory. ${errors.join(' | ')}`)
}
function prepareDesktopDataDirectoryAsync(options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: options })
    worker.once('message', message => message.error ? reject(new Error(message.error)) : resolve(message))
    worker.once('error', reject)
    worker.once('exit', code => { if (code !== 0) reject(new Error(`Data-directory worker exited ${code}`)) })
  })
}
if (!isMainThread) {
  try { parentPort.postMessage(prepareDesktopDataDirectory(workerData)) }
  catch (error) { parentPort.postMessage({ error: error.message }) }
}
module.exports = { prepareDesktopDataDirectory, prepareDesktopDataDirectoryAsync }
