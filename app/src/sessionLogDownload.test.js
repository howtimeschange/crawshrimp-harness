import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source = readFileSync(new URL('../../integrations/deepseek-harness/crawshrimp-slots/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('    const sessionLogDownloads = new Set()')
const end = source.indexOf('    function installShellMessageBridge', start)
function harness(fetcher) {
  const messages = [], downloads = []
  const context = { URL, fetch: fetcher, window: { location: { origin: 'http://127.0.0.1:19066' } },
    document: { createElement: () => ({ click() { downloads.push({ href: this.href, filename: this.download }) } }) },
    postToShell: m => messages.push(m),
  }
  vm.runInNewContext(source.slice(start, end) + '; globalThis.download = downloadSessionLog;', context)
  return { download: context.download, messages, downloads }
}
test('export downloads the captured session directly without invoking a modal', async () => {
  const requests = []
  const h = harness(async (url, init) => { requests.push({ url, init }); return { ok: true } })
  await h.download('session-one')
  assert.equal(requests[0].init.method, 'HEAD')
  assert.equal(requests[0].url.pathname, '/api/session.export')
  assert.equal(requests[0].url.searchParams.get('includeDescendants'), 'true')
  assert.equal(h.downloads[0].filename, 'dsh-session-session-one.zip')
  assert.equal(h.messages.length, 0)
})
test('same-session double click shares export preparation; failure stays visible and retry works', async () => {
  let resolve, count = 0
  const h = harness(() => { count++; return new Promise(r => { resolve = r }) })
  const first = h.download('one')
  await h.download('one')
  assert.equal(count, 1)
  resolve({ ok: false, status: 500 }); await first
  assert.equal(h.downloads.length, 0)
  assert.equal(h.messages[0].runtimeSessionId, 'one')
  assert.match(h.messages[0].message, /500/)
  const retry = h.download('one'); resolve({ ok: true }); await retry
  assert.equal(h.downloads.length, 1)
})
