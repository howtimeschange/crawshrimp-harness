'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')

const { createApiConnection } = require('./apiConnection')

test('synchronizes the main-process API endpoint before the first renderer request', async () => {
  let apiBase = 'http://127.0.0.1:18765'
  const events = []

  const connection = createApiConnection({
    synchronize: async () => {
      events.push('synchronize')
      apiBase = 'http://127.0.0.1:18766'
    },
    request: async () => {
      events.push(`request:${apiBase}`)
      return apiBase
    },
  })

  const result = await connection.call('GET', '/agent/runtime')

  assert.equal(result, 'http://127.0.0.1:18766')
  assert.deepEqual(events, [
    'synchronize',
    'request:http://127.0.0.1:18766',
  ])
})

test('shares one initial API synchronization across concurrent renderer requests', async () => {
  let resolveSynchronization
  let synchronizeCount = 0
  const synchronization = new Promise(resolve => { resolveSynchronization = resolve })
  const events = []

  const connection = createApiConnection({
    synchronize: async () => {
      synchronizeCount += 1
      await synchronization
    },
    request: async (_method, path) => {
      events.push(path)
      return path
    },
  })

  const first = connection.call('GET', '/agent/runtime')
  const second = connection.call('GET', '/health')
  resolveSynchronization()

  assert.deepEqual(await Promise.all([first, second]), ['/agent/runtime', '/health'])
  assert.equal(synchronizeCount, 1)
  assert.deepEqual(events, ['/agent/runtime', '/health'])
})

test('exposes a readiness barrier without issuing a synthetic API request', async () => {
  let synchronizeCount = 0
  let requestCount = 0
  const connection = createApiConnection({
    synchronize: async () => { synchronizeCount += 1 },
    request: async () => { requestCount += 1 },
  })

  await connection.ready()
  await connection.ready()

  assert.equal(synchronizeCount, 1)
  assert.equal(requestCount, 0)
})

test('retries synchronization after a transient readiness rejection', async () => {
  let synchronizeCount = 0
  const connection = createApiConnection({
    synchronize: async () => {
      synchronizeCount += 1
      if (synchronizeCount === 1) throw new Error('core not ready')
    },
    request: async () => 'ready',
  })

  await assert.rejects(connection.call('GET', '/agent/runtime'), /core not ready/)
  assert.equal(await connection.call('GET', '/agent/runtime'), 'ready')
  assert.equal(synchronizeCount, 2)
})

test('preload gates every local API path and never exposes the API token to status listeners', () => {
  const preload = readFileSync(`${__dirname}/preload.js`, 'utf8')

  assert.match(preload, /async function requestApi\(method, requestPath, body\)/)
  assert.match(preload, /request:\s*requestApi/)
  assert.match(preload, /function createApiConnection\(\{ synchronize, request \}\)/)
  assert.doesNotMatch(preload, /require\(['"]\.\/apiConnection['"]\)/)
  assert.match(preload, /async function apiCall\(method, requestPath, body\)\s*\{\s*return agentApiConnection\.call\(method, requestPath, body\)/)
  assert.match(preload, /await agentApiConnection\.ready\(\)/)
  assert.match(preload, /const publicStatus = rememberApiConnectionFromStatus\(data\)[\s\S]{0,180}cb\(publicStatus\)/)
  assert.doesNotMatch(preload, /rememberApiConnectionFromStatus\(data\)\s*\n\s*cb\(data\)/)
})
