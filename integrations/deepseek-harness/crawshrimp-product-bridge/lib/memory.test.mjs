import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

test('account preferences are isolated and a live old scope cannot follow a new login', t => {
  const { root } = fixture(t), file=join(root,'managed-model-session.json'), database=join(root,'account-memory.sqlite')
  const login=id=>writeFileSync(file,JSON.stringify({accountId:id}),{mode:0o600})
  const preference={key:'style',content:'A private preference',evidence:'fixture',level:'preference'}
  const local=new MemoryStore(database,Date.now,accountMemoryOptions(root));local.save('global',{...preference,content:'device-only'},'local')
  login('account-a')
  assert.throws(()=>local.list('workspace'),/账号已切换/)
  const a=new MemoryStore(database,Date.now,accountMemoryOptions(root));a.save('global',preference,'a')
  login('account-b')
  assert.throws(()=>a.list('workspace'),/账号已切换/)
  assert.throws(()=>a.save('global',{...preference,key:'late'},'a'),/账号已切换/)
  const b=new MemoryStore(database,Date.now,accountMemoryOptions(root));assert.deepEqual(b.list('workspace'),[])
  login('account-a')
  assert.equal(new MemoryStore(database,Date.now,accountMemoryOptions(root)).list('workspace')[0].content,'A private preference')
  unlinkSync(file)
  assert.equal(new MemoryStore(database,Date.now,accountMemoryOptions(root)).list('workspace')[0].content,'device-only')
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
