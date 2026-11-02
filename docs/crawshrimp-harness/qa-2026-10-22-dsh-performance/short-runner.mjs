import {DshWebRuntime} from '../../../integrations/deepseek-harness/worker/web-rpc-client.mjs';
import {resolve,join} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,rmSync} from 'node:fs';
const dir=resolve('.codex-tmp/dont-stop/dsh-perf-20261022'),cwd=join(dir,'workspace');mkdirSync(cwd,{recursive:true});
copyFileSync(resolve('.codex-tmp/dont-stop/dsh-v021/workspace/migration-screen.png'),join(cwd,'migration-screen.png'));
const {createInterface}=await import('node:readline');const input=createInterface({input:process.stdin});const key=await new Promise(resolve=>input.once('line',resolve));input.close();
const results=[];const save=()=>writeFileSync(join(dir,'results.json'),JSON.stringify(results,null,2));
for(let round=1;round<=3;round++)for(const label of (round%2?['old','new']:['new','old'])){
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
 if(!await turn('text','本次测试仅需在当前会话保留验证数字 7319，不要调用任何工具。仅回复 READY-7319。',/READY-7319/))continue;
 rmSync(join(cwd,'bench-check.txt'),{force:true});
 if(!await turn('tools','这是隔离测试。使用 bash 创建 bench-check.txt 内容 7319，再用单独一次 read 调用读回。最后仅报告读回数字。',/7319/,['bash','read']))continue;
 if(!await turn('screenshot','用 read_image 读取 migration-screen.png，只报告表格中两项 P0 建议。',/Messages/,['read_image']))continue;
 const began=performance.now();const compact=await r.request('commands/execute',{agentId:id,line:'/compact',...(label==='old'?{images:[]}:{submittedAttachments:[]})},AbortSignal.timeout(120000));results.push({round,label,category:'compact',elapsedMs:Math.round(performance.now()-began),result:compact});save();
 await turn('resume','压缩后继续：最初的验证数字是多少？使用 read 再次读回 bench-check.txt 核对。仅报告数字及是否一致。',/7319/,['read']);
 }catch(e){results.push({round,label,category:'run-error',error:e.message});console.log(JSON.stringify({round,label,error:e.message}))}finally{await r.stop();save()}
}
