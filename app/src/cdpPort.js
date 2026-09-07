'use strict'

// A source/dev Harness can run beside a user's installed desktop client.  Keep
// the default public port stable, but allow the whole desktop stack to opt into
// an isolated loopback port for an explicit development session.
const DEFAULT_CDP_PORT = 9222

function resolveCdpPort(value = process.env.CRAWSHRIMP_CDP_PORT) {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) return DEFAULT_CDP_PORT
  const port = Number(text)
  return Number.isInteger(port) && port >= 1024 && port <= 65535
    ? port
    : DEFAULT_CDP_PORT
}

function loopbackCdpUrl(port = resolveCdpPort()) {
  return `http://127.0.0.1:${port}`
}

module.exports = { DEFAULT_CDP_PORT, resolveCdpPort, loopbackCdpUrl }
