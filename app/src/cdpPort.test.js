'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { DEFAULT_CDP_PORT, resolveCdpPort, loopbackCdpUrl } = require('./cdpPort')

test('CDP port resolver preserves the product default and accepts an isolated dev port', () => {
  assert.equal(DEFAULT_CDP_PORT, 9222)
  assert.equal(resolveCdpPort(''), 9222)
  assert.equal(resolveCdpPort('9247'), 9247)
  assert.equal(loopbackCdpUrl(9247), 'http://127.0.0.1:9247')
})

test('CDP port resolver rejects malformed, privileged, and out-of-range overrides', () => {
  for (const value of ['9222.1', 'localhost:9247', '80', '65536', '-1']) {
    assert.equal(resolveCdpPort(value), 9222, value)
  }
})
