const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// Exercise the real slots token layer and shell bridge without starting a user runtime.
const source = fs.readFileSync(path.join(__dirname, '../../integrations/deepseek-harness/crawshrimp-slots/lib/client.js'), 'utf8')
const slice = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a)
  assert.ok(a >= 0 && b > a, `missing ${start}`)
  return source.slice(a, b)
}
const code = [
  slice('const CRAWSHRIMP_TOKENS =', 'let currentRuntimeSessionId'),
  slice('const ORANGE_STEPS =', 'const CRAWSHRIMP_BRAND_NAME'),
  slice('function applyShellTheme(', 'const sessionLogDownloads'),
  'globalThis.applyShellTheme = applyShellTheme',
].join('\n')
const sandbox = {}
vm.runInNewContext(code, sandbox)

test('embedded theme switches between lake and original light and dark palettes', () => {
  const applied = []
  const ctx = { theme: { overrideTokens(source, tokens) { applied.push({ source, tokens }) }, setTheme(value) { applied.at(-1).theme = value } } }
  sandbox.applyShellTheme(ctx, 'light', 'lake')
  assert.equal(applied.at(-1).theme, 'light')
  assert.equal(applied.at(-1).tokens['--dsw-alias-brand-primary'].light, '#315c43')
  assert.equal(applied.at(-1).tokens['--dsw-alias-bg-base'].light, '#ffffff')
  assert.equal(applied.at(-1).tokens['--dsw-static-blue-500'].light, '#315c43')
  sandbox.applyShellTheme(ctx, 'light', 'default')
  assert.equal(applied.at(-1).tokens['--dsw-alias-brand-primary'].light, '#FF5000')
  sandbox.applyShellTheme(ctx, 'dark', 'lake')
  assert.equal(applied.at(-1).theme, 'dark')
  assert.equal(applied.at(-1).tokens['--dsw-alias-brand-primary'].dark, '#FF6B2B')
  const count = applied.length
  sandbox.applyShellTheme(ctx, 'invalid', 'lake')
  assert.equal(applied.length, count)
})
