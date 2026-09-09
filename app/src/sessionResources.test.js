import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('./renderer/components/agent/SessionResources.vue', import.meta.url), 'utf8')
const script = source.split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')
function harness() {
  const requests = []
  const pointerEvents = new Map()
  const props = { sessionId: 'a' }
  const context = {
    document: { getElementById: () => null },
    nextTick: fn => Promise.resolve().then(fn),
    defineProps: () => props, defineEmits: () => {}, defineExpose: () => {},
    ref: value => ({ value }), computed: fn => ({ get value() { return fn() } }),
    watch: () => {}, onMounted: () => {}, onUnmounted: () => {},
    setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout,
    localStorage: { getItem: () => null, setItem() {} },
    window: { innerWidth: 1600, innerHeight: 960, addEventListener: (name, fn) => pointerEvents.set(name, fn), removeEventListener: name => pointerEvents.delete(name), cs: {
      agentApi: () => new Promise(resolve => requests.push(resolve)),
      listAgentBrowserTabs: async () => ({ ok: true, tabs: [{ id: 'one' }, { id: 'two' }] }),
    } },
  }
  vm.runInNewContext(script + '\nglobalThis.h = { refresh, opened, selection, artifacts, tabs, unseen, openBrowser, back, width, adjustWidth, miniTab, browserReady, resize, onViewportResize, togglePanel, compactOpen, searching, query, toggleSearch, closeSearch, searchInput, searchButton, filteredTabs, filteredArtifacts };', context)
  return { ...context.h, props, requests, pointerEvents, viewport: context.window }
}
test('late resource response from another session cannot overwrite the active session', async () => {
  const h = harness()
  const first = h.refresh()
  h.props.sessionId = 'b'
  const second = h.refresh()
  h.requests[1]({ artifacts: [{ path: '/b.txt' }], tabs: [] })
  await second
  h.requests[0]({ artifacts: [{ path: '/a.txt' }], tabs: [] })
  await first
  assert.equal(h.artifacts.value[0].path, '/b.txt')
})
test('first new artifact after an empty baseline marks the collapsed panel without opening it', async () => {
  const h = harness()
  let request = h.refresh(); h.requests[0]({ artifacts: [], tabs: [] }); await request
  h.opened.value = false
  request = h.refresh(); h.requests[1]({ artifacts: [{ path: '/first.txt' }], tabs: [] }); await request
  assert.equal(h.unseen.value, 1)
  assert.equal(h.opened.value, false)
})
test('browser activity updates both pages while preserving the page the user chose', async () => {
  const h = harness()
  h.openBrowser('one')
  const request = h.refresh()
  h.requests[0]({ artifacts: [], tabs: [{ id: 'one' }, { id: 'two' }], activeTabId: 'two' })
  await request
  assert.equal(h.tabs.value.length, 2)
  assert.equal(h.selection.value.id, 'one')
  h.back()
  assert.equal(h.selection.value, null)
  assert.equal(h.tabs.value.length, 2)
})


test('browser tab changes and compact mode preserve the user resized half-screen width', () => {
  const h = harness()
  h.openBrowser('one')
  h.adjustWidth(-120)
  const width = h.width.value
  h.openBrowser('two')
  assert.equal(h.width.value, width)
  h.back()
  assert.equal(h.width.value, width)
  h.openBrowser('one')
  assert.equal(h.width.value, width)
})

test('resource updates show a mini page without opening a half-screen view', async () => {
  const h = harness()
  const pending = h.refresh()
  h.requests[0]({ artifacts: [], tabs: [{ id: 'one' }, { id: 'two' }], activeTabId: 'two' })
  await pending
  assert.equal(h.selection.value, null)
  assert.equal(h.miniTab.value.id, 'two')
})


test('half-screen dragging keeps pointer capture across the chat iframe and cleans up on release', () => {
  const h = harness()
  let captured = false
  const target = {
    setPointerCapture: () => { captured = true },
    hasPointerCapture: () => captured,
    releasePointerCapture: () => { captured = false },
  }
  h.resize({ button: 0, preventDefault() {}, currentTarget: target, pointerId: 7, clientX: 800 })
  assert.equal(captured, true)
  h.pointerEvents.get('pointermove')({ clientX: 920 })
  assert.equal(h.width.value, 580)
  h.pointerEvents.get('pointerup')()
  assert.equal(captured, false)
  assert.equal(h.pointerEvents.size, 0)
})


test('shrinking to a small window collapses resources, and growing does not force them open', () => {
  const h = harness()
  h.openBrowser('one')
  h.viewport.innerWidth = 1100
  h.onViewportResize()
  assert.equal(h.opened.value, false)
  assert.equal(h.selection.value.id, 'one')
  h.viewport.innerWidth = 1600
  h.onViewportResize()
  assert.equal(h.opened.value, false)
  h.togglePanel()
  assert.equal(h.opened.value, true)
  assert.equal(h.selection.value.id, 'one')
})

test('short windows collapse too, while manual reopening at the same size stays available', () => {
  const h = harness()
  h.viewport.innerHeight = 580
  h.onViewportResize()
  assert.equal(h.opened.value, false)
  h.togglePanel()
  h.onViewportResize()
  assert.equal(h.opened.value, true)
  h.viewport.innerHeight = 560
  h.onViewportResize()
  assert.equal(h.opened.value, false)
})


test('switching browser presentation unmounts the old stream before starting the replacement', async () => {
  const h = harness()
  h.openBrowser('one')
  assert.equal(h.browserReady.value, false)
  await Promise.resolve()
  assert.equal(h.browserReady.value, true)
  h.back()
  assert.equal(h.browserReady.value, false)
  await Promise.resolve()
  assert.equal(h.browserReady.value, true)
})


test('compact layout reserves chat space only while the resource card is visible', () => {
  const h = harness()
  assert.equal(h.opened.value, false)
  assert.equal(h.compactOpen.value, false)
  h.togglePanel()
  assert.equal(h.compactOpen.value, true)
  h.openBrowser('one')
  assert.equal(h.compactOpen.value, false)
  h.back()
  assert.equal(h.compactOpen.value, true)
  h.togglePanel()
  assert.equal(h.compactOpen.value, false)
})

test('search opens with focus and closes with results and keyboard focus restored', async () => {
  const h = harness()
  let focus = ''
  h.searchInput.value = { focus: () => { focus = 'input' } }
  h.searchButton.value = { focus: () => { focus = 'button' } }
  assert.equal(h.searching.value, false)
  h.toggleSearch()
  await Promise.resolve()
  assert.equal(focus, 'input')
  h.query.value = 'report'
  h.closeSearch()
  await Promise.resolve()
  assert.equal(h.searching.value, false)
  assert.equal(h.query.value, '')
  assert.equal(focus, 'button')
})

test('large resource collections remain fully searchable by title, path and URL', () => {
  const h = harness()
  h.tabs.value = Array.from({ length: 24 }, (_, i) => ({ id: String(i), title: `Page ${i}`, url: `https://example.test/page-${i}` }))
  h.artifacts.value = Array.from({ length: 120 }, (_, i) => ({ filename: `Report-${i}.md`, path: `/batch/${i}/result.md` }))
  h.query.value = 'page-23'
  assert.equal(h.filteredTabs.value[0].id, '23')
  h.query.value = '/batch/119/'
  assert.equal(h.filteredArtifacts.value[0].filename, 'Report-119.md')
  h.query.value = 'REPORT-'
  assert.equal(h.filteredArtifacts.value.length, 120)
  h.closeSearch()
  assert.equal(h.filteredTabs.value.length, 24)
  assert.equal(h.filteredArtifacts.value.length, 120)
})
