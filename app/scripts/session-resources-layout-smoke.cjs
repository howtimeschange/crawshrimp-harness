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
  await win.webContents.executeJavaScript(`
    window.__snapshotRetries = 0;
    const artifacts = Array.from({length:3}, (_,i) => ({artifact_id:'file-'+i, filename:'最终演示文稿_完整可编辑版本.pptx', path:'', source:'office', office:{job_id:'test'}, file_snapshot:{status:i === 1?'too_large':'quota_exceeded', version_id:'v'+i}, versions:[{artifact_id:'history-ready',status:'ready',sha256:'a'.repeat(64),updated_at:'2026-11-03 18:00'}, {artifact_id:'history-deleted',status:'deleted',sha256:'b'.repeat(64),updated_at:'2026-11-02 18:00'}]}));
    window.cs.agentApi = async (method, url) => {
      if (method === 'POST' && url.endsWith('retry-snapshot')) {
        window.__snapshotRetries++;
        artifacts[0].file_snapshot.status = 'ready'; artifacts[0].path = '/mock/deck.pptx';
        return {status:'ready'};
      }
      if (url.includes('/session-resources/version?')) return {artifact_id:'history-ready',filename:'history.md',path:'/mock/history.md'};
      return {tabs:[], artifacts, storage:{near_limit:true,full:true,bytes:338*1048576,max_bytes:512*1048576,versions:500,max_versions:500}};
    };
    [...document.querySelectorAll('button')].find(b => b.textContent.includes('进入对话')).click();
  `);
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
  const history = await win.webContents.executeJavaScript(`({notice:document.querySelector('.storage-notice')?.textContent,deleted:document.querySelectorAll('.history-version button:disabled').length})`);
  if (!history.notice.includes('额度已满') || history.deleted !== 3) throw Error(JSON.stringify(history));
  await win.webContents.executeJavaScript(`document.querySelector('.retry-snapshot-action').click()`);
  await new Promise(r=>setTimeout(r,500));
  const retries = await win.webContents.executeJavaScript(`({count:window.__snapshotRetries,buttons:document.querySelectorAll('.retry-snapshot-action').length,error:document.querySelector('.resource-error')?.textContent})`);
  if (retries.count !== 1 || retries.buttons !== 2 || retries.error) throw Error(JSON.stringify(retries));
  await win.webContents.executeJavaScript(`document.querySelector('.history-version button:not(:disabled)').click()`);
  await new Promise(r=>setTimeout(r,300));
  if (!await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.workspace-tab-label')).some(el=>el.textContent === 'history.md')`)) throw Error('History version did not open');
  console.log('Quota warning, retained/deleted history and clean/retry actions passed');
 } catch(e) {console.error(e);process.exitCode=1} finally {win.destroy();fs.rmSync(profile,{recursive:true,force:true});app.quit()}
});
