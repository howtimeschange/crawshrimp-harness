'use strict'
// Simulated redemption authority; real broker, Python provider adapter and Vue views.
// The DSH restart endpoint is a fixture; this does not run a real model or redeem a voucher.
const { app, BrowserWindow, ipcMain, session } = require('electron')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')
const { createManagedAccount } = require('../src/managedAccount')
const { createManagedCatalogRefresh } = require('../src/managedCatalogRefresh')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'redeem-model-smoke-'))
app.setPath('userData', path.join(directory, 'electron'))
app.whenReady().then(async () => {
  let account, watcher, server, win, exitCode = 0, poll
  let paid = false, offline = false, activeRun = false, restartCount = 0, configModels = [], inferencePosts = 0
  const runtimeEpoch = 'redemption-fixture-epoch'
  const pythonBin = process.env.CRAWSHRIMP_TEST_PYTHON || path.resolve(__dirname, '../../venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  const providerSettings = () => JSON.parse(execFileSync(pythonBin, ['-c', `
import json,sys
from pathlib import Path
from core import managed_models
managed_models.runtime_paths.data_root=lambda:Path(sys.argv[1])
def public(rows):
 return [{k:v for k,v in row.items() if k not in {'api_key','base_url'}}|{'configured':True} for row in rows]
print(json.dumps({'managed_text_providers':public(managed_models.text_providers()),'managed_image_providers':public(managed_models.image_providers())}))
`, directory], { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, CRAWSHRIMP_DATA: directory, CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH: runtimeEpoch }, encoding: 'utf8' }))
  const waitFor = async predicate => {
    const deadline = Date.now() + 15000
    while (!await predicate()) { if (Date.now() > deadline) throw Error('Timed out waiting for redemption readback'); await new Promise(resolve => setTimeout(resolve, 30)) }
  }
  try {
    fs.writeFileSync(path.join(directory, 'modeljetty-session.enc'), JSON.stringify({ session: JSON.stringify({ access_token: 'fixture-only', expiresAt: Date.now() + 3600000 }) }))
    account = createManagedAccount({ issuer: 'https://fixture.invalid', directory, runtimeDirectory: () => directory, runtimeEpoch,
      safeStorage: { isEncryptionAvailable: () => true, encryptString: v => Buffer.from(v), decryptString: v => v.toString() }, openExternal: async () => {},
      notify: () => { if (win && !win.isDestroyed()) win.webContents.send('fixture:account-changed') },
      fetcher: async (url, options) => {
        if (options.method !== 'GET') { inferencePosts++; throw Error('POST forbidden') }
        if (new URL(url).pathname === '/account/me') return Response.json({ user: { id: 'same-free-user', email: 'fixture@example.invalid' }, plan: 'free', paidModelAccess: false })
        if (offline) throw Error('fixture offline')
        return Response.json({ plan: 'free', paidModelAccess: paid, models: [
          { id: 'gemini-3.8-flash', name: 'Gemini', kind: 'text', protocol: 'openai', available: true },
          { id: 'gemini-3.1-flash-image-preview', name: 'Nano Banana', kind: 'image', protocol: 'gemini', available: true },
          ...['gpt-6.1-sol', 'deepseek-flash', 'gpt-image-2'].map(id => ({ id, name: id, kind: id.includes('image') ? 'image' : 'text', protocol: id.startsWith('gpt-6') ? 'openai-responses' : 'openai', available: paid })),
        ] })
      } })
    const initial = await account.run('status')
    watcher = createManagedCatalogRefresh({ refresh: () => account.run('refresh-models'), isActive: () => true,
      timers: { setInterval(fn) { poll = fn; return 1 }, clearInterval() {} } })
    ipcMain.handle('fixture:account', (_event, action) => { assert.ok(['status', 'refresh-models'].includes(action)); return account.run(action) })
    ipcMain.handle('fixture:settings', () => providerSettings())
    ipcMain.handle('fixture:agent', (_event, method, route) => {
      if (method === 'POST' && route === '/agent/runtime/restart') {
        if (activeRun) return { ok: false, error: 'ACTIVE_RUN' }
        restartCount++
        configModels = providerSettings().managed_text_providers.flatMap(p => p.models.map(m => m.id))
        return { ok: true }
      }
      return { state: 'ready', api_key_configured: true, active_run: activeRun ? 'fixture-running-task' : null, generation: restartCount, items: [], artifacts: [], pages: [] }
    })
    const preload = path.join(directory, 'preload.cjs')
    fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('cs',{
      accountAction:a=>ipcRenderer.invoke('fixture:account',a),getSettings:()=>ipcRenderer.invoke('fixture:settings'),
      agentApi:(m,p)=>ipcRenderer.invoke('fixture:agent',m,p),onAccountChanged:fn=>{const f=()=>fn();ipcRenderer.on('fixture:account-changed',f);return()=>ipcRenderer.removeListener('fixture:account-changed',f)},
      listAiImageJobs:async()=>[],imageCallHistory:async()=>({}),analyticsPreferences:async()=>({enabled:false}),analyticsSummary:async()=>({}),readLocalImagePreview:async()=>({})
    })`)
    const { createServer } = await import('vite'), vue = (await import('@vitejs/plugin-vue')).default
    const source = `import {createApp} from 'vue';
      import Agent from '/src/renderer/views/AgentWebView.vue';import Images from '/src/renderer/views/AiImageWorkbench.vue';
      import {connectAiImageProviderUpdates} from '/src/renderer/utils/aiImageModels.js';
      window.stopCatalog=connectAiImageProviderUpdates(window.cs);
      window.agentState=createApp(Agent).mount('#agent').$.setupState;
      window.imageState=createApp(Images).mount('#images').$.setupState;window.ready=true;`
    server = await createServer({ root: path.resolve(__dirname, '..'), configFile: false, plugins: [vue(), { name: 'redeem-fixture', resolveId: id => id === '__redeem_fixture' ? id : null, load: id => id === '__redeem_fixture' ? source : null }], cacheDir: path.join(directory, 'vite'), optimizeDeps: { noDiscovery: true, include: [] }, server: { host: '127.0.0.1', port: 5281 }, appType: 'custom' })
    server.middlewares.use('/__redeem', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<div id="agent"></div><div id="images"></div><script type="module" src="/@id/__redeem_fixture"></script>') })
    await server.listen()
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.replace(/^ws:/, 'http:').startsWith(origin + '/') }))
    win = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, sandbox: true } })
    await win.loadURL(origin + '/__redeem')
    const run = code => win.webContents.executeJavaScript(code)
    await waitFor(async () => await run('Boolean(window.ready && imageState.providersReady)') && restartCount === 1)
    assert.deepEqual(configModels, ['managed-gemini-3.8-flash'])
    const imageOptions = () => run('Array.from(document.querySelectorAll("#images .aiw-task-fields select option")).map(x=>x.value)')
    assert.equal((await imageOptions()).includes('custom-managed-openai/gpt-image-2'), false)
    paid = true; await watcher.focus()
    await waitFor(async () => restartCount === 2 && (await imageOptions()).includes('custom-managed-openai/gpt-image-2'))
    assert.ok(configModels.includes('managed-gpt-6.1-sol')); assert.ok(configModels.includes('managed-deepseek-flash'))
    assert.equal(await run('agentState.onboardingAccount.plan'), 'free')
    assert.equal(await run('agentState.onboardingAccount.paidModelAccess'), true)
    assert.equal(await run('agentState.onboardingAccount.accountSessionEpoch'), initial.accountSessionEpoch)
    poll(); await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(restartCount, 2)
    offline = true; poll(); await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(restartCount, 2)
    offline = false; activeRun = true; paid = false; poll()
    await waitFor(() => run('agentState.onboardingAccount.modelsRevision===3'))
    assert.equal(restartCount, 2)
    activeRun = false
    await waitFor(() => restartCount === 3)
    assert.deepEqual(configModels, ['managed-gemini-3.8-flash'])
    paid = true; poll()
    await waitFor(() => restartCount === 4)
    assert.equal(inferencePosts, 0)
    console.log(JSON.stringify({ passed: true, freeGiftOnlyGemini: true, focusUnlocksWithoutLogin: true, actualPythonProvidersReadBack: true, actualAgentAndImageViews: true, activeRunDeferred: true, foregroundPollUnlocks: true, offlinePreservesConfig: true, unchangedNoRestart: true, realDshProcess: false, paidCalls: 0 }))
  } catch (error) { console.error(error); exitCode = 1 }
  finally { watcher?.dispose(); win?.destroy(); account?.dispose(); await server?.close(); fs.rmSync(directory, { recursive: true, force: true }); app.exit(exitCode) }
})
