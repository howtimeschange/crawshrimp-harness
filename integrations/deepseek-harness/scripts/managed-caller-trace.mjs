// Managed text caller identity receipts. The Account ledger remains the only billing authority.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const CAPABILITY='managed-text-preserved-v1';
const FILE=/^[a-f0-9]{64}\.json$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BILL=/^[A-Za-z0-9_-]{1,64}$/;
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code})};
function rootPath(value){if(typeof value!=='string'||!path.isAbsolute(value))fail('managed_trace_data_root_required');return path.resolve(value)}
function syncDirectory(dir){
 // Windows FlushFileBuffers cannot sync a read-only directory handle. Keep
 // file fsync and exclusive creation on every platform; do not mask IO errors.
 if(process.platform==='win32')return;
 const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function privateDirectory(dir){
 if(fs.existsSync(dir)){const st=fs.lstatSync(dir);if(st.isSymbolicLink()||!st.isDirectory())fail('managed_trace_unsafe_directory')}
 else{fs.mkdirSync(dir,{mode:0o700});syncDirectory(path.dirname(dir))}
}
function readSession(dataRoot){
 const file=path.join(dataRoot,'managed-model-session.json'),st=fs.lstatSync(file);
 if(st.isSymbolicLink()||!st.isFile()||(process.platform!=='win32'&&(st.mode&0o077)))fail('managed_trace_unsafe_session');
 let session;try{session=JSON.parse(fs.readFileSync(file,'utf8'))}catch{fail('managed_trace_invalid_session')}
 if(session.version!==1||session.callerRequestIdentity!==CAPABILITY||typeof session.accountId!=='string'||!session.accountId||typeof session.brokerToken!=='string'||session.brokerToken.length<32)fail('managed_trace_capability_required');
 let broker,service;try{broker=new URL(session.baseURL);service=new URL(session.accountServiceOrigin)}catch{fail('managed_trace_invalid_session')}
 if(broker.protocol!=='http:'||broker.hostname!=='127.0.0.1'||!broker.port||broker.username||broker.password||broker.pathname!=='/'||broker.search||broker.hash)fail('managed_trace_invalid_broker');
 if(service.username||service.password||service.search||service.hash||service.pathname!=='/'||!(service.protocol==='https:'||service.protocol==='http:'&&service.hostname==='127.0.0.1'))fail('managed_trace_invalid_authority');
 const owner=sha(service.origin+'\0'+session.accountId);
 const binding=sha(service.origin+'\0'+session.accountId+'\0'+broker.origin+'\0'+session.brokerToken);
 return {session,owner,binding,broker,service};
}
function receiptDirectory(root,owner,create=false){
 const parent=path.join(root,'managed-caller-receipts');const dir=path.join(parent,owner);
 if(create){privateDirectory(root);privateDirectory(parent);privateDirectory(dir)}
 else for(const p of [parent,dir])if(fs.existsSync(p)){const st=fs.lstatSync(p);if(st.isSymbolicLink()||!st.isDirectory())fail('managed_trace_unsafe_directory')}
 return dir;
}
function durable(file,value,exclusive=false){
 const target=exclusive?file:file+'.'+randomUUID()+'.tmp';
 const fd=fs.openSync(target,fs.constants.O_EXCL|fs.constants.O_CREAT|fs.constants.O_WRONLY|(fs.constants.O_NOFOLLOW||0),0o600);
 try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
 if(!exclusive)fs.renameSync(target,file);
 syncDirectory(path.dirname(file));
}
function receiptRows(root,identity){
 const dir=receiptDirectory(root,identity.owner);if(!fs.existsSync(dir))return [];
 return fs.readdirSync(dir).filter(name=>FILE.test(name)).map(name=>{
  const file=path.join(dir,name),st=fs.lstatSync(file);
  if(st.isSymbolicLink()||!st.isFile()||(process.platform!=='win32'&&(st.mode&0o077)))fail('managed_trace_unsafe_receipt');
  const row=JSON.parse(fs.readFileSync(file,'utf8'));
  if(row.version!==1||row.operationTag+'.json'!==name||!UUID.test(row.callerRequestId??'')||row.managedRequestId!==row.callerRequestId||row.ownerNamespace!==identity.owner||!/^[a-f0-9]{64}$/.test(row.bodySHA256??''))fail('managed_trace_corrupt_receipt');
  return row;
 });
}
function readReceipt(root,identity,id){
 if(typeof id!=='string'||!UUID.test(id))fail('managed_trace_invalid_original_id');
 const row=receiptRows(root,identity).find(row=>row.callerRequestId===id);
 if(!row)fail('managed_trace_original_id_not_found');
 return row;
}
function unchanged(root,binding){const next=readSession(root);if(next.binding!==binding)fail('managed_trace_session_changed');return next}

export function createManagedCallerFetch({provider,modelId,baseURL,apiKey,sessionId,messages=[],purpose,dataRoot=process.env.CRAWSHRIMP_DATA,fetcher=globalThis.fetch}={}){
 if(!['crawshrimp-managed-openai','crawshrimp-managed-openai-responses'].includes(provider))return undefined;
 const root=rootPath(dataRoot),identity=readSession(root),base=new URL(baseURL);
 if(base.origin!==identity.broker.origin||base.pathname!=='/v1'||base.search||base.hash||base.username||base.password||apiKey!==identity.session.brokerToken)fail('managed_trace_session_changed');
 // Dynamic context snapshots may gain a fresh ID during the same DSH retry.
 // They do not admit a new user/tool intent and must not escape its replay fence.
 const durableIds=messages.filter(m=>m&&m.role!=='system'&&m.role!=='developer'&&m.source?.kind!=='runtime-context'&&typeof m.id==='string'&&m.id).map(m=>m.id);
 let sourceMessageSeqs;
 const titles=messages.filter(m=>m?.source?.kind==='dsh-session-title-llm');
 if(purpose==='session-title'||titles.length){
  const anchor=titles.length===1&&titles[0].role==='user'?titles[0].source.managedCallerSourceSequence:null;
  if(purpose!=='session-title'||typeof sessionId!=='string'||!sessionId||!anchor||typeof anchor!=='object'||Array.isArray(anchor)
   ||Object.keys(anchor).sort().join(',')!=='messageSeqs,purpose,sessionId,version'
   ||anchor.version!==1||anchor.sessionId!==sessionId||anchor.purpose!==purpose
   ||!Array.isArray(anchor.messageSeqs)||!anchor.messageSeqs.length
   ||!anchor.messageSeqs.every((seq,index)=>Number.isSafeInteger(seq)&&seq>=0&&(index===0||seq>anchor.messageSeqs[index-1])))fail('managed_trace_source_sequence_required');
  sourceMessageSeqs=[...anchor.messageSeqs];
 }
 if(!sessionId||!sourceMessageSeqs&&!durableIds.length)fail('managed_trace_durable_operation_required');
 const endpoint=provider.endsWith('openai-responses')?'/v1/responses':'/v1/chat/completions';
 let entered=false;
 return async(input,init)=>{
  if(entered)fail('managed_trace_duplicate_transport_forbidden');entered=true;
  const request=new Request(input,init),target=new URL(request.url);
  if(request.method!=='POST'||target.origin!==base.origin||target.pathname!==endpoint||target.search||target.hash)fail('managed_trace_unexpected_transport');
  unchanged(root,identity.binding);
  const body=Buffer.from(await request.clone().arrayBuffer());if(body.length>32*1024*1024)fail('managed_trace_body_limit');
  unchanged(root,identity.binding);
  const bodySHA256=sha(body),sessionTag=sha(String(sessionId??''));
  const operationTag=sha(JSON.stringify(sourceMessageSeqs?{sessionTag,purpose,sourceMessageSeqs}:{sessionTag,purpose:purpose??null,durableIds}));
  const id=randomUUID(),dir=receiptDirectory(root,identity.owner,true),file=path.join(dir,operationTag+'.json');
  const row={version:1,ownerNamespace:identity.owner,callerRequestId:id,managedRequestId:id,operationTag,bodySHA256,bodyBytes:body.length,
   provider,modelId,sessionTag,operationIdentity:sourceMessageSeqs?'durable_session_source_sequences':'durable_session_messages',brokerBinding:identity.binding,state:'dispatch_unknown',createdAt:new Date().toISOString()};
  // Exclusive-create and fsync the original ID before the only permitted HTTP attempt.
  try{durable(file,row,true)}catch(error){
   if(error.code!=='EEXIST')throw error;
   const previous=receiptRows(root,identity).find(r=>r.operationTag===operationTag);
   throw Object.assign(new Error(previous?.bodySHA256===bodySHA256?'managed_trace_existing_original_readback_only':'managed_trace_operation_conflict'),{code:'managed_trace_no_replay',callerRequestId:previous?.callerRequestId??null});
  }
  const headers=new Headers(request.headers);headers.set('X-Request-Id',id);
  try{
   unchanged(root,identity.binding);
   const response=await fetcher(new Request(request,{headers,redirect:'error'}));
   row.httpStatus=response.status;const observed=response.headers.get('X-Request-Id');row.observedManagedRequestId=typeof observed==='string'&&UUID.test(observed)?observed:null;
   const bill=response.headers.get('X-Oneapi-Request-Id');row.observedBillingRequestId=typeof bill==='string'&&BILL.test(bill)?bill:null;
   row.state='headers_received';row.headersAt=new Date().toISOString();durable(file,row);
   if(response.ok&&row.observedManagedRequestId!==id){await response.body?.cancel();fail('managed_trace_identity_mismatch')}
   return response;
  }catch(error){row.state='dispatch_unknown';row.transportError=error?.name??'Error';durable(file,row);throw error}
 };
}

export function listManagedCallerReceipts({dataRoot=process.env.CRAWSHRIMP_DATA,sessionId}={}){
 const root=rootPath(dataRoot),identity=readSession(root),dir=receiptDirectory(root,identity.owner);
 if(!fs.existsSync(dir))return [];
 const tag=sessionId===undefined?null:sha(String(sessionId));
 const records=receiptRows(root,identity);
 unchanged(root,identity.binding);return records.filter(row=>tag===null||row.sessionTag===tag);
}

export async function reconcileManagedCaller(id,{dataRoot=process.env.CRAWSHRIMP_DATA,fetcher=globalThis.fetch}={}){
 const root=rootPath(dataRoot),identity=readSession(root),receipt=readReceipt(root,identity,id);
 const result={callerRequestId:id,managedRequestId:id,transportState:receipt.state,readbackStatus:'unconfirmed',ledger:null,costVerified:false};
 let response;
 try{response=await fetcher(new URL('/account/requests/'+id,identity.broker),{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+identity.session.brokerToken},signal:AbortSignal.timeout(30000)})}
 catch{unchanged(root,identity.binding);return result}
 let size=0;const parts=[];
 try{
  for await(const part of response.body??[]){size+=part.length;if(size>8192){await response.body?.cancel().catch(()=>{});fail('managed_trace_response_limit')}parts.push(Buffer.from(part))}
  unchanged(root,identity.binding);
  if(!response.ok)return {...result,httpStatus:response.status};
  const value=JSON.parse(Buffer.concat(parts).toString()),row=value?.request;
  if(row===null)return {...result,readbackStatus:'not_found_unconfirmed'};
  if(!row||row.requestId!==id)fail('managed_trace_identity_mismatch');
  const date=typeof row.createdAt==='string'?new Date(row.createdAt):null;
  return {...result,readbackStatus:'observed',ledger:{requestId:id,state:['in_progress','completed','unknown','upstream_rejected','not_dispatched','failed','canceled'].includes(row.state)?row.state:null,
   createdAt:date&&Number.isFinite(date.getTime())?date.toISOString():null,billingRequestId:typeof row.billingRequestId==='string'&&BILL.test(row.billingRequestId)?row.billingRequestId:null}};
 }catch(error){unchanged(root,identity.binding);if(error?.code==='managed_trace_session_changed')throw error;return result}
}
