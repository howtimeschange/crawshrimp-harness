// Start app Vite on port 5187, then run with Electron (ELECTRON_RUN_AS_NODE unset).
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'office-resource-layout-'));
app.setPath('userData', profile);
app.whenReady().then(async () => {
 const win = new BrowserWindow({show:false,width:1300,height:900,webPreferences:{contextIsolation:true}});
 try {
  await win.loadURL(process.env.RESOURCE_LAYOUT_URL || 'http://127.0.0.1:5187/dev/session-resources.html');
  await win.webContents.executeJavaScript(`window.cs.agentApi = async () => ({tabs:[], artifacts:Array.from({length:3}, (_,i) => ({artifact_id:'file-'+i,filename:'最终演示文稿_完整可编辑版本.pptx',path:'',source:'office',office:{job_id:'test'},file_snapshot:{status:i === 1?'too_large':'quota_exceeded',version_id:'v'+i}}))}); [...document.querySelectorAll('button')].find(b => b.textContent.includes('进入对话')).click();`);
  for (const width of [1300,900]) {
   win.setSize(width,900);
   await new Promise(r=>setTimeout(r,700));
   const rows = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.artifact-row')).map(row => {const main=row.querySelector('.resource-main').getBoundingClientRect(),name=row.querySelector('.resource-name').getBoundingClientRect(),action=row.querySelector('.current-file-action').getBoundingClientRect(),box=row.getBoundingClientRect();return {nameWidth:name.width,mainBottom:main.bottom,actionTop:action.top,overflow:row.scrollWidth>row.clientWidth,boxWidth:box.width}})`);
   if(rows.length!==3 || rows.some(r=>r.nameWidth<100 || r.actionTop<r.mainBottom || r.overflow)) throw Error(JSON.stringify({width,rows}));
   console.log(JSON.stringify({width,rows}));
   if (process.env.RESOURCE_LAYOUT_SCREENSHOTS) {
    fs.mkdirSync(process.env.RESOURCE_LAYOUT_SCREENSHOTS, {recursive:true});
    fs.writeFileSync(path.join(process.env.RESOURCE_LAYOUT_SCREENSHOTS, 'resources-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
   }
  }
 } catch(e) {console.error(e);process.exitCode=1} finally {win.destroy();fs.rmSync(profile,{recursive:true,force:true});app.quit()}
});
