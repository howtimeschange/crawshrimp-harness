'use strict'
const http=require('node:http')
const {randomBytes,timingSafeEqual}=require('node:crypto')
// Per-process capability inherited only by the managed agent runtime. Never sends Auth tokens.
function createMarketplaceBridge({run}) {
 const token=randomBytes(32).toString('hex');let server,url=''
 const allowed=new Set(['list','history','prepare-zip','publish','submit','cancel','unlist','discard-zip'])
 return {
  async start(){
   if(server)return
   server=http.createServer((req,res)=>{
    const reply=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body))}
    const supplied=Buffer.from(String(req.headers['x-crawshrimp-market-token']||'')),expected=Buffer.from(token)
    if(req.headers.origin||supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return reply(403,{error:'Forbidden'})
    if(req.method!=='POST'||req.url!=='/market')return reply(404,{error:'Not found'})
    let body='';req.setTimeout(15000,()=>req.destroy())
    req.on('data',chunk=>{body+=chunk;if(Buffer.byteLength(body)>150000)req.destroy()})
    req.on('end',async()=>{try{
     const {action,input={}}=JSON.parse(body)
     if(!allowed.has(action))throw Error('Unsupported market command')
     if(action==='prepare-zip' && (typeof input.path!=='string'||!require('node:path').isAbsolute(input.path)))throw Error('An absolute ZIP path is required')
     req.setTimeout(0)
     // CLI owns its temporary preparations; renderer remains isolated by random tokens.
     reply(200,{ok:true,result:await run(action,action==='list'?{...input,mine:true}:input)})
    }catch(e){reply(400,{ok:false,error:e.message,auto_retry:false})}})
   })
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
   url=`http://127.0.0.1:${server.address().port}/market`;server.unref()
  },
  environment(){if(!url)throw Error('Market bridge not started');return {CRAWSHRIMP_MARKET_URL:url,CRAWSHRIMP_MARKET_TOKEN:token}},
  async close(){if(server)await new Promise(r=>server.close(r));server=null;url=''}
 }
}
module.exports={createMarketplaceBridge}
