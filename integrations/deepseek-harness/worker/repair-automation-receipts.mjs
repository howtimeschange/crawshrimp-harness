import { open, readFile, readdir, rename, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { zstdCompressSync, zstdDecompress } from 'node:zlib'

const decompress = promisify(zstdDecompress)

async function syncedTemp(path, bytes) {
  const temp = path + '.receipt-repair-' + randomUUID() + '.tmp'
  const file = await open(temp, 'wx', 0o600)
  try { await file.writeFile(bytes); await file.sync() }
  catch (error) { await unlink(temp).catch(() => {}); throw error }
  finally { await file.close() }
  return temp
}

async function receiptBackup(path, bytes) {
  let backup = path + '.before-product-history-repair-v2'
  const addressed = backup + '.' + createHash('sha256').update(bytes).digest('hex')
  while (true) {
    try {
      if ((await readFile(backup)).equals(bytes)) return backup
      // Preserve older/partial backups, including interruption while creating
      // the content-addressed backup. Never require filesystem hard-link support.
      backup = backup === path + '.before-product-history-repair-v2' ? addressed : addressed + '.' + randomUUID()
      continue
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    let file
    try { file = await open(backup, 'wx', 0o600) }
    catch (error) { if (error.code === 'EEXIST') continue; throw error }
    try { await file.writeFile(bytes); await file.sync() }
    finally { await file.close() }
    return backup
  }
}

// Only the old product-owned flat event layout needs this repair. rc.2 owns
// current-generation decoding/migration; its persistence implementation is private.
// A torn/unsupported log stays byte-for-byte intact for the native reader to diagnose.
export async function readLegacyReceiptLog(bytes) {
  let plain
  try {
    const frames = []; let offset = 0, size = 0
    while (offset < bytes.length) {
      const decoded = await decompress(bytes.subarray(offset), { info: true, maxOutputLength: 256 * 1024 * 1024 - size })
      const consumed = decoded.engine.bytesWritten
      if (!Number.isSafeInteger(consumed) || consumed <= 0 || consumed > bytes.length - offset) return null
      frames.push(decoded.buffer); size += decoded.buffer.length; offset += consumed
      if (size >= 256 * 1024 * 1024) return null
    }
    plain = Buffer.concat(frames)
  }
  catch { return null }
  if (!plain.length || plain.at(-1) !== 10) return null
  let rows
  try { rows = plain.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line)) }
  catch { return null }
  const [header, ...events] = rows
  if (header?.type !== 'session' || !Number.isInteger(header.version) || header.version < 0 || header.version > 3
      || typeof header.id !== 'string' || header.inheritedEventCount || header.parent || header.fork) return null
  if (!events.every((event, seq) => event && event.seq === seq && typeof event.type === 'string'
      && event.data && typeof event.data === 'object' && !Array.isArray(event.data))) return null
  const { type: _type, ...meta } = header
  return { meta, events }
}

// Only repair the known product receipt defect, never arbitrary malformed logs.
export function repairReceiptTurns(events) {
  let last = 0, mapping, knownDefect = false
  const output = [...events]
  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    if (event.type === 'turn/start') {
      if (mapping) throw new Error('Cannot repair an open/nested turn')
      const original = event.data.turn
      if (original <= last && !knownDefect) {
        const body = events.slice(i, i + 5)
        if (body.map(e => e.type).join(',') !== 'turn/start,step/start,assistant/message,step/end,turn/end'
            || body[2].data?.message?.source?.provider !== 'crawshrimp-automation') {
          throw new Error('Duplicate turn is not a Crawshrimp automation receipt')
        }
        knownDefect = true
      }
      const turn = knownDefect ? Math.max(original, last + 1) : original
      mapping = { original, turn }
      last = turn
    }
    if (mapping && event.data?.turn === mapping.original && mapping.turn !== mapping.original) {
      output[i] = { ...event, data: { ...event.data, turn: mapping.turn } }
    }
    if (event.type === 'turn/end') mapping = undefined
  }
  if (mapping && knownDefect) throw new Error('Cannot repair a running session')
  return knownDefect ? output : events
}

// Called before the sole managed Host starts, after its predecessor has exited.
// Backups preserve the exact compressed bytes; sequence IDs and message bodies stay stable.
export async function repairAutomationReceiptLogs({ runtimeRoot, dshHome }) {
  const sessionsRoot = join(dshHome, '..', 'harness-sessions')
  let groups
  try { groups = await readdir(sessionsRoot, { withFileTypes: true }) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
  const repaired = []
  for (const group of groups.filter(x => x.isDirectory())) {
    for (const entry of await readdir(join(sessionsRoot, group.name), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = join(sessionsRoot, group.name, entry.name, 'session.jsonl.zstd')
      let bytes
      try { bytes = await readFile(path) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
      const decoded = await readLegacyReceiptLog(bytes)
      if (!decoded) continue
      // Unrelated historical defects stay owned by the original runtime reader.
      let events
      try { events = repairReceiptTurns(decoded.events) }
      catch { continue }
      // rc.1 requires model provenance on assistant records. Older product
      // recovery notices used a plugin source; preserve their text and identity.
      const normalized = events.map(event => event.type === 'assistant/message'
        && event.data?.message?.source?.kind === 'plugin'
        && event.data.message.source.plugin === 'crawshrimp-output-recovery'
        ? { ...event, data: { ...event.data, message: { ...event.data.message,
            source: { kind: 'model', provider: 'crawshrimp-output-recovery', model: 'notice' } } } }
        : event)
      if (events === decoded.events && normalized.every((e, i) => e === events[i])) continue
      events = normalized
      if (decoded.inheritedEventCount) throw new Error('Repair of fork-inherited receipts requires manual review')
      const backup = await receiptBackup(path, bytes)
      const header = zstdCompressSync(Buffer.from(JSON.stringify({ type: 'session', ...decoded.meta }) + '\n'))
      const body = zstdCompressSync(Buffer.from(events.map(e => JSON.stringify(e)).join('\n') + '\n'))
      const temp = await syncedTemp(path, Buffer.concat([header, body]))
      try {
        if (!(await readFile(path)).equals(bytes)) throw new Error('历史在修复期间发生变化；已保留原文件和备份：' + path)
        // Invalidate before replacing history, so an interruption after rename
        // cannot leave a stale projection cache paired with the repaired log.
        const cache = join(dshHome, 'storages/session_projcache/sessions', entry.name + '.json')
        try { await rename(cache, cache + '.before-product-history-repair-v2-' + randomUUID()) }
        catch (error) { if (error.code !== 'ENOENT') throw error }
        await rename(temp, path)
      } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error }) }
      repaired.push({ sessionId: entry.name, backup })
    }
  }
  return repaired
}
