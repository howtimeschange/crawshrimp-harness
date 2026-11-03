'use strict'
// No real account, prompt or inference endpoint. All destinations are loopback.
const http = require('node:http')
const net = require('node:net')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const nativeInstalled = process.argv.includes('--native-installed')
const installedAsar = '/Applications/抓虾 Harness.app/Contents/Resources/app.asar'
const { createManagedFetch } = require(nativeInstalled ? installedAsar + '/src/managedFetch' : '../src/managedFetch')
const { createManagedAccount: candidate } = require('../src/managedAccount')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const runtimeVersion = { node: process.versions.node, electron: process.versions.electron || null, undici: require(nativeInstalled ? installedAsar + '/node_modules/undici/package.json' : 'undici/package.json').version }
const listen = async server => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port }
function installedBroker() {
  const Module = require('node:module')
  const source = require('@electron/asar').extractFile('/Applications/抓虾 Harness.app/Contents/Resources/app.asar', 'src/managedAccount.js').toString()
  const filename = path.resolve(__dirname, '../src/managedAccount-installed-fixture.cjs')
  const mod = new Module(filename, module)
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(source, filename)
  return mod.exports.createManagedAccount
}
async function scenario(mode, { systemProxy = false, delayMs = 200, createAccount = candidate } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-transport-'))
  const started = performance.now(), sockets = new Set(), tunnels = new Set()
  const result = { scenario: mode, systemProxy, requestBytes: 0, expectedBytes: 0, dispatches: 0, accepted: 0, completed: false, uploadAborted: false, transportCode: null }
  let account, managedFetch, cut = false
  const killTunnel = () => { cut = true; for (const socket of tunnels) socket.destroy() }
  const api = http.createServer((req, res) => {
    if (req.url === '/account/me') { res.end(JSON.stringify({ user: { id: 'fixture' }, plan: 'pro' })); return }
    if (req.url === '/account/models') { res.end(JSON.stringify({ models: [{ id: 'gemini-fixture', kind: 'text', available: true }] })); return }
    if (!req.url.startsWith('/account/inference/')) { res.writeHead(404).end(); return }
    result.dispatches++; result.expectedBytes = Number(req.headers['content-length'])
    req.on('data', chunk => { result.requestBytes += chunk.length })
    req.on('aborted', () => { result.uploadAborted = true })
    req.on('error', () => {})
    req.on('end', async () => {
      result.accepted++
      if (mode === 'reset-before-headers') setTimeout(killTunnel, 40)
      await sleep(delayMs)
      result.completed = true
      if (!res.destroyed) res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ fixture: true }))
    })
  })
  const proxy = http.createServer()
  proxy.on('connect', (req, client, head) => {
    const [host, port] = req.url.split(':')
    assert.equal(host, '127.0.0.1')
    const upstream = net.connect(Number(port), host, () => {
      tunnels.add(client); tunnels.add(upstream)
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      client.on('data', chunk => {
        if (mode === 'reset-during-upload' && !cut && chunk.includes(Buffer.from('POST /account/inference/'))) {
          const delimiter = chunk.indexOf('\r\n\r\n')
          upstream.write(chunk.subarray(0, delimiter + 4 + 1024))
          client.pause(); setTimeout(killTunnel, 40)
        } else upstream.write(chunk)
      })
      upstream.pipe(client)
    })
    for (const socket of [client, upstream]) {
      socket.on('error', () => {}); socket.on('close', () => { tunnels.delete(socket); client.destroy(); upstream.destroy() })
    }
  })
  api.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  try {
    const apiPort = await listen(api), proxyPort = await listen(proxy)
    const route = mode === 'healthy-direct' ? 'DIRECT' : `PROXY 127.0.0.1:${systemProxy ? 7897 : proxyPort}`
    managedFetch = createManagedFetch({ resolveProxy: async () => route })
    fs.writeFileSync(path.join(dir, 'modeljetty-session.enc'), JSON.stringify({ session: JSON.stringify({ access_token: 'fixture-only', expiresAt: Date.now() + 3600000 }) }))
    account = createAccount({ issuer: `http://127.0.0.1:${apiPort}/oidc`, development: true, directory: dir, runtimeDirectory: () => dir,
      safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() }, openExternal: async () => {},
      fetcher: async (...args) => { try { return await managedFetch(...args) } catch (error) { result.transportCode = error.cause?.code || error.code || error.name; throw error } } })
    await account.run('status')
    const runtime = JSON.parse(fs.readFileSync(path.join(dir, 'managed-model-session.json')))
    const body = JSON.stringify({ model: 'managed-gemini-fixture', stream: false, messages: [{ role: 'user', content: 'x'.repeat(5543000) }] })
    const response = await fetch(runtime.baseURL + '/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + runtime.brokerToken, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(delayMs + 15000) })
    result.clientStatus = response.status
    const payload = await response.json()
    result.unknown = /结果未知/.test(payload.error?.message || '')
    if (mode.startsWith('reset-')) {
      assert.equal(response.status, 409); assert.equal(result.unknown, true)
      await sleep(delayMs + 50)
      if (mode === 'reset-before-headers') { assert.equal(result.accepted, 1); assert.equal(result.completed, true) }
      else { assert.equal(result.accepted, 0); assert.equal(result.uploadAborted, true); assert.ok(result.requestBytes < result.expectedBytes) }
      assert.equal(result.dispatches, 1)
    } else { assert.equal(response.status, 200); assert.equal(payload.fixture, true); assert.equal(result.dispatches, 1) }
    result.elapsedMs = Math.round(performance.now() - started)
    return result
  } finally {
    account?.dispose(); killTunnel(); for (const socket of sockets) socket.destroy()
    api.closeAllConnections(); api.close(); proxy.close()
    await managedFetch?.close(); fs.rmSync(dir, { recursive: true, force: true })
  }
}
;(async () => {
  const createAccount = nativeInstalled ? require(installedAsar + '/src/managedAccount').createManagedAccount : process.argv.includes('--installed') ? installedBroker() : candidate
  if (process.argv.includes('--live-local-proxy')) {
    const results = await Promise.all(['healthy-direct', 'healthy-proxy'].map(mode => scenario(mode, { createAccount, systemProxy: mode === 'healthy-proxy', delayMs: 90000 })))
    console.log(JSON.stringify({ runtime: runtimeVersion, broker: nativeInstalled ? 'native-installed' : process.argv.includes('--installed') ? 'installed-source-local-deps' : 'candidate', results, paidCalls: 0 }))
  } else {
    const results = []
    for (const mode of ['healthy-direct', 'healthy-proxy', 'reset-before-headers', 'reset-during-upload']) results.push(await scenario(mode, { createAccount }))
    console.log(JSON.stringify({ runtime: runtimeVersion, broker: nativeInstalled ? 'native-installed' : process.argv.includes('--installed') ? 'installed-source-local-deps' : 'candidate', results, paidCalls: 0 }))
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
