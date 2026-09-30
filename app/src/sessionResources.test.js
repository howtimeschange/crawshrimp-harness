import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { liveSessionBrowserPages, isClosedBrowserPageError } from './renderer/utils/sessionBrowserPages.js'
import { resourceId, restoreWorkspace } from './renderer/utils/resourceWorkspace.js'
import { documentKind } from './renderer/utils/documentPreview.js'
import { formatArtifactAge, sortArtifactsByUpdated, isOfficeDocument } from './renderer/utils/artifactTime.js'

const source = readFileSync(new URL('./renderer/components/agent/SessionResources.vue', import.meta.url), 'utf8')
const script = source.split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')
function harness({ sessionId = 'a', storage = new Map() } = {}) {
  const requests = []
  const pointerEvents = new Map()
  const props = { sessionId, conversationPhase: 'active' }
  const context = {
    resourceId, restoreWorkspace, formatArtifactAge, sortArtifactsByUpdated, isOfficeDocument, documentKind, liveSessionBrowserPages, isClosedBrowserPageError,
    defineAsyncComponent: () => ({}),
    document: { getElementById: () => null },
    nextTick: fn => Promise.resolve().then(fn),
    defineProps: () => props, defineEmits: () => {}, defineExpose: () => {},
    ref: value => ({ value }), computed: fn => ({ get value() { return fn() } }),
    watch: () => {}, onMounted: () => {}, onUnmounted: () => {},
    setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    window: { innerWidth: 1600, innerHeight: 960, addEventListener: (name, fn) => pointerEvents.set(name, fn), removeEventListener: name => pointerEvents.delete(name), cs: {
      agentApi: method => method === 'POST' ? Promise.resolve({}) : new Promise(resolve => requests.push(resolve)),
      listAgentBrowserTabs: async () => ({ ok: true, tabs: [{ id: 'one' }, { id: 'two' }] }),
    } },
  }
  vm.runInNewContext(script + '\nglobalThis.h = { dragOverResource, dropTarget, clearTabDrag, activePaneTab, switchPane, changeBrowserLayout, collapseBrowser, resizeSplit, startTabDrag, dropResource, tabArrow, splitRatio, draggedTab, retainedTabs, syncSessionPanel, refresh, workTabs, activeIds, split, focusedPane, effectiveSplit, openResource, closeResource, toggleSplit, followBrowserActivity, opened, selection, artifacts, tabs, unseen, openBrowser, back, width, adjustWidth, miniTab, browserReady, resize, onViewportResize, togglePanel, compactOpen, searching, query, toggleSearch, closeSearch, searchInput, searchButton, filteredTabs, filteredArtifacts };', context)
  return { ...context.h, props, requests, pointerEvents, viewport: context.window, storage,
    enterSession(id, _old, phase = id ? 'active' : 'hero') { props.sessionId = id; props.conversationPhase = phase; context.h.syncSessionPanel() },
  }
}

test('new-chat page stays collapsed and the first actual session opens by default', () => {
  const h = harness({ sessionId: '' })
  h.enterSession('')
  assert.equal(h.opened.value, false)
  assert.equal(h.compactOpen.value, false)
  h.enterSession('first', '')
  assert.equal(h.opened.value, true)
  assert.equal(h.compactOpen.value, true)
})

test('each session restores the user choice across navigation and component reload', () => {
  const h = harness({ sessionId: '' })
  h.enterSession('first', '')
  h.togglePanel()
  assert.equal(h.opened.value, false)
  h.enterSession('second', 'first')
  assert.equal(h.opened.value, true)
  h.enterSession('', 'second')
  assert.equal(h.opened.value, false)
  h.enterSession('first', '')
  assert.equal(h.opened.value, false)
  h.enterSession('second', 'first')
  assert.equal(h.opened.value, true)
  const reloaded = harness({ storage: h.storage })
  reloaded.enterSession('first')
  assert.equal(reloaded.opened.value, false)
  reloaded.enterSession('second')
  assert.equal(reloaded.opened.value, true)
})

test('opening the blank page manually does not become the first session preference', () => {
  const h = harness({ sessionId: '' })
  h.enterSession('')
  h.togglePanel()
  h.enterSession('first', '')
  assert.equal(h.opened.value, true)
  assert.equal(h.storage.has('crawshrimp.sessionPanel.v2.'), false)
  h.enterSession('', 'first')
  assert.equal(h.opened.value, false)
})

test('a new session with an allocated ID stays closed until its first message activates it', () => {
  const h = harness()
  h.enterSession('allocated-blank', undefined, 'hero')
  assert.equal(h.opened.value, false)
  h.enterSession('allocated-blank', undefined, 'settling')
  assert.equal(h.opened.value, false)
  assert.equal(h.storage.has('crawshrimp.sessionPanel.v2.allocated-blank'), false)
  h.enterSession('allocated-blank', undefined, 'active')
  assert.equal(h.opened.value, true)
  h.togglePanel()
  h.enterSession('allocated-blank', undefined, 'active')
  assert.equal(h.opened.value, false)
})

test('temporary hero/loading phases never overwrite the active session panel preference', () => {
  const h = harness()
  h.enterSession('existing')
  assert.equal(h.opened.value, true)
  h.enterSession('existing', undefined, 'hero')
  assert.equal(h.opened.value, false)
  h.enterSession('existing', undefined, 'settling')
  h.enterSession('existing', undefined, 'active')
  assert.equal(h.opened.value, true)
  h.togglePanel()
  h.enterSession('existing', undefined, 'hero')
  h.enterSession('existing', undefined, 'active')
  assert.equal(h.opened.value, false)
})

test('the iframe publishes hero-to-active changes even when the session ID stays the same', () => {
  const bundle = readFileSync(new URL('../../integrations/deepseek-harness/crawshrimp-slots/lib/client.js', import.meta.url), 'utf8')
  const method = bundle.slice(bundle.indexOf('    function publishCurrentSession(ctx) {'), bundle.indexOf('    function apply(ctx) {'))
  const messages = []
  let id = 'allocated-blank', phase = 'hero'
  const publish = vm.runInNewContext(method + '; publishCurrentSession', {
    lastPublishedRuntimeSessionId: '', lastPublishedConversationPhase: '', currentRuntimeSessionId: '',
    persistedRuntimeSessionId: () => id,
    document: { querySelector: () => ({ getAttribute: () => phase }) },
    generationGroups: new Map(), flushAttachmentHints: () => {}, postToShell: message => messages.push(message),
  })
  const ctx = { sessions: { list: { getSnapshot: () => ({ current: id }) } } }
  publish(ctx)
  phase = 'active'; publish(ctx); publish(ctx)
  let stateMessages = messages.filter(m => m.__crawshrimp === 'active-runtime-session')
  assert.deepEqual(stateMessages.map(m => m.conversationPhase), ['hero', 'active'])
  assert.equal(messages.filter(m => m.__crawshrimp === 'artifact-replay').length, 1)
  id = ''; phase = 'hero'; publish(ctx)
  stateMessages = messages.filter(m => m.__crawshrimp === 'active-runtime-session')
  assert.equal(stateMessages.at(-1).runtimeSessionId, '')
  assert.equal(stateMessages.at(-1).conversationPhase, 'hero')
})
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
  h.tabs.value = [{ id: 'one' }, { id: 'two' }]; await h.openBrowser('one')
  const request = h.refresh()
  h.requests[0]({ artifacts: [], tabs: [{ id: 'one' }, { id: 'two' }], activeTabId: 'two' })
  await request
  assert.equal(h.tabs.value.length, 2)
  assert.equal(h.selection.value.id, 'one')
  h.back()
  assert.equal(h.selection.value, null)
  assert.equal(h.tabs.value.length, 2)
})


test('browser tab changes and compact mode preserve the user resized half-screen width', async () => {
  const h = harness()
  h.tabs.value = [{ id: 'one' }, { id: 'two' }]; await h.openBrowser('one')
  h.adjustWidth(-120)
  const width = h.width.value
  await h.openBrowser('two')
  assert.equal(h.width.value, width)
  h.back()
  assert.equal(h.width.value, width)
  h.tabs.value = [{ id: 'one' }, { id: 'two' }]; await h.openBrowser('one')
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


test('shrinking and growing retain the selected resource', async () => {
  const h = harness(); h.tabs.value = [{ id: 'one' }, { id: 'two' }]; await h.openBrowser('one')
  h.viewport.innerWidth = 1100; h.onViewportResize(); assert.equal(h.opened.value, true)
  h.viewport.innerWidth = 1600; h.onViewportResize(); assert.equal(h.opened.value, true)
  assert.equal(h.selection.value.id, 'one')
})
test('short windows preserve explicit collapse choices', () => {
  const h = harness(); h.viewport.innerHeight = 580; h.onViewportResize()
  assert.equal(h.opened.value, false); h.togglePanel(); h.onViewportResize(); assert.equal(h.opened.value, true)
  h.viewport.innerHeight = 560; h.onViewportResize(); assert.equal(h.opened.value, true)
})

test('returning to inventory retains mounted browser tabs; visibility owns the stream', async () => {
  const h = harness()
  h.tabs.value = [{ id: 'one' }, { id: 'two' }]; await h.openBrowser('one')
  assert.equal(h.browserReady.value, true)
  h.back()
  assert.equal(h.workTabs.value.length, 1)
  await Promise.resolve()
  assert.equal(h.browserReady.value, true)
})


test('compact layout reserves chat space only while the resource card is visible', async () => {
  const h = harness()
  assert.equal(h.opened.value, false)
  assert.equal(h.compactOpen.value, false)
  h.togglePanel()
  assert.equal(h.compactOpen.value, true)
  h.tabs.value = [{ id: 'one' }, { id: 'two' }]; await h.openBrowser('one')
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


test('same filename at different paths stays separate; close keeps other pane and restore retains modes', () => {
  const h = harness(); h.enterSession('a')
  h.openResource({ path: '/中文/a/report.csv', filename: 'report.csv' })
  h.openResource({ path: '/中文/b/report.csv', filename: 'report.csv' })
  assert.equal(h.workTabs.value.length, 2)
  h.toggleSplit(); assert.equal(h.effectiveSplit.value, true)
  h.workTabs.value[0].mode = 'source'; h.workTabs.value[1].zoom = 2
  h.enterSession('b'); h.enterSession('a')
  assert.equal(h.workTabs.value.length, 2); assert.equal(h.split.value, true)
  assert.equal(h.workTabs.value[0].mode, 'source')
  h.closeResource(h.workTabs.value[1]); assert.equal(h.workTabs.value.length, 1)
  assert.equal(h.selection.value.path, '/中文/a/report.csv')
})
test('narrow split degrades without discarding tabs or selected pane', () => {
  const h = harness(); h.enterSession('a')
  h.openResource({ path: '/a.md', filename: 'a.md' }); h.openResource({ path: '/b.md', filename: 'b.md' }); h.toggleSplit()
  h.viewport.innerWidth = 900; h.onViewportResize()
  assert.equal(h.opened.value, true); assert.equal(h.effectiveSplit.value, false); assert.equal(h.workTabs.value.length, 2)
  assert.equal(h.focusedPane.value, 1)
})
test('agent activity follows exact target and excludes other sessions without selecting or replaying actions', () => {
  const h = harness(); h.enterSession('a')
  h.followBrowserActivity({ source: 'agent', runtime_session_id: 'b', active_tab_id: 'private', tabs: [{ id: 'private' }] })
  assert.equal(h.workTabs.value.length, 0)
  h.followBrowserActivity({ source: 'agent', runtime_session_id: 'a', run_id: 'run', tool_call_id: 'call', active_tab_id: 'two', tabs: [{ id: 'two', url: 'https://example.com' }] })
  assert.equal(h.selection.value.id, 'two'); assert.equal(h.requests.length, 1) // Only initial resource read.
})

test('polling the same browser event cannot reopen a preview after the user returns to resources', () => {
  const h = harness(); h.enterSession('a')
  const event = { source:'agent', runtime_session_id:'a', run_id:'r', tool_call_id:'c', operation:'click', phase:'completed', active_tab_id:'two', tabs:[{id:'two'}] }
  h.followBrowserActivity(event); h.back()
  h.followBrowserActivity({...event, created_at:'2026-09-30T14:00:00'})
  assert.equal(h.selection.value, null)
})


test('drag moves a tab across panes without replacing its retained renderer and restores ratio', () => {
  const h = harness(); h.enterSession('a')
  h.openResource({path:'/a.md',filename:'a.md'}); h.openResource({path:'/b.csv',filename:'b.csv'})
  h.toggleSplit()
  const a = h.workTabs.value.find(t => t.path === '/a.md')
  const b = h.workTabs.value.find(t => t.path === '/b.csv')
  h.draggedTab.value = a.key; h.dropResource({},1,b)
  assert.equal(a.pane,1); assert.equal(h.activeIds.value[0],''); assert.equal(h.activeIds.value[1],a.key)
  assert.equal(h.retainedTabs.value.find(t => t.key === a.key),a)
  assert.deepEqual(Array.from(h.workTabs.value,t=>t.path),['/a.md','/b.csv'])
  h.tabArrow({altKey:true},a,-1)
  assert.equal(a.pane,0); assert.equal(h.activeIds.value[1],b.key)
  h.splitRatio.value=.64; h.enterSession('b'); h.enterSession('a')
  assert.equal(h.splitRatio.value,.64)
})

test('foreign drops do not add resources or corrupt active tabs', () => {
  const h = harness(); h.enterSession('a'); h.openResource({path:'/a.md',filename:'a.md'})
  h.draggedTab.value = 'foreign'; h.dropResource({},1)
  assert.equal(h.workTabs.value.length,1); assert.equal(h.workTabs.value[0].pane,0)
})


test('drop insertion supports both edges and clears stale drags on session switch', () => {
  const h = harness(); h.enterSession('a')
  for (const name of ['a','b','c']) h.openResource({path:`/${name}.md`,filename:`${name}.md`})
  const [a,b,c] = h.workTabs.value
  h.draggedTab.value = a.key; h.dropTarget.value = {pane:0,key:b.key,after:true}; h.dropResource({},0,b)
  assert.deepEqual(Array.from(h.workTabs.value,t=>t.path),['/b.md','/a.md','/c.md'])
  h.draggedTab.value = c.key; h.dropTarget.value = {pane:0,key:b.key,after:false}; h.dropResource({},0,b)
  assert.deepEqual(Array.from(h.workTabs.value,t=>t.path),['/c.md','/b.md','/a.md'])
  h.draggedTab.value = a.key; h.enterSession('b'); assert.equal(h.draggedTab.value,null); assert.equal(h.dropTarget.value,null)
})
test('drag feedback accepts only a local tab and identifies the insertion edge', () => {
  const h = harness(); h.enterSession('a'); h.openResource({path:'/a.md',filename:'a.md'})
  const item=h.workTabs.value[0]; let prevented=0
  const event={preventDefault:()=>prevented++,clientX:80,dataTransfer:{},currentTarget:{getBoundingClientRect:()=>({left:0,width:100}),closest:()=>null}}
  h.dragOverResource(event,1,item); assert.equal(prevented,0)
  h.draggedTab.value=item.key; h.dragOverResource(event,1,item)
  assert.equal(prevented,1); assert.equal(h.dropTarget.value.after,true); assert.equal(event.dataTransfer.dropEffect,'move')
})
test('floating browser persists per session, excludes duplicate mini and agent updates retain its layout', () => {
  const h=harness();h.enterSession('a');h.tabs.value=[{id:'one',url:'https://example.com'}]
  h.openResource({...h.tabs.value[0],kind:'browser'}); const tab=h.workTabs.value[0]
  h.changeBrowserLayout(tab,'floating');assert.equal(h.selection.value,null);assert.equal(h.miniTab.value,undefined)
  h.followBrowserActivity({source:'agent',runtime_session_id:'a',active_tab_id:'one',tabs:[{id:'one',url:'https://iana.org'}],operation:'click',phase:'completed'})
  assert.equal(tab.layout,'floating');assert.equal(tab.url,'https://iana.org');assert.equal(h.selection.value,null)
  h.enterSession('b');h.enterSession('a');assert.equal(h.workTabs.value[0].layout,'floating')
  h.changeBrowserLayout(h.workTabs.value[0],'docked');assert.equal(h.selection.value.layout,'docked')
  h.collapseBrowser(h.workTabs.value[0]);assert.equal(h.selection.value,null)
})
test('split resize cleans global handlers on cancellation and clamps ratio', () => {
  const h=harness(); let captured=false
  const target={parentElement:{getBoundingClientRect:()=>({left:100,width:800})},setPointerCapture:()=>captured=true,hasPointerCapture:()=>captured,releasePointerCapture:()=>captured=false}
  h.resizeSplit({button:0,pointerId:1,currentTarget:target,preventDefault(){}})
  h.pointerEvents.get('pointermove')({clientX:850});assert.equal(h.splitRatio.value,.7)
  h.pointerEvents.get('pointercancel')();assert.equal(captured,false);assert.equal(h.pointerEvents.size,0)
})
