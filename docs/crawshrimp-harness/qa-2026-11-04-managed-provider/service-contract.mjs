import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {generateKeyPairSync} from 'node:crypto'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
const require=createRequire(import.meta.url)
const {createManagedAccount}=require('../../../app/src/managedAccount.js')
if(!process.env.MODELJETTY_SERVICE_ROOT)throw Error('Set MODELJETTY_SERVICE_ROOT to the local account-service directory; local synthetic providers only')
const {createService}=await import(pathToFileURL(path.join(process.env.MODELJETTY_SERVICE_ROOT,'src/service.mjs')))
// In-memory storage mirrors the current managed-disconnect HTTP fixture. This
// probe proves HTTP/client contracts, not PostgreSQL persistence.
function fixtureStore(){
 const oidc=new Map(),accounts=new Map(),requests=new Map()
 return {Adapter:class{
  constructor(kind){this.kind=kind}
  async upsert(id,p,ttl){oidc.set(this.kind+':'+id,{p:structuredClone(p),expires:ttl?Date.now()+ttl*1000:Infinity})}
  async find(id){const v=oidc.get(this.kind+':'+id);return v&&v.expires>Date.now()?structuredClone(v.p):undefined}
  async destroy(id){oidc.delete(this.kind+':'+id)}
  async revokeByGrantId(id){for(const [k,v]of oidc)if(v.p.grantId===id)oidc.delete(k)}
 },async account(id){return accounts.get(id)},async saveAccount(id,profile,upstream){accounts.set(id,{...profile,id,upstream})},
 async claimInference(id,account,kind,limits){
  if(requests.has(id))return 'duplicate'
  if([...requests.values()].filter(r=>r.account_id===account&&['in_progress','unknown'].includes(r.state)).length>=limits.concurrency)return 'limit'
  requests.set(id,{id,account_id:account,state:'in_progress',inference_kind:kind,billing_request_id:null,created_at:new Date()});return 'acquired'
 },async recordBillingRequest(id,owner,billing){
  if(typeof billing!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(billing))return false
  const row=requests.get(id);if(row?.account_id!==owner||row.billing_request_id&&row.billing_request_id!==billing)throw Error('billing_request_identity_conflict')
  row.billing_request_id=billing;return true
 },async finishRequest(id,state){requests.get(id).state=state},async request(id,owner){const row=requests.get(id);return row?.account_id===owner?{...row}:undefined}}
}

for(const scenario of ['done','truncated','cancel',400,403,408,409,500,502])test('real service + broker: '+scenario,{timeout:10000},async t=>{
 const store=fixtureStore();let posts=0,service
 const provider=http.createServer(async(req,res)=>{
  posts++;for await(const _ of req){}
  res.writeHead(typeof scenario==='number'?scenario:200,{'Content-Type':typeof scenario==='number'?'application/json':'text/event-stream','X-Oneapi-Request-Id':'original_billing_fixture'})
  if(typeof scenario==='number')return res.end('{"error":"synthetic status"}')
  res.write('data: {"choices":[{"delta":{"content":"fixture"},"finish_reason":null}]}\n\n')
  setTimeout(()=>scenario==='truncated'?res.destroy():res.end('data: [DONE]\n\n'),60)
 })
 await new Promise(r=>provider.listen(0,'127.0.0.1',r))
 const server=http.createServer((req,res)=>service.handle(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r))
 t.after(()=>{provider.closeAllConnections();server.closeAllConnections();provider.close();server.close()})
 const origin='http://127.0.0.1:'+server.address().port,owner='newapi:fixture-owner'
 await store.saveAccount(owner,{name:'Synthetic'},{key:'never-real',walletEnabled:true,plan:'pro'})
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048})
 service=await createService({issuer:origin+'/oidc',webOrigin:origin,store,upstream:{origin:'http://127.0.0.1:'+provider.address().port,models:async()=>['gemini-3.8-flash-high']},readPaidModelAccess:async()=>true,jwks:{keys:[{...privateKey.export({format:'jwk'}),kid:'fixture',alg:'RS256'}]},cookieKeys:['synthetic-cookie-key-at-least-32-characters']})
 async function token(accountId){const grant=new service.provider.Grant({accountId,clientId:'crawshrimp-desktop'});grant.addOIDCScope('openid models:invoke');const grantId=await grant.save();return new service.provider.AccessToken({accountId,clientId:'crawshrimp-desktop',grantId,scope:'models:invoke'}).save()}
 const accessToken=await token(owner),dir=fs.mkdtempSync(path.join(os.tmpdir(),'harness-service-contract-'))
 fs.writeFileSync(path.join(dir,'modeljetty-session.enc'),JSON.stringify({session:JSON.stringify({access_token:accessToken,expiresAt:Date.now()+3600000})}))
 const desktop=createManagedAccount({issuer:origin+'/oidc',directory:dir,runtimeDirectory:()=>dir,development:true,openExternal:async()=>{},safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()}})
 t.after(()=>{desktop.dispose();fs.rmSync(dir,{recursive:true,force:true})})
 await desktop.run('status');const broker=JSON.parse(fs.readFileSync(path.join(dir,'managed-model-session.json')))
 const body=JSON.stringify({model:'managed-gemini-3.8-flash-high',messages:[{role:'user',content:'synthetic'}],stream:true})
 const response=await fetch(broker.baseURL+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+broker.brokerToken},body})
 const id=response.headers.get('x-request-id');assert.ok(id);assert.equal(response.headers.get('x-oneapi-request-id'),'original_billing_fixture')
 if(scenario==='truncated')await assert.rejects(response.text())
 else if(scenario==='cancel'){const reader=response.body.getReader();assert.equal((await reader.read()).done,false);await reader.cancel()}
 else await response.text()
 const wanted=['done','cancel'].includes(scenario)?'completed':typeof scenario==='number'&&[400,403].includes(scenario)?'upstream_rejected':'unknown'
 let trace;for(let i=0;i<100;i++){trace=(await desktop.run('request-trace',{requestId:id})).request;if(trace?.state!== 'in_progress')break;await new Promise(r=>setTimeout(r,10))}
 assert.equal(trace.state,wanted);assert.equal(trace.requestId,id);assert.equal(trace.billingRequestId,'original_billing_fixture');assert.equal(posts,1)
 assert.deepEqual(Object.keys(trace).sort(),['billingRequestId','createdAt','requestId','state'])
 const duplicate=await fetch(origin+'/account/inference/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json','X-Request-Id':id},body:body.replace('managed-','')});assert.equal(duplicate.status,409);await duplicate.text();assert.equal(posts,1)
 await store.saveAccount('newapi:other',{name:'Other'},{key:'never-real',walletEnabled:true,plan:'pro'})
 const other=await fetch(origin+'/account/requests/'+id,{headers:{Authorization:'Bearer '+await token('newapi:other')}});assert.equal((await other.json()).request,null);assert.equal(posts,1)
})
