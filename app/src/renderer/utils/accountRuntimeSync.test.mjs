import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAccountRuntimeSync } from './accountRuntimeSync.mjs'

test('active run defers account change until idle and records only a successful restart', async () => {
  let calls = 0, pending = false
  const sync = createAccountRuntimeSync({ restart: async () => ++calls === 1 ? { ok: false, error: 'ACTIVE_RUN' } : { ok: true }, onPending: value => { pending = value } })
  await sync.setAccount('B')
  assert.equal(pending, true)
  await sync.retryIfIdle('run-1')
  assert.equal(calls, 1)
  await sync.retryIfIdle(null)
  assert.equal(calls, 2)
  assert.equal(pending, false)
  await sync.setAccount('B')
  assert.equal(calls, 2)
})

test('a newer account is applied after an older restart finishes', async () => {
  let release, calls = 0
  const sync = createAccountRuntimeSync({ restart: () => ++calls === 1 ? new Promise(resolve => { release = resolve }) : Promise.resolve({ ok: true }) })
  const first = sync.setAccount('A')
  await sync.setAccount('B')
  release({ ok: true })
  await first
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 2)
  await sync.setAccount('B')
  assert.equal(calls, 2)
})

test('non-active failures remain visible and are not retried on every poll', async () => {
  let calls = 0, message = ''
  const sync = createAccountRuntimeSync({ restart: async () => { calls++; return { ok: false, error: 'broken' } }, onError: value => { message = value } })
  await sync.setAccount('A')
  await sync.retryIfIdle(null)
  assert.equal(calls, 1)
  assert.equal(message, 'broken')
  await sync.setAccount('A')
  assert.equal(calls, 2)
})

test('switching A to B and back to A during a restart reapplies A', async () => {
  let calls = 0, release
  const sync = createAccountRuntimeSync({ restart: () => {
    calls++
    return calls === 2 ? new Promise(resolve => { release = resolve }) : Promise.resolve({ ok: true })
  } })
  await sync.setAccount('A')
  const switching = sync.setAccount('B')
  await sync.setAccount('A')
  release({ ok: true })
  await switching
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 3)
  await sync.setAccount('A')
  assert.equal(calls, 3)
})
