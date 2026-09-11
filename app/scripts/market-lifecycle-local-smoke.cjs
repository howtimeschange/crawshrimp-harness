'use strict'
// Real authenticated account + CLI + installer. Read-only cloud acceptance; no approval or upload.
const {app,safeStorage,net}=require('electron')
const {createClient}=require('@supabase/supabase-js')
const {createAccountAuth}=require('../src/accountAuth')
const {createMarketplace}=require('../src/marketplace')
const {createMarketplaceBridge}=require('../src/marketplaceBridge')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict')
const {execFile,execFileSync}=require('node:child_process'),{promisify}=require('node:util')
app.setName('crawshrimp-harness')
app.whenReady().then(async()=>{
 const root=path.resolve(__dirname,'../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'market-lifecycle-'))
 const auth=createAccountAuth({config:require('../src/accountConfig.json'),directory:path.join(os.homedir(),'Library/Application Support/crawshrimp-harness/account'),safeStorage,createClient:(u,k,o)=>createClient(u,k,{...o,global:{fetch:(u,o)=>net.fetch(u,{...o,cache:'no-store'})}})})
 const python=(code,args=[])=>execFileSync(path.join(root,'venv/bin/python3'),['-c',code,...args],{cwd:root,env:{...process.env,CRAWSHRIMP_DATA:path.join(dir,'data')},encoding:'utf8'})
 const file=process.argv.find(a=>a.endsWith('.zip'))
 if(!file)throw Error('Provide an absolute example ZIP path')
 let receipts={},calls=0
 const market=createMarketplace({getClient:()=>auth.getClient(),accountState:()=>auth.run('status'),version:'0.2.0',readInstalls:()=>receipts,writeInstalls:r=>{receipts=r},getInstalled:async()=>JSON.parse(python('from core import adapter_loader as a; import json; a.scan_all(); print(json.dumps(a.list_all()))')),installZip:async bytes=>{calls++;const tmp=path.join(dir,'install.zip');fs.writeFileSync(tmp,bytes);return {ok:true,adapter:JSON.parse(python('from core.adapter_loader import install_from_zip;import sys;print(install_from_zip(sys.argv[1]).model_dump_json())',[tmp]))}}})
 const bridge=createMarketplaceBridge({run:market.run});await bridge.start()
 const cli=async(...args)=>JSON.parse((await promisify(execFile)(process.execPath,[path.join(root,'integrations/deepseek-harness/skills/crawshrimp-market/scripts/market.cjs'),...args],{env:{...process.env,...bridge.environment(),ELECTRON_RUN_AS_NODE:'1'}})).stdout)
 try{
 const prepared=await cli('prepare-zip',file);assert.equal(prepared.version,'2.0.1')
 const list=await cli('list');const hash=require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex')
 const row=list.items.find(p=>p.sha256===hash && p.status==='approved');assert.ok(row,'Existing approved example must match supplied ZIP')
 // Existing local import with no marketplace receipt must be replaced directly.
 python('from core.adapter_loader import install_from_zip;import sys;install_from_zip(sys.argv[1])',[file])
 const installed=await market.run('install',{id:row.id});assert.equal(installed.adapter.id,prepared.adapterId);assert.equal(calls,1)
 assert.equal((await market.run('install',{id:row.id})).alreadyInstalled,true);assert.equal(calls,1)
 console.log(JSON.stringify({ok:true,packageId:row.id,adapterId:prepared.adapterId,version:prepared.version,cliPreparation:true,authenticatedList:true,overwroteLocalImport:true,duplicateInstallSkipped:true,cloudMutation:false},null,2))
 }finally{await bridge.close();auth.dispose();fs.rmSync(dir,{recursive:true,force:true});app.quit()}
}).catch(e=>{console.error(e.message);app.exit(1)})
