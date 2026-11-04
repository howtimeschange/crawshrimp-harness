import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createRequire} from 'node:module'
import {fileURLToPath,pathToFileURL} from 'node:url'
const require=createRequire(import.meta.url)
const {createManagedAccount}=require('../../../app/src/managedAccount.js')
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..')
if(!process.env.HARNESS_JOINT_FIXTURE)throw Error('Set HARNESS_JOINT_FIXTURE to the private local fixture JSON; contents must not be logged')
const config=JSON.parse(fs.readFileSync(process.env.HARNESS_JOINT_FIXTURE,'utf8'))
for(const target of [config.origin,config.issuer,config.controlOrigin])assert.equal(new URL(target).hostname,'127.0.0.1')
const identity=config.access['crawshrimp-desktop'][1]
const evidence=[]
test('Harness broker/provider + isolated candidate HTTP + PostgreSQL trace', {timeout:30000},async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'harness-joint-pg-'))
 fs.writeFileSync(path.join(directory,'modeljetty-session.enc'),JSON.stringify({session:JSON.stringify({access_token:identity.accessToken,refresh_token:identity.refreshToken,expiresAt:Date.now()+3600000})}),{mode:0o600})
 const captured=[]
 const account=createManagedAccount({issuer:config.issuer,directory,runtimeDirectory:()=>directory,development:true,openExternal:async()=>{},safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},fetcher:async(url,options)=>{
  const response=await fetch(url,options)
  if(new URL(url).pathname.startsWith('/account/inference/'))captured.push({id:new Headers(options.headers).get('x-request-id'),body:options.body,path:new URL(url).pathname,billing:response.headers.get('x-oneapi-request-id'),status:response.status})
  return response
 }})
 t.after(()=>{account.dispose();fs.rmSync(directory,{recursive:true,force:true})})
 const status=await account.run('status');assert.equal(status.user.id,identity.owner)
 const broker=JSON.parse(fs.readFileSync(path.join(directory,'managed-model-session.json')))
 const catalog=await (await fetch(config.origin+'/account/models',{headers:{Authorization:'Bearer '+identity.accessToken}})).json()
 const model=catalog.models.find(m=>m.kind==='text'&&m.protocol==='openai')
 assert.ok(model,'Fixture must expose a Chat Completions model')
 const control=async()=>{const response=await fetch(config.controlOrigin,{headers:{Authorization:'Bearer '+config.controlToken}});assert.equal(response.status,200);return response.json()}
 assert.equal((await control()).state.mode,'complete','Do not mutate a shared fixture mode')
 const payload=stream=>JSON.stringify({model:'managed-'+model.id,stream,messages:[{role:'user',content:'Synthetic Harness joint fixture'}]})
 const headers={Authorization:'Bearer '+broker.brokerToken,'Content-Type':'application/json'}
 async function verify(name,before,disconnected=false){
  assert.equal(captured.length,before+1,'One broker inference fetch per operation')
  const original=captured[before];assert.equal(original.status,200);assert.ok(original.id);assert.ok(original.billing)
  let initial=(await account.run('request-trace',{requestId:original.id})).request
  assert.equal(initial.billingRequestId,original.billing)
  let trace=initial
  for(let attempt=0;attempt<150&&trace.state==='in_progress';attempt++){
   await new Promise(r=>setTimeout(r,10));trace=(await account.run('request-trace',{requestId:original.id})).request
  }
  assert.equal(trace.state,'completed');assert.equal(trace.requestId,original.id);assert.equal(trace.billingRequestId,original.billing)
  assert.deepEqual(Object.keys(trace).sort(),['billingRequestId','createdAt','requestId','state'])
  const snapshotBefore=await control(),beforeDuplicate=snapshotBefore.posts.filter(p=>p.billingRequestId===original.billing)
  assert.equal(beforeDuplicate.length,1)
  const duplicate=await fetch(config.origin+original.path,{method:'POST',headers:{Authorization:'Bearer '+identity.accessToken,'Content-Type':'application/json','X-Request-Id':original.id},body:original.body})
  assert.equal(duplicate.status,409);await duplicate.text()
  const after=(await account.run('request-trace',{requestId:original.id})).request
  assert.equal(after.billingRequestId,original.billing);assert.equal(after.state,'completed')
  const snapshotAfter=await control()
  assert.equal(snapshotAfter.posts.filter(p=>p.billingRequestId===original.billing).length,1)
  assert.equal(snapshotAfter.posts.length,snapshotBefore.posts.length,'No additional upstream dispatch after duplicate POST')
  assert.equal(captured.length,before+1)
  evidence.push({name,requestId:original.id,billingRequestId:original.billing,initialState:initial.state,state:trace.state,downstreamDisconnected:disconnected,duplicateStatus:409,originalDispatches:1,brokerInferenceFetches:1,dispatchCountBeforeDuplicate:snapshotBefore.posts.length,dispatchCountAfterDuplicate:snapshotAfter.posts.length})
 }
 await t.test('ordinary JSON request and durable original trace',async()=>{
  const before=captured.length,r=await fetch(broker.baseURL+'/v1/chat/completions',{method:'POST',headers,body:payload(false)})
  assert.equal(r.status,200);assert.ok((await r.json()).choices[0].message.content)
  assert.equal(r.headers.get('x-request-id'),captured[before].id);assert.equal(r.headers.get('x-oneapi-request-id'),captured[before].billing)
  await verify('nonstream-json',before)
 })
 await t.test('complete SSE request through broker',async()=>{
  const before=captured.length,r=await fetch(broker.baseURL+'/v1/chat/completions',{method:'POST',headers,body:payload(true)})
  assert.equal(r.status,200);assert.match(await r.text(),/data: \[DONE\]/);await verify('complete-sse',before)
 })
 await t.test('downstream closes after delta and original upstream completes in PostgreSQL',async()=>{
  const before=captured.length,r=await fetch(broker.baseURL+'/v1/chat/completions',{method:'POST',headers,body:payload(true)}),reader=r.body.getReader()
  const first=await reader.read();assert.equal(first.done,false);assert.match(new TextDecoder().decode(first.value),/fixture/)
  await reader.cancel();await verify('delta-then-client-close',before,true)
 })
 const {streamSimple}=await import(pathToFileURL(path.join(root,'integrations/deepseek-harness/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js')))
 for(const cancel of [false,true])await t.test('installed provider '+(cancel?'cancel after delta':'normal completion'),async()=>{
  const before=captured.length,controller=new AbortController()
  const runtimeModel={id:'managed-'+model.id,name:'Fixture',api:'openai-completions',provider:'crawshrimp-managed-openai',baseUrl:broker.baseURL+'/v1',reasoning:false,input:['text'],contextWindow:64000,maxTokens:128,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}
  let terminal,delta=false
  for await(const event of streamSimple(runtimeModel,{messages:[{role:'user',content:'Synthetic joint provider request',timestamp:Date.now()}]},{apiKey:broker.brokerToken,maxRetries:0,maxTokens:8,timeoutMs:3000,signal:controller.signal})){
   if(event.type==='text_delta'){delta=true;if(cancel)controller.abort()}
   if(event.type==='done'||event.type==='error')terminal=event.type
  }
  assert.ok(delta);assert.equal(terminal,cancel?'error':'done');await verify(cancel?'installed-provider-cancel':'installed-provider-complete',before,cancel)
 })
 assert.equal(captured.length,5)
 fs.writeFileSync(path.join(here,'joint-pg-results.json'),JSON.stringify({status:'passed',serviceSource:config.source,realPostgreSQL:true,realPaidProviderCalls:0,requests:evidence,sharedFixtureModeMutations:0,sessionRevocations:0},null,2)+'\n')
})
