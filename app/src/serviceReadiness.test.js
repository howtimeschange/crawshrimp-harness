'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { waitForServiceReadiness } = require('./serviceReadiness')

test('waits for an in-flight recovery before ensuring desktop services', async () => {
  let releaseRecovery
  const recoveryBarrier = new Promise(resolve => { releaseRecovery = resolve })
  const events = []

  const pending = waitForServiceReadiness({
    recoveryBarrier,
    ensureServices: async () => { events.push('ensure-services') },
  })

  await Promise.resolve()
  assert.deepEqual(events, [])

  releaseRecovery()
  await pending
  assert.deepEqual(events, ['ensure-services'])
})

test('waits for an existing startup promise without starting services again', async () => {
  let releaseStartup
  const startupPromise = new Promise(resolve => { releaseStartup = resolve })
  let ensureCalls = 0

  const pending = waitForServiceReadiness({
    startupPromise,
    ensureServices: async () => { ensureCalls += 1 },
  })

  await Promise.resolve()
  assert.equal(ensureCalls, 0)

  releaseStartup()
  await pending
  assert.equal(ensureCalls, 0)
})
