#!/usr/bin/env node
'use strict'
const fs=require('node:fs')
async function main(){
 const [action,arg]=process.argv.slice(2)
 if(!action||action==='--help'){console.log('market.cjs list [JSON] | prepare-zip /absolute/package.zip | publish metadata.json | history ID | submit ID | cancel ID | unlist ID');return}
 let input={}
 if(action==='prepare-zip')input={path:arg}
 else if(action==='publish')input=JSON.parse(fs.readFileSync(arg,'utf8'))
 else if(action==='list')input=arg?JSON.parse(arg):{}
 else input={id:arg}
 const url=process.env.CRAWSHRIMP_MARKET_URL,token=process.env.CRAWSHRIMP_MARKET_TOKEN
 if(!url||!token)throw Error('请在已登录抓虾客户端的智能体会话中运行市场 CLI；客户端需要支持市场生命周期版本。')
 const target=new URL(url)
 if(target.hostname!=='127.0.0.1'||target.protocol!=='http:')throw Error('Invalid local market bridge')
 const response=await fetch(target,{method:'POST',headers:{'content-type':'application/json','x-crawshrimp-market-token':token},body:JSON.stringify({action,input}),signal:AbortSignal.timeout(120000)})
 const result=await response.json()
 if(!response.ok||!result.ok)throw Error(result.error||'Market command failed; inspect list before retrying')
 console.log(JSON.stringify(result.result,null,2))
}
main().catch(e=>{console.error(JSON.stringify({error:e.message,auto_retry:false}));process.exitCode=1})
