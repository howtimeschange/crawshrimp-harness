import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../views/AgentWebView.vue', import.meta.url), 'utf8')
const start = source.indexOf('  let runtimePollInFlight = false')
const end = source.indexOf('  tabPollTimer =', start)

function pollingHarness(url) {
  let poll
  let reject
  let requests = 0
  let recoveries = 0
  const context = {
    webUrl: { value: url }, error: { value: '' },
    window: { cs: { agentApi: () => { requests++; return new Promise((_, fail) => { reject = fail }) } } },
    autoRecover: () => { recoveries++ },
    setInterval: (fn) => { poll = fn },
  }
  vm.runInNewContext(source.slice(start, end), context)
  return { context, poll, fail: () => reject(new Error('status request timed out')), requests: () => requests, recoveries: () => recoveries }
}

test('timeout preserves an existing conversation and does not stack status requests', async () => {
  const h = pollingHarness('http://localhost/session')
  const first = h.poll()
  await h.poll()
  assert.equal(h.requests(), 1)
  h.fail()
  await first
  assert.equal(h.context.webUrl.value, 'http://localhost/session')
  assert.equal(h.recoveries(), 0)
  const next = h.poll()
  assert.equal(h.requests(), 2)
  h.fail()
  await next
})

test('initial connection failure still triggers recovery without an existing conversation', async () => {
  const h = pollingHarness('')
  const request = h.poll()
  h.fail()
  await request
  assert.equal(h.recoveries(), 1)
  assert.equal(h.context.error.value, '无法连接本地服务')
})
