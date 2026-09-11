const {test}=require('node:test')
const assert=require('node:assert/strict')
const {createMarketplaceBridge}=require('./marketplaceBridge')
test('local marketplace capability restricts origin/actions and never returns Auth tokens',async()=>{
 const calls=[];const bridge=createMarketplaceBridge({run:async(a,i)=>{calls.push([a,i]);return {items:[]}}})
 await bridge.start();const env=bridge.environment()
 const request=(action,input={},headers={})=>fetch(env.CRAWSHRIMP_MARKET_URL,{method:'POST',headers:{'x-crawshrimp-market-token':env.CRAWSHRIMP_MARKET_TOKEN,...headers},body:JSON.stringify({action,input})})
 try{
 assert.equal((await request('list',{}, {'x-crawshrimp-market-token':'wrong'})).status,403)
 assert.equal((await request('list',{}, {origin:'https://evil.example'})).status,403)
 assert.equal((await request('review')).status,400)
 assert.equal((await request('prepare-zip',{path:'relative.zip'})).status,400)
 const res=await request('list',{mine:false});assert.equal(res.status,200);assert.deepEqual(await res.json(),{ok:true,result:{items:[]}})
 assert.deepEqual(calls,[['list',{mine:true}]])
 }finally{await bridge.close()}
})
