const {test}=require('node:test')
const assert=require('node:assert/strict')
test('read UI deadline returns timely values, preserves errors and bounds stalled IPC',async()=>{
 const {readRequest}=await import('./renderer/utils/readRequest.mjs')
 assert.equal(await readRequest(()=>42),42)
 await assert.rejects(readRequest(()=>{throw Error('offline')}),/offline/)
 await assert.rejects(readRequest(()=>new Promise(()=>{}),10),/加载超时/)
})
