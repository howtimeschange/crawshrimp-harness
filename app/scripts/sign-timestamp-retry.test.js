'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { executeWithTimestampRetry } = require('./sign-macos-app')

test('transient timestamp failure retries the unchanged strong signing request', async () => {
  const args = ['--sign', 'developer-identity', '--force', '--timestamp', '--options', 'runtime', '/bundle/binary']
  const calls = []
  const output = await executeWithTimestampRetry(async (...call) => {
    calls.push(call)
    if (calls.length === 1) throw new Error('A timestamp was expected but was not found.')
    return 'signed'
  }, 'codesign', args, { encoding: 'utf8' }, async () => {})
  assert.equal(output, 'signed')
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], calls[1])
  assert.ok(calls[1][1].includes('--timestamp'))
})

test('timestamp retry has a three-attempt bound', async () => {
  let calls = 0
  await assert.rejects(executeWithTimestampRetry(async () => {
    calls++
    throw new Error('A timestamp was expected but was not found.')
  }, 'codesign', ['--timestamp', '/binary'], {}, async () => {}), /timestamp/)
  assert.equal(calls, 3)
})

test('signing identity failures and signature verification are not retried', async () => {
  for (const [args, message] of [[['--timestamp', '/binary'], 'identity not found'], [['--verify', '/binary'], 'A timestamp was expected but was not found.']]) {
    let calls = 0
    await assert.rejects(executeWithTimestampRetry(async () => {
      calls++
      throw new Error(message)
    }, 'codesign', args, {}, async () => {}))
    assert.equal(calls, 1)
  }
})
