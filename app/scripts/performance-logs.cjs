'use strict'
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const output=path.resolve(process.env.PERF_OUTPUT || path.join(__dirname,'../../.codex-tmp/performance-2026-09-15/logs-'+process.platform+'-'+process.arch))
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'profile'))
const result={platform:process.platform,arch:process.arch,electron:process.versions.electron,memory:os.totalmem(),scenarios:[]}
const save=()=>fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2))
app.whenReady().then(async()=>{
 const w=new BrowserWindow({width:1280,height:800,webPreferences:{contextIsolation:true}})
 await w.loadFile(path.join(__dirname,'../dist/performance/index.html'));w.show();w.focus()
 w.webContents.debugger.attach('1.3');await w.webContents.debugger.sendCommand('Performance.enable')
 for(const rate of [1,4]) {
  await w.webContents.debugger.sendCommand('Emulation.setCPUThrottlingRate',{rate})
  for(const count of [1000,10000,50000]) {
   const t=Date.now();const r=await w.webContents.executeJavaScript(`window.perfLogs(${count})`)
   const heapMetrics=await w.webContents.debugger.sendCommand('Performance.getMetrics');r.heap=heapMetrics.metrics.find(m=>m.name==='JSHeapUsedSize')?.value
   result.scenarios.push({rate,count,wallMs:Date.now()-t,...r,processes:app.getAppMetrics().map(p=>({type:p.type,memory:p.memory,cpu:p.cpu}))});save()
   await w.webContents.executeJavaScript('window.perfLogs(0)');await new Promise(r=>setTimeout(r,500))
  }
 }
 await w.webContents.debugger.sendCommand('Emulation.setCPUThrottlingRate',{rate:1})
 await w.webContents.debugger.sendCommand('HeapProfiler.collectGarbage')
 result.afterGc=await w.webContents.debugger.sendCommand('Performance.getMetrics')
 result.finishedAt=new Date().toISOString();save();w.destroy();app.quit()
}).catch(e=>{result.fatal=e.stack;save();app.exit(1)})
setTimeout(()=>{result.timeout=true;save();app.exit(2)},240000).unref()
