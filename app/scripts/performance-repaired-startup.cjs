'use strict'
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{performance}=require('node:perf_hooks')
const {prepareDesktopDataDirectoryAsync}=require('../src/desktopDataDirectory')
const output=path.resolve(process.env.PERF_OUTPUT)
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'profile'))
app.whenReady().then(async()=>{
 const rows=[]
 for(let i=0;i<2;i++){
  let maxGap=0,last=performance.now(),ticks=0
  const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++},10)
  const start=performance.now()
  const prepared=await prepareDesktopDataDirectoryAsync({candidates:[path.join(output,'data')],homeDir:os.homedir(),env:{}})
  clearInterval(timer)
  rows.push({iteration:i,elapsedMs:performance.now()-start,maxTimerGapMs:maxGap,ticks,errors:prepared.errors.length})
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({platform:process.platform,arch:process.arch,electron:process.versions.electron,rows},null,2))
 }
 app.quit()
}).catch(e=>{fs.writeFileSync(path.join(output,'error.txt'),e.stack);app.exit(1)})
