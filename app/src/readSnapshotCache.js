'use strict'
function createReadSnapshotCache({ ttlMs = 1000, now = Date.now } = {}) {
  const entries = new Map()
  let revision = 0
  return {
    invalidate() { revision++; entries.clear() },
    async read(key, load) {
      const old = entries.get(key)
      if (old && (old.pending || now() - old.at < ttlMs)) return structuredClone(await old.promise)
      const stamp = revision
      const entry = { pending: true, at: now(), promise: null }
      entry.promise = Promise.resolve().then(load).then(result => {
        entry.pending = false; entry.at = now()
        if (revision !== stamp && entries.get(key) === entry) entries.delete(key)
        return result
      }, error => { if (entries.get(key) === entry) entries.delete(key); throw error })
      entries.set(key, entry)
      while (entries.size > 16) entries.delete(entries.keys().next().value)
      return structuredClone(await entry.promise)
    },
  }
}
module.exports = { createReadSnapshotCache }
