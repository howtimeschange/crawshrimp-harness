'use strict'
const fs=require('node:fs')
const path=require('node:path')
const crypto=require('node:crypto')
const {atomicWriteFileSync}=require('./atomicFile')
const NAMES=new Set(['activity','feature_used','model_configured','task_started','task_finished','model_call','app_error'])
const FEATURES=new Set(['agent','skill','file_preview','browser','automation','settings','app'])
function sanitize(name,fields={}){
 if(!NAMES.has(name))return null
 const result={name}
 if(FEATURES.has(fields.feature))result.feature=fields.feature
 if(['succeeded','failed','canceled','unknown'].includes(fields.outcome))result.outcome=fields.outcome
 if(typeof fields.model==='string'&&/^[A-Za-z0-9_.:/-]{1,100}$/.test(fields.model))result.model=fields.model
 if(typeof fields.error_code==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(fields.error_code))result.error_code=fields.error_code
 for(const key of ['duration_ms','input_tokens','output_tokens'])if(Number.isSafeInteger(fields[key])&&fields[key]>=0&&fields[key]<=1e10)result[key]=fields[key]
 return result
}
function createProductAnalytics({directory,getDataDirectory,getSession,version,platform=process.platform,environment='production',endpoint='https://analytics.crawshrimp.com/api/events',fetchImpl=fetch}){
 fs.mkdirSync(directory,{recursive:true})
 const preferences=path.join(directory,'preferences.json')
 let enabled=true;try{enabled=JSON.parse(fs.readFileSync(preferences)).enabled!==false}catch{}
 let actor=null,busy=false,lastActivity=0,lastRoot='',timer=null,syncQueue=Promise.resolve(),initialized=false,stopped=false
 const roots=new Set()
 function root(){const r=path.join(getDataDirectory(),'product-analytics');fs.mkdirSync(path.join(r,'queue'),{recursive:true});roots.add(r);return r}
 function writeContext(){const r=root();if(lastRoot&&lastRoot!==r)atomicWriteFileSync(path.join(lastRoot,'context.json'),JSON.stringify({enabled:false}));lastRoot=r;atomicWriteFileSync(path.join(r,'context.json'),JSON.stringify({enabled:enabled&&!stopped&&!!actor,user_id:actor?.user.id,version,platform,environment}))}
 function clear(){for(const r of roots){try{for(const f of fs.readdirSync(path.join(r,'queue')))if(f.endsWith('.json'))fs.rmSync(path.join(r,'queue',f),{force:true})}catch{}}}
 function sync(){
  const work=syncQueue.then(async()=>{if(stopped)return null;const r=root();let previous=actor?.user?.id;if(!initialized){try{previous=JSON.parse(fs.readFileSync(path.join(r,'context.json'))).user_id}catch{} initialized=true}
    const session=await getSession();if(session?.user?.id!==previous){clear();lastActivity=0}actor=session;writeContext();return session})
  syncQueue=work.catch(()=>{});return work
 }
 function record(name,fields={}){try{if(stopped||!enabled||!actor)return;const clean=sanitize(name,fields);if(!clean)return;const r=root(),queue=path.join(r,'queue');if(fs.readdirSync(queue).length>=5000)return;const event={...clean,event_id:crypto.randomUUID(),occurred_at:new Date().toISOString(),version,platform,environment};atomicWriteFileSync(path.join(queue,event.event_id+'.json'),JSON.stringify({user_id:actor.user.id,event}));}catch{}}
 function activity(){if(Date.now()-lastActivity<60000)return;lastActivity=Date.now();record('activity',{feature:'app'})}
 async function flush(){if(busy)return;busy=true;try{await sync();if(stopped||!enabled||!actor)return;const queue=path.join(root(),'queue'),batch=[];for(const file of fs.readdirSync(queue)){if(!file.endsWith('.json'))continue;const full=path.join(queue,file);try{const raw=fs.readFileSync(full,'utf8');const item=JSON.parse(raw);if(item.user_id!==actor.user.id||Date.parse(item.event.occurred_at)<Date.now()-7*864e5){fs.rmSync(full,{force:true});continue}batch.push({full,item,raw});if(batch.length===100)break}catch{fs.rmSync(full,{force:true})}}
 if(!batch.length)return;const userId=actor.user.id;const response=await fetchImpl(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${actor.access_token}`},body:JSON.stringify({events:batch.map(x=>x.item.event)}),signal:AbortSignal.timeout(15000)});const acknowledged=response.ok?await response.json():null;if(Number.isInteger(acknowledged)&&acknowledged>=0&&acknowledged<=batch.length&&actor?.user.id===userId)for(const x of batch){try{if(fs.readFileSync(x.full,'utf8')===x.raw)fs.rmSync(x.full,{force:true})}catch{}};
 }catch{}finally{busy=false}}
 return {record,activity,sync,flush,start(){timer=setInterval(()=>void flush(),15000);timer.unref?.();void flush()},stop(){clearInterval(timer);stopped=true;try{writeContext()}catch{}},status(){return {enabled}},setEnabled(value){enabled=value===true;atomicWriteFileSync(preferences,JSON.stringify({enabled}));if(!enabled)clear();writeContext();return {enabled}}}
}
module.exports={createProductAnalytics,sanitize}
