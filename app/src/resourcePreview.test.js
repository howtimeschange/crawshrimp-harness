import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { documentKind, readDocumentText } from './renderer/utils/documentPreview.js'
import { isOfficeFile } from './renderer/utils/artifactTime.js'
import { previewType, parseDelimited } from './renderer/utils/resourceWorkspace.js'

const script = readFileSync(new URL('./renderer/components/agent/resources/ResourcePreview.vue', import.meta.url), 'utf8')
  .split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')
function harness({ active = true, path = '/fixtures/photo.jpg', fetch: fetcher = async () => new Response('image bytes', { headers: { 'content-type': 'image/jpeg' } }) } = {}) {
  const props = { active, item: { path, filename: path.split(/[\\/]/).pop() }, zoom: 1, mode: 'preview' }
  const requests = [], revoked = [], created = [], watchers = [], unmounts = []
  const context = {
    defineProps: () => props, defineEmits: () => () => {}, ref: value => ({ value }), computed: fn => ({ get value() { return fn() } }),
    lazyView: () => ({}), documentKind, readDocumentText, isOfficeFile, previewType, parseDelimited,
    watch(source, callback) { watchers.push({ source, callback }) }, onUnmounted: fn => unmounts.push(fn),
    AbortController, Blob,
    URL: { createObjectURL(blob) { const url = `blob:fixture-${created.length}`; created.push({ blob, url }); return url }, revokeObjectURL: url => revoked.push(url) },
    fetch: (...args) => { requests.push(args); return fetcher(...args) },
    window: { cs: { agentMediaUrl: async file => `http://localhost/media?path=${encodeURIComponent(file)}` } },
  }
  vm.runInNewContext(script + '\nglobalThis.h = {url,loading,error,imageSize,imageContainer,rememberImageSize,revision,mediaElement}', context)
  const watcher = watchers[1]
  let previous, cleanup = () => {}
  return { ...context.h, props, requests, revoked, created,
    update(change = {}) {
      Object.assign(props, change)
      const key = watcher.source()
      if (previous && key.every((value, index) => value === previous[index])) return Promise.resolve()
      cleanup(); const old = previous; previous = key
      return watcher.callback(key, old, fn => { cleanup = fn })
    },
    unmount() { cleanup(); unmounts.forEach(fn => fn()) },
  }
}
for (const path of ['/Users/test/图片.jpg', 'C:\\Users\\test\\图片.jpg']) {
  test(`hidden image tabs release their blob and retain reading geometry (${path})`, async () => {
    const h = harness({ active: false, path })
    await h.update(); assert.equal(h.requests.length, 0)
    await h.update({ active: true }); assert.equal(h.created.length, 1)
    h.rememberImageSize({ target: { src: h.url.value, naturalWidth: 3000, naturalHeight: 4000 } })
    h.imageContainer.value = { scrollTop: 1200, scrollLeft: 200 }
    await h.update({ active: false })
    assert.equal(h.url.value, ''); assert.deepEqual(h.revoked, ['blob:fixture-0'])
    assert.equal(h.imageSize.value.width, 3000); assert.equal(h.imageContainer.value.scrollTop, 1200)
    await h.update({ active: true })
    assert.equal(h.created.length, 2); assert.equal(h.imageContainer.value.scrollLeft, 200)
    h.unmount(); assert.deepEqual(h.revoked, ['blob:fixture-0', 'blob:fixture-1'])
  })
}
test('late image fetch cannot recreate a blob after hiding or unmount', async () => {
  for (const hide of [true, false]) {
    let resolve
    const h = harness({ fetch: () => new Promise(r => { resolve = r }) })
    const pending = h.update(); await new Promise(setImmediate)
    if (hide) await h.update({ active: false }); else h.unmount()
    resolve(new Response('old image')); await pending
    assert.equal(h.created.length, 0); assert.equal(h.url.value, '')
  }
})
test('reread or path change resets image dimensions but an old image load is ignored', async () => {
  const h = harness(); await h.update()
  const oldUrl = h.url.value
  h.rememberImageSize({ target: { src: oldUrl, naturalWidth: 100, naturalHeight: 200 } })
  h.imageContainer.value = { scrollTop: 20, scrollLeft: 30 }; h.revision.value++
  await h.update(); assert.equal(h.imageSize.value, null); assert.equal(h.imageContainer.value.scrollTop, 0)
  h.rememberImageSize({ target: { src: oldUrl, naturalWidth: 100, naturalHeight: 200 } })
  assert.equal(h.imageSize.value, null)
  h.unmount()
})
test('oversized image response cancels its body before allocation', async () => {
  let canceled = 0
  const h = harness({ fetch: async () => ({ ok: true, headers: new Headers({ 'content-length': String(33 * 1024 * 1024) }), body: { async cancel() { canceled++ } } }) })
  await h.update(); assert.equal(canceled, 1); assert.equal(h.created.length, 0); assert.match(h.error.value, /32 MB/)
})
test('failed image load can retry on reactivation', async () => {
  let failed = true
  const h = harness({ fetch: async () => failed ? new Response('', { status: 404 }) : new Response('image') })
  await h.update(); assert.match(h.error.value, /不存在/)
  await h.update({ active: false }); failed = false; await h.update({ active: true })
  assert.equal(h.error.value, ''); assert.ok(h.url.value); h.unmount()
})
test('audio and video URLs stay stable across activation changes', async () => {
  for (const path of ['/media/song.mp3', 'C:\\media\\video.mp4']) {
    const h = harness({ path }); await h.update()
    const url = h.url.value
    await h.update({ active: false }); assert.equal(h.url.value, url)
    assert.equal(h.requests.length, 0); h.unmount()
  }
})
