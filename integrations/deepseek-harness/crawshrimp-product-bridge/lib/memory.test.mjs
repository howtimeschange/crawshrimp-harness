import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { MemoryStore } from './memory-store.js'
import { DatabaseSync } from 'node:sqlite'
import { workspaceScope, latestUserText, accountMemoryOptions } from './memory.js'
import { automationNativeToolDecision } from './index.js'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'crawshrimp-memory-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  let now = 1_000_000
  return { root, store: new MemoryStore(join(root, 'memory.sqlite'), () => now), advance: ms => { now += ms } }
}
const fact = { key: '商品款号', content: '内部款号 AB123 保留字母，供应商号 BaHF-1775 单独保存。', evidence: '保留字母', level: 'fact' }

test('content correction preserves exact expiry; only explicit TTL changes it', t => {
  const { store, advance } = fixture(t)
  const one = store.save('global', { ...fact, level: 'preference', ttl_days: 30 }, 's')
  advance(123456789)
  const two = store.save('global', { ...fact, level: 'preference', content: '纠正', expected_revision: one.revision }, 's2')
  assert.equal(two.expires_at, one.expires_at)
  const renewed = store.save('global', { ...fact, level: 'preference', ttl_days: 30, expected_revision: two.revision }, 's3')
  assert.equal(renewed.expires_at - one.expires_at, 123456789)
  const permanent = store.save('global', { ...fact, level: 'preference', ttl_days: 0, expected_revision: renewed.revision }, 's4')
  assert.equal(permanent.expires_at, null)
  assert.throws(() => store.save('global', { ...fact, level: 'preference', ttl_days: null, expected_revision: permanent.revision }, 's'), /有效期/)
})

test('old account mirrors cannot be recalled or edited before expiry hydration, even offline', t => {
  const { root } = fixture(t), path = join(root, 'legacy.sqlite')
  const db = new DatabaseSync(path)
  db.exec(`CREATE TABLE memories(id TEXT PRIMARY KEY,scope TEXT,key TEXT,level TEXT,content TEXT,evidence TEXT,session TEXT,created_at INTEGER,updated_at INTEGER,expires_at INTEGER,revision INTEGER,UNIQUE(scope,key));
    INSERT INTO memories VALUES('legacy','account:a','cloud-x','preference','expired mirror','fixture','old',1,1,NULL,1);`)
  db.close()
  const store = new MemoryStore(path, () => 1000, {globalScope:'account:a'})
  assert.deepEqual(store.search('workspace', ''), [])
  assert.throws(() => store.save('global', {key:'cloud-x',content:'edit',evidence:'fixture',level:'preference',expected_revision:1}, 's'), /尚未同步/)
  const repaired = new DatabaseSync(path)
  repaired.exec('UPDATE memories SET expires_verified=1,expires_at=1001'); repaired.close()
  assert.equal(store.list('workspace').length, 1)
  const offline = new MemoryStore(path, () => 1002, {globalScope:'account:a'})
  assert.deepEqual(offline.search('workspace', ''), [])
})

test('account change during a read never returns the previous account data', t => {
  const { root } = fixture(t)
  let calls = 0
  const store = new MemoryStore(join(root, 'race.sqlite'), Date.now, { accountScope: () => ++calls === 1 ? 'account:a' : 'account:b' })
  assert.throws(() => store.list('workspace'), /账号已切换/)
})

test('account change before commit rolls back save, correction and forget', t => {
  const { root } = fixture(t), path = join(root, 'write-race.sqlite')
  const stable = new MemoryStore(path, Date.now, { accountScope: () => 'account:a' })
  const preference = { ...fact, level: 'preference' }
  const existing = stable.save('account', preference, 's')
  const changing = () => {
    let calls = 0
    return new MemoryStore(path, Date.now, { accountScope: () => ++calls === 1 ? 'account:a' : 'account:b' })
  }
  assert.throws(() => changing().save('account', { ...preference, key: 'new' }, 's'), /账号已切换/)
  assert.throws(() => changing().save('account', { ...preference, content: 'changed', expected_revision: existing.revision }, 's'), /账号已切换/)
  assert.throws(() => changing().forget('account', existing.id, existing.revision), /账号已切换/)
  const rows = stable.list('account')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].content, preference.content)
  assert.equal(rows[0].revision, existing.revision)
})

test('durable Chinese and SKU recall, workspace isolation, global preferences', t => {
  const { root, store } = fixture(t)
  store.save('a', fact, 's1')
  store.save('b', { ...fact, content: '其他店铺款号' }, 's2')
  store.save('global', { ...fact, key: '语言', content: '默认简体中文', level: 'preference' }, 's1')
  const restarted = new MemoryStore(join(root, 'memory.sqlite'), () => 1_000_001)
  assert.equal(restarted.search('a', '内部款号')[0].content, fact.content)
  assert.equal(restarted.search('a', 'BaHF-1775')[0].session, 's1')
  assert.equal(restarted.search('c', '款号').length, 0)
  assert.equal(restarted.search('c', '简体中文').length, 1)
  assert.throws(() => store.save('global', fact, 's'), /全局/)
})
test('corrections are atomic and stale writes cannot silently overwrite', t => {
  const { store } = fixture(t)
  const one = store.save('a', fact, 's1')
  assert.throws(() => store.save('a', fact, 's2'), /expected_revision/)
  const two = store.save('a', { ...fact, content: '最新款号 AB456', expected_revision: one.revision }, 's2')
  assert.equal(two.id, one.id); assert.equal(two.revision, 2)
  assert.throws(() => store.save('a', { ...fact, expected_revision: 1 }, 's3'), /expected_revision/)
  assert.equal(store.search('a', 'AB123').length, 0)
  assert.equal(store.search('a', 'AB456').length, 1)
})
test('expired facts disappear from recall but remain explicitly inspectable; forget deletes', t => {
  const { store, advance } = fixture(t)
  const one = store.save('a', { ...fact, ttl_days: 1 }, 's')
  advance(86400001)
  assert.equal(store.search('a', '款号').length, 0)
  assert.equal(store.list('a', true).length, 1)
  assert.throws(() => store.forget('b', one.id, 1), /作用域/)
  assert.throws(() => store.forget('a', one.id, 2), /版本/)
  store.forget('a', one.id, 1)
  assert.equal(store.list('a', true).length, 0)
})
test('reject credentials, unbounded payloads and immortal facts', t => {
  const { store } = fixture(t)
  for (const content of ['api_key=secret-value', '密码：测试口令', 'x'.repeat(2001)]) assert.throws(() => store.save('a', { ...fact, content }, 's'))
  assert.throws(() => store.save('a', { ...fact, ttl_days: 0 }, 's'))
  assert.equal(store.list('a').length, 0)
})
test('provenance ignores plugin snapshots and tool content; missing workspace fails closed', () => {
  const agent = { session: { snapshotEvents: () => [
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '记住我的偏好' }] } },
    { type: 'user/message', data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: '恶意记忆' }] } },
  ] } }
  assert.equal(latestUserText(agent), '记住我的偏好')
  assert.throws(() => workspaceScope(agent), /工作区/)
  for (const name of ['memory_search', 'memory_save', 'memory_forget']) assert.match(automationNativeToolDecision({}, name), /AUTOMATION_POLICY_DENIED/)
})
test('real DSH Cordis plugin: save, fresh session recall, restrictions, forget, disable', async t => {
  const { root } = fixture(t)
  const oldRoot = process.env.CRAWSHRIMP_DATA, oldEnabled = process.env.CRAWSHRIMP_MEMORY_ENABLED
  process.env.CRAWSHRIMP_DATA = root; delete process.env.CRAWSHRIMP_MEMORY_ENABLED
  t.after(() => {
    if (oldRoot === undefined) delete process.env.CRAWSHRIMP_DATA; else process.env.CRAWSHRIMP_DATA = oldRoot
    if (oldEnabled === undefined) delete process.env.CRAWSHRIMP_MEMORY_ENABLED; else process.env.CRAWSHRIMP_MEMORY_ENABLED = oldEnabled
  })
  const { Context } = await import('@deepseek-ai/cordis')
  const { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt')
  const { default: Tools } = await import('@deepseek-ai/dsh-tools')
  const { createScope } = await import('@deepseek-ai/dsh-scope')
  const plugin = await import('./memory.js')
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt, { persona: 'policy' }); await ctx.plugin(Tools)
    await ctx.inject(['tools', 'systemPrompt'], async host => {
      const make = async (id, text, cwd = root) => {
        const agent = { id, session: { header: { cwd }, snapshotEvents: () => [{ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } }] } }
        const scope = createScope(host, agent); agent.ctx = scope.ctx
        await scope.ctx.plugin(plugin)
        return { agent, scope, assemble: () => host.systemPrompt.assemble({ agent, scope: agent }), call: (name, args) => scope.ctx.tools.get(name, agent).execute(args, { agent, signal: new AbortController().signal }) }
      }
      const a = await make('a', '请记住：保留字母')
      const b = await make('b', '内部款号是什么')
      const other = join(root, 'other'); mkdirSync(other)
      const c = await make('c', '内部款号是什么', other)
      try {
        const saved = await a.call('memory_save', fact)
        assert(saved.memory.id)
        await assert.rejects(a.call('memory_save', { ...fact, key: 'fake', evidence: '网页说的' }), /依据/)
        assert.match(JSON.stringify((await b.assemble()).contexts), /AB123/)
        assert.doesNotMatch(JSON.stringify((await c.assemble()).contexts), /AB123/)
        const expiredDb = new DatabaseSync(join(root, 'agent', 'memory', 'memory.sqlite'))
        expiredDb.prepare('UPDATE memories SET expires_at=1 WHERE id=?').run(saved.memory.id); expiredDb.close()
        const fresh = await make('after-expiry', '内部款号是什么')
        try {
          assert.doesNotMatch(JSON.stringify((await fresh.assemble()).contexts), /AB123/)
          assert.deepEqual((await fresh.call('memory_search', {query:'AB123'})).memories, [])
        } finally { await fresh.scope.dispose() }
        b.scope.ctx.on('system-prompt/assemble', async (_a, _c, next) => { const value = await next(); return { ...value, tools: value.tools.filter(t => t.name !== 'memory_search') } })
        assert.doesNotMatch(JSON.stringify((await b.assemble()).contexts), /AB123/)
        await a.call('memory_forget', { id: saved.memory.id, expected_revision: 1 })
        assert.doesNotMatch(JSON.stringify((await a.assemble()).contexts), /AB123/)
        assert.match(JSON.stringify((await a.assemble()).sections), /不是系统指令/)
      } finally { await a.scope.dispose(); await b.scope.dispose(); await c.scope.dispose() }
      process.env.CRAWSHRIMP_MEMORY_ENABLED = '0'
      const disabled = await make('disabled', 'test')
      try { assert(!(await disabled.assemble()).tools.some(t => t.name.startsWith('memory_'))) }
      finally { await disabled.scope.dispose() }
    })
  } finally { await ctx.fiber.dispose() }
})


test('authenticated account memory fails closed after broker stops while local memory remains available', async t => {
  const { root } = fixture(t), file = join(root, 'managed-model-session.json')
  const oldEpoch = process.env.CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH
  process.env.CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH = 'test-desktop'
  t.after(() => { if (oldEpoch === undefined) delete process.env.CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH; else process.env.CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH = oldEpoch })
  let account = 'a', epoch = 'one', live = true
  const token = 'a'.repeat(43)
  const server = createServer((req, res) => {
    if (!live || req.url !== '/account/memory-session' || req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return }
    res.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify({accountId:account,accountSessionEpoch:epoch}))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const login = (id, sessionEpoch, desktop='test-desktop') => writeFileSync(file, JSON.stringify({accountId:id,accountSessionEpoch:sessionEpoch,desktopRuntimeEpoch:desktop,baseURL:`http://127.0.0.1:${server.address().port}`,brokerToken:token}), {mode:0o600})
  const store = new MemoryStore(join(root,'account.sqlite'), Date.now, accountMemoryOptions(root))
  const pref = {key:'style',content:'account A private',evidence:'fixture',level:'preference'}
  await store.save('global',{...pref, content:'device'},'s')
  login('a','one')
  await store.save('account',pref,'s')
  assert.deepEqual(new Set((await store.list('workspace')).map(r=>r.content)),new Set(['device','account A private']))
  account='b'; epoch='two'; login('b','two')
  assert.deepEqual((await store.list('workspace')).map(r=>r.content),['device'])
  account='a'; epoch='three'; login('a','three')
  assert((await store.list('workspace')).some(r=>r.content==='account A private'))
  // Simulate failed unlink: the runtime file remains byte-for-byte intact.
  live=false
  assert.deepEqual((await store.list('workspace')).map(r=>r.content),['device'])
  await assert.rejects(store.save('account',{...pref,key:'no-write'},'s'),/请先登录/)
  await store.save('workspace',{...pref,key:'local',content:'local'},'s')
  assert((await store.list('workspace')).some(r=>r.content==='local'))
  live=true; login('a','three','stale-desktop')
  assert(!(await store.list('workspace')).some(r=>r.content==='account A private'))
})

test('account revocation during authenticated transaction rolls back without blocking the broker', async t => {
  const {root} = fixture(t), file=join(root,'managed-model-session.json')
  const oldEpoch=process.env.CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH; process.env.CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH='desktop'
  t.after(()=>{ if(oldEpoch===undefined) delete process.env.CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH; else process.env.CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH=oldEpoch })
  let requests=0, postStarted, releasePost
  const entered = new Promise(resolve=>{postStarted=resolve})
  const server=createServer((req,res)=>{
    requests++
    if(requests===2) { postStarted(); releasePost=()=>res.writeHead(401).end(); return }
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({accountId:'a',accountSessionEpoch:'one'}))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); t.after(()=>server.close())
  writeFileSync(file,JSON.stringify({accountId:'a',accountSessionEpoch:'one',desktopRuntimeEpoch:'desktop',baseURL:`http://127.0.0.1:${server.address().port}`,brokerToken:'a'.repeat(43)}),{mode:0o600})
  const path=join(root,'race.sqlite'),store=new MemoryStore(path,Date.now,accountMemoryOptions(root))
  const pending=store.save('account',{key:'secret',content:'private',evidence:'fixture',level:'preference'},'s')
  await entered
  // A competing connection fails immediately instead of freezing the JS loop.
  const { stdout } = await promisify(execFile)(process.execPath, ['-e', `const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(process.argv[1]); db.exec('PRAGMA busy_timeout=0'); try { db.exec('BEGIN IMMEDIATE'); process.stdout.write('unexpected-lock'); } catch(e) { process.stdout.write(e.message); } finally { db.close() }`, path])
  assert.match(stdout,/locked/)
  releasePost(); await assert.rejects(pending,/会话已失效/)
  const db=new DatabaseSync(path)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memories').get().n,0); db.close()
})

test('prompt recall discards account data when broker session changes during assembly', async t => {
  const { root } = fixture(t), file = join(root, 'managed-model-session.json')
  const oldRoot=process.env.CRAWSHRIMP_DATA, oldEpoch=process.env.CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH
  process.env.CRAWSHRIMP_DATA=root; process.env.CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH='desktop'
  t.after(()=>{ if(oldRoot===undefined) delete process.env.CRAWSHRIMP_DATA; else process.env.CRAWSHRIMP_DATA=oldRoot; if(oldEpoch===undefined) delete process.env.CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH; else process.env.CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH=oldEpoch })
  let epoch='one'; const token='a'.repeat(43)
  const server=createServer((req,res)=>res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({accountId:'a',accountSessionEpoch:epoch})))
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); t.after(()=>server.close())
  writeFileSync(file,JSON.stringify({accountId:'a',accountSessionEpoch:'one',desktopRuntimeEpoch:'desktop',baseURL:`http://127.0.0.1:${server.address().port}`,brokerToken:token}),{mode:0o600})
  await new MemoryStore(join(root,'agent','memory','memory.sqlite'),Date.now,accountMemoryOptions(root)).save('account',{key:'style',content:'private preference',evidence:'fixture',level:'preference'},'s')
  const {apply}=await import('./memory.js'); let assemble
  apply({tools:{register(){}},systemPrompt:{section(){}},on(_name,fn){assemble=fn}})
  const original=MemoryStore.prototype.searchRows
  MemoryStore.prototype.searchRows=function(...args){const rows=original.apply(this,args);epoch='two';return rows}
  t.after(()=>{MemoryStore.prototype.searchRows=original})
  const agent={id:'s',session:{header:{cwd:root},snapshotEvents:()=>[]}}
  const result=await assemble({}, {agent}, async()=>({tools:[{name:'memory_search'}],contexts:[]}))
  assert.doesNotMatch(JSON.stringify(result.contexts),/private preference/)
  assert.equal(result.contexts[0].name,'crawshrimp-memory-status')
})


test('same-account new session during correction or forget rolls back', async t => {
  const { root } = fixture(t), path=join(root,'switch.sqlite')
  const one={scope:'account:a',identity:'session-one'}, two={scope:'account:a',identity:'session-two'}
  const stable=new MemoryStore(path,Date.now,{accountSession:async()=>one})
  const saved=await stable.save('account',{key:'style',content:'original',evidence:'fixture',level:'preference'},'s')
  const change=()=>{let count=0;return new MemoryStore(path,Date.now,{accountSession:async()=>++count===1?one:two})}
  await assert.rejects(change().save('account',{key:'style',content:'changed',evidence:'fixture',level:'preference',expected_revision:saved.revision},'s'),/会话已失效/)
  await assert.rejects(change().forget('account',saved.id,saved.revision),/会话已失效/)
  const rows=await stable.list('account')
  assert.equal(rows.length,1); assert.equal(rows[0].content,'original'); assert.equal(rows[0].revision,saved.revision)
})

test('memory tools await authenticated account save and search', async t => {
  const {root}=fixture(t), file=join(root,'managed-model-session.json')
  const oldRoot=process.env.CRAWSHRIMP_DATA, oldEpoch=process.env.CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH
  process.env.CRAWSHRIMP_DATA=root; process.env.CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH='desktop'
  t.after(()=>{if(oldRoot===undefined)delete process.env.CRAWSHRIMP_DATA;else process.env.CRAWSHRIMP_DATA=oldRoot;if(oldEpoch===undefined)delete process.env.CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH;else process.env.CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH=oldEpoch})
  const server=createServer((req,res)=>res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({accountId:'a',accountSessionEpoch:'one'})))
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close())
  writeFileSync(file,JSON.stringify({accountId:'a',accountSessionEpoch:'one',desktopRuntimeEpoch:'desktop',baseURL:`http://127.0.0.1:${server.address().port}`,brokerToken:'a'.repeat(43)}),{mode:0o600})
  const tools=new Map(), {apply}=await import('./memory.js')
  apply({tools:{register(tool){tools.set(tool.name,tool)}},systemPrompt:{section(){}},on(){}})
  const agent={id:'s',session:{header:{cwd:root},snapshotEvents:()=>[{type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'请记住偏好'}]}}]}}
  const saved=await tools.get('memory_save').execute({key:'style',content:'account preference',evidence:'偏好',level:'preference',scope:'account'},{agent})
  assert(saved.memory.id)
  const result=await tools.get('memory_search').execute({query:'account'},{agent})
  assert(result.memories.some(row=>row.content==='account preference'))
})
