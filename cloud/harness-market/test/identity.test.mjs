import test from 'node:test'
import assert from 'node:assert/strict'
import {createMarketBridge,allowedMarketRoute} from '../functions/modeljetty-market/market.mjs'
test('market bridge permits only marketplace reads, owner RPCs and immutable ZIP operations',()=>{
 for(const [p,m] of [['/rest/v1/market_packages','GET'],['/rest/v1/rpc/market_rate','POST'],['/storage/v1/object/market-packages/'+'a'.repeat(36)+'/'+'b'.repeat(36)+'.zip','POST']])assert.equal(allowedMarketRoute(p,m),true)
 for(const [p,m] of [['/rest/v1/harness_analytics_admins','GET'],['/rest/v1/rpc/market_review','POST'],['/rest/v1/market_packages','PATCH'],['/auth/v1/admin/users','POST'],['/storage/v1/object/market-packages/x/../../private','GET']])assert.equal(allowedMarketRoute(p,m),false)
})
test('market identity is stable, isolated and forwards user JWT rather than admin bearer',async()=>{
 const records=new Map(),calls=[];let serial=0
 class Adapter{async find(id){return records.get(id)}async upsert(id,value){records.set(id,value)}}
 const bridge=createMarketBridge({url:'https://market.invalid',serviceKey:'server-only',store:{Adapter},fetcher:async(url,options)=>{
 calls.push({url,...options})
 if(url.endsWith('admin/generate_link')){const email=JSON.parse(options.body).email;return Response.json({id:email,hashed_token:email,verification_type:'signup'})}
 if(url.endsWith('/verify')){assert.equal(JSON.parse(options.body).type,'signup');const id=JSON.parse(options.body).token_hash;return Response.json({user:{id},access_token:'user-'+(++serial),expires_in:3600})}
 return Response.json([])
 }})
 const [a,b]=await Promise.all([bridge.identity('newapi:1'),bridge.identity('newapi:1')]);assert.equal(a.userId,b.userId);assert.equal(serial,1)
 const c=await bridge.identity('newapi:2');assert.notEqual(a.userId,c.userId)
 await bridge.proxy('newapi:1','/rest/v1/market_packages','?select=*','GET',{authorization:'Bearer forged',apikey:'forged'})
 assert.equal(calls.at(-1).headers.Authorization,'Bearer user-1');assert.equal(calls.at(-1).headers.apikey,'server-only')
 await assert.rejects(bridge.proxy('newapi:1','/rest/v1/rpc/market_review','','POST',{},Buffer.from('{}')),/not allowed/)
 assert.equal(records.size,2)
})
