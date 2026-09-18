const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { listDirectoryFilesSnapshot, createDirectoryScanner, createPdfPreviewer } = require('./localFileJobs')
test('directory cancellation is scoped and replaced requests cannot remove newer jobs', async () => {
  const pending = []
  const scan = createDirectoryScanner((root, opts) => new Promise(resolve => pending.push({ signal: opts.signal, resolve })))
  const old = scan('old', { requestId: '1:scan' })
  const replacement = scan('new', { requestId: '1:scan' })
  const other = scan('other', { requestId: '2:scan' })
  assert.equal(pending[0].signal.aborted, true)
  pending[0].resolve(); await old
  scan.cancel('1:scan')
  assert.equal(pending[1].signal.aborted, true)
  assert.equal(pending[2].signal.aborted, false)
  scan.dispose()
  assert.equal(pending[2].signal.aborted, true)
  pending[1].resolve(); pending[2].resolve()
  await Promise.all([replacement, other])
})
test('directory traversal budget bounds nonmatching files and reports incomplete scan', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-scan-'))
  try {
    await Promise.all(Array.from({ length: 30 }, (_, i) => fs.writeFile(path.join(root, `${i}.jpg`), 'x')))
    const result = await listDirectoryFilesSnapshot(root, { extensions: ['pdf'], maxFiles: 1, maxVisited: 10 })
    assert.equal(result.paths.length, 0); assert.equal(result.truncated, true); assert.equal(result.reason, 'scan_budget')
    const all = await listDirectoryFilesSnapshot(root, { extensions: ['jpg'] })
    assert.equal(all.paths.length, 30); assert.equal(all.truncated, false)
    const controller = new AbortController(); controller.abort()
    await assert.rejects(listDirectoryFilesSnapshot(root, { signal: controller.signal }), /取消/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
test('canceled queued PDF preview never starts Python', async () => {
  let spawned = 0
  const render = createPdfPreviewer(() => { spawned++; throw Error('must not launch') }, () => os.tmpdir())
  const pending = render('does-not-exist.pdf', { requestId: 'cancel' })
  render.cancel('cancel')
  await assert.rejects(pending, /取消/)
  assert.equal(spawned, 0)
  render.dispose()
})
