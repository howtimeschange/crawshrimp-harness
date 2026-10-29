import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { search as rank } from './memory-ranking.js'

export const LEVELS = ['preference', 'fact', 'procedure', 'lesson']
const SECRET = /(?:sk-[a-zA-Z0-9_-]{16,}|-----BEGIN .*PRIVATE KEY|(?:password|api[_-]?key|access[_-]?token|密码|密钥)\s*[:=：]\s*\S+)/i
export function safeText(value, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`记忆文字须为 1–${max} 字符`)
  if (SECRET.test(value)) throw new Error('请移除凭据后再保存记忆')
  return value.trim()
}

// One short-lived connection per operation: no handles retained by scoped plugins.
// SQLite transactions serialize writes across sessions and runtime processes.
export class MemoryStore {
  constructor(path, now = Date.now, { globalScope = 'global', assertAccount = () => {}, accountScope = () => null, accountIdentity = () => null, accountSession = null } = {}) {
    this.path = path; this.now = now; this.globalScope = globalScope; this.assertAccount = assertAccount; this.accountScope = accountScope; this.accountIdentity = accountIdentity; this.accountSession = accountSession
  }
  physicalScope(scope, account) {
    if (scope === 'account') { if (!account) throw new Error('请先登录对应账号后访问账号记忆'); return account }
    return scope === 'global' ? this.globalScope : scope
  }
  logicalRow(row, account) {
    if (row?.scope === this.globalScope) return { ...row, scope: 'global' }
    return account && row?.scope === account ? { ...row, scope: 'account' } : row
  }
  withDb(fn, { write = false, requireAccount = false, includeAccount = false } = {}) {
    if (this.accountSession) return this.withAuthenticatedDb(fn, { write, requireAccount, includeAccount })
    this.assertAccount()
    const identity = this.accountIdentity()
    const account = this.accountScope()
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const db = new DatabaseSync(this.path)
    try {
      chmodSync(this.path, 0o600)
      db.exec(`PRAGMA busy_timeout=3000; PRAGMA secure_delete=ON;
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY, scope TEXT NOT NULL, key TEXT NOT NULL,
          level TEXT NOT NULL, content TEXT NOT NULL, evidence TEXT NOT NULL,
          session TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          expires_at INTEGER, revision INTEGER NOT NULL DEFAULT 1, expires_verified INTEGER NOT NULL DEFAULT 0,
          UNIQUE(scope, key));
        CREATE INDEX IF NOT EXISTS memory_scope ON memories(scope);`)
      if (!db.prepare('PRAGMA table_info(memories)').all().some(r => r.name === 'expires_verified'))
        db.exec('ALTER TABLE memories ADD COLUMN expires_verified INTEGER NOT NULL DEFAULT 0')
      if (write) db.exec('BEGIN IMMEDIATE')
      try {
        const result = fn(db, account)
        if (this.accountScope() !== account || this.accountIdentity() !== identity) throw new Error('账号已切换，请重试记忆操作')
        if (write) db.exec('COMMIT')
        return result
      } catch (error) {
        if (write) db.exec('ROLLBACK')
        throw error
      }
    } finally { db.close() }
  }
  async withAuthenticatedDb(fn, { write, requireAccount, includeAccount }) {
    const identity = requireAccount || includeAccount ? await this.accountSession() : null
    if (requireAccount && !identity) throw new Error('请先登录对应账号后访问账号记忆')
    const account = identity?.scope || null
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const db = new DatabaseSync(this.path)
    try {
      chmodSync(this.path, 0o600)
      // Never block the Node event loop while another process holds a write
      // lock: the broker check below needs the loop to finish or time out.
      db.exec(`PRAGMA busy_timeout=0; PRAGMA secure_delete=ON;
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY, scope TEXT NOT NULL, key TEXT NOT NULL,
          level TEXT NOT NULL, content TEXT NOT NULL, evidence TEXT NOT NULL,
          session TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          expires_at INTEGER, revision INTEGER NOT NULL DEFAULT 1, expires_verified INTEGER NOT NULL DEFAULT 0,
          UNIQUE(scope, key));
        CREATE INDEX IF NOT EXISTS memory_scope ON memories(scope);`)
      if (!db.prepare('PRAGMA table_info(memories)').all().some(r => r.name === 'expires_verified'))
        db.exec('ALTER TABLE memories ADD COLUMN expires_verified INTEGER NOT NULL DEFAULT 0')
      if (write) db.exec('BEGIN IMMEDIATE')
      try {
        const result = fn(db, account)
        if (identity) {
          const current = await this.accountSession()
          if (!current || current.identity !== identity.identity || current.scope !== identity.scope)
            throw new Error('账号已切换或会话已失效，请重试记忆操作')
        }
        if (write) db.exec('COMMIT')
        return result
      } catch (error) {
        if (write) db.exec('ROLLBACK')
        throw error
      }
    } finally { db.close() }
  }
  save(scope, input, session) {
    const key = safeText(input.key, 120), content = safeText(input.content)
    const evidence = safeText(input.evidence, 1000)
    if (!LEVELS.includes(input.level)) throw new Error('未知记忆类型')
    if ((scope === 'global' || scope === 'account') && input.level !== 'preference') throw new Error('全局记忆仅用于用户偏好；业务事实请存当前工作区')
    const changesExpiry = Object.hasOwn(input, 'ttl_days')
    const days = changesExpiry ? input.ttl_days : (input.level === 'fact' ? 30 : 0)
    if (!Number.isInteger(days) || days < 0 || days > 3650 || (input.level === 'fact' && days === 0)) throw new Error('事实须设置 1–3650 天有效期；其他类型可用 0 表示长期')
    const now = this.now()
    return this.withDb((db, account) => {
      scope = this.physicalScope(scope, account)
      const old = db.prepare('SELECT * FROM memories WHERE scope=? AND key=?').get(scope, key)
      if (old && scope.startsWith('account:') && !old.expires_verified)
        throw new Error('这条账号记忆的有效期尚未同步，请连接新版服务后再纠正')
      if (old && input.expected_revision !== old.revision) throw new Error('该记忆已存在或发生变化，请先查询并提供 expected_revision 后纠正')
      if (!old && input.expected_revision != null) throw new Error('待纠正记忆不存在')
      const id = old?.id || randomUUID()
      const expiry = old && !changesExpiry ? old.expires_at : days ? now + days * 86400000 : null
      if (input.level === 'fact' && expiry === null) throw new Error('事实须设置有效期')
      db.prepare(`INSERT INTO memories(id,scope,key,level,content,evidence,session,created_at,updated_at,expires_at,expires_verified)
        VALUES(?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(scope,key) DO UPDATE SET
        level=excluded.level,content=excluded.content,evidence=excluded.evidence,session=excluded.session,
        updated_at=excluded.updated_at,expires_at=excluded.expires_at,expires_verified=1,revision=memories.revision+1`)
        .run(id, scope, key, input.level, content, evidence, session, now, now, expiry)
      const row = db.prepare('SELECT * FROM memories WHERE id=?').get(id)
      return this.logicalRow(row, account)
    }, { write: true, requireAccount: scope === 'account' })
  }
  list(scope, includeExpired = false) {
    return this.withDb((db, account) => db.prepare(`SELECT * FROM memories WHERE (scope=? OR scope=? OR scope=?)
      AND (scope NOT LIKE 'account:%' OR expires_verified=1)
      ${includeExpired ? '' : 'AND (expires_at IS NULL OR expires_at > ?)'} ORDER BY updated_at DESC, id`)
      .all(...(includeExpired ? [this.physicalScope(scope, account), this.globalScope, account || ''] : [this.physicalScope(scope, account), this.globalScope, account || '', this.now()]))
      .map(row => this.logicalRow(row, account)), { includeAccount: true, requireAccount: scope === 'account' })
  }
  search(scope, query, limit = 8) {
    const rows = this.list(scope)
    return rows && typeof rows.then === 'function' ? rows.then(value => this.searchRows(value, query, limit)) : this.searchRows(rows, query, limit)
  }
  searchRows(rows, query, limit = 8) {
    if (!query.trim()) return rows.slice(0, limit)
    const byId = new Map(rows.map(r => [r.id, r]))
    return rank(query.slice(0, 4000), rows.map(r => ({ ...r, title: r.key, keywords: [], importance: r.level === 'preference' ? 3 : 1 })), { k: limit, now: this.now() })
      .map(hit => ({ ...byId.get(hit.id), score: hit.score }))
  }
  forget(scope, id, revision) {
    return this.withDb((db, account) => {
      const result = db.prepare('DELETE FROM memories WHERE scope=? AND id=? AND revision=?').run(this.physicalScope(scope, account), id, revision)
      if (!result.changes) throw new Error('记忆不存在、作用域不匹配或版本已变化；请重新查询')
      return { forgotten: id, note: '已从长期记忆库删除；历史会话中的原始消息和旧快照不会被改写。' }
    }, { write: true, requireAccount: scope === 'account' })
  }
}
