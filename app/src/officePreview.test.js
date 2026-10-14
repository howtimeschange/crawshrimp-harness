import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { isOfficeFile } from './renderer/utils/artifactTime.js'
import { resolveOfficePreview } from './renderer/utils/officePreview.js'

function harness(api, initial = {}) {
  const source = readFileSync(new URL('./renderer/components/agent/OfficePreview.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')
  const props = { path: '/report.pptx', active: true, revision: 0, updatedAt: '', ...initial }
  let callback, dispose = () => {}
  const context = {
    defineProps: () => props, ref: value => ({ value }), computed: fn => ({ get value() { return fn() } }),
    watch: (_, cb) => { callback = cb }, resolveOfficePreview, AbortController,
    window: { cs: { agentApi: api } },
  }
  vm.runInNewContext(script + '\nglobalThis.h = {pages, status, error, loading, runtimeProgress, retryCount}', context)
  return { props, ...context.h, update(change = {}) { dispose(); Object.assign(props, change); return callback(null, null, fn => { dispose = fn }) }, dispose() { dispose() } }
}
const office = { revision: 'v1', pages: [{ path: '/page1.png' }], visual: { status: 'passed', reviewed: [1] } }

test('PPTX/DOCX/XLSX route to Office preview even when forwarded or restored without metadata', () => {
  const source = readFileSync(new URL('./renderer/components/agent/resources/ResourcePreview.vue', import.meta.url), 'utf8')
  assert.match(source, /office = computed\(\(\) => isOfficeFile\(props.item\)\)/)
  for (const filename of ['report.PPTX', 'word.docx', 'table.xlsx']) assert.equal(isOfficeFile({ filename }), true)
  assert.equal(isOfficeFile({ path: '/report.pptx' }), true)
  assert.equal(isOfficeFile({ filename: 'chart.png', office }), false)
})
test('active file-only preview renders resolved pages and keeps them across tab switches', async () => {
  let calls = 0
  const h = harness(async () => { calls++; return { state: 'completed', office } })
  await h.update()
  assert.equal(h.pages.value.length, 1)
  assert.match(h.status.value, /已完成 1 页/)
  await h.update({ active: false }); await h.update({ active: true })
  assert.equal(calls, 1)
  assert.equal(h.pages.value[0].path, '/page1.png')
})
test('published pages work immediately and manual reread resolves the current file', async () => {
  let calls = 0
  const h = harness(async () => { calls++; return { state: 'completed', office: { ...office, pages: [{ path: '/new.png' }] } } }, { office })
  await h.update()
  assert.equal(h.pages.value[0].path, '/page1.png')
  assert.equal(calls, 0)
  await h.update({ revision: 1 })
  assert.equal(h.pages.value[0].path, '/new.png')
  assert.equal(calls, 1)
})
test('inactive restored tabs wait until opened and late old-file responses cannot replace a new file', async () => {
  const requests = []
  const h = harness((_, __, body) => new Promise(resolve => requests.push({ body, resolve })), { active: false })
  await h.update(); assert.equal(requests.length, 0)
  const first = h.update({ active: true })
  const second = h.update({ path: '/new.docx' })
  requests[1].resolve({ state: 'completed', office: { ...office, pages: [{ path: '/new.png' }] } }); await second
  requests[0].resolve({ state: 'completed', office }); await first
  assert.equal(h.pages.value[0].path, '/new.png')
  assert.equal(h.error.value, '')
})
test('failed conversion shows its cause and reread can recover', async () => {
  let failing = true
  const h = harness(async () => failing ? { state: 'failed', error: { message: '文档损坏' } } : { state: 'completed', office })
  await h.update()
  assert.match(h.error.value, /文档损坏/)
  assert.equal(h.loading.value, false)
  failing = false; await h.update({ revision: 1 })
  assert.equal(h.pages.value.length, 1)
  assert.equal(h.error.value, '')
})
test('Office download status is visible and the retry control recovers a failed first use', async () => {
  let failing = true
  const h = harness(async () => failing ? { state: 'failed', error: { message: '下载失败，请检查网络' } } : { state: 'completed', office })
  await h.update()
  assert.match(h.error.value, /下载失败/)
  failing = false; h.retryCount.value++; await h.update()
  assert.equal(h.pages.value.length, 1)
  h.loading.value = true
  h.runtimeProgress.value = { state: 'downloading', message: '首次使用，正在下载 Office 组件', downloaded_bytes: 1, total_bytes: 2 }
  assert.match(h.status.value, /50%/)
  h.loading.value = false
})
test('a same-path update invalidates published pages and rejects an older pending response', async () => {
  const requests = []
  const h = harness(() => new Promise(resolve => requests.push(resolve)), { office, updatedAt: 't1' })
  await h.update()
  const first = h.update({ updatedAt: 't2' })
  assert.equal(h.pages.value.length, 0)
  const second = h.update({ updatedAt: 't3' })
  requests[1]({ state: 'completed', office: { ...office, pages: [{ path: '/newest.png' }] } }); await second
  requests[0]({ state: 'completed', office }); await first
  assert.equal(h.pages.value[0].path, '/newest.png')
})
