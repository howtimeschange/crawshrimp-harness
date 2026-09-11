'use strict'

// Run with: env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/dsh-web-auth-electron-smoke.cjs
// Exercise Chromium's real file:// iframe cookie policy, including fetch and WS.
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createHash } = require('node:crypto')
const { createDshWebAuthBridge } = require('../src/dshWebAuthBridge')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-auth-electron-'))
app.setPath('userData', path.join(dir, 'user-data'))
const cookie = 'dsh-auth-smoke=signed-test-credential'
let win, bridge, server
const events = []
const waitFor = predicate => new Promise((resolve, reject) => {
  const deadline = Date.now() + 15000
  const timer = setInterval(() => {
    if (predicate()) { clearInterval(timer); resolve() }
    else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('Timed out: ' + JSON.stringify(events))) }
  }, 25)
})

app.whenReady().then(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.searchParams.get('token') === 'launch') {
      res.writeHead(303, { location: '/', 'set-cookie': cookie + '; Max-Age=120; Path=/; HttpOnly; SameSite=Strict' }).end()
      return
    }
    const authenticated = req.headers.cookie?.includes(cookie) === true
    events.push({ path: url.pathname, authenticated })
    if (!authenticated) { res.writeHead(401).end('dsh web authentication required'); return }
    if (url.pathname === '/api/probe') {
      assert.notEqual(req.headers['sec-fetch-site'], 'cross-site')
      if (req.headers.origin) assert.equal(req.headers.origin, `http://${req.headers.host}`)
      res.end('{}'); return
    }
    res.setHeader('content-type', 'text/html')
    res.end('<script>fetch("/api/probe");new WebSocket(location.origin.replace("http:","ws:")+"/events")</script>Authenticated DSH fixture')
  })
  server.on('upgrade', (req, socket, head) => {
    assert.notEqual(req.headers['sec-fetch-site'], 'cross-site')
    assert.equal(req.headers.origin, `http://${req.headers.host}`)
    const authenticated = req.headers.cookie?.includes(cookie) === true
    events.push({ path: '/events', authenticated })
    if (!authenticated) { socket.destroy(); return }
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const launchUrl = origin + '/?token=launch'
  const shellPath = path.join(dir, 'index.html')
  const writeShell = url => fs.writeFileSync(shellPath, `<iframe src="${url}"></iframe>`)
  win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } })

  writeShell(launchUrl)
  await win.loadFile(shellPath)
  await waitFor(() => events.some(event => event.path === '/' && !event.authenticated))
  console.log('PASS: unpatched file:// iframe reproduces 401 after token redirect')

  bridge = createDshWebAuthBridge({
    session: win.webContents.session,
    getWebContents: () => win.webContents,
    isTrustedRendererUrl: url => url === pathToFileURL(shellPath).href,
  })
  const snapshot = await bridge.prepare({ state: 'ready', web_launch_url: launchUrl })
  assert.equal(snapshot.web_launch_url, origin + '/')
  events.length = 0
  writeShell(snapshot.web_launch_url)
  await win.loadFile(shellPath)
  await waitFor(() => ['/api/probe', '/events'].every(p => events.some(event => event.path === p && event.authenticated)))
  assert.ok(events.every(event => event.authenticated))
  console.log('PASS: patched file:// iframe, fetch and websocket authenticate with Strict cookie unchanged')

  bridge.dispose()
  bridge = null
  events.length = 0
  await win.loadFile(shellPath)
  await waitFor(() => events.some(event => event.path === '/' && !event.authenticated))
  console.log('PASS: disposing the bridge removes embedded authentication')
}).catch(error => {
  console.error(error)
  process.exitCode = 1
}).finally(() => {
  bridge?.dispose()
  win?.destroy()
  server?.close()
  app.quit()
})
