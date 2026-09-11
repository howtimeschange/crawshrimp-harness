const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {createProductAnalytics,sanitize}=require('./productAnalytics')
test('whitelist drops contents, paths, secrets and invalid usage',()=>{
 assert.deepEqual(sanitize('model_call',{prompt:'secret',api_key:'secret',model:'model',input_tokens:-1,output_tokens:10}),{name:'model_call',model:'model',output_tokens:10})
 assert.equal(sanitize('unknown'),null)
})
test('durable retry, successful ack, identity switching and opt-out',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'harness-analytics-'));let actor={user:{id:'one'},access_token:'secret'},ok=false,requests=[]
 const a=createProductAnalytics({directory:path.join(root,'prefs'),getDataDirectory:()=>root,getSession:async()=>actor,version:'test',environment:'test',fetchImpl:async(_url,options)=>{requests.push(JSON.parse(options.body));return {ok,json:async()=>1}}})
 try{await a.sync();a.record('feature_used',{feature:'agent',prompt:'secret'});await a.flush();assert.equal(requests.length,1);assert.equal(fs.readdirSync(path.join(root,'product-analytics/queue')).length,1)
 ok=true;await a.flush();assert.equal(requests[0].events[0].event_id,requests[1].events[0].event_id);assert.equal(fs.readdirSync(path.join(root,'product-analytics/queue')).length,0)
 a.record('activity');actor={user:{id:'two'},access_token:'other'};await a.sync();assert.equal(fs.readdirSync(path.join(root,'product-analytics/queue')).length,0)
 a.record('activity');a.setEnabled(false);a.record('activity');assert.equal(fs.readdirSync(path.join(root,'product-analytics/queue')).length,0)
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'product-analytics/context.json'))).enabled,false)
 }finally{a.stop();fs.rmSync(root,{recursive:true,force:true})}
})
test('shutdown preserves retry queue and late usage enrichment survives an in-flight ack',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'harness-analytics-race-'));const session={user:{id:'one'},access_token:'secret'}
 const options={directory:path.join(root,'prefs'),getDataDirectory:()=>root,getSession:async()=>session,version:'test',environment:'test'}
 let first=createProductAnalytics({...options,fetchImpl:async()=>({ok:false,json:async()=>0})})
 try{await first.sync();first.record('model_call',{model:'model'});first.stop();
 const queue=path.join(root,'product-analytics/queue');assert.equal(fs.readdirSync(queue).length,1)
 let second=createProductAnalytics({...options,fetchImpl:async()=>{const file=path.join(queue,fs.readdirSync(queue)[0]);const data=JSON.parse(fs.readFileSync(file));data.event.input_tokens=10;fs.writeFileSync(file,JSON.stringify(data));return {ok:true,json:async()=>1}}})
 await second.flush();assert.equal(fs.readdirSync(queue).length,1,'new usage must remain queued after old request acknowledged');second.stop()
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
