'use strict'
// Read-only cloud timing with a temporary copy of the existing encrypted account.
const {app,safeStorage}=require('electron')
const {createClient}=require('@supabase/supabase-js')
const {createAccountAuth}=require('../src/accountAuth')
const {createMarketplace}=require('../src/marketplace')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
app.setName('crawshrimp-harness')
app.whenReady().then(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'market-read-'))
 const source=process.env.MARKET_ACCOUNT_DIRECTORY || path.join(os.homedir(),'Library/Application Support/crawshrimp-harness/account')
 fs.cpSync(source,dir,{recursive:true})
 const timings=[]
 const auth=createAccountAuth({config:require('../src/accountConfig.json'),directory:dir,safeStorage,createClient:(url,key,opts)=>createClient(url,key,{...opts,global:{...opts.global,fetch:async(url,options)=>{const start=performance.now();try{const result=await opts.global.fetch(url,options);timings.push({endpoint:new URL(url).pathname,status:result.status,ms:Math.round(performance.now()-start)});return result}catch(e){timings.push({endpoint:new URL(url).pathname,error:e.name,ms:Math.round(performance.now()-start)});throw e}}}})})
 const market=createMarketplace({accountState:()=>auth.run('status'),getClient:()=>auth.getClient(),version:'0.2.0'})
 try {
  for(const mine of [false,true]){const start=performance.now();const list=await market.run('list',{mine});console.log(JSON.stringify({action:mine?'mine':'discover',items:list.items.length,ms:Math.round(performance.now()-start)}));if(!mine&&list.items[0]){const start=performance.now();const r=await market.run('ratings',{id:list.items[0].id});console.log(JSON.stringify({action:'ratings',reviews:r.reviews.length,ms:Math.round(performance.now()-start)}))}}
  console.log(JSON.stringify({requests:timings,cloudMutation:false}))
 }finally{auth.dispose();fs.rmSync(dir,{recursive:true,force:true});app.quit()}
}).catch(e=>{console.error(e.message);app.exit(1)})
