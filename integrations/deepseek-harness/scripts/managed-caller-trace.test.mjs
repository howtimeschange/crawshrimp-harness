import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createManagedCallerFetch, listManagedCallerReceipts } from './managed-caller-trace.mjs'

function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'managed-caller-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const session = { version: 1, callerRequestIdentity: 'managed-text-preserved-v1',
    accountId: 'synthetic-owner', accountServiceOrigin: 'https://account.example',
    baseURL: 'http://127.0.0.1:12345', brokerToken: 'synthetic-token-with-more-than-32-characters' }
  fs.writeFileSync(join(root, 'managed-model-session.json'), JSON.stringify(session), { mode: 0o600 })
  return {
    root,
    caller: fetcher => createManagedCallerFetch({ dataRoot: root, provider: 'crawshrimp-managed-openai',
      modelId: 'managed-test', baseURL: session.baseURL + '/v1', apiKey: session.brokerToken,
      sessionId: 'test-session', messages: [{ role: 'user', id: 'original-user-message' }], fetcher }),
    request: () => new Request(session.baseURL + '/v1/chat/completions', { method: 'POST', body: '{"model":"test"}' }),
  }
}

function platform(t, value) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value })
  t.after(() => Object.defineProperty(process, 'platform', descriptor))
}

test('Windows persists the original ID before dispatch without syncing directory handles', async t => {
  const { root, caller, request } = fixture(t)
  platform(t, 'win32') // Filesystem fault injection, also runnable on native Windows.
  const sync = fs.fsyncSync
  let fileSyncs = 0, attempts = 0, originalId
  t.mock.method(fs, 'fsyncSync', fd => {
    if (fs.fstatSync(fd).isDirectory()) throw Object.assign(new Error('directory fsync unsupported'), { code: 'EPERM' })
    fileSyncs++
    return sync(fd)
  })
  const fetcher = async req => {
    attempts++
    originalId = req.headers.get('X-Request-Id')
    assert.equal(fileSyncs, 1)
    const rows = listManagedCallerReceipts({ dataRoot: root })
    assert.equal(rows[0].callerRequestId, originalId)
    assert.equal(rows[0].state, 'dispatch_unknown')
    return new Response('{}', { headers: { 'X-Request-Id': originalId } })
  }
  assert.equal((await caller(fetcher)(request())).status, 200)
  assert.equal(fileSyncs, 2, 'response headers update still syncs the file')
  await assert.rejects(caller(fetcher)(request()), error =>
    error.code === 'managed_trace_no_replay' && error.callerRequestId === originalId)
  assert.equal(attempts, 1)
})

test('Windows file fsync failure remains fatal before transport', async t => {
  const { caller, request } = fixture(t)
  platform(t, 'win32')
  let attempts = 0
  t.mock.method(fs, 'fsyncSync', () => { throw Object.assign(new Error('disk IO failure'), { code: 'EIO' }) })
  await assert.rejects(caller(async () => { attempts++; return new Response('{}') })(request()), { code: 'EIO' })
  assert.equal(attempts, 0)
})

test('POSIX directory fsync failure is not silently ignored', { skip: process.platform === 'win32' }, async t => {
  const { caller, request } = fixture(t)
  const sync = fs.fsyncSync
  let attempts = 0
  t.mock.method(fs, 'fsyncSync', fd => {
    if (fs.fstatSync(fd).isDirectory()) throw Object.assign(new Error('directory IO failure'), { code: 'EIO' })
    return sync(fd)
  })
  await assert.rejects(caller(async () => { attempts++; return new Response('{}') })(request()), { code: 'EIO' })
  assert.equal(attempts, 0)
})
