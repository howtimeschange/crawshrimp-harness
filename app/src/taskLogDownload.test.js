'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {downloadTaskLog}=require('./taskLogDownload')
test('download streams authenticated contents and preserves target on HTTP failure', async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'harness-log-'));const target=path.join(root,'task.log')
 const server=http.createServer((req,res)=>{assert.equal(req.headers['x-test-token'],'fixture');if(req.url==='/bad'){res.writeHead(500);res.end();return}res.write('first\n');res.end('last\n')})
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const options={port:server.address().port,token:'fixture',tokenHeader:'X-Test-Token',filePath:target}
 try {
  await downloadTaskLog({...options,urlPath:'/ok'});assert.equal(fs.readFileSync(target,'utf8'),'first\nlast\n')
  await assert.rejects(downloadTaskLog({...options,urlPath:'/bad'}),/500/)
  assert.equal(fs.readFileSync(target,'utf8'),'first\nlast\n');assert.deepEqual(fs.readdirSync(root),['task.log'])
 }finally{await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true})}
})
