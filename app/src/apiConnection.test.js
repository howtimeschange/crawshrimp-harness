'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')

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
  assert.match(preload, /async function agentApi\(method, requestPath, body\)\s*\{\s*return ipcRenderer\.invoke\('agent:api', method, requestPath, body\)/)
  assert.match(preload, /await agentApiConnection\.ready\(\)/)
  assert.match(preload, /const publicStatus = rememberApiConnectionFromStatus\(data\)[\s\S]{0,180}cb\(publicStatus\)/)
  assert.doesNotMatch(preload, /rememberApiConnectionFromStatus\(data\)\s*\n\s*cb\(data\)/)
})

test('preload retains the API endpoint and token returned by status IPC in its isolated world', () => {
  const preload = readFileSync(`${__dirname}/preload.js`, 'utf8')

  assert.match(preload, /let synchronizedApiBase = ''/)
  assert.match(preload, /let synchronizedApiToken = ''/)
  assert.match(preload, /synchronizedApiBase = normalizedStatusBase/)
  assert.match(preload, /synchronizedApiToken = statusToken/)
  assert.match(preload, /const trustedPort = Number\.isInteger\(port\) && port >= 1024 && port <= 65535 \? port : 0/)
  assert.match(preload, /return synchronizedApiToken \|\| readStorageValue\(TOKEN_STORAGE_KEY\)/)
})

test('preload trusts the validated status port even when isolated-world URL storage is unavailable', async () => {
  const preload = readFileSync(`${__dirname}/preload.js`, 'utf8')
  const exposed = {}
  const requests = []
  const status = {
    api: true,
    apiPort: 18882,
    apiBase: 'http://127.0.0.1:18882',
    apiToken: 'test-runtime-token',
  }

  runInNewContext(preload, {
    require: (id) => {
      if (id !== 'electron') throw new Error(`Unexpected preload dependency: ${id}`)
      return {
        contextBridge: { exposeInMainWorld: (_name, api) => { Object.assign(exposed, api) } },
        ipcRenderer: {
          invoke: async (channel, ...args) => {
            if (channel === 'get-status') return status
            if (channel === 'agent:api') {
              requests.push({ channel, args })
              return { state: 'ready' }
            }
            throw new Error(`Unexpected IPC channel: ${channel}`)
          },
          on: () => {},
          removeAllListeners: () => {},
          removeListener: () => {},
        },
      }
    },
    window: {
      location: { search: '' },
      localStorage: {
        getItem: () => { throw new Error('storage unavailable') },
        setItem: () => { throw new Error('storage unavailable') },
      },
    },
    URL: class UnavailableUrl { constructor() { throw new Error('URL unavailable in isolated world') } },
    URLSearchParams,
    AbortController,
    TextDecoder,
    setTimeout,
    clearTimeout,
    console,
    fetch: async () => { throw new Error('Agent startup must not fetch from the renderer') },
  })

  await exposed.getStatus()
  assert.equal(exposed.getApiBase(), 'http://127.0.0.1:18882')
  assert.deepEqual(await exposed.agentApi('GET', '/agent/runtime'), { state: 'ready' })
  assert.deepEqual(requests, [{
    channel: 'agent:api',
    args: ['GET', '/agent/runtime', undefined],
  }])
})
