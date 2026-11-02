import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { connectionWebServer } from './backports/product-v021.mjs'
test('Connection declares webServer required by generic scoped RPC registration', () => {
  const before = 'const inject = ["credentials"];'
  const after = connectionWebServer(before)
  assert.deepEqual(Function(after.replace('const inject =', 'return'))(), ['credentials', 'webServer'])
  assert.equal(connectionWebServer(after), after)
  assert.throws(() => connectionWebServer('upstream changed'))
  const real = readFileSync(new URL('../node_modules/@deepseek-ai/dsh-client-connection/lib/index.js', import.meta.url), 'utf8')
  assert.match(connectionWebServer(real), /const inject = \["credentials", "webServer"\];/)
})
