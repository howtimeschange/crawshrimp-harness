'use strict'
const {app}=require('electron'), fs=require('node:fs'), path=require('node:path'),vm=require('node:vm'),{performance}=require('node:perf_hooks')
const output=path.resolve(process.env.PERF_OUTPUT)
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'profile'))
const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8')
const {hardenWindowsPathSync,assertSafeWindowsDataRootSync}=require('../src/windowsAcl')
const {assertNoLinkComponentsSync}=require('../src/pathIdentity')
const scope=vm.createContext({app,fs,path,process,hardenWindowsPathSync,assertSafeWindowsDataRootSync,assertNoLinkComponentsSync})
for(const name of ['ensureWritableDirectory','ensureWritableDataDir']){const match=source.match(new RegExp(`function ${name}\\([^]*?\\n}`));if(!match)throw Error(name);vm.runInContext(match[0],scope)}
app.whenReady().then(async()=>{
 const rows=[]
 for(let i=0;i<2;i++){
  const start=performance.now(),timer=new Promise(r=>setTimeout(()=>r(performance.now()-start),0));
  scope.ensureWritableDataDir(path.join(output,'data'))
  const elapsedMs=performance.now()-start,blockedTimerMs=await timer
  rows.push({iteration:i,elapsedMs,blockedTimerMs})
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({platform:process.platform,arch:process.arch,electron:process.versions.electron,paths:5,rows},null,2))
 }
 app.quit()
}).catch(e=>{fs.writeFileSync(path.join(output,'error.txt'),e.stack);app.exit(1)})
