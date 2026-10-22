'use strict'
const fs = require('node:fs')
const path = require('node:path')
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const enums = {
  route: ['oauth-token','oauth-discovery','inference','account'],
  phase: ['start','headers','finish'],
  outcome: ['consumed','body-error','cancelled','headers-error','completed','rejected','unknown','closed'],
  reason: ['code_not_found','code_expired','code_consumed','redirect_mismatch','pkce_failed','client_mismatch','refresh_invalid','other'],
  oauthError: ['invalid_grant','invalid_request','invalid_client','unauthorized_client','unsupported_grant_type','invalid_scope','server_error','temporarily_unavailable','access_denied','other'],
  grant: ['authorization_code','refresh_token','other'],
  contentType: ['application/json','application/problem+json','text/html','text/plain','text/event-stream','other'],
  textObservation: ['observed','inspection-limit','no-text-observed'],
  connection: ['new','reused','unavailable'],
  transportCode: ['ENOTFOUND','EAI_AGAIN','ECONNRESET','ECONNREFUSED','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','AbortError','TimeoutError','UNKNOWN'],
}
const numbers = ['status','headersMs','firstByteMs','firstTextMs','totalMs','authMs','bodyReadMs','admissionMs','poolAcquireMs','advisoryLockWaitMs','admissionQueryMs','upstreamHeadersMs','upstreamFirstByteMs','upstreamFirstTextMs','connectionMs','sentMs','dropped']
function safeEvent(input) {
  const result = {}
  if (UUID.test(input?.requestId || '')) result.requestId = input.requestId
  for (const name of ['upstreamIdHash','bridgeIdHash']) if (/^[a-f0-9]{32}$/.test(input?.[name] || '')) result[name] = input[name]
  for (const [name, values] of Object.entries(enums)) if (values.includes(input?.[name])) result[name] = input[name]
  for (const name of numbers) if (Number.isFinite(input?.[name]) && input[name] >= 0 && input[name] <= 3600000) result[name] = Math.round(input[name])
  return result
}

// This writer owns ONLY these three fixed files in a dedicated, non-symlink
// directory. No stdout fallback, raw objects, arbitrary paths, or network I/O.
function createBoundedDiagnostics({ directory, campaign, until, io = fs.promises, now = Date.now, maxFileBytes = 2*1024*1024-512, maxRecords = 4000, rate = 120, queueLimit = 65536 } = {}) {
  const deadline = Date.parse(until), started = now()
  const valid = typeof directory === 'string' && UUID.test(campaign || '') && Number.isFinite(deadline) && deadline > started && deadline-started <= 86400000
  const cap = Math.min(maxFileBytes, 2*1024*1024-512), recordCap = Math.min(maxRecords,4000), rateCap = Math.min(rate,120), queueCap = Math.min(queueLimit,65536)
  const files = directory ? ['events.jsonl','previous.jsonl','state.json'].map(n => path.join(directory,n)) : []
  let enabled = valid, collecting = valid, good = false, bad = false, prepared = false, stopping = false, size = 0, accepted = 0, dropped = 0, minute = Math.floor(started/60000), inMinute = 0, queuedBytes = 0, queue = [], worker = null, fault = '', expired = !valid, timer
  const existsSafe = () => { try { const s=fs.lstatSync(directory); return s.isDirectory()&&!s.isSymbolicLink() } catch { return false } }
  const purgeSync = () => { if (existsSafe()) for (const f of files) { try { fs.unlinkSync(f) } catch {} } }
  const purge = async () => { if (existsSafe()) for (const f of files) { try { await io.unlink(f) } catch {} } }
  const state = () => ({ enabled: enabled && collecting && now()<deadline, campaign: valid?campaign:null, until: Number.isFinite(deadline)?new Date(deadline).toISOString():null, accepted, dropped, fault, expired })
  const stop = async () => {
    enabled=false; stopping=true; queue=[]; queuedBytes=0
    if (worker) await worker.catch(()=>{})
    await purge()
  }
  const ready = (async()=>{
    if (!valid) { await purge(); return }
    try {
      await io.mkdir(directory,{recursive:true,mode:0o700})
      if (!existsSafe()) throw new Error('unsafe-directory')
      await io.chmod(directory,0o700)
      let previous
      try { const stat=await io.lstat(files[2]); if (!stat.isFile()||stat.isSymbolicLink()||stat.size>1024) throw new Error('unsafe-state'); previous=JSON.parse(await io.readFile(files[2],'utf8')) } catch(e) { if (e.code!=='ENOENT') throw e }
      if (previous && (previous.campaign!==campaign || previous.until!==until)) await purge()
      if (previous?.campaign===campaign && previous.until===until) { accepted=Math.min(recordCap,Number(previous.accepted)||0);good=previous.good===true;bad=previous.bad===true;if(good&&bad){collecting=false;fault='evidence-complete'} }
      for (const f of files.slice(0,2)) { try { const s=await io.lstat(f); if (!s.isFile()||s.isSymbolicLink()||s.size>cap) throw new Error('unsafe-log'); if(f===files[0])size=s.size } catch(e) { if(e.code!=='ENOENT')throw e } }
      if (stopping || now()>=deadline) { expired=true; await purge(); return }
      prepared=true
    } catch { enabled=false; fault='sink-unavailable'; queue=[];queuedBytes=0 }
  })()
  async function writePrivate(file, data, append) {
    const h=await io.open(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW|(append?fs.constants.O_APPEND:fs.constants.O_TRUNC),0o600)
    try { await h.chmod(0o600); await h.writeFile(data) } finally { await h.close() }
  }
  async function drain() {
    await ready
    if(!prepared)return
    while(queue.length && enabled && now()<deadline) {
      const line=queue.shift();queuedBytes-=Buffer.byteLength(line)
      if(size+Buffer.byteLength(line)>cap) {
        try{await io.unlink(files[1])}catch(e){if(e.code!=='ENOENT')throw e}
        try{await io.rename(files[0],files[1])}catch(e){if(e.code!=='ENOENT')throw e}
        size=0
      }
      await writePrivate(files[0],line,true);size+=Buffer.byteLength(line)
      await writePrivate(files[2],JSON.stringify({campaign,until,accepted,good,bad}),false)
    }
  }
  function emit(input) {
    try {
      if(!enabled || !collecting || now()>=deadline) return false
      const current=Math.floor(now()/60000);if(current!==minute){minute=current;inMinute=0}
      if(accepted>=recordCap) {collecting=false;fault='record-limit';dropped++;return false}
      if(inMinute>=rateCap) { dropped++;return false }
      const line=JSON.stringify({timestamp:new Date(now()).toISOString(),campaign,...safeEvent(input),dropped})+'\n', bytes=Buffer.byteLength(line)
      if(bytes>1024 || bytes>cap) {dropped++;return false}
      if(queuedBytes+bytes>queueCap) {dropped++;enabled=false;fault='backpressure';queue=[];queuedBytes=0;return false}
      accepted++;inMinute++;queue.push(line);queuedBytes+=bytes
      if(input.phase==='finish') {
        if(input.status>=200&&input.status<300&&input.totalMs<10000&&['consumed','completed'].includes(input.outcome))good=true
        if((input.route==='oauth-token'&&input.oauthError&&input.status>=400)||(input.route==='inference'&&(input.status>=400||input.firstTextMs>10000||input.headersMs>10000||input.totalMs>10000)))bad=true
        if(good&&bad){collecting=false;fault='evidence-complete'}
      }
      if(!worker)worker=drain().catch(()=>{enabled=false;fault='sink-unavailable';queue=[];queuedBytes=0}).finally(()=>{worker=null})
      return true
    } catch {dropped++;return false}
  }
  if(valid) { timer=setTimeout(()=>{expired=true;void stop()},Math.max(1,deadline-started));timer.unref?.();process.once('exit',purgeSync) }
  return { emit, ready, active:()=>enabled&&collecting&&now()<deadline, state, async flush(){await ready;while(worker)await worker}, async close(){clearTimeout(timer);await stop();process.removeListener('exit',purgeSync)} }
}
module.exports={createBoundedDiagnostics,safeEvent,UUID}
