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
  constructor(path, now = Date.now, { globalScope = 'global', assertAccount = () => {} } = {}) {
    this.path = path; this.now = now; this.globalScope = globalScope; this.assertAccount = assertAccount
  }
  physicalScope(scope) { return scope === 'global' ? this.globalScope : scope }
  logicalRow(row) { return row?.scope === this.globalScope ? { ...row, scope: 'global' } : row }
  withDb(fn) {
    this.assertAccount()
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
      return fn(db)
    } finally { db.close() }
  }
  save(scope, input, session) {
    const key = safeText(input.key, 120), content = safeText(input.content)
    const evidence = safeText(input.evidence, 1000)
    if (!LEVELS.includes(input.level)) throw new Error('未知记忆类型')
    if (scope === 'global' && input.level !== 'preference') throw new Error('全局记忆仅用于用户偏好；业务事实请存当前工作区')
    scope = this.physicalScope(scope)
    const changesExpiry = Object.hasOwn(input, 'ttl_days')
    const days = changesExpiry ? input.ttl_days : (input.level === 'fact' ? 30 : 0)
    if (!Number.isInteger(days) || days < 0 || days > 3650 || (input.level === 'fact' && days === 0)) throw new Error('事实须设置 1–3650 天有效期；其他类型可用 0 表示长期')
    const now = this.now()
    return this.withDb(db => {
      db.exec('BEGIN IMMEDIATE')
      try {
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
        db.exec('COMMIT'); return this.logicalRow(row)
      } catch (error) { db.exec('ROLLBACK'); throw error }
    })
  }
  list(scope, includeExpired = false) {
    return this.withDb(db => db.prepare(`SELECT * FROM memories WHERE (scope=? OR scope=?)
      AND (scope NOT LIKE 'account:%' OR expires_verified=1)
      ${includeExpired ? '' : 'AND (expires_at IS NULL OR expires_at > ?)'} ORDER BY updated_at DESC, id`)
      .all(...(includeExpired ? [this.physicalScope(scope), this.globalScope] : [this.physicalScope(scope), this.globalScope, this.now()]))
      .map(row => this.logicalRow(row)))
  }
  search(scope, query, limit = 8) {
    const rows = this.list(scope)
    if (!query.trim()) return rows.slice(0, limit)
    const byId = new Map(rows.map(r => [r.id, r]))
    return rank(query.slice(0, 4000), rows.map(r => ({ ...r, title: r.key, keywords: [], importance: r.level === 'preference' ? 3 : 1 })), { k: limit, now: this.now() })
      .map(hit => ({ ...byId.get(hit.id), score: hit.score }))
  }
  forget(scope, id, revision) {
    return this.withDb(db => {
      const result = db.prepare('DELETE FROM memories WHERE scope=? AND id=? AND revision=?').run(this.physicalScope(scope), id, revision)
      if (!result.changes) throw new Error('记忆不存在、作用域不匹配或版本已变化；请重新查询')
      return { forgotten: id, note: '已从长期记忆库删除；历史会话中的原始消息和旧快照不会被改写。' }
    })
  }
}
