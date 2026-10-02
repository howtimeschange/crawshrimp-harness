// Run with Node. Uses isolated Chrome/Electron profiles and a free Vite port.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { spawn } = require('node:child_process'), net = require('node:net')
const assert = require('node:assert/strict')
const ROOT = path.resolve(__dirname, '../../..')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE || '/Users/xingyicheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function freePort() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
function wave() {
  const bytes = Buffer.alloc(44 + 16000 * 10 * 2)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40)
  return 'data:audio/wav;base64,' + bytes.toString('base64')
}
;(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-lifecycle-electron-'))
  const chromeData = path.join(temp, 'chrome')
  fs.mkdirSync(chromeData)
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${chromeData}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1200,900', 'about:blank',
  ], { stdio: 'ignore' })
  let browser, electron, vite
  const results = { checks: {}, errors: [] }
  try {
    let cdpPort = 0
    for (let i = 0; i < 100; i++) {
      try { cdpPort = Number(fs.readFileSync(path.join(chromeData, 'DevToolsActivePort'), 'utf8').split('\n')[0]) } catch {}
      if (cdpPort > 0) break
      await sleep(100)
    }
    assert.ok(cdpPort > 0, 'isolated Chrome must finish publishing its CDP port')
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
    const context = browser.contexts()[0], remote = context.pages()[0]
    await remote.setContent('<!doctype html><style>body{margin:0}button{position:absolute;left:850px;top:550px;width:100px;height:40px}</style><button onclick="window.clicks=(window.clicks||0)+1">TEST</button><input style="position:absolute;left:50px;top:50px"><div style="height:2200px"></div>')
    const cdp = await context.newCDPSession(remote), tid = (await cdp.send('Target.getTargetInfo')).targetInfo.targetId
    const { createServer } = await import(path.join(ROOT, 'app/node_modules/vite/dist/node/index.js'))
    const vue = (await import(path.join(ROOT, 'app/node_modules/@vitejs/plugin-vue/dist/index.mjs'))).default
    const vitePort = await freePort()
    const html = `<!doctype html><style>*{box-sizing:border-box}body{margin:0}.root{position:relative;display:flex;height:100vh;width:100vw}.chat{flex:1} :root{--bg:white;--bg2:#eee;--text:#222;--border:#bbb}</style><div id="app"></div><script type="module">
      import{createApp,h,ref}from'vue';import Resources from'/components/agent/SessionResources.vue';
      window.handlers={frame:[],status:[]};
      window.review.onFrame(p=>{for(const fn of handlers.frame)fn(p)});window.review.onStatus(p=>{for(const fn of handlers.status)fn(p)});
      const markdown='# Acceptance\\n\\n'+('line\\n\\n'.repeat(500));
      const html='<!doctype html><h1>HTML acceptance</h1>'+('<p>Reading position</p>'.repeat(500));
      window.cs={agentApi:async()=>({artifacts:[],tabs:[{id:${JSON.stringify(tid)},url:'about:blank',title:'static'}],activeTabId:${JSON.stringify(tid)}}),
        listAgentBrowserTabs:()=>review.call('tabs'),startAgentBrowserStream:id=>review.call('start',id),stopAgentBrowserStream:id=>review.call('stop',id),
        sendAgentBrowserInput:(id,event)=>review.call('input',id,event),
        agentMediaUrl:async p=>p.endsWith('.wav')?${JSON.stringify(wave())}:'data:'+ (p.endsWith('.html')?'text/html':'text/markdown')+';base64,'+btoa(p.endsWith('.html')?html:markdown),
        onAgentBrowserFrame:fn=>{handlers.frame.push(fn);return()=>handlers.frame.splice(handlers.frame.indexOf(fn),1)},
        onAgentBrowserStatus:fn=>{handlers.status.push(fn);return()=>handlers.status.splice(handlers.status.indexOf(fn),1)}};
      createApp({setup(){const panel=ref(null),sessionId=ref('s1');window.panel=panel;window.sessionId=sessionId;return()=>h('div',{class:'root'},[h('div',{class:'chat'}),h(Resources,{ref:panel,sessionId:sessionId.value,conversationPhase:'active'})])}}).mount('#app');
    </script>`
    vite = await createServer({ configFile: false, root: path.join(ROOT, 'app/src/renderer'), cacheDir: path.join(temp, 'vite-cache'),
      plugins: [vue(), { name: 'acceptance-route', configureServer(server) {
        server.middlewares.use('/acceptance', async (_, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/acceptance', html)) })
      } }], server: { host: '127.0.0.1', port: vitePort, strictPort: true, fs: { allow: [ROOT] } },
      resolve: { alias: { vue: path.join(ROOT, 'app/node_modules/vue/dist/vue.esm-bundler.js') } },
    })
    await vite.listen()
    fs.writeFileSync(path.join(temp, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('review',{
      call:(kind,id,event)=>ipcRenderer.invoke('review:call',kind,id,event),
      onFrame:fn=>ipcRenderer.on('agent:browser:frame',(_,p)=>fn(p)),onStatus:fn=>ipcRenderer.on('agent:browser:status',(_,p)=>fn(p))});`)
    fs.writeFileSync(path.join(temp, 'main.cjs'), `const {app,BrowserWindow,ipcMain}=require('electron');
      app.setPath('userData',${JSON.stringify(path.join(temp, 'electron'))});
      process.env.CRAWSHRIMP_CDP_PORT=${JSON.stringify(String(cdpPort))};
      const api=require(${JSON.stringify(path.join(ROOT, 'app/src/agentBrowser.js'))});
      global.review={api,sent:[],input:[],delay:false};
      ipcMain.handle('review:call',async(e,kind,id,event)=>{
        if(kind==='start')return api.startAgentBrowserStream(e.sender,id);
        if(kind==='stop')return api.stopAgentBrowserStream(id);
        if(kind==='tabs')return api.listAgentBrowserTabs();
        if(kind==='input'){review.input.push(event);const result=await api.dispatchAgentBrowserInput(e.sender,{targetId:id,event});
          if(review.delay&&(event.type==='mousePressed'||event.type==='rawKeyDown'))await new Promise(r=>setTimeout(r,500));return result;}});
      app.whenReady().then(()=>{const win=new BrowserWindow({width:1400,height:928,show:true,webPreferences:{contextIsolation:true,sandbox:true,preload:${JSON.stringify(path.join(temp, 'preload.cjs'))}}});
        const send=win.webContents.send.bind(win.webContents);win.webContents.send=(channel,payload)=>{review.sent.push({channel,targetId:payload.targetId,width:payload.width,height:payload.height,url:payload.url});return send(channel,payload)};
        win.loadURL(${JSON.stringify(`http://127.0.0.1:${vitePort}/acceptance`)});});
      app.on('before-quit',()=>api.stopAgentBrowserStream());app.on('window-all-closed',()=>app.quit());`)
    electron = await _electron.launch({ executablePath: path.join(ROOT, 'app/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [path.join(temp, 'main.cjs')] })
    const viewer = await electron.firstWindow()
    viewer.on('pageerror', error => results.errors.push(String(error)))
    const state = () => electron.evaluate(() => ({ sent: global.review.sent, input: global.review.input, streams: global.review.api.getAgentBrowserState() }))
    const open = item => viewer.evaluate(item => window.panel.value.openResource(item), item)
    const activeImage = () => viewer.locator('.workspace-content:not(.inactive) .browser-frame-img')
    await viewer.waitForSelector('.browser-mini .browser-frame-img'); await sleep(1100)
    const before = (await state()).sent.filter(x => x.channel.endsWith('frame')).length
    await viewer.locator('.mini-expand').click(); await activeImage().waitFor(); await sleep(300)
    results.checks.staticHandoff = { before, after: (await state()).sent.filter(x => x.channel.endsWith('frame')).length,
      images: await activeImage().count(), status: await viewer.locator('.workspace-content:not(.inactive) .browser-status').innerText() }
    assert.equal(results.checks.staticHandoff.images, 1); assert.equal(results.checks.staticHandoff.before, results.checks.staticHandoff.after)
    assert.equal(results.checks.staticHandoff.status, '已连接')
    await remote.evaluate(() => location.hash = 'without-paint'); await sleep(1000)
    results.checks.route = { remote: remote.url(), backend: (await state()).streams.streams[0].url,
      visible: await viewer.locator('.workspace-content:not(.inactive) .browser-window-foot .url').innerText(), frames: (await state()).sent.filter(x => x.channel.endsWith('frame')).length }
    assert.equal(results.checks.route.remote, results.checks.route.visible); assert.equal(results.checks.route.backend, results.checks.route.visible)
    assert.equal(results.checks.route.frames, before)
    await viewer.screenshot({ path: path.join(__dirname, '01-static-route.png') })
    let box = await activeImage().boundingBox()
    const size = await remote.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    await viewer.mouse.click(box.x + 900 / size.width * box.width, box.y + 570 / size.height * box.height); await sleep(200)
    assert.equal(await remote.evaluate(() => window.clicks), 1)
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.5 })
    await remote.evaluate(() => { document.querySelector('button').style.left = '400px'; document.querySelector('button').style.top = '300px' })
    await sleep(500); box = await activeImage().boundingBox()
    const meta = (await state()).sent.filter(x => x.channel.endsWith('frame')).at(-1)
    await viewer.mouse.click(box.x + 450 / meta.width * box.width, box.y + 320 / meta.height * box.height); await sleep(200)
    assert.equal(await remote.evaluate(() => window.clicks), 2)
    results.checks.clicks = { normal: 1, afterScale15: 2 }
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }); await sleep(300)
    await remote.evaluate(() => { window.mouseEvents = []; document.addEventListener('mousedown', e => mouseEvents.push(e.type)); document.addEventListener('mouseup', e => mouseEvents.push(e.type)) })
    await electron.evaluate(() => { global.review.delay = true; global.review.input = [] })
    box = await activeImage().boundingBox()
    await viewer.mouse.click(box.x + 100 / size.width * box.width, box.y + 150 / size.height * box.height)
    await remote.waitForFunction(() => window.mouseEvents.includes('mousedown'))
    await viewer.evaluate(() => document.querySelector('[title="返回会话资源列表"]').click()); await sleep(800)
    results.checks.release = { input: (await state()).input, remote: await remote.evaluate(() => window.mouseEvents), active: (await state()).streams.active }
    assert.deepEqual(results.checks.release.remote, ['mousedown', 'mouseup']); assert.equal(results.checks.release.active, true)
    assert.ok(results.checks.release.input.some(e => e.kind === 'release'))
    await viewer.locator('.mini-expand').click(); await activeImage().waitFor()
    await remote.evaluate(() => { window.keyEvents = []; document.addEventListener('keydown', e => keyEvents.push(e.type)); document.addEventListener('keyup', e => keyEvents.push(e.type)) })
    box = await activeImage().boundingBox()
    await viewer.mouse.click(box.x + 60 / size.width * box.width, box.y + 60 / size.height * box.height); await sleep(550)
    await viewer.keyboard.down('Shift'); await viewer.keyboard.up('Shift')
    await remote.waitForFunction(() => window.keyEvents.includes('keydown'))
    await viewer.evaluate(() => document.querySelector('[title="返回会话资源列表"]').click()); await sleep(800)
    results.checks.keyRelease = await remote.evaluate(() => window.keyEvents)
    assert.deepEqual(results.checks.keyRelease, ['keydown', 'keyup'])
    await electron.evaluate(() => { global.review.delay = false })
    for (const ext of ['md', 'html']) {
      await open({ kind: 'artifact', path: `/acceptance.${ext}`, filename: `acceptance.${ext}` })
      const body = viewer.frameLocator('.workspace-content:not(.inactive) iframe').locator('body')
      await body.waitFor(); await body.evaluate(() => window.scrollTo(0, 500))
      const scrollBefore = await body.evaluate(() => scrollY), chatBefore = await viewer.locator('.chat').evaluate(e => e.clientWidth)
      await viewer.evaluate(() => window.panel.value.collapse()); await sleep(100)
      const collapsed = await viewer.locator('.session-resources').evaluate(e => ({ inert: e.inert, hidden: getComputedStyle(e).visibility, height: e.clientHeight }))
      const chatAfter = await viewer.locator('.chat').evaluate(e => e.clientWidth)
      await viewer.locator('.session-panel-toggle').click(); await sleep(100)
      const scrollAfter = await body.evaluate(() => scrollY)
      results.checks[`scroll-${ext}`] = { scrollBefore, scrollAfter, chatBefore, chatAfter, collapsed }
      assert.equal(scrollBefore, 500); assert.equal(scrollAfter, 500); assert.ok(chatAfter > chatBefore); assert.equal(collapsed.inert, true)
    }
    await viewer.screenshot({ path: path.join(__dirname, '02-restored-reading.png') })
    await open({ kind: 'artifact', path: '/acceptance.wav', filename: 'acceptance.wav' }); await viewer.waitForSelector('audio')
    await viewer.locator('audio').evaluate(async a => { a.muted = true; a.currentTime = 1; await a.play() }); await sleep(250)
    const audioTime = await viewer.locator('audio').evaluate(a => a.currentTime)
    await open({ kind: 'artifact', path: '/acceptance.md', filename: 'acceptance.md' }); await sleep(300)
    const pausedTime = await viewer.locator('audio').evaluate(a => ({ paused: a.paused, time: a.currentTime }))
    await open({ kind: 'artifact', path: '/acceptance.wav', filename: 'acceptance.wav' }); await sleep(200)
    const restored = await viewer.locator('audio').evaluate(a => ({ paused: a.paused, time: a.currentTime }))
    results.checks.audio = { audioTime, pausedTime, restored }
    assert.equal(pausedTime.paused, true); assert.equal(restored.paused, true); assert.equal(pausedTime.time, restored.time); assert.ok(pausedTime.time >= audioTime)
    await viewer.locator('audio').evaluate(a => a.play()); await viewer.evaluate(() => window.sessionId.value = 's2'); await sleep(200)
    assert.equal(await viewer.locator('audio').evaluate(a => a.paused), true)
    await viewer.evaluate(() => window.sessionId.value = 's1'); await sleep(200)
    // A video element uses the same media lifecycle; feed a local canvas recording.
    const videoUrl = await viewer.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffaa66'; ctx.fillRect(0, 0, 160, 90)
      const stream = canvas.captureStream(10), recorder = new MediaRecorder(stream, { mimeType: 'video/webm' }), chunks = []
      const stopped = new Promise(resolve => { recorder.ondataavailable = e => chunks.push(e.data); recorder.onstop = resolve })
      recorder.start(); const timer = setInterval(() => { ctx.fillStyle = '#aaff66'; ctx.fillRect(0, 0, 160, 90) }, 50)
      await new Promise(r => setTimeout(r, 700)); recorder.stop(); await stopped; clearInterval(timer); stream.getTracks().forEach(t => t.stop())
      return URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }))
    })
    await viewer.evaluate(url => { const old = window.cs.agentMediaUrl; window.cs.agentMediaUrl = p => p.endsWith('.webm') ? Promise.resolve(url) : old(p) }, videoUrl)
    await open({ kind: 'artifact', path: '/acceptance.webm', filename: 'acceptance.webm' }); await viewer.waitForSelector('video')
    await viewer.locator('video').evaluate(async v => { v.muted = true; v.loop = true; await v.play() }); await sleep(100)
    await viewer.evaluate(() => window.panel.value.collapse()); await sleep(200)
    results.checks.video = await viewer.locator('video').evaluate(v => ({ paused: v.paused, time: v.currentTime }))
    assert.equal(results.checks.video.paused, true)
    await viewer.locator('.session-panel-toggle').click()
    await open({ kind: 'browser', id: tid }); await activeImage().waitFor()
    await viewer.locator('[aria-label="脱离为浮窗"]').click(); await viewer.waitForSelector('.agent-browser-window:not(.docked) .browser-frame-img')
    await viewer.screenshot({ path: path.join(__dirname, '03-floating-browser.png') })
    assert.equal(await viewer.locator('.agent-browser-window:not(.docked)').isVisible(), true)
    await viewer.evaluate(() => window.panel.value.collapse()); await sleep(150)
    assert.equal(await viewer.locator('.agent-browser-window:not(.docked)').isVisible(), false)
    await viewer.locator('.session-panel-toggle').click(); await sleep(150)
    assert.equal(await viewer.locator('.agent-browser-window:not(.docked)').isVisible(), true)
    results.checks.floating = { restored: true, hiddenOnCollapse: true }
    await electron.evaluate(() => {
      global.review.api.stopAgentBrowserStream()
      const OriginalWS = global.WebSocket
      global.review.originalWS = OriginalWS; global.review.screenshots = 0
      global.WebSocket = class extends OriginalWS { send(raw) {
        const command = JSON.parse(raw)
        if (command.method === 'Page.startScreencast') { setTimeout(() => this.onmessage?.({ data: JSON.stringify({ id: command.id, error: { message: 'unsupported for acceptance' } }) }), 0); return }
        if (command.method === 'Page.captureScreenshot') global.review.screenshots++
        super.send(raw)
      } }
    })
    await viewer.locator('.agent-browser-window:not(.docked) [aria-label="刷新画面"]').click(); await sleep(1800)
    results.checks.fallback = await electron.evaluate(() => ({ screenshots: global.review.screenshots, active: global.review.api.getAgentBrowserState().active }))
    assert.ok(results.checks.fallback.screenshots >= 2); assert.equal(results.checks.fallback.active, true)
    await electron.evaluate(() => { global.WebSocket = global.review.originalWS })
    assert.deepEqual(results.errors, [])
    results.environment = { electron: await electron.evaluate(({ app }) => app.getVersion()), cdpPort, vitePort, temp }
    results.passed = true
  } catch (error) {
    results.passed = false; results.failure = error.stack; throw error
  } finally {
    fs.writeFileSync(path.join(__dirname, 'electron-results.json'), JSON.stringify(results, null, 2) + '\n')
    await electron?.close(); await vite?.close(); await browser?.close(); chrome.kill('SIGTERM')
    console.log(JSON.stringify(results, null, 2))
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
