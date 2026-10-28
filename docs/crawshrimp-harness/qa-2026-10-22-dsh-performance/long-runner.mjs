import {DshWebRuntime} from '../../../integrations/deepseek-harness/worker/web-rpc-client.mjs';
import {resolve,join} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,rmSync} from 'node:fs';
const dir=resolve('.codex-tmp/dont-stop/dsh-perf-long-20261022'),cwd=join(dir,'workspace');mkdirSync(cwd,{recursive:true});
copyFileSync(resolve('.codex-tmp/dont-stop/dsh-v021/workspace/migration-screen.png'),join(cwd,'migration-screen.png'));
const {createInterface}=await import('node:readline');const input=createInterface({input:process.stdin});const key=await new Promise(resolve=>input.once('line',resolve));input.close();
const results=[];const save=()=>writeFileSync(join(dir,'results.json'),JSON.stringify(results,null,2));
for(let round=1;round<=2;round++)for(const label of (round%2?['old','new']:['new','old'])){
 const runtimeRoot=label==='old'?'/Users/xingyicheng/Documents/crawshrimp-harness/integrations/deepseek-harness':resolve('integrations/deepseek-harness');
 const version=JSON.parse(readFileSync(join(runtimeRoot,'node_modules/@deepseek-ai/dsh/package.json'))).version;
 const start=performance.now();const r=await DshWebRuntime.launch({runtimeRoot,dshHome:join(dir,`${round}-${label}-home`),nodeExecutable:process.execPath,cwd,timeoutMs:30000,env:{CRAWSHRIMP_DEEPSEEK_API_KEY:key,CRAWSHRIMP_STAGE_BOOT_CHECK:'1',CRAWSHRIMP_DATA:join(dir,`${round}-${label}-data`),CRAWSHRIMP_DISABLE_NATIVE_WEB:'1',CRAWSHRIMP_TOOL_CONTEXT:'domains',DSH_TELEMETRY_DISABLED:'1'}});
 const id=`cs-perf-${round}-${label}-${Date.now()}`;results.push({round,label,version,category:'startup',elapsedMs:Math.round(performance.now()-start)});save();
 try{
 await r.createSession({sessionId:id,cwd});const selected=await r.selectModel({sessionId:id,provider:'crawshrimp-deepseek-official',model:'deepseek-flash',reasoningEffort:'off'});
 console.log(JSON.stringify({round,label,version,selected}));
 async function turn(category,prompt,expected,requiredTools=[]){
 let yes,no;const done=new Promise((a,b)=>{yes=a;no=b});done.catch(()=>{});const events=[];let ready=false;const follow=r.follow(id,{onEvent:e=>{if(ready){events.push(e);if(e.type==='turn/end')yes(e.data)}},onError:no});let timer;let begin;
 try{await follow.ready;ready=true;begin=performance.now();timer=setTimeout(()=>no(Error('120s deadline')),120000);await r.prompt({sessionId:id,content:[{type:'text',text:prompt}]});const end=await done;
 const replies=events.filter(e=>e.type==='assistant/message');const text=replies.flatMap(e=>e.data.message?.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');const usages=replies.map(e=>e.data.usage).filter(Boolean);const metrics={};for(const k of ['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens'])metrics[k]=usages.length&&usages.every(u=>typeof u[k]==='number')?usages.reduce((a,u)=>a+u[k],0):null;
 const tools=events.filter(e=>e.type==='tool/call').map(e=>e.data.name);const row={round,label,version,category,elapsedMs:Math.round(performance.now()-begin),success:end.reason?.kind==='completed'&&expected.test(text)&&requiredTools.every(t=>tools.includes(t)),metrics,tools,text};results.push(row);console.log(JSON.stringify(row));return row.success;
 }catch(e){results.push({round,label,category,success:false,error:e.message});console.log(JSON.stringify({round,label,category,error:e.message}));return false}finally{clearTimeout(timer);follow.close();save()}}
 const ledger=Array.from({length:160},(_,i)=>`Record ${i+1}: project item PART-${String(i+1).padStart(4,'0')}; stock ${i*7+11}; warehouse Shanghai; audit status checked; shipment review pending.`).join('\n');
 if(!await turn('long-input','这是测试数据，不调用工具、不写入长期记忆。本会话核验口令是 LEDGER-7319。保留下面账本供后续核对，仅回复 READY-7319。\n'+ledger,/READY-7319/))continue;
 if(!await turn('long-query','不要调用工具。根据刚才账本，Record 160 的 stock 数量是多少？只回复数字。',/1124/))continue;
 const began=performance.now();const compact=await r.request('commands/execute',{agentId:id,line:'/compact',...(label==='old'?{images:[]}:{submittedAttachments:[]})},AbortSignal.timeout(120000));results.push({round,label,category:'compact',elapsedMs:Math.round(performance.now()-began),result:compact});save();
 await turn('resume','不要调用工具。报告本会话核验口令和之前核对的 Record 160 库存数量。',/LEDGER-7319[\s\S]*1124|1124[\s\S]*LEDGER-7319/);
 }catch(e){results.push({round,label,category:'run-error',error:e.message});console.log(JSON.stringify({round,label,error:e.message}))}finally{await r.stop();save()}
}
