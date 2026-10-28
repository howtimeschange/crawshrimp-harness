const {test}=require('node:test')
const assert=require('node:assert/strict')
const {createManagedFetch,proxyRoute}=require('./managedFetch')
test('managed traffic follows OS proxy and preserves request identity without cookies',async()=>{
 const calls=[],routes=[],dispatcher={close:async()=>{}},response=new Response('ok')
 const request={method:'POST',headers:{Authorization:'Bearer test-only'},body:'{"model":"fixture"}',redirect:'error',signal:AbortSignal.timeout(1000)}
 const fetcher=createManagedFetch({resolveProxy:async()=> 'PROXY 127.0.0.1:7897; DIRECT'}, {makeDispatcher:route=>{routes.push(route);return dispatcher},fetcher:async(url,options)=>{calls.push({url,options});return response}})
 assert.equal(await fetcher('https://example.test/account/inference/v1/responses',request),response)
 assert.equal(calls.length,1);assert.deepEqual(routes,['http://127.0.0.1:7897'])
 assert.deepEqual(calls[0].options,{...request,credentials:'omit',dispatcher})
})
test('transport and partial-body failures never cause a fallback or replay',async()=>{
 for(const bodyError of [false,true]){
  let calls=0;const failure=new TypeError('network failed')
  const fetcher=createManagedFetch({resolveProxy:async()=> 'PROXY 127.0.0.1:7897; DIRECT'}, {makeDispatcher:()=>({}),fetcher:async()=>{calls++;if(!bodyError)throw failure;return new Response(new ReadableStream({start(c){c.error(failure)}}))}})
  await assert.rejects(async()=>{const r=await fetcher('https://example.test',{method:'POST',body:'test'});await r.text()},/network failed/)
  assert.equal(calls,1)
 }
})
test('route changes take effect, unsupported proxies never silently become direct',async()=>{
 assert.equal(proxyRoute('DIRECT'),null)
 assert.equal(proxyRoute('HTTPS proxy.example:443'),'https://proxy.example')
 for(const route of ['','SOCKS5 127.0.0.1:7897','PROXY user:secret@proxy.example:80'])assert.throws(()=>proxyRoute(route))
 let proxy='DIRECT';const routes=[]
 const fetcher=createManagedFetch({resolveProxy:async()=>proxy},{makeDispatcher:r=>{routes.push(r);return {}},fetcher:async()=>new Response('ok')})
 await fetcher('https://example.test');proxy='PROXY 127.0.0.1:7897';await fetcher('https://example.test')
 assert.deepEqual(routes,[null,'http://127.0.0.1:7897'])
})
