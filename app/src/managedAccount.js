'use strict'
const http = require('node:http')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { managedInferenceStream } = require('./managedInferenceStream')
const { atomicWriteFileSync } = require('./atomicFile')
const { createEncryptedStorage } = require('./accountAuth')
const { diagnosticFetch, oauthFailure } = require('./managedDiagnostics')
const { createBoundedDiagnostics } = require('./boundedDiagnostics')
function serviceURL(value, development=false) {
  const url=new URL(value)
  if(url.username||url.password||url.search||url.hash || (url.protocol!=='https:' && !(development&&url.protocol==='http:'&&url.hostname==='127.0.0.1')))throw new Error('账号中心地址无效')
  return url
}
function createManagedAccount({issuer,directory,runtimeDirectory,safeStorage,openExternal,copyText,notify=()=>{},development=false,fetcher=fetch}) {
  const authority=serviceURL(issuer,development),origin=authority.origin
  const diagnosticCampaign=process.env.HARNESS_DIAGNOSTICS_RUN
  const diagnostic=diagnosticCampaign?createBoundedDiagnostics({directory:path.join(directory,'diagnostics'),campaign:diagnosticCampaign,until:process.env.HARNESS_DIAGNOSTICS_UNTIL}):null
  const record=event=>{if(['oauth-token','inference'].includes(event.route))diagnostic?.emit(event)}
  fetcher=diagnosticFetch(fetcher,diagnostic?{enabled:()=>diagnostic.active(),campaign:diagnosticCampaign,allowedOrigin:origin,traceConnections:true,emit:event=>record({...event,phase:'finish'}),onHeaders:event=>record({...event,phase:'headers'})}:undefined)
  function logOAuth(error){const event=oauthFailure(error);if(diagnostic){record({...event,phase:'finish',oauthError:event.reason})}else console.warn('[managed-oauth-diagnostic]',JSON.stringify(event))}
  const storage=createEncryptedStorage({file:path.join(directory,'modeljetty-session.enc'),safeStorage})
  let session=null,config=null,pending=null,broker=null,brokerKey='',catalog=[],profile=null,generation=0,refreshing=null,hydrating=null,catalogRefreshing=null,catalogUpdatedAt=0,message='',loginStarting=false
  const runtimeFile=()=>path.join(runtimeDirectory(),'managed-model-session.json')
  const modulePromise=import('openid-client')
  async function configuration(){if(config)return config;const oidc=await modulePromise;try{config=await oidc.discovery(authority,'crawshrimp-desktop',undefined,oidc.None(),{[oidc.customFetch]:fetcher,...(development?{execute:[oidc.allowInsecureRequests]}:{})});return config}catch(error){logOAuth(error);throw error}}
  function save(){if(session)storage.setItem('session',JSON.stringify(session));else storage.clear()}
  function load(){if(!session){const raw=storage.getItem('session');if(raw)session=JSON.parse(raw)}return session}
  async function access(){load();if(!session)throw new Error('请先登录抓虾官方服务');if(session.expiresAt>Date.now()+30000)return session.access_token;if(refreshing)return refreshing;const epoch=generation,previous=session;const operation=(async()=>{try{const oidc=await modulePromise;const next=await oidc.refreshTokenGrant(await configuration(),previous.refresh_token);if(epoch!==generation)throw new Error('账号已切换');session={...next,refresh_token:next.refresh_token||previous.refresh_token,expiresAt:Date.now()+next.expires_in*1000};save();return session.access_token}catch(error){logOAuth(error);if(epoch===generation){session=null;profile=null;storage.clear();await stopBroker();message='登录已失效，请重新登录';notify()}throw error}finally{if(refreshing===operation)refreshing=null}})();refreshing=operation;return operation}
  async function api(route,method='GET'){const token=await access();const response=await fetcher(new URL(route,origin),{method,headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(response.status===401?'登录已失效，请重新登录':'官方服务暂不可用，请稍后重试');return response.json()}
  function cancel(){if(pending){clearTimeout(pending.timer);pending.server.close();pending=null;session=null;profile=null;storage.clear();void stopBroker()}generation++;hydrating=null;refreshing=null}
  async function stopBroker(){brokerKey='';catalog=[];catalogUpdatedAt=0;catalogRefreshing=null;try{fs.rmSync(runtimeFile(),{force:true})}catch{}if(broker){broker.closeAllConnections();broker.close();broker=null}}
  async function startBroker(epoch){await stopBroker();if(epoch!==generation)return;brokerKey=crypto.randomBytes(32).toString('base64url');const key=brokerKey,accountId=profile.user.id
    broker=http.createServer(async(req,res)=>{
      const started=performance.now(),timing={outcome:'unknown'}
      const elapsed=()=>Math.round(performance.now()-started)
      res.setHeader('Cache-Control','no-store')
      const fail=(status,error)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:error,type:'managed_service',...(timing.requestId?{request_id:timing.requestId}:{})}}))}
      try{
        const provided=String(req.headers.authorization||'').replace(/^Bearer /,'')||String(req.headers['x-goog-api-key']||'')
        if(epoch!==generation||accountId!==profile?.user?.id||provided.length!==key.length||!crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(key))||req.headers.origin)return fail(401,'本机官方服务会话已失效，请重新选择模型')
        const url=new URL(req.url,'http://127.0.0.1')
        if(req.method!=='POST'||url.search||!(/^\/v1\/(chat\/completions|responses|images\/generations)$/.test(url.pathname)||/^\/v1beta\/models\/[a-zA-Z0-9.-]+:generateContent$/.test(url.pathname)))return fail(404,'不支持的模型接口')
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>32*1024*1024)return fail(413,'请求内容过大');chunks.push(chunk)}
        const body=JSON.parse(Buffer.concat(chunks).toString());if(typeof body.model==='string')body.model=body.model.replace(/^managed-/,'')
        timing.bodyReadMs=elapsed();timing.requestBytes=size;timing.model=typeof body.model==='string'?body.model:url.pathname.split('/').pop().split(':')[0]
        const requestId=crypto.randomUUID();timing.requestId=requestId
        res.setHeader('X-Request-Id',requestId)
        const authStarted=performance.now(),token=await access();timing.authMs=Math.round(performance.now()-authStarted)
        if(epoch!==generation)return fail(401,'账号已切换')
        record({route:'inference',phase:'start',requestId,authMs:timing.authMs,bodyReadMs:timing.bodyReadMs})
        const upstreamStarted=performance.now()
        const response=await fetcher(new URL('/account/inference'+url.pathname,origin),{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Request-Id':requestId},body:JSON.stringify(body),signal:AbortSignal.timeout(600000)})
        timing.upstreamHeadersMs=Math.round(performance.now()-upstreamStarted);timing.status=response.status
        const contentType=response.headers.get('content-type')||'application/json',billingId=response.headers.get('x-oneapi-request-id')
        res.writeHead(response.status,{'Content-Type':contentType,'X-Request-Id':requestId,...(typeof billingId==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(billingId)?{'X-Oneapi-Request-Id':billingId}:{})})
        const observer=response.ok?managedInferenceStream(contentType,url.pathname):null
        if(response.body)await pipeline(Readable.fromWeb(response.body),...(observer?[observer]:[]),res);else res.end()
        timing.outcome=response.status>=500||[408,409].includes(response.status)?'unknown':response.ok?'completed':'rejected'
      }catch{timing.outcome='unknown';if(!res.headersSent){timing.status=409;fail(409,'官方请求结果未知，请核对任务与账单，不要直接重复生成')}else res.destroy()}finally{if(!diagnosticCampaign&&process.env.CRAWSHRIMP_MANAGED_TIMINGS==='1'&&timing.requestId){timing.totalMs=elapsed();console.info('[managed-inference-timing]',JSON.stringify(timing))}}
    })
    const currentBroker=broker
    await new Promise((resolve,reject)=>{currentBroker.once('error',reject);currentBroker.listen(0,'127.0.0.1',resolve)})
    if(epoch!==generation)return
    await refreshCatalog(true)
  }
  async function refreshCatalog(force=false){
    if(!broker||!profile?.user||!session)return
    if(catalogRefreshing)return catalogRefreshing
    if(!force&&Date.now()-catalogUpdatedAt<60000)return
    const epoch=generation,currentBroker=broker,key=brokerKey,accountId=profile.user.id
    const operation=(async()=>{
      const result=await api('/account/models')
      if(epoch!==generation||broker!==currentBroker||accountId!==profile?.user?.id)return
      if(!Array.isArray(result.models))throw new Error('官方模型目录格式无效')
      if(JSON.stringify(result.models)===JSON.stringify(catalog)&&fs.existsSync(runtimeFile())){catalogUpdatedAt=Date.now();return}
      // Preserve the live broker capability and in-flight inference while updating its catalogue.
      atomicWriteFileSync(runtimeFile(),JSON.stringify({version:1,accountId,baseURL:`http://127.0.0.1:${currentBroker.address().port}`,brokerToken:key,models:result.models}))
      fs.chmodSync(runtimeFile(),0o600)
      catalog=result.models;catalogUpdatedAt=Date.now()
    })()
    catalogRefreshing=operation
    try{await operation}finally{if(catalogRefreshing===operation)catalogRefreshing=null}
  }
  async function hydrate(){if(hydrating)return hydrating;const epoch=generation;const operation=(async()=>{const next=await api('/account/me');if(epoch!==generation)return;profile=next;await startBroker(epoch)})().finally(()=>{if(hydrating===operation)hydrating=null});hydrating=operation;return operation}
  async function status(){load();if(session&&(!profile||hydrating)){await hydrate()}else if(session&&profile){await refreshCatalog()}return {configured:true,managed:true,user:profile?.user||null,pending:pending?'oauth':'',recovery:false,message,plan:profile?.plan||null,models:catalog.map(({id,name,kind})=>({id,name,kind})),plansURL:`${origin}/plans`}}
  async function login(){if(pending||loginStarting)throw new Error('请完成或取消当前网页登录');loginStarting=true;const epoch=generation;try{return await beginLogin(epoch)}finally{loginStarting=false}}
  async function beginLogin(startEpoch){if(pending)throw new Error('请完成或取消当前网页登录');await configuration();if(startEpoch!==generation)return status();const oidc=await modulePromise;const verifier=oidc.randomPKCECodeVerifier(),state=oidc.randomState(),nonce=oidc.randomNonce(),epoch=++generation
    hydrating=null;refreshing=null;await stopBroker();profile=null;session=null;storage.clear();message=''
    let callbackOrigin
    const server=http.createServer(async(req,res)=>{
      const url=new URL(req.url,callbackOrigin)
      if(req.method!=='GET'||req.headers.host!==new URL(callbackOrigin).host||url.pathname!=='/auth/callback'||url.searchParams.get('state')!==state){res.writeHead(400).end('Invalid login callback');return}
      if(!pending||pending.exchanging||epoch!==generation){res.writeHead(410).end();return}
      clearTimeout(pending.timer);pending.exchanging=true;server.close();res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end('已收到授权，请返回抓虾。')
      try{const tokens=await oidc.authorizationCodeGrant(config,url,{pkceCodeVerifier:verifier,expectedState:state,expectedNonce:nonce});if(epoch!==generation)return;session={...tokens,expiresAt:Date.now()+tokens.expires_in*1000};save();await hydrate();if(epoch===generation)message='网页登录成功'}catch(error){logOAuth(error);if(epoch===generation){session=null;profile=null;storage.clear();await stopBroker();message='登录未完成，请重新发起';const reason=['invalid_grant','access_denied','invalid_request','server_error','temporarily_unavailable'].includes(error?.error)?error.error:'unclassified';if(!diagnosticCampaign)console.warn('[managed-login-failure]',JSON.stringify({code:typeof error?.code==='string'&&/^[A-Z_]+$/.test(error.code)?error.code:'UNKNOWN',reason}))}}finally{if(epoch===generation)pending=null;notify()}
    })
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
    if(epoch!==generation){server.close();return status()}
    callbackOrigin=`http://127.0.0.1:${server.address().port}`
    const redirect=callbackOrigin+'/auth/callback'
    pending={server,timer:setTimeout(()=>{cancel();message='登录等待已过期';notify()},600000)};pending.timer.unref?.()
    const url=oidc.buildAuthorizationUrl(config,{redirect_uri:redirect,scope:'openid offline_access models:invoke',code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',state,nonce,prompt:'login consent'})
    if(epoch!==generation)return status()
    pending.url=url.href
    try{await openExternal(url.href)}catch{cancel();throw new Error('无法打开浏览器，请重试')};return status()
  }
  async function logout(){let token;try{token=load()?.access_token}catch{}cancel();await stopBroker();session=null;profile=null;storage.clear();message='';if(token){try{const response=await fetcher(new URL('/account/session',origin),{method:'DELETE',headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Revocation not confirmed')}catch{message='本机已退出；云端会话未确认撤销，请在账号中心核对'}}notify();return status()}
  return {async run(action,input={}){if(action==='request-trace'){if(typeof input.requestId!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(input.requestId))throw new Error('请求编号无效');return api('/account/requests/'+input.requestId)}if(action==='status')return status();if(action==='refresh-models'){await refreshCatalog(true);return status()};if(action==='login'||action==='oauth')return login();if(action==='reopen'){if(!pending?.url)throw new Error('请重新发起登录');await openExternal(pending.url);return status()}if(action==='copy-login-link'){if(!pending?.url)throw new Error('请重新发起登录');if(!copyText)throw new Error('当前客户端不支持复制登录链接');await copyText(pending.url);message='登录链接已复制，请粘贴到浏览器打开';return status()}if(action==='cancel'){cancel();return status()}if(action==='logout')return logout();if(action==='plans'){await openExternal(`${origin}/plans`);return status()}if(action==='usage')return api('/account/usage');throw new Error('请在网页账号中心完成此操作')},analyticsSession:async()=>null,getClient(){
    const {createClient}=require('@supabase/supabase-js')
    return createClient(origin+'/account/market','managed-market',{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{fetch:async(url,options={})=>{
        const target=new URL(url)
        if(target.origin!==origin||!target.pathname.startsWith('/account/market/'))throw new Error('市场请求地址无效')
        const headers=new Headers(options.headers)
        headers.set('Authorization','Bearer '+await access());headers.delete('apikey')
        return fetcher(target,{...options,headers,redirect:'error',signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000)})
      }},
    })
  },marketState:async()=>{const state=await status();return state.user?api('/account/market/profile'):state},dispose(){cancel();void stopBroker();void diagnostic?.close()},api}
}
module.exports={createManagedAccount,serviceURL}
