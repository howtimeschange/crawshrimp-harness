import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { patchIdleWatchdogSource, patchStreamCleanupSource } from './stream-lifecycle.mjs'
const source = readFileSync(new URL('./fixtures/timeout-012.mjs', import.meta.url), 'utf8')
const patched = patchIdleWatchdogSource(source)
const { idleWatchdog, timeoutOf } = await import('data:text/javascript;base64,' + Buffer.from(patched).toString('base64'))
const wait = ms => new Promise(r => setTimeout(r, ms))
test('hung transport next settles at idle deadline', async () => {
 const w = idleWatchdog(undefined, 20, 'IDLE')
 try { await assert.rejects(w.next({ next: () => new Promise(() => {}) }), /IDLE/); assert(timeoutOf(w.signal, 'IDLE')) }
 finally { w[Symbol.dispose]() }
})
test('caller cancellation settles hung transport and keeps caller reason', async () => {
 const c = new AbortController(), w = idleWatchdog(c.signal, 2000, 'IDLE')
 const reason = new Error('user cancelled'), result = w.next({ next: () => new Promise(() => {}) })
 c.abort(reason)
 await assert.rejects(result, e => e === reason)
 assert.equal(timeoutOf(w.signal, 'IDLE'), undefined); w[Symbol.dispose]()
})
test('consumer work does not count as provider idle; stream values preserved', async () => {
 const w = idleWatchdog(undefined, 20, 'IDLE')
 assert.deepEqual(await w.next({ next: async () => ({ value: 1, done: false }) }), { value: 1, done: false })
 await wait(40); assert.equal(w.signal.aborted, false)
 assert.deepEqual(await w.next({ next: async () => ({ done: true }) }), { done: true }); w[Symbol.dispose]()
})
test('late transport rejection after timeout is observed, with no unhandled rejection', async () => {
 const w = idleWatchdog(undefined, 10, 'IDLE')
 let reject
 await assert.rejects(w.next({ next: () => new Promise((_, r) => { reject = r }) }), /IDLE/)
 reject(new Error('late close')); await wait(5); w[Symbol.dispose]()
})
test('cleanup no longer waits for a return queued behind hung read; transformations idempotent', async () => {
 const adapter = 'try { await iterator.return(void 0); } catch (_abortedSdkTeardown) {}'
 const updated = patchStreamCleanupSource(adapter)
 assert.equal(patchStreamCleanupSource(updated), updated)
 assert.equal(patchIdleWatchdogSource(patched), patched)
 const fn = new Function('iterator', 'return (async () => {' + updated.match(/\/\/ crawshrimp-detached-stream-cleanup-v1\n([^\n]+)/)[1] + '})()')
 await Promise.race([fn({ return: () => new Promise(() => {}) }), wait(50).then(() => { throw new Error('cleanup blocked') })])
})
