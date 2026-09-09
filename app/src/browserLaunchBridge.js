'use strict'

const http = require('node:http')
const { randomBytes, timingSafeEqual } = require('node:crypto')

// Private desktop/backend channel. Health probes never call this endpoint.
function createBrowserLaunchBridge({ launchChrome }) {
  const token = randomBytes(32).toString('hex')
  let server, starting, url = ''
  return {
    async start() {
      if (url) return
      if (starting) return starting
      starting = new Promise((resolve, reject) => {
        server = http.createServer(async (req, res) => {
          const supplied = Buffer.from(String(req.headers['x-crawshrimp-browser-token'] || ''))
          const expected = Buffer.from(token)
          if (req.headers.origin || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
            res.writeHead(403).end(); return
          }
          if (req.method !== 'POST' || req.url !== '/ensure') { res.writeHead(404).end(); return }
          try {
            const result = await launchChrome()
            res.writeHead(result?.ok ? 200 : 503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: Boolean(result?.ok), message: result?.msg || '' }))
          } catch (error) {
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, message: error.message }))
          }
        })
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
          url = `http://127.0.0.1:${server.address().port}/ensure`
          server.unref()
          resolve()
        })
      }).catch(error => { starting = null; throw error })
      return starting
    },
    environment() {
      if (!url) throw new Error('Browser launch bridge has not started')
      return { CRAWSHRIMP_BROWSER_LAUNCH_URL: url, CRAWSHRIMP_BROWSER_LAUNCH_TOKEN: token }
    },
    async close() {
      url = ''; starting = null
      if (server) await new Promise(resolve => server.close(resolve))
    },
  }
}
module.exports = { createBrowserLaunchBridge }
