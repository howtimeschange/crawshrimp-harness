'use strict'
// Uses the existing local encrypted login without copying or printing credentials.
// Test events are isolated from production/development in environment=test.
const {app,safeStorage,net,BrowserWindow}=require('electron')
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict')
const {createAccountAuth}=require('../src/accountAuth')
const {createClient}=require('@supabase/supabase-js')
const {createProductAnalytics}=require('../src/productAnalytics')
const config=require('../src/accountConfig.json')
app.setName('crawshrimp-harness')
const output=path.resolve(__dirname,'../../.codex-tmp/analytics-acceptance')
fs.mkdirSync(output,{recursive:true})
app.whenReady().then(async()=>{
 const project=crypto.createHash('sha256').update(config.url).digest('hex').slice(0,20)
 const source=path.join(os.homedir(),'Library/Application Support/crawshrimp-harness/account',`account-${project}.enc`)
 const auth=createAccountAuth({config,directory:path.dirname(source),safeStorage,openExternal:async()=>{},createClient:(url,key,options)=>createClient(url,key,{...options,global:{fetch:net.fetch.bind(net)}})})
 const session=await auth.analyticsSession()
 if(!session?.access_token)throw Error('No existing signed-in desktop account')
 const url='https://analytics.crawshrimp.com'
 const api=async(p,body)=>{const r=await net.fetch(url+p,{method:'POST',headers:{authorization:`Bearer ${session.access_token}`,'content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(`${p}: HTTP ${r.status}`);return r.json()}
 const before=await api('/api/dashboard',{days:30,env:'test'})
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'harness-analytics-live-'))
 const collector=createProductAnalytics({directory:dir,getDataDirectory:()=>dir,getSession:async()=>session,version:'acceptance',environment:'test',fetchImpl:net.fetch.bind(net)})
 await collector.sync()
 if(!process.env.ANALYTICS_READ_ONLY){
 collector.record('activity',{feature:'app'})
 collector.record('feature_used',{feature:'file_preview'})
 collector.record('model_call',{model:'acceptance-no-model-call',input_tokens:10,output_tokens:20})
 }
 await collector.flush()
 assert.equal(fs.readdirSync(path.join(dir,'product-analytics/queue')).length,0,'batch must be acknowledged')
 const after=await api('/api/dashboard',{days:30,env:'test'})
 assert(after.features.some(x=>x.feature==='file_preview'))
 assert(after.models.some(x=>x.model==='acceptance-no-model-call'&&x.input_tokens>=10))
 // Actual renderer of the shipped dashboard; authenticate via the real API using
 // the already verified session in memory, without exposing tokens to a file.
 const win=new BrowserWindow({width:1440,height:1050,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}})
 await win.loadURL(process.env.ANALYTICS_PREVIEW_URL || url)
 fs.writeFileSync(path.join(output,'login.png'),(await win.webContents.capturePage()).toPNG())
 assert(await win.webContents.executeJavaScript(`document.getElementById('admin-nav').hidden`),'login must hide navigation')
 await win.webContents.executeJavaScript(`token=${JSON.stringify(session.access_token)};document.getElementById('environment').value='test';refresh()`)
 if(await win.webContents.executeJavaScript("Boolean(document.getElementById('nav-analytics'))")){
   const nav=await win.webContents.executeJavaScript(`(()=>{const a=document.getElementById('nav-analytics');a.querySelector('summary').click();const collapsed=!a.open;a.querySelector('summary').click();return {groups:document.querySelectorAll('.nav-group').length,reports:a.querySelectorAll('a').length,management:document.getElementById('nav-management').querySelectorAll('a').length,collapsed,expanded:a.open}})()`)
   assert.deepEqual(nav,{groups:2,reports:6,management:1,collapsed:true,expanded:true})
   await win.webContents.executeJavaScript("history.replaceState(null,'','#market');loadRoute()")
   assert(await win.webContents.executeJavaScript("document.getElementById('nav-management').open && !document.getElementById('market-panel').hidden"),'management deep link must expand group and load')
   await win.webContents.executeJavaScript("history.replaceState(null,'','#overview');loadRoute()")
 }
 const visible=await win.webContents.executeJavaScript(`({dashboard:!document.getElementById('dashboard').hidden,text:document.getElementById('model-table').textContent})`)
 if(!visible.dashboard) console.error(visible.text.slice(-700))
 assert(visible.dashboard&&visible.text.includes('acceptance-no-model-call'),'dashboard must render persisted usage')
 if (await win.webContents.executeJavaScript('Boolean(window.HarnessCharts)')) {
   const checks=await win.webContents.executeJavaScript(`(()=>{const c=echarts.getInstanceByDom(document.getElementById('active-trend'));if(!c)throw Error('chart missing');c.dispatchAction({type:'legendToggleSelect',name:'新增账号'});const selected=c.getOption().legend[0].selected['新增账号'];c.dispatchAction({type:'dataZoom',start:50,end:100});const zoom=c.getOption().dataZoom[0].start;document.querySelector('#feature-ranking').parentNode.querySelector('[data-metric="uses"]').click();return {count:[...document.querySelectorAll('.chart')].filter(e=>echarts.getInstanceByDom(e)).length,selected,zoom,metric:document.querySelector('#feature-ranking').parentNode.querySelector('[data-metric="uses"]').getAttribute('aria-pressed')}})()`)
   assert.equal(checks.count,12);assert.equal(checks.selected,false);assert.equal(checks.zoom,50);assert.equal(checks.metric,'true')
   await win.webContents.executeJavaScript(`echarts.getInstanceByDom(document.getElementById('active-trend')).dispatchAction({type:'legendToggleSelect',name:'新增账号'});echarts.getInstanceByDom(document.getElementById('active-trend')).dispatchAction({type:'dataZoom',start:0,end:100})`)
   await new Promise(resolve=>setTimeout(resolve,500))
   fs.writeFileSync(path.join(output,'chart-checks.json'),JSON.stringify(checks,null,2))
 }
 // Download every report through its real button and verify saved CSV bytes.
 if (await win.webContents.executeJavaScript('Boolean(window.HarnessExports)')) {
   const keys=await win.webContents.executeJavaScript(`[...document.querySelectorAll('[data-export]')].map(b=>b.dataset.export)`)
   assert.equal(keys.length,12)
   const downloads=[]
   for(const key of keys){
     const downloaded=new Promise((resolve,reject)=>{
       const timeout=setTimeout(()=>reject(Error('CSV download timed out: '+key)),15000)
       win.webContents.session.once('will-download',(_event,item)=>{
         const destination=path.join(output,item.getFilename());item.setSavePath(destination)
         item.once('done',(_event,state)=>{clearTimeout(timeout);if(state!=='completed')return reject(Error('Download '+state));resolve(destination)})
       })
     })
     await win.webContents.executeJavaScript(`document.querySelector('[data-export="${key}"]').click()`,true)
     const destination=await downloaded,csv=fs.readFileSync(destination,'utf8')
     assert(csv.startsWith('\uFEFF'));assert(csv.includes('数据环境'));assert(path.basename(destination).includes('_test_30天_'))
     downloads.push({report:key,file:path.basename(destination),bytes:Buffer.byteLength(csv)})
     // Stay below Chromium's automatic-download burst limit.
     await new Promise(resolve=>setTimeout(resolve,1100))
   }
   fs.writeFileSync(path.join(output,'export-checks.json'),JSON.stringify(downloads,null,2))
   console.log('PASS: all 12 report buttons downloaded scoped UTF-8 CSV files')
 }
 fs.writeFileSync(path.join(output,'dashboard.png'),(await win.webContents.capturePage()).toPNG())
 fs.writeFileSync(path.join(output,'readback.json'),JSON.stringify({checkedAt:new Date().toISOString(),before:before.active,after:after.active,features:after.features,models:after.models,environment:'test',rendered:true},null,2))
 console.log('PASS: encrypted existing login -> Electron outbox -> Cloudflare -> Supabase -> rendered dashboard; test environment only')
 for(const section of ['conversion','quality','models']) {
   await win.webContents.executeJavaScript(`document.getElementById('${section}').scrollIntoView({behavior:'instant'})`)
   await new Promise(resolve=>setTimeout(resolve,150))
   fs.writeFileSync(path.join(output,section+'.png'),(await win.webContents.capturePage()).toPNG())
 }
 for(const width of [375,768,1024,1440]){
   win.setSize(width,1000)
   await win.webContents.executeJavaScript('window.HarnessCharts?.resize()')
   await new Promise(resolve=>setTimeout(resolve,100))
   assert(await win.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth+1'),'viewport overflow at '+width)
 }
 win.setSize(420,900)
 await win.webContents.executeJavaScript('window.HarnessCharts?.resize()')
 await new Promise(resolve=>setTimeout(resolve,300))
 assert(await win.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth+1'),'mobile page must not overflow')
 await win.webContents.executeJavaScript("document.getElementById('overview').scrollIntoView({behavior:'instant'})")
 await new Promise(resolve=>setTimeout(resolve,150))
 fs.writeFileSync(path.join(output,'dashboard-mobile.png'),(await win.webContents.capturePage()).toPNG())
 collector.stop();auth.dispose();fs.rmSync(dir,{recursive:true,force:true});win.destroy();app.quit()
}).catch(e=>{console.error('FAIL:',e.message);app.exit(1)})
