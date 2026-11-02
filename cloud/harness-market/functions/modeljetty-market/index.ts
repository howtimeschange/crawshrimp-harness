import { createMarketBridge, allowedMarketRoute } from './market.mjs'
const base=Deno.env.get('SUPABASE_URL')!, key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const authOrigin='https://modeljetty.com'
class BindingAdapter {
  async find(id:string) {
    const r=await fetch(`${base}/rest/v1/market_identity_links?account_id=eq.${encodeURIComponent(id)}&select=payload`,{headers:{apikey:key,Authorization:`Bearer ${key}`}})
    if(!r.ok)throw new Error('Identity store unavailable')
    return (await r.json())[0]?.payload
  }
  async upsert(id:string,payload:unknown) {
    const r=await fetch(`${base}/rest/v1/market_identity_links?on_conflict=account_id`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},body:JSON.stringify({account_id:id,payload})})
    if(!r.ok)throw new Error('Identity store unavailable')
  }
}
const bridge=createMarketBridge({url:base,serviceKey:key,store:{Adapter:BindingAdapter}})
const json=(status:number,data:unknown)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}})
Deno.serve(async req=>{
 try {
  const url=new URL(req.url), prefix='/modeljetty-market', offset=url.pathname.indexOf(prefix)
  const path=url.pathname.slice(offset+prefix.length)
  if(!(req.method==='GET'&&path==='/profile')&&!allowedMarketRoute(path,req.method))return json(403,{error:'Market route not allowed'})
  const authorization=req.headers.get('authorization')||''
  if(!/^Bearer [A-Za-z0-9._~-]+$/.test(authorization))return json(401,{error:'Sign in required'})
  // Validate opaque desktop tokens with their issuer on EVERY request, including logout revocation.
  const auth=await fetch(authOrigin+'/account/me',{headers:{Authorization:authorization},redirect:'error',signal:AbortSignal.timeout(15000)})
  if(!auth.ok)return json(auth.status===401?401:403,{error:'Sign in required'})
  const {user}=await auth.json()
  if(!/^newapi:\d+$/.test(user?.id))return json(403,{error:'Unsupported identity'})
  if(path==='/profile')return json(200,{user:{id:(await bridge.identity(user.id)).userId,name:user.name,anonymous:false}})
  const reader=req.body?.getReader();const chunks:Uint8Array[]=[];let size=0
  if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>51*1024*1024){await reader.cancel();return json(413,{error:'File too large'})}chunks.push(value)}
  const body=new Uint8Array(size);let position=0;for(const chunk of chunks){body.set(chunk,position);position+=chunk.length}
  const upstream=await bridge.proxy(user.id,path,url.search,req.method,Object.fromEntries(req.headers),body)
  const headers=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
  for(const name of ['content-type','content-range','range-unit']){const value=upstream.headers.get(name);if(value)headers.set(name,value)}
  return new Response(upstream.body,{status:upstream.status,headers})
 }catch(error){console.error('market_bridge_failure',error instanceof Error?error.message:'unknown');return json(502,{error:'Market identity service temporarily unavailable'})}
})
