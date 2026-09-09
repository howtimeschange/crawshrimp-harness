const test = require('node:test')
const assert = require('node:assert/strict')
const { createBrowserLaunchBridge } = require('./browserLaunchBridge')

test('browser launch requires the private desktop token and an explicit POST', async () => {
  let launches = 0
  const bridge = createBrowserLaunchBridge({ launchChrome: async () => { launches++; return {ok:true} } })
  await bridge.start()
  const env = bridge.environment()
  const url = env.CRAWSHRIMP_BROWSER_LAUNCH_URL
  const headers = { 'X-Crawshrimp-Browser-Token': env.CRAWSHRIMP_BROWSER_LAUNCH_TOKEN }
  try {
    assert.equal(launches, 0)
    assert.equal((await fetch(url, {method:'POST'})).status, 403)
    assert.equal((await fetch(url, {method:'POST', headers:{...headers, Origin:'https://example.com'}})).status, 403)
    assert.equal((await fetch(url, {headers})).status, 404)
    assert.equal(launches, 0)
    assert.equal((await fetch(url, {method:'POST',headers})).status, 200)
    assert.equal(launches, 1)
  } finally { await bridge.close() }
})

test('browser startup failure returns an actionable error', async () => {
  const bridge = createBrowserLaunchBridge({ launchChrome: async () => ({ok:false,msg:'CDP port occupied'}) })
  await bridge.start()
  const env = bridge.environment()
  try {
    const response = await fetch(env.CRAWSHRIMP_BROWSER_LAUNCH_URL, {method:'POST', headers:{'X-Crawshrimp-Browser-Token':env.CRAWSHRIMP_BROWSER_LAUNCH_TOKEN}})
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {ok:false,message:'CDP port occupied'})
  } finally { await bridge.close() }
})
