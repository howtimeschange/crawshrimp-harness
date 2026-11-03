'use strict'
// Isolated renderer fixture: no account data, external network or generation calls.
const { app, BrowserWindow, session } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-model-smoke-'))
app.setPath('userData', directory)
app.whenReady().then(async () => {
  let server, window, exitCode = 0
  try {
    const { createServer } = await import('vite')
    const vue = (await import('@vitejs/plugin-vue')).default
    let fixtureSource = ''
    server = await createServer({ root: path.resolve(__dirname, '..'), configFile: false, plugins: [vue(), {name:'model-fixture',resolveId:id=>id==='__fixture_entry'?id:null,load:id=>id==='__fixture_entry'?fixtureSource:null}], cacheDir: path.join(directory, 'vite'), optimizeDeps: { noDiscovery: true, include: [] }, server: { host: '127.0.0.1', port: 5279 }, appType: 'custom' })
    server.middlewares.use('/__model_fixture', (_req, res) => {
      res.setHeader('Content-Type', 'text/html')
      fixtureSource = `
        import {createApp, nextTick} from 'vue';
        import Workbench from '/src/renderer/views/AiImageWorkbench.vue';
        import {configureAiImageProviders} from '/src/renderer/utils/aiImageModels.js';
        window.nextTick = nextTick; window.configure = configureAiImageProviders;
        window.fixtureSettings = {'ai.semir.gpt_api_key':'fixture'};
        window.paidCalls = 0;
        window.cs = {getSettings:async()=>window.fixtureSettings, listAiImageJobs:async()=>[],
          imageCallHistory:async()=>({}), readLocalImagePreview:async()=>({}),
          createAiImageJob:async()=>{window.paidCalls++;throw Error('Generation forbidden in fixture')}};
        localStorage.setItem('crawshrimp.aiImageWorkbench.state.v2', JSON.stringify({form:{modelId:'gpt-image-2',prompt:'preserved',ratio:'16:9',size:'1536x864',expectedConnectionVersion:'old'}}));
        const vm = createApp(Workbench).mount('#app'); window.state = vm.$.setupState;
        window.ready = true;
      `
      res.end('<!doctype html><div id="app"></div><script type="module" src="/@id/__fixture_entry"></script>')
    })
    await server.listen()
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.replace(/^ws:/, 'http:').startsWith(origin + '/') }))
    window = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { contextIsolation: true, sandbox: true } })
    window.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message) })
    await window.loadURL(origin + '/__model_fixture')
    const run = source => window.webContents.executeJavaScript(source)
    for (let i = 0; i < 100 && !await run('Boolean(window.ready && window.state?.providersReady)'); i++) await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(await run('Boolean(window.ready)'), true, 'renderer fixture must mount')
    assert.equal(await run('state.form.modelId'), 'semir/gpt-image-2')
    assert.equal(await run('document.querySelector(".aiw-task-fields select").value'), 'semir/gpt-image-2')
    assert.equal(await run('state.form.prompt'), 'preserved')
    assert.equal(await run('state.form.expectedConnectionVersion'), '')
    assert.equal(await run('state.generationConfigMessage'), '')
    // Restore a retired task after settings have loaded; preserve its historical identity.
    await run(`(async()=>{ await state.restoreJob({job_uid:'history',model_key:'gpt-image-2',status:'completed',prompt:'history prompt',params:{size:'1536x864',ratio:'16:9'},summary:{runs:[]}}, {preserveCurrentDraft:false});
      Object.assign(state.form,{modelId:'gpt-image-2',quality:'obsolete',count:4});
      configure({'managed_image_providers':[{id:'custom-managed-test',name:'Official',protocol:'gemini',models:['banana'],configured:true}]}); await nextTick() })()`)
    assert.equal(await run('state.form.modelId'), 'custom-managed-test/banana')
    assert.equal(await run('state.form.size'), '1K')
    assert.equal(await run('state.form.count'), 1)
    assert.equal(await run('state.currentJob.model_key'), 'gpt-image-2')
    await run(`state.openBatchGenerationDialog(); state.batchGenerationDialog.modelId='retired'; nextTick()`)
    assert.equal(await run('state.batchGenerationDialog.modelId'), 'custom-managed-test/banana')
    assert.equal(await run('state.batchGenerationDialog.size'), '1K')
    await run(`configure({'ai.woka.api_key':'fixture','ai.semir.gpt_api_key':'fixture'}); nextTick()`)
    await run(`state.form.modelId='semir/gpt-image-2'; nextTick()`)
    assert.equal(await run('state.form.modelId'), 'semir/gpt-image-2')
    await run('configure({}); nextTick()')
    assert.match(await run('state.generationConfigMessage'), /未配置/)
    assert.equal(await run('window.paidCalls'), 0)
    assert.equal(await run('document.body.textContent.includes("所选模型已移除")'), false)
    console.log(JSON.stringify({ passed: true, restoredDraft: true, retiredTask: true, catalogRefresh: true, batch: true, configuredChoicePreserved: true, noConfiguredModel: true, paidCalls: 0 }))
  } catch (error) { console.error(error); exitCode = 1 }
  finally { window?.destroy(); await server?.close(); fs.rmSync(directory, { recursive: true, force: true }); app.exit(exitCode) }
})
