import { createHmac } from 'node:crypto'
const tables = new Set(['market_packages','market_ratings','market_events'])
const rpcs = new Set(['market_rating_summary','market_rate','market_remove_rating','market_begin_release','market_submit','market_owner_action'])
export function allowedMarketRoute(path, method) {
  if (method === 'GET' && /^\/rest\/v1\/[^/]+$/.test(path)) return tables.has(path.split('/').at(-1))
  if (method === 'POST' && path.startsWith('/rest/v1/rpc/')) return rpcs.has(path.slice('/rest/v1/rpc/'.length))
  return ['GET','POST'].includes(method) && /^\/storage\/v1\/object\/(?:authenticated\/)?market-packages\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.zip$/.test(path)
}
// The service key is used ONLY to establish a regular per-account Auth session.
// All marketplace data requests use that user's JWT, preserving existing RLS.
export function createMarketBridge({url,serviceKey,store,fetcher=fetch}) {
  const origin=new URL(url).origin, sessions=new Map(), flights=new Map()
  const bindings=new store.Adapter('MarketplaceBinding')
  async function authRequest(path,body) {
    const response=await fetcher(origin+'/auth/v1/'+path,{method:'POST',redirect:'error',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)})
    if(!response.ok){const detail=await response.json().catch(()=>({}));throw Object.assign(new Error(`Market Auth ${path}: ${response.status} ${detail.error_code||detail.code||''}`),{status:502})}
    return response.json()
  }
  async function identity(id) {
    const prior=sessions.get(id);if(prior?.expires>Date.now()+60000)return prior
    if(flights.has(id))return flights.get(id)
    const flight=(async()=>{
      const binding=await bindings.find(id)
      const email=binding?.email || `mj-${createHmac('sha256',serviceKey).update(id).digest('hex')}@accounts.modeljetty.invalid`
      const link=await authRequest('admin/generate_link',{type:'magiclink',email})
      const userId=link.user?.id || link.id, tokenHash=link.properties?.hashed_token || link.hashed_token
      if(!userId||!tokenHash)throw new Error('市场身份响应无效')
      if(binding && userId!==binding.userId)throw new Error('市场身份映射不一致')
      const verificationType=link.properties?.verification_type || link.verification_type || 'magiclink'
      if(!['signup','magiclink'].includes(verificationType))throw new Error('Unexpected verification type')
      const session=await authRequest('verify',{type:verificationType,token_hash:tokenHash})
      if(!session.user?.id||!session.access_token||session.user.id!==userId)throw new Error('市场身份验证失败')
      await bindings.upsert(id,{email,userId:session.user.id})
      const result={userId:session.user.id,token:session.access_token,expires:Date.now()+session.expires_in*1000}
      sessions.set(id,result);return result
    })().finally(()=>flights.delete(id));flights.set(id,flight);return flight
  }
  return {identity,async proxy(id,path,query,method,headers,body){
    if(!allowedMarketRoute(path,method))throw Object.assign(new Error('Market route not allowed'),{status:403})
    const user=await identity(id)
    const forwarded={apikey:serviceKey,Authorization:`Bearer ${user.token}`}
    for(const key of ['content-type','accept','prefer','range','range-unit','x-upsert','cache-control'])if(headers[key])forwarded[key]=headers[key]
    return fetcher(origin+path+query,{method,redirect:'error',headers:forwarded,body:method==='GET'?undefined:body,signal:AbortSignal.timeout(60000)})
  }}
}
