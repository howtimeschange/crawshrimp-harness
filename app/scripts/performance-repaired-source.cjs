'use strict'
// Reproducible audit, no model calls. Full source app by default; PERF_COMPONENT_ONLY=1
// measures the shipped Vue renderer with fixture IPC and real local file code.
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm')
const { performance, monitorEventLoopDelay } = require('node:perf_hooks')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '..')
const output = path.resolve(process.env.PERF_OUTPUT || path.join(root, '..', '.codex-tmp', 'performance-2026-09-15', `${process.platform}-${process.arch}-${Date.now()}`))
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', path.join(output, 'profile'))
process.env.CRAWSHRIMP_DATA = path.join(output, 'data')
process.env.CRAWSHRIMP_PORT = '18845'
process.env.CRAWSHRIMP_CDP_PORT = '19345'
process.env.CRAWSHRIMP_RENDERER_URL = pathToFileURL(path.join(root, 'dist/renderer/index.html')).href
const componentOnly = process.env.PERF_COMPONENT_ONLY === '1'
const started = performance.now()
const report = { startedAt: new Date().toISOString(), componentOnly, platform: process.platform, arch: process.arch, electron: process.versions.electron, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemory: os.totalmem(), scenarios: [], errors: [], samples: [] }
const save = () => fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable()
let win, sampleTimer, scene = 'startup'
const fixtureWorkspace = path.join(output, 'workspace'); fs.mkdirSync(fixtureWorkspace, { recursive: true })
const mainSource = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8')
function sourceFunction(name) {
 const match = mainSource.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`))
 if (!match) throw Error(`Missing source function: ${name}`)
 return match[0]
}
const context = vm.createContext({ fs, path, os, nativeImage, app, Buffer, fileURLToPath: require('node:url').fileURLToPath, assertImageInputSize: n => { if(n > 20*1024*1024)throw Error('size cap') }, execFileSync: require('node:child_process').execFileSync })
for (const name of ['resolveLocalImagePath', 'imageMimeForPath', 'readLocalImageDataUrl', 'readLocalImageThumbnail']) vm.runInContext(sourceFunction(name), context)
const { listAuthorizedBalaWorkspaceImages } = require('../src/balaWorkspaceFiles')
const ipcStats = {}
if (componentOnly) {
 const preload = path.join(output, 'fixture-preload.cjs')
 fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');const cs={};\n` +
 ['getStatus','getTasks','getSettings','getUpdateStatus','agentApi','getScriptFavorites','getAdapters','getLocalPromptLibraries','getPlatformInfo','listBalaWorkspaceImages','readLocalImageThumbnail','readBalaWorkspaceManifest','writeBalaWorkspaceManifest','getTaskStatus','listTaskSchedules','listLocalPromptLibraries','getBalaVideoProviderStatus','getAiVideoSettings','getAccountState','accountAction','listTaskInstances','listDataFiles','getDataFiles'].map(name=>`cs.${name}=(...args)=>ipcRenderer.invoke('perf:call',${JSON.stringify(name)},args);`).join('\n') +
 `\nfor(const name of ['onStatus','offStatus','onUpdateStatus','onAccountState','onAccountChanged','onAgentEvent','offAgentEvent'])cs[name]=()=>()=>{};contextBridge.exposeInMainWorld('cs',cs);localStorage.setItem('crawshrimp.bala-ai-video.workspace-dir',${JSON.stringify(fixtureWorkspace)});`)
 ipcMain.handle('perf:call', async (_e, method, args) => {
  ipcStats[method] = (ipcStats[method] || 0) + 1
  if (method === 'getStatus') return { api: true, chrome: false, apiState: 'ready', appVersion: 'performance-fixture', platform: process.platform }
  if (method === 'getSettings') return {}
  if (method === 'getTaskStatus') return {live:null,last_run:null}
  if (method === 'listTaskSchedules' || method === 'listTaskInstances') return {items:[]}
  if (method === 'listLocalPromptLibraries') return {libraries:[]}
  if (method === 'getUpdateStatus') return { status: 'idle' }
  if (method === 'getPlatformInfo') return { platform: process.platform }
  if (method === 'listBalaWorkspaceImages') return listAuthorizedBalaWorkspaceImages({ workspaceRoot: args[0] })
  if (method === 'readLocalImageThumbnail') return context.readLocalImageThumbnail(...args)
  if (method === 'readBalaWorkspaceManifest') return { ok: true, manifest: null }
  if (method === 'writeBalaWorkspaceManifest') return { ok: true }
  if (/Account|account/.test(method)) return { authenticated: false }
  if (method === 'agentApi') {
   if (args[1] === '/agent/runtime') return { state: 'needs_configuration', model_configured: false }
   return { ok: true, items: [], tasks: [], events: [], providers: [], models: [], batches: [], runs: [] }
  }
  return []
 })
 app.whenReady().then(() => {
  win = new BrowserWindow({ width: 1280, height: 800, webPreferences: { preload, contextIsolation: true, nodeIntegration: false } })
  win.loadFile(path.join(root, 'dist/renderer/index.html'))
 })
} else {
 require('../src/main')
}
app.on('web-contents-created', (_e, contents) => {
 contents.on('devtools-opened', () => contents.closeDevTools())
 contents.on('console-message', (_e, details) => { if (details?.level === 'error') report.errors.push({ scene, message: String(details.message).slice(0, 300) }) })
 contents.on('render-process-gone', (_e, d) => { report.errors.push({ scene, rendererGone: d.reason }); save() })
})
function metrics() {
 return app.getAppMetrics().map(p => ({ pid: p.pid, type: p.type, cpuPercent: p.cpu.percentCPUUsage, cpuSeconds: p.cpu.cumulativeCPUUsage, workingSetKB: p.memory.workingSetSize, privateKB: p.memory.privateBytes }))
}
async function snapshot() {
 const renderer = await win.webContents.executeJavaScript(`({heap:performance.memory?.usedJSHeapSize,dom:document.querySelectorAll('*').length,images:document.images.length,body:document.body.innerText.length})`)
 return { renderer, processes: metrics() }
}
async function measure(name, action) {
 scene = name; loop.reset(); const t = performance.now(), before = await snapshot(), cpuBefore = process.cpuUsage(), calls = {...ipcStats}
 try {
  await delay(20)
  const probeStart=performance.now(), probe=new Promise(resolve=>setTimeout(()=>resolve(performance.now()-probeStart),0))
  const detail = await action()
  const firstTimerDelayMs = await probe
  await delay(25)
  const after = await snapshot(), cpu = process.cpuUsage(cpuBefore)
  report.scenarios.push({ name, durationMs: performance.now()-t, mainCpuMs: (cpu.user+cpu.system)/1000, firstTimerDelayMs, mainLoopMaxMs: loop.max/1e6, mainLoopP99Ms: loop.percentile(99)/1e6, before, after, detail, ipcCalls: Object.fromEntries(Object.entries(ipcStats).map(([k,v])=>[k,v-(calls[k]||0)]).filter(([,v])=>v)) })
 } catch(e) { report.scenarios.push({name,error:e.stack}) }
 save(); console.log('PERF completed:', name)
}
async function navigate(id) {
 return win.webContents.executeJavaScript(`(async()=>{const c=document.querySelector('#app')._vnode?.component || document.querySelector('#app').__vue_app__?._container?._vnode?.component;if(!c)throw Error('Vue root unavailable');const find=v=>{if(!v)return null;if(v.component?.type?.__name==='AgentWebView')return v.component;const nodes=[v.component?.subTree,...(Array.isArray(v.children)?v.children:[])];for(const n of nodes){const r=find(n);if(r)return r}return null};const agent=find(c.subTree);if(!agent)throw Error('AgentWebView unavailable');const t=performance.now();agent.emit('nav-select',${JSON.stringify(id)});let raf=true;await Promise.race([new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),new Promise(r=>setTimeout(()=>{raf=false;r()},2000))]);return {paintMs:performance.now()-t,raf,view:agent.props.activeNav,text:document.body.innerText.slice(-160),dom:document.querySelectorAll('*').length}})()`)
}
async function run() {
 for(let n=0;n<120;n++) {
  win ||= BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().startsWith('devtools:'))
  if(win && await win.webContents.executeJavaScript('Boolean(document.querySelector("#app")?.__vue_app__)').catch(()=>false))break
  await delay(500)
 }
 if(!win)throw Error('No application window')
 win.webContents.closeDevTools();win.show();win.focus()
 report.measurementNotes={memory:'Electron working sets; renderer performance.memory is bucketed and not used for conclusions',scope:componentOnly?'Vue production bundle with fixture IPC; local file functions run unchanged':'source Electron with real backend; no model inference'}
 report.shellReadyMs = performance.now()-started
 report.initial = await snapshot(); report.removalCheck = await win.webContents.executeJavaScript(`({video:document.body.innerText.includes('AI 视频工作流'),buyer:document.body.innerText.includes('AI 买家秀工作流')})`); save()
 sampleTimer = setInterval(()=>{report.samples.push({atMs:performance.now()-started,scene,processes:metrics()});save()},1000)
 if(process.env.PERF_IPC_ONLY==='1') {
  const fixtureRoot=process.env.PERF_EXISTING_FIXTURES;if(!fixtureRoot)throw Error('PERF_EXISTING_FIXTURES required')
  await measure('directory-10000-via-ipc',async()=>win.webContents.executeJavaScript(`(async()=>{const t=performance.now();const files=await window.cs.listBalaWorkspaceImages(${JSON.stringify(path.join(fixtureRoot,'scan-10000'))});return {files:files.length,elapsedMs:performance.now()-t}})()`))
  await measure('thumbnail-12-via-ipc-concurrency-3',async()=>win.webContents.executeJavaScript(`(async()=>{const files=${JSON.stringify(Array.from({length:12},(_,i)=>path.join(fixtureRoot,'photo-'+i+'.jpg')))};let index=0,count=0;const t=performance.now();const worker=async()=>{while(index<files.length){const f=files[index++];const r=await window.cs.readLocalImageThumbnail(f,{maxEdge:280});if(!r.ok)throw Error(r.error);count++}};await Promise.all([worker(),worker(),worker()]);return {count,elapsedMs:performance.now()-t}})()`))
  report.finishedAt=new Date().toISOString();save();clearInterval(sampleTimer);loop.disable();app.quit();return
 }
 await measure('idle-first-20s', () => delay(20000))
 if(!componentOnly) await measure('backend-readiness', async()=>win.webContents.executeJavaScript(`window.cs.getStatus().then(s=>({api:s.api,apiPort:s.apiPort,apiState:s.apiState}))`))
 for(const view of ['scripts','task_center','ai_image','ai_video_generation','local_prompt_library','files','settings','agent']) {
  await measure('view-'+view, async()=>{const nav=await navigate(view);await delay(1000);return nav})
 }
 await measure('source-health', async()=>{
  const status=await win.webContents.executeJavaScript('window.cs.getStatus()')
  return new Promise((resolve,reject)=>require('node:http').get(`http://127.0.0.1:${status.apiPort}/health`,r=>{let body='';r.on('data',c=>body+=c);r.on('end',()=>{const h=JSON.parse(body);resolve({ok:h.ok,runtime:h.runtime})})}).on('error',reject))
 })
 if(process.env.PERF_QUICK==='1') { report.finishedAt=new Date().toISOString();save();clearInterval(sampleTimer);loop.disable();app.quit();return }
 await measure('idle-after-workflows-20s',()=>delay(20000))
 await measure('switch-30-times',async()=>{const times=[];for(let i=0;i<30;i++){const r=await navigate(['agent','ai_image','ai_video_generation'][i%3]);times.push(r.paintMs)}return{paintMs:times}})
 await navigate('agent')
 if(process.env.PERF_UI_ONLY==='1'){await measure('minimized-idle-15s',async()=>{win.minimize();await delay(15000);win.restore();return{note:'fixture API; no backend'}});report.finishedAt=new Date().toISOString();save();clearInterval(sampleTimer);loop.disable();app.quit();return}
 // Real synchronous file path, with the same function used by main IPC.
 for(const count of [1000,10000]) {
  const dir=path.join(output,'scan-'+count);fs.mkdirSync(dir,{recursive:true})
  for(let i=0;i<count;i++){const sub=path.join(dir,String(Math.floor(i/100)));fs.mkdirSync(sub,{recursive:true});fs.writeFileSync(path.join(sub,i+'.jpg'),'fixture')}
  await measure('directory-'+count,async()=>{const ms=[];for(let i=0;i<3;i++){const t=performance.now();const result=listAuthorizedBalaWorkspaceImages({workspaceRoot:dir});ms.push(performance.now()-t);if(result.length!==count)throw Error('incorrect file count');await delay(30)}return{files:count,timesMs:ms}})
 }
 const width=6000,height=4000,bitmap=Buffer.alloc(width*height*4)
 let seed=12345;for(let i=0;i<bitmap.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)|0;bitmap[i]=seed&255;bitmap[i+1]=(seed>>>8)&255;bitmap[i+2]=(seed>>>16)&255;bitmap[i+3]=255}
 const img=nativeImage.createFromBitmap(bitmap,{width,height}), jpg=img.toJPEG(80)
 const imageFiles=[];for(let i=0;i<12;i++){const f=path.join(output,`photo-${i}.jpg`);fs.writeFileSync(f,jpg);imageFiles.push(f)}
 report.fixtureImage={width,height,bytes:jpg.length};await delay(100)
 for(const count of [1,6,12]) await measure('thumbnail-24mp-'+count,async()=>{const t=performance.now();let bytes=0;for(const f of imageFiles.slice(0,count)){const r=context.readLocalImageThumbnail(f,{maxEdge:280});bytes+=r.data_url.length}return{elapsedMs:performance.now()-t,count,base64Bytes:bytes}})
 if(process.platform==='win32') await measure('windows-acl-repeat-3',async()=>{const {hardenWindowsPathSync}=require('../src/windowsAcl');const f=path.join(output,'acl-fixture.txt');fs.writeFileSync(f,'audit fixture');const times=[];for(let i=0;i<3;i++){const t=performance.now();hardenWindowsPathSync(f);times.push(performance.now()-t)}return{timesMs:times}})
 if(win.webContents.debugger.isAttached())win.webContents.debugger.detach()
 win.webContents.debugger.attach('1.3')
 await win.webContents.debugger.sendCommand('Emulation.setCPUThrottlingRate',{rate:4})
 await measure('renderer-only-4x-switch-12',async()=>{const times=[];for(let i=0;i<12;i++)times.push((await navigate(['agent','ai_image','ai_video_generation'][i%3])).paintMs);return{paintMs:times,note:'renderer slowdown only; not an i3 simulation'}})
 await win.webContents.debugger.sendCommand('Emulation.setCPUThrottlingRate',{rate:1})
 await navigate('agent'); await measure('idle-final-15s',()=>delay(15000))
 fs.writeFileSync(path.join(output,'final.png'),(await win.webContents.capturePage()).toPNG())
 report.finishedAt=new Date().toISOString();save();clearInterval(sampleTimer);loop.disable();app.quit()
}
app.whenReady().then(()=>run()).catch(e=>{report.fatal=e.stack;save();console.error(e);clearInterval(sampleTimer);app.exit(1)})
setTimeout(()=>{report.timeout=true;save();app.exit(2)},8*60*1000).unref()
