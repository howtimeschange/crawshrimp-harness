'use strict'
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks')
const {createThumbnailReader}=require('../src/imageThumbnail')
const out=process.env.PERF_OUTPUT;fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'))
app.whenReady().then(async()=>{
 const rows=[]
 for(const count of [1,6,12]){
  const read=createThumbnailReader(()=>process.env.PERF_PYTHON)
  const image=path.join(process.env.PERF_IMAGES,'photo-0.jpg');let ticks=0,gap=0,last=performance.now()
  const timer=setInterval(()=>{const now=performance.now();gap=Math.max(gap,now-last);last=now;ticks++},10)
  const t=performance.now()
  const results=await Promise.all(Array.from({length:count},(_,i)=>read(path.join(process.env.PERF_IMAGES,`photo-${i}.jpg`),{maxEdge:280})))
  clearInterval(timer)
  if(results.some(r=>Math.max(r.width,r.height)>280))throw Error('incorrect dimensions')
  rows.push({count,elapsedMs:performance.now()-t,maxTimerGapMs:gap,ticks,bytes:results.reduce((n,r)=>n+r.bytes,0)})
 }
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({platform:process.platform,arch:process.arch,rows},null,2));app.quit()
}).catch(e=>{fs.writeFileSync(path.join(out,'error.txt'),e.stack);app.exit(1)})
