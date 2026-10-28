'use strict'
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {createManagedAccount}=require('./managedAccount')
test('managed GPT image edits preserve binary multipart and reject unavailable models before forwarding',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'image-edit-broker-'))
 const storage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()}
 fs.writeFileSync(path.join(dir,'modeljetty-session.enc'),JSON.stringify({session:JSON.stringify({access_token:'fixture-account-token',expiresAt:Date.now()+3600000})}))
 const calls=[]
 const account=createManagedAccount({issuer:'https://account.example',directory:dir,runtimeDirectory:()=>dir,safeStorage:storage,openExternal:async()=>{},fetcher:async(url,init)=>{
  const u=new URL(url)
  if(u.pathname==='/account/me')return Response.json({user:{id:'fixture-owner'},plan:'plus'})
  if(u.pathname==='/account/models')return Response.json({models:[{id:'gpt-image-2',kind:'image',protocol:'openai',available:true}]})
  calls.push({url:u.pathname,init});return Response.json({data:[{b64_json:'fixture-result'}]})
 }})
 t.after(()=>{account.dispose();fs.rmSync(dir,{recursive:true,force:true})})
 await account.run('status')
 const runtime=JSON.parse(fs.readFileSync(path.join(dir,'managed-model-session.json')))
 const bytes=Buffer.from([137,80,78,71,0,255,13,10]),makeForm=(model='managed-gpt-image-2')=>{
  const form=new FormData();form.set('model',model);form.set('prompt','保留参考图细节');form.append('image',new Blob([bytes],{type:'image/png'}),'reference.png');return form
 }
 const response=await fetch(runtime.baseURL+'/v1/images/edits',{method:'POST',headers:{Authorization:`Bearer ${runtime.brokerToken}`},body:makeForm()})
 assert.equal(response.status,200);assert.equal(calls.length,1)
 const forwarded=calls[0];assert.equal(forwarded.url,'/account/inference/v1/images/edits')
 assert.equal(new Headers(forwarded.init.headers).get('authorization'),'Bearer fixture-account-token');assert.equal(forwarded.init.redirect,'error')
 const form=await new Request('http://fixture.invalid',{method:'POST',headers:forwarded.init.headers,body:forwarded.init.body}).formData()
 assert.equal(form.get('model'),'gpt-image-2');assert.equal(form.get('prompt'),'保留参考图细节')
 assert.deepEqual(Buffer.from(await form.get('image').arrayBuffer()),bytes)
 assert.equal((await fetch(runtime.baseURL+'/v1/images/edits',{method:'POST',headers:{Authorization:`Bearer ${runtime.brokerToken}`},body:makeForm('not-offered')})).status,400)
 assert.equal((await fetch(runtime.baseURL+'/v1/images/edits',{method:'POST',headers:{Authorization:`Bearer ${runtime.brokerToken}`,'Content-Type':'application/json'},body:'{}'})).status,400)
 assert.equal(calls.length,1,'rejected edits must never reach a paid endpoint')
})

test('wallet reads use fixed authenticated CNY and production subscription endpoints and reject account drift', async t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wallet-read-'))
 const storage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()}
 fs.writeFileSync(path.join(dir,'modeljetty-session.enc'),JSON.stringify({session:JSON.stringify({access_token:'fixture-account-token',expiresAt:Date.now()+3600000})}))
 const calls=[];let pending=false,release
 const account=createManagedAccount({issuer:'https://account.example',directory:dir,runtimeDirectory:()=>dir,safeStorage:storage,openExternal:async()=>{},fetcher:async(url,init)=>{
  const target=new URL(url);calls.push({target,init})
  if(target.pathname==='/account/session')return Response.json({ok:true})
  if(pending)return new Promise(resolve=>{release=resolve})
  return Response.json(target.pathname==='/account/allowance'?{currency:'CNY',available:55}:{active:false})
 }})
 t.after(()=>{account.dispose();fs.rmSync(dir,{recursive:true,force:true})})
 assert.deepEqual(await account.run('allowance'),{currency:'CNY',available:55})
 assert.deepEqual(await account.run('subscription'),{active:false})
 assert.deepEqual(calls.map(c=>c.target.pathname),['/account/allowance','/account/apple/subscription'])
 for(const {target,init} of calls){assert.equal(target.search,'');assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(new Headers(init.headers).get('authorization'),'Bearer fixture-account-token')}
 pending=true
 const oldRead=account.run('allowance');while(!release)await new Promise(resolve=>setImmediate(resolve))
 await account.run('logout');release(Response.json({currency:'CNY',available:999}))
 await assert.rejects(oldRead,/账号已切换/)
 const before=calls.length
 await assert.rejects(account.run('allowance'),/请先登录/)
 assert.equal(calls.length,before)
})

test('new desktop registration has its own PKCE flow and cancellation preserves no pending login', async t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-first-run-'))
 let destination
 const authority='http://127.0.0.1:19875/oidc'
 const account=createManagedAccount({issuer:authority,development:true,directory:dir,runtimeDirectory:()=>dir,safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},openExternal:async url=>{destination=new URL(url)},fetcher:async()=>Response.json({issuer:authority,authorization_endpoint:authority+'/auth',token_endpoint:authority+'/token',jwks_uri:authority+'/jwks',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256']})})
 t.after(()=>{account.dispose();fs.rmSync(dir,{recursive:true,force:true})})
 assert.equal((await account.run('register')).pending,'oauth')
 assert.equal(destination.searchParams.get('crawshrimp_flow'),'register')
 assert.equal(destination.searchParams.get('code_challenge_method'),'S256')
 assert.match(destination.searchParams.get('redirect_uri'),/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/)
 await assert.rejects(account.run('login'),/完成或取消/)
 assert.equal((await account.run('cancel')).pending,'')
 await account.run('login')
 assert.equal(destination.searchParams.get('crawshrimp_flow'),'login')
 await account.run('cancel')
})

test('Free paid access unlocks text and image routes, survives spending, and clears on refund/legacy/logout', async t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paid-model-broker-'))
 const storage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()}
 fs.writeFileSync(path.join(dir,'modeljetty-session.enc'),JSON.stringify({session:JSON.stringify({access_token:'fixture-token',expiresAt:Date.now()+3600000})}))
 let flag,plan='free',balance=500,inference=0,catalogReads=0,release,hold=false
 const models=[{id:'gpt-6.1-sol',name:'GPT',kind:'text',protocol:'openai-responses'},{id:'deepseek-flash',name:'DeepSeek',kind:'text',protocol:'openai'},{id:'gpt-image-2',name:'GPT Image',kind:'image',protocol:'openai'},{id:'gemini-3.1-flash-image',name:'Gemini',kind:'image',protocol:'gemini'}]
 const account=createManagedAccount({issuer:'https://account.example',directory:dir,runtimeDirectory:()=>dir,safeStorage:storage,openExternal:async()=>{},fetcher:async url=>{
  const path=new URL(url).pathname
  if(path==='/account/me')return Response.json({user:{id:'paid-fixture'},plan,paidModelAccess:flag,balance})
  if(path==='/account/models'){
   catalogReads++
   if(hold)return new Promise(resolve=>{release=resolve})
   return Response.json({plan,paidModelAccess:flag,models:models.map(model=>({...model,available:model.id.startsWith('gemini-')||plan==='pro'||flag===true})),balance})
  }
  if(path==='/account/session')return Response.json({ok:true})
  assert.ok(path.startsWith('/account/inference/'));inference++;return Response.json({ok:true})
 }})
 t.after(()=>{account.dispose();fs.rmSync(dir,{recursive:true,force:true})})
 const runtime=()=>JSON.parse(fs.readFileSync(path.join(dir,'managed-model-session.json')))
 let state=await account.run('status')
 assert.equal(state.plan,'free');assert.equal(state.paidModelAccess,false)
 const invoke=async(path,body)=>{const r=runtime();return fetch(r.baseURL+path,{method:'POST',headers:{Authorization:`Bearer ${r.brokerToken}`,'Content-Type':'application/json'},body:JSON.stringify(body)})}
 for (const invalid of [undefined,false,'true',1]) {
  flag=invalid
  assert.equal((await invoke('/v1/responses',{model:'managed-gpt-6.1-sol',input:'fixture'})).status,403)
  assert.equal(inference,0,'gifts/manual balance/invalid flags must never infer')
 }
 flag=true
 state=await account.run('refresh-models')
 assert.equal(state.plan,'free');assert.equal(state.paidModelAccess,true)
 assert.equal(runtime().paidModelAccess,true)
 assert.equal(state.models.find(m=>m.id==='gpt-image-2').available,true)
 const edit=async()=>{const r=runtime(),form=new FormData();form.set('model','managed-gpt-image-2');form.set('prompt','fixture edit');form.append('image',new Blob([Buffer.from([137,80,78,71])],{type:'image/png'}),'fixture.png');return fetch(r.baseURL+'/v1/images/edits',{method:'POST',headers:{Authorization:`Bearer ${r.brokerToken}`},body:form})}
 assert.equal((await edit()).status,200)
 for(const amount of [10,3.25,0]){
  balance=amount
  for(const [path,body] of [['/v1/responses',{model:'managed-gpt-6.1-sol',input:'fixture'}],['/v1/chat/completions',{model:'managed-deepseek-flash',messages:[]}],['/v1/images/generations',{model:'gpt-image-2',prompt:'fixture'}]]) assert.equal((await invoke(path,body)).status,200)
 }
 const count=inference
 flag=false
 assert.equal((await edit()).status,403)
 assert.equal((await invoke('/v1/images/generations',{model:'gpt-image-2',prompt:'refund'})).status,403)
 assert.equal(inference,count)
 state=await account.run('status');assert.equal(state.paidModelAccess,false)
 assert.equal(runtime().models.find(m=>m.id==='gpt-image-2').available,false)
 plan='pro';await account.run('refresh-models')
 assert.equal((await invoke('/v1/responses',{model:'managed-gpt-6.1-sol',input:'pro'})).status,200)
 plan='free';flag=undefined;await account.run('refresh-models')
 assert.equal((await invoke('/v1/responses',{model:'managed-gpt-6.1-sol',input:'legacy'})).status,403)
 hold=true
 const stale=account.run('refresh-models');while(!release)await new Promise(resolve=>setImmediate(resolve))
 await account.run('logout')
 release(Response.json({plan:'pro',paidModelAccess:true,models}))
 await stale
 state=await account.run('status')
 assert.equal(state.user,null);assert.equal(state.paidModelAccess,false);assert.deepEqual(state.models,[])
 assert.equal(fs.existsSync(path.join(dir,'managed-model-session.json')),false)
 assert.ok(catalogReads>=15,'every inference must refresh authority before forwarding')
})

test('official catalogue refresh adds models and changes permissions without local plan assumptions', async t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'catalog-authority-'))
 const storage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()}
 fs.writeFileSync(path.join(dir,'modeljetty-session.enc'),JSON.stringify({session:JSON.stringify({access_token:'fixture-catalog-token',expiresAt:Date.now()+3600000})}))
 let models=[{id:'new-provider-model',name:'New model',kind:'text',protocol:'openai',available:true}]
 const account=createManagedAccount({issuer:'https://account.example',directory:dir,runtimeDirectory:()=>dir,safeStorage:storage,openExternal:async()=>{},fetcher:async url=>Response.json(new URL(url).pathname==='/account/me'?{user:{id:'catalog-owner'},plan:'free'}:{plan:'free',models})})
 t.after(()=>{account.dispose();fs.rmSync(dir,{recursive:true,force:true})})
 const before=await account.run('status')
 assert.equal(before.models[0].available,true)
 assert.ok(before.modelsUpdatedAt>0)
 const oldRuntime=JSON.parse(fs.readFileSync(path.join(dir,'managed-model-session.json')))
 models=[{...models[0],available:false},{id:'brand-new-model',name:'Future model',kind:'text',protocol:'openai',available:true}]
 const after=await account.run('refresh-models')
 assert.deepEqual(after.models.map(m=>[m.id,m.available]),[['new-provider-model',false],['brand-new-model',true]])
 const updated=JSON.parse(fs.readFileSync(path.join(dir,'managed-model-session.json')))
 assert.equal(updated.baseURL,oldRuntime.baseURL)
 assert.equal(updated.brokerToken,oldRuntime.brokerToken)
 assert.equal(updated.models.length,2)
})

test('broker obeys explicit server availability for future families and never infers access from paid plan', async t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'server-model-authority-'))
 const storage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()}
 fs.writeFileSync(path.join(dir,'modeljetty-session.enc'),JSON.stringify({session:JSON.stringify({access_token:'synthetic-authority-token',expiresAt:Date.now()+3600000})}))
 let plan='free',paidModelAccess=false,models=[{id:'future-provider-v9',name:'Future',kind:'text',protocol:'openai',available:true}],inferences=0
 const account=createManagedAccount({issuer:'https://account.example',directory:dir,runtimeDirectory:()=>dir,safeStorage:storage,openExternal:async()=>{},fetcher:async url=>{
  const target=new URL(url)
  if(target.pathname==='/account/me')return Response.json({user:{id:'future-owner'},plan,paidModelAccess})
  if(target.pathname==='/account/models')return Response.json({plan,paidModelAccess,models})
  assert.ok(target.pathname.startsWith('/account/inference/'));inferences++;return Response.json({choices:[]})
 }})
 t.after(()=>{account.dispose();fs.rmSync(dir,{recursive:true,force:true})})
 await account.run('status')
 const initial=JSON.parse(fs.readFileSync(path.join(dir,'managed-model-session.json')))
 const invoke=id=>fetch(initial.baseURL+'/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${initial.brokerToken}`,'Content-Type':'application/json'},body:JSON.stringify({model:'managed-'+id,messages:[]})})
 assert.equal((await invoke('future-provider-v9')).status,200)
 assert.equal(inferences,1)
 plan='pro';paidModelAccess=true
 for(const availability of [false,undefined,'true',1]){
  models=[{...models[0],available:availability}]
  assert.equal((await invoke('future-provider-v9')).status,403)
  assert.equal(inferences,1,'paid flag and Pro must not override missing/nonboolean/false server permission')
 }
 models=[{id:'gemini-disabled',name:'Gemini',kind:'text',protocol:'openai',available:false}]
 assert.equal((await invoke('gemini-disabled')).status,403)
 models=[]
 assert.ok([400,403].includes((await invoke('future-provider-v9')).status))
 assert.equal(inferences,1)
 const current=JSON.parse(fs.readFileSync(path.join(dir,'managed-model-session.json')))
 assert.equal(current.baseURL,initial.baseURL);assert.equal(current.brokerToken,initial.brokerToken)
})

test('desktop account broker does not expose excluded agent and app routes', async t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-excluded-routes-'))
 const storage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()}
 fs.writeFileSync(path.join(dir,'modeljetty-session.enc'),JSON.stringify({session:JSON.stringify({access_token:'fixture-token',expiresAt:Date.now()+3600000})}))
 const calls=[]
 const account=createManagedAccount({issuer:'https://account.example',directory:dir,runtimeDirectory:()=>dir,safeStorage:storage,openExternal:async()=>{},fetcher:async(url)=>{
  const p=new URL(url).pathname;calls.push(p)
  return Response.json(p==='/account/me'?{user:{id:'fixture-owner'}}:{models:[]})
 }})
 t.after(()=>{account.dispose();fs.rmSync(dir,{recursive:true,force:true})})
 await account.run('status')
 const runtime=JSON.parse(fs.readFileSync(path.join(dir,'managed-model-session.json')))
 const before=calls.length
 for(const route of ['/account/agent/memories/changes','/account/agent/computers','/account/agent/apps/connections']) {
  const response=await fetch(runtime.baseURL+route,{headers:{Authorization:`Bearer ${runtime.brokerToken}`}})
  assert.equal(response.status,404,route)
 }
 assert.equal(calls.length,before)
})
