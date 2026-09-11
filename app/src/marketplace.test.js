'use strict'
const {test}=require('node:test')
const assert=require('node:assert/strict')
const {execFileSync}=require('node:child_process')
const {validateMetadata,validateZip,createMarketplace}=require('./marketplace')
const metadata={name:'商品导出',author:'开发者',description:'批量导出商品信息到本地表格',version:'1.0.0',harness_range:'>=0.2.0 <0.3.0',platforms:'淘宝，京东'}
const zip=names=>execFileSync('python3',['-c',`import io,zipfile,sys,json
b=io.BytesIO()
with zipfile.ZipFile(b,'w') as z:
 for name in json.loads(sys.argv[1]): z.writestr(name,'id: demo\\nname: Demo\\nentry_url: https://example.com\\nversion: 1.0.0')
sys.stdout.buffer.write(b.getvalue())`,JSON.stringify(names)])
test('metadata validates versions and platforms',()=>{assert.deepEqual(validateMetadata(metadata).platforms,['淘宝','京东']);for(const patch of [{version:'latest'},{harness_range:'anything'},{platforms:''},{description:'x'}])assert.throws(()=>validateMetadata({...metadata,...patch}))})
test('ZIP accepts root or wrapped manifest, rejects missing, nested, traversal, duplicate and corrupt packages',async()=>{await validateZip(zip(['manifest.yaml','run.js']));await validateZip(zip(['demo/manifest.yaml','demo/run.js']));for(const names of [['run.js'],['a/b/manifest.yaml'],['manifest.yaml','../secret'],['manifest.yaml','b/manifest.yaml'],['manifest.yaml','run.js','run.js']])await assert.rejects(validateZip(zip(names)));await assert.rejects(validateZip(Buffer.from('not zip')))})
test('market requires a signed-in account before accessing data',async()=>{let accessed=false;const market=createMarketplace({accountState:async()=>({user:null}),getClient:()=>{accessed=true}});await assert.rejects(market.run('list'),/登录/);assert.equal(accessed,false)})
test('anonymous users cannot publish and renderer cannot invoke review',async()=>{const market=createMarketplace({accountState:async()=>({user:{id:'u',anonymous:true}}),getClient:()=>({})});await assert.rejects(market.run('publish',metadata),/绑定邮箱/);await assert.rejects(market.run('review'),/不支持/)})
test('failed upload never submits approval and leaves identifiable draft',async()=>{const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'market-test-'));const file=path.join(dir,'a.zip');await fs.writeFile(file,zip(['manifest.yaml']));let inserted,submitted=false;const client={from:()=>({insert:async row=>{inserted=row;return {}}}),storage:{from:()=>({upload:async()=>({error:{code:'offline'}})})},rpc:async(name,args)=>{if(name==='market_begin_release'){inserted={...args.metadata,id:'draft',status:'draft'};return {data:inserted}}submitted=true;return {}}};try{const market=createMarketplace({accountState:async()=>({user:{id:'u'}}),getClient:()=>client,chooseZip:async()=>file});const prepared=await market.run('prepare-zip');await assert.rejects(market.run('publish',{...metadata,zipToken:prepared.token}));assert.ok(inserted.id);assert.equal(submitted,false)}finally{await fs.rm(dir,{recursive:true,force:true})}})
test('download refuses mismatched digest before saving',async()=>{let saved=false;const row={id:'id',owner_id:'owner',size_bytes:3,sha256:'0'.repeat(64)};const client={from:()=>({select:()=>({eq:()=>({single:async()=>({data:row})})})}),storage:{from:()=>({download:async()=>({data:new Blob(['abc'])})})}};const market=createMarketplace({accountState:async()=>({user:{id:'u'}}),getClient:()=>client,saveZip:()=>{saved=true}});await assert.rejects(market.run('download',{id:'id'}),/完整性/);assert.equal(saved,false)})
function installationFixture(overrides={}) {
 const bytes=zip(['manifest.yaml']), row={id:'package',owner_id:'author',status:'approved',version:'1.0.0',harness_range:'>=0.2.0',size_bytes:bytes.length,sha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex')}
 let locals=[],receipts={},installs=0
 const stages=[]
 const client={from:()=>({select:()=>({eq:()=>({single:async()=>({data:row})})})}),storage:{from:()=>({download:async()=>({data:new Blob([bytes])})})}}
 const market=createMarketplace({getClient:()=>client,accountState:async()=>({user:{id:'user'}}),version:'0.2.0',getInstalled:async()=>locals,readInstalls:()=>receipts,writeInstalls:r=>{receipts=r},notify:p=>stages.push(p.stage),installZip:async b=>{installs++;assert.deepEqual(b,bytes);locals=[{id:'demo',version:'1.0.0'}];return {ok:true,adapter:locals[0]}},...overrides})
 return {market,row,stages,setLocals:v=>{locals=v},get installs(){return installs},get receipts(){return receipts}}
}
test('one-click install verifies bytes, invokes installer once and records a confirmed local installation',async()=>{
 const f=installationFixture();const [a,b]=await Promise.all([f.market.run('install',{id:'package'}),f.market.run('install',{id:'package'})]);assert.equal(a.adapter.id,'demo');assert.equal(b.adapter.id,'demo');assert.equal(f.installs,1);assert.deepEqual(f.stages,['downloading','installing','installed']);assert.equal(f.receipts.package.adapterId,'demo');assert.equal((await f.market.run('install',{id:'package'})).alreadyInstalled,true);assert.equal(f.installs,1)
})
test('install refuses unapproved, incompatible and colliding local packages',async()=>{
 for(const status of ['pending','withdrawn']){const f=installationFixture();f.row.status=status;await assert.rejects(f.market.run('install',{id:'package'}),/不能安装/);assert.equal(f.installs,0)}
 const f=installationFixture();f.row.harness_range='>=9.0.0';await assert.rejects(f.market.run('install',{id:'package'}),/更新客户端/);assert.equal(f.installs,0)
 const collision=installationFixture();collision.setLocals([{id:'demo',version:'1.0.0'}]);assert.equal((await collision.market.run('install',{id:'package'})).ok,true);assert.equal(collision.installs,1)
})
test('failed installation creates no receipt and can be retried',async()=>{
 let attempts=0
 const f=installationFixture({installZip:async()=>{attempts++;throw Error('offline')}})
 await assert.rejects(f.market.run('install',{id:'package'}),/offline/);await assert.rejects(f.market.run('install',{id:'package'}),/offline/);assert.equal(attempts,2);assert.deepEqual(f.receipts,{});assert.equal(f.stages.at(-1),'failed')
})
test('rating validates input and propagates server refusal without success',async()=>{let calls=0;const market=createMarketplace({accountState:async()=>({user:{id:'u'}}),getClient:()=>({rpc:async()=>{calls++;return {error:{code:'denied'}}}})});for(const stars of [0,6,1.5])await assert.rejects(market.run('rate',{id:'p',stars,displayName:'Name'}),/1–5/);assert.equal(calls,0);await assert.rejects(market.run('rate',{id:'p',stars:5,displayName:'Name'}),/请求失败/);assert.equal(calls,1)})

test('ZIP preparation reads version and publishing uses the exact prepared bytes',async()=>{
 const bytes=zip(['manifest.yaml']);let inserted,uploaded;const client={from:()=>({insert:async row=>{inserted=row;return {}}}),storage:{from:()=>({upload:async(p,b)=>{uploaded=b;return {}}})},rpc:async(name,args)=>{if(name==='market_begin_release'){inserted={...args.metadata,id:'p',owner_id:'u',status:'draft'};return {data:inserted}}return {}}};
 const market=createMarketplace({getClient:()=>client,accountState:async()=>({user:{id:'u'}})});
 await assert.rejects(market.run('publish',metadata),/先选择/);
 const prepared=await market.run('prepare-zip',{name:'demo.zip',bytes:new Uint8Array(bytes)});assert.equal(prepared.version,'1.0.0');assert.equal(prepared.name,'Demo');
 await market.run('publish',{...metadata,version:'9.9.9',zipToken:prepared.token});assert.equal(inserted.version,'1.0.0');assert.deepEqual(uploaded,bytes);
 await assert.rejects(market.run('publish',{...metadata,zipToken:prepared.token}),/先选择/);
 await assert.rejects(market.run('prepare-zip',{name:'bad.zip',bytes:new Uint8Array([1,2])}));
})

test('icons allow bounded PNG thumbnails and reject external URLs and SVG',()=>{for(const icon of ['https://example.com/a.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,'+'a'.repeat(100001)])assert.throws(()=>validateMetadata({...metadata,icon}),/图标/);assert.equal(validateMetadata(metadata).icon,'')})

test('history keeps existing release visible when lifecycle migration is unavailable',async()=>{
 const row={id:'legacy',owner_id:'u',version:'2.0.1',status:'approved'}
 const client={from:table=>({select:()=>({eq:()=>table==='market_packages'?{single:async()=>({data:row})}:{order:()=>({limit:async()=>({error:{code:'PGRST205'}})})}})})}
 const market=createMarketplace({accountState:async()=>({user:{id:'u'}}),getClient:()=>client})
 const history=await market.run('history',{id:'legacy'})
 assert.deepEqual(history.items,[row]);assert.equal(history.available,false);assert.match(history.notice,/暂不支持/)
})

function readFixture({scriptId,delay=10,hang=false}={}) {
 const started=[],finished=[]
 const client={from(table){const filters={};let columns='';const q={select(c){columns=c;return q},eq(k,v){filters[k]=v;return q},in(){return q},order(){return q},range(){return q},limit(){return q},single(){return q},maybeSingle(){return q},abortSignal(s){q.signal=s;return q},then(resolve,reject){
 const key=table==='market_packages'?(filters.script_id?'releases':'package'):(filters.user_id?'mine':'reviews');started.push(key)
 return new Promise((done,fail)=>{if(hang){q.signal.addEventListener('abort',()=>fail(q.signal.reason),{once:true});return}setTimeout(()=>{finished.push(key);done({data:key==='package'?{id:'p',owner_id:'author',status:'approved',...(scriptId?{script_id:scriptId}:{})}:key==='releases'?[{id:'old'}]:key==='mine'?null:[]})},delay)}).then(resolve,reject)
 }};return q},rpc(){return {abortSignal(){return this},then(resolve){started.push('summary');return new Promise(done=>setTimeout(()=>{finished.push('summary');done({data:[{average:4,total:1}]})},delay)).then(resolve)}}}}
 return {client,started,finished}
}
test('ratings start independent reads together and support packages without script_id',async()=>{
 const f=readFixture({delay:30});const m=createMarketplace({accountState:async()=>({user:{id:'u'}}),getClient:()=>f.client})
 const work=m.run('ratings',{id:'p'});await new Promise(r=>setTimeout(r,5));assert.deepEqual(f.started.sort(),['mine','package','summary']);assert.deepEqual(f.finished,[])
 const result=await work;assert.deepEqual(result.reviews,[]);assert.equal(result.summary.average,4);assert.equal(result.canRate,true)
})
test('ratings retain cross-release lookup when lifecycle fields exist',async()=>{
 const f=readFixture({scriptId:'s'});const m=createMarketplace({accountState:async()=>({user:{id:'u'}}),getClient:()=>f.client});await m.run('ratings',{id:'p'});assert.ok(f.started.includes('releases'))
})
test('read deadline aborts stalled queries and also bounds a stalled account lookup',async()=>{
 const f=readFixture({hang:true});const m=createMarketplace({accountState:async()=>({user:{id:'u'}}),getClient:()=>f.client,readTimeoutMs:15});await assert.rejects(m.run('ratings',{id:'p'}),/加载超时/)
 let accessed=false;const blocked=createMarketplace({accountState:()=>new Promise(()=>{}),getClient:()=>{accessed=true},readTimeoutMs:15});await assert.rejects(blocked.run('list'),/加载超时/);assert.equal(accessed,false)
})
