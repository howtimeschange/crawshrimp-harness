'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {createBoundedDiagnostics}=require('./boundedDiagnostics')
const campaign='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222'
const wait=ms=>new Promise(r=>setTimeout(r,ms))
function setup(t,options={}){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bounded-diag-'));const sink=createBoundedDiagnostics({directory,campaign,until:new Date(Date.now()+60000).toISOString(),...options});t.after(async()=>{await sink.close();fs.rmSync(directory,{recursive:true,force:true})});return {sink,directory}}
test('allowlist, private permissions, hard rotation cap and explicit shutdown',async t=>{
 const {sink,directory}=setup(t,{maxFileBytes:1024});await sink.ready
 for(let i=0;i<18;i++){sink.emit({requestId,route:'oauth-token',phase:'finish',status:400,reason:'pkce_failed',headers:{Authorization:'SECRET'},error_description:'SECRET',model:'SECRET',accountId:'SECRET',firstTextMs:i});await sink.flush()}
 const files=fs.readdirSync(directory);assert.deepEqual(files.sort(),['events.jsonl','previous.jsonl','state.json'])
 for(const name of files){assert.equal(fs.statSync(path.join(directory,name)).mode&0o777,0o600);assert.ok(!fs.readFileSync(path.join(directory,name),'utf8').includes('SECRET'))}
 assert.ok(fs.statSync(path.join(directory,'events.jsonl')).size<=1024);assert.ok(fs.statSync(path.join(directory,'previous.jsonl')).size<=1024)
 await sink.close();assert.deepEqual(fs.readdirSync(directory),[]);assert.equal(sink.emit({requestId}),false)
})
test('automatic expiry purges existing and pending files without business actions',async t=>{
 const {sink,directory}=setup(t,{until:new Date(Date.now()+150).toISOString()});await sink.ready;sink.emit({requestId});await sink.flush();assert.ok(fs.existsSync(path.join(directory,'events.jsonl')))
 await wait(200);assert.equal(sink.active(),false);assert.equal(sink.state().expired,true);assert.deepEqual(fs.readdirSync(directory),[])
})
test('oversized validity rejected, expired restart cleans only owned files',async t=>{
 const {sink,directory}=setup(t,{until:new Date(Date.now()+86460000).toISOString()});await sink.ready;assert.equal(sink.active(),false)
 fs.writeFileSync(path.join(directory,'events.jsonl'),'old');fs.writeFileSync(path.join(directory,'unrelated'),'KEEP')
 const expired=createBoundedDiagnostics({directory,campaign,until:new Date(Date.now()-1).toISOString()});await expired.ready;assert.deepEqual(fs.readdirSync(directory),['unrelated']);await expired.close()
})
test('disk failure and backpressure disable logging without throwing',async t=>{
 const bad={...fs.promises,open:async()=>{throw Object.assign(new Error('SECRET'),{code:'ENOSPC'})}}
 const {sink}=setup(t,{io:bad});await sink.ready;assert.doesNotThrow(()=>sink.emit({requestId}));await sink.flush();assert.equal(sink.state().fault,'sink-unavailable')
 const overloaded=setup(t,{queueLimit:16}).sink;overloaded.emit({requestId});assert.equal(overloaded.state().fault,'backpressure');assert.equal(overloaded.active(),false)
})
test('campaign restart preserves record ceiling and rejects symlink directory',async t=>{
 const until=new Date(Date.now()+60000).toISOString(),{sink,directory}=setup(t,{until,maxRecords:2});await sink.ready;sink.emit({requestId});sink.emit({requestId});await sink.flush();assert.equal(sink.emit({requestId}),false)
 const resumed=createBoundedDiagnostics({directory,campaign,until,maxRecords:2});await resumed.ready;assert.equal(resumed.emit({requestId}),false);await resumed.close()
 const link=directory+'-link';fs.symlinkSync(directory,link);t.after(()=>fs.rmSync(link,{force:true}))
 const unsafe=createBoundedDiagnostics({directory:link,campaign,until});await unsafe.ready;assert.equal(unsafe.active(),false);await unsafe.close()
})
test('one complete failure plus normal comparison automatically stops new records and preserves the final event',async t=>{
 const {sink,directory}=setup(t);await sink.ready
 sink.emit({requestId,route:'oauth-token',phase:'finish',status:200,totalMs:12,outcome:'consumed'})
 sink.emit({requestId,route:'oauth-token',phase:'finish',status:400,oauthError:'invalid_grant',reason:'code_consumed'})
 await sink.flush();assert.equal(sink.active(),false);assert.equal(sink.state().fault,'evidence-complete')
 assert.match(fs.readFileSync(path.join(directory,'events.jsonl'),'utf8'),/code_consumed/)
 assert.equal(sink.emit({requestId}),false)
})
