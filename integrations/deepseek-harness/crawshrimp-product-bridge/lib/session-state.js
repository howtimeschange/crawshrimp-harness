import { MemoryStore } from './memory-store.js'
import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values'

// External plugins cannot use rc.2's experimental appendPluginRecord API.
// Keep recoverable plugin state separate from both Session wire events and memory facts.
export class SessionStateStore {
  constructor(path) { this.store = new MemoryStore(path) }
  scope(workspace, session, plugin) {
    for (const value of [workspace, session, plugin]) if (typeof value !== 'string' || !value.trim() || value.length > 512) throw new TypeError('Invalid session state scope')
    const key = JSON.stringify([workspace, session, plugin])
    const withDb = fn => this.store.withDb(db => {
      db.exec('CREATE TABLE IF NOT EXISTS plugin_session_state (scope TEXT PRIMARY KEY, version INTEGER NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL)')
      return fn(db)
    })
    return {
      get(version = 1) {
        return withDb(db => { const row = db.prepare('SELECT * FROM plugin_session_state WHERE scope=?').get(key)
          return row && row.version === version ? { revision: row.revision, value: JSON.parse(row.payload) } : undefined })
      },
      set(value, { version = 1, expectedRevision = 0 } = {}) {
        if (!Number.isSafeInteger(version) || version < 1 || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError('Invalid session state version')
        const payload = JSON.stringify(snapshotJsonValue(value))
        if (Buffer.byteLength(payload) > 65536) throw new RangeError('Session state exceeds 64 KiB')
        return withDb(db => {
          db.exec('BEGIN IMMEDIATE')
          try {
            const old = db.prepare('SELECT version,revision FROM plugin_session_state WHERE scope=?').get(key)
            if ((old?.revision ?? 0) !== expectedRevision || old && old.version !== version) throw new Error('Session state revision/version conflict')
            const revision = expectedRevision + 1
            db.prepare('INSERT INTO plugin_session_state VALUES(?,?,?,?) ON CONFLICT(scope) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(key,version,revision,payload)
            db.exec('COMMIT'); return revision
          } catch(e) {db.exec('ROLLBACK');throw e}
        })
      },
      delete(expectedRevision) {
        return withDb(db => db.prepare('DELETE FROM plugin_session_state WHERE scope=? AND revision=?').run(key,expectedRevision).changes === 1)
      },
    }
  }
}
