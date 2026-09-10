import assert from 'node:assert/strict'
import test from 'node:test'
import { repairReceiptTurns } from './repair-automation-receipts.mjs'
const turn = (n, provider = 'model') => [
  { type: 'turn/start', data: { turn: n } },
  { type: 'step/start', data: { turn: n, step: 1 } },
  { type: 'assistant/message', data: { turn: n, step: 1, message: { source: { provider }, content: ['keep me'] } } },
  { type: 'step/end', data: { turn: n, step: 1 } },
  { type: 'turn/end', data: { turn: n } },
]
test('repairs legacy receipts and subsequent turns without changing content or seq', () => {
  const original = [...turn(1), ...turn(2), ...turn(1, 'crawshrimp-automation'), ...turn(3)].map((e, seq) => ({ ...e, seq }))
  const repaired = repairReceiptTurns(original)
  assert.deepEqual(repaired.filter(e => e.type === 'turn/start').map(e => e.data.turn), [1, 2, 3, 4])
  assert.deepEqual(repaired.map(e => e.seq), original.map(e => e.seq))
  assert.deepEqual(repaired.filter(e => e.type === 'assistant/message').map(e => e.data.message), original.filter(e => e.type === 'assistant/message').map(e => e.data.message))
  assert.equal(repairReceiptTurns(repaired), repaired)
  assert.equal(original[10].data.turn, 1)
})
test('rejects unrelated malformed history', () => {
  assert.throws(() => repairReceiptTurns([...turn(1), ...turn(1)]), /not a Crawshrimp/)
})

test('disk repair backs up original bytes and produces readable, idempotent history', async () => {
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join, resolve } = await import('node:path')
  const { zstdCompressSync } = await import('node:zlib')
  const { JsonlSessionPersistence: P } = await import('../node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js')
  const { repairAutomationReceiptLogs } = await import('./repair-automation-receipts.mjs')
  const root = await mkdtemp(join(tmpdir(), 'cs-history-repair-test-'))
  try {
    const dshHome = join(root, 'dsh-home')
    const path = join(root, 'harness-sessions', 'group', 'session-test', 'session.jsonl.zstd')
    await mkdir(join(path, '..'), { recursive: true })
    const header = { type: 'session', version: 0, id: 'session-test', createdAt: 1, delegationDepth: 0 }
    // Use a header-only file to check no rewrite for healthy histories.
    const bytes = zstdCompressSync(Buffer.from(JSON.stringify(header) + '\n'))
    await writeFile(path, bytes)
    const options = { runtimeRoot: resolve(import.meta.dirname, '..'), dshHome }
    assert.deepEqual(await repairAutomationReceiptLogs(options), [])
    assert.deepEqual(await readFile(path), bytes)
    assert.equal((await P.prototype.readZstdPrefix.call({}, bytes)).events.length, 0)
    const { createAssistantMessage } = await import('../node_modules/@deepseek-ai/dsh-llm/lib/index.js')
    const rows = [...turn(1), ...turn(1, 'crawshrimp-automation'), ...turn(2)].map((e, seq) => ({
      ...e, seq, time: seq + 1,
      ...(e.type === 'assistant/message' ? { surfaceOp: 'append', data: { ...e.data,
        message: createAssistantMessage({ content: [{ type: 'text', text: 'preserved' }], source: { provider: e.data.message.source.provider, model: 'fixture' } }) } } : {}),
    }))
    const damaged = Buffer.concat([bytes, zstdCompressSync(Buffer.from(rows.map(e => JSON.stringify(e)).join('\n') + '\n'))])
    await writeFile(path, damaged)
    const result = await repairAutomationReceiptLogs(options)
    assert.equal(result.length, 1)
    assert.deepEqual(await readFile(result[0].backup), damaged)
    const restored = await P.prototype.readZstdPrefix.call({}, await readFile(path))
    assert.deepEqual(restored.events.filter(e => e.type === 'turn/start').map(e => e.data.turn), [1, 2, 3])
    assert.deepEqual(await repairAutomationReceiptLogs(options), [])
  } finally { await rm(root, { recursive: true, force: true }) }
})
