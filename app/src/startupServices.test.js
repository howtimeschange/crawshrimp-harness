const test = require('node:test')
const assert = require('node:assert/strict')

const { startDesktopServices } = require('./startupServices')

test('startDesktopServices still starts Chrome when backend startup fails', async () => {
  const events = []

  const result = await startDesktopServices({
    autoLaunchChrome: true,
    startBackend: async () => {
      events.push('backend')
      throw new Error('backend did not become ready')
    },
    startChrome: async () => {
      events.push('chrome')
      return { ok: true, msg: 'chrome ready' }
    },
    log: message => events.push(message),
  })

  assert.deepEqual(events.slice(0, 2).sort(), ['backend', 'chrome'])
  assert.equal(result.api.ok, false)
  assert.match(result.api.error.message, /backend did not become ready/)
  assert.equal(result.chrome.ok, true)
})



test('Harness startup defers Chrome even if the backend fails', async () => {
  let launches = 0
  const result = await startDesktopServices({
    startBackend: async () => { throw new Error('backend failed') },
    startChrome: async () => { launches++; return {ok:true} },
  })
  assert.equal(launches, 0)
  assert.equal(result.chrome.deferred, true)
  assert.equal(result.api.ok, false)
})

test('normal Harness startup requires only the core service', async () => {
  const result = await startDesktopServices({ startBackend: async () => {} })
  assert.equal(result.api.ok, true)
  assert.equal(result.chrome.deferred, true)
})
