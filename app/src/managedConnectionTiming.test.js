'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http')
const {diagnosticFetch}=require('./managedDiagnostics')
test('real local fetch connection events stay associated under concurrency',async t=>{
 const server=http.createServer((q,s)=>setTimeout(()=>{s.setHeader('content-type','application/json');s.end('{}')},q.url==='/slow'?70:5));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close()})
 const events=[],run=diagnosticFetch(fetch,{enabled:()=>true,emit:e=>events.push(e),traceConnections:true,route:'inference'}),origin=`http://127.0.0.1:${server.address().port}`
 const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']
 await Promise.all(['/slow','/fast'].map(async(p,i)=>{await(await run(origin+p,{headers:{'x-request-id':ids[i]}})).text()}))
 assert.equal(events.length,2);assert.ok(events.find(e=>e.requestId===ids[0]).totalMs>=60);assert.ok(events.find(e=>e.requestId===ids[1]).totalMs<events.find(e=>e.requestId===ids[0]).totalMs)
 assert.ok(events.every(e=>typeof e.sentMs==='number'))
 assert.ok(events.every(e=>e.connection==='new'&&typeof e.connectionMs==='number'))
 await new Promise(r=>setTimeout(r,20));await(await run(origin+'/fast',{headers:{'x-request-id':ids[0]}})).text();assert.equal(events[2].connection,'reused')
})
