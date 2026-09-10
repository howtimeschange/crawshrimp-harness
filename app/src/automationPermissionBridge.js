'use strict'
const http = require('node:http')
const { randomBytes, timingSafeEqual } = require('node:crypto')

// Capability-limited channel: it can request OS consent, never execute AppleScript.
function createAutomationPermissionBridge({ requestPermission }) {
  const token = randomBytes(32).toString('hex')
  let server, url = ''
  return {
    async start() {
      if (server) return
      server = http.createServer(async (req, res) => {
        const supplied = Buffer.from(String(req.headers['x-crawshrimp-automation-token'] || ''))
        const expected = Buffer.from(token)
        const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
        if (req.headers.origin || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { reply(403, { error: 'Forbidden' }); return }
        if (req.method !== 'POST' || req.url !== '/request') { reply(404, { error: 'Not found' }); return }
        let body = '', tooLarge = false
        req.setTimeout(10000)
        req.on('data', chunk => { body += chunk; if (Buffer.byteLength(body) > 4096) { tooLarge = true; req.destroy() } })
        req.on('end', async () => {
          if (tooLarge) return
          try {
            const payload = JSON.parse(body)
            if (typeof payload.bundle_id !== 'string' || typeof payload.purpose !== 'string' || !payload.purpose.trim() || payload.purpose.length > 500) { reply(400, { error: 'bundle_id and purpose are required' }); return }
            req.setTimeout(0)
            reply(200, await requestPermission(payload.bundle_id, payload.purpose.trim()))
          } catch (error) { reply(400, { status: 'unknown', error: error.message, auto_retry: false }) }
        })
      })
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
      url = `http://127.0.0.1:${server.address().port}/request`
      server.unref()
    },
    environment() {
      if (!url) throw new Error('Automation bridge not started')
      return { CRAWSHRIMP_AUTOMATION_URL: url, CRAWSHRIMP_AUTOMATION_TOKEN: token }
    },
    async close() { if (server) await new Promise(resolve => server.close(resolve)); server = null; url = '' },
  }
}
module.exports = { createAutomationPermissionBridge }
