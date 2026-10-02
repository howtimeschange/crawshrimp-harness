const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { createServer } = require('node:http')
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

async function fixture(t) {
  const bytes = Buffer.from('pinned Office archive fixture')
  const cacheDirectory = mkdtempSync(join(tmpdir(), 'office-download-'))
  const routes = { '/primary.bin': { status: 200, body: bytes }, '/mirror.bin': { status: 200, body: bytes } }
  const calls = []
  const server = createServer((req, res) => {
    calls.push(req.url)
    const route = routes[req.url] || { status: 404, body: 'missing' }
    res.writeHead(route.status)
    res.end(route.body)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    rmSync(cacheDirectory, { recursive: true, force: true })
  })
  const base = 'http://127.0.0.1:' + server.address().port
  const entry = {
    url: base + '/primary.bin',
    fallbackUrls: [base + '/mirror.bin'],
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
  const { downloadOfficeAsset } = await import('./office-download.mjs')
  return { bytes, routes, calls, entry, cacheDirectory,
    path: join(cacheDirectory, 'primary.bin'),
    download: () => downloadOfficeAsset(entry, { cacheDirectory, warn: () => {} }) }
}

test('real HTTP 503 retries and falls back to a hash-verified mirror', async t => {
  const f = await fixture(t)
  f.routes['/primary.bin'] = { status: 503, body: 'unavailable' }
  assert.equal(await f.download(), f.path)
  assert.deepEqual(readFileSync(f.path), f.bytes)
  assert.ok(f.calls.filter(url => url === '/primary.bin').length > 1)
  assert.equal(f.calls.at(-1), '/mirror.bin')
  assert.equal(existsSync(f.path + '.partial'), false)
})

test('a successful HTTP response with corrupt bytes cannot enter the cache', async t => {
  const f = await fixture(t)
  f.routes['/primary.bin'].body = 'truncated archive'
  await f.download()
  assert.deepEqual(f.calls, ['/primary.bin', '/mirror.bin'])
  assert.deepEqual(readFileSync(f.path), f.bytes)
  assert.equal(existsSync(f.path + '.partial'), false)
})

test('all mismatched sources fail closed and discard partial downloads', async t => {
  const f = await fixture(t)
  f.routes['/primary.bin'].body = 'corrupt primary'
  f.routes['/mirror.bin'].body = 'corrupt mirror'
  await assert.rejects(f.download(), /Unable to download verified Office asset[\s\S]*checksum mismatch/)
  assert.equal(existsSync(f.path), false)
  assert.equal(existsSync(f.path + '.partial'), false)
})

test('verified cached bytes are reused without contacting an unavailable source', async t => {
  const f = await fixture(t)
  writeFileSync(f.path, f.bytes)
  f.routes['/primary.bin'] = { status: 503, body: 'unavailable' }
  assert.equal(await f.download(), f.path)
  assert.deepEqual(f.calls, [])
})

test('a corrupt cache and stale partial file are replaced only by verified bytes', async t => {
  const f = await fixture(t)
  writeFileSync(f.path, 'corrupt cache')
  writeFileSync(f.path + '.partial', 'stale partial')
  await f.download()
  assert.deepEqual(readFileSync(f.path), f.bytes)
  assert.deepEqual(f.calls, ['/primary.bin'])
  assert.equal(existsSync(f.path + '.partial'), false)
})
