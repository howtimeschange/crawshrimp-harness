import { copyFile, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { zstdCompressSync } from 'node:zlib'

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
  const { JsonlSessionPersistence } = await import(pathToFileURL(join(runtimeRoot, 'node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js')).href)
  const repaired = []
  for (const group of groups.filter(x => x.isDirectory())) {
    for (const entry of await readdir(join(sessionsRoot, group.name), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = join(sessionsRoot, group.name, entry.name, 'session.jsonl.zstd')
      let bytes
      try { bytes = await readFile(path) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
      const decoded = await JsonlSessionPersistence.prototype.readZstdPrefix.call({}, bytes)
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
      const backup = path + '.before-product-history-repair-v2'
      await copyFile(path, backup, constants.COPYFILE_EXCL)
      const header = zstdCompressSync(Buffer.from(JSON.stringify({ type: 'session', ...decoded.meta }) + '\n'))
      const body = zstdCompressSync(Buffer.from(events.map(e => JSON.stringify(e)).join('\n') + '\n'))
      const temp = path + '.receipt-repair-tmp'
      await writeFile(temp, Buffer.concat([header, body]), { mode: 0o600, flag: 'wx' })
      await rename(temp, path)
      const cache = join(dshHome, 'storages/session_projcache/sessions', entry.name + '.json')
      try { await rename(cache, cache + '.before-product-history-repair-v2') } catch (error) { if (error.code !== 'ENOENT') throw error }
      repaired.push({ sessionId: entry.name, backup })
    }
  }
  return repaired
}
