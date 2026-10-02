import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { liveSessionBrowserPages, isClosedBrowserPageError } from './sessionBrowserPages.js'
import { resourceId, restoreWorkspace } from './resourceWorkspace.js'
import { formatArtifactAge, sortArtifactsByUpdated } from './artifactTime.js'

const source = readFileSync(new URL('../components/agent/SessionResources.vue', import.meta.url), 'utf8')
const script = source.split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')
function harness({ api = async () => ({}), list = async () => ({ok:true,tabs:[]}) } = {}) {
  const ref = value => ({value})
  const props = { sessionId: 'session-a', conversationPhase: 'active' }
  const context = {
    defineProps: () => props, defineEmits: () => {}, defineExpose: () => {}, ref,
    computed: fn => ({ get value() { return fn() } }), watch() {}, onMounted() {}, onUnmounted() {},
    nextTick: fn => Promise.resolve().then(fn), setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout,
    window: { innerWidth: 1400, innerHeight: 900, cs: {agentApi:api,listAgentBrowserTabs:list} },
    document: { getElementById: () => null }, localStorage: { getItem: () => null, setItem() {} },
    liveSessionBrowserPages, isClosedBrowserPageError, resourceId, restoreWorkspace, formatArtifactAge, sortArtifactsByUpdated,
  }
  vm.runInNewContext(script + `
    loadedOnce = true; opened.value = true;
    tabs.value = [{ id: 'closed', title: 'Old page' }]; activeTabId.value = 'closed';
    globalThis.h = { tabs, activeTabId, selection, closedBrowserIds, error, refresh, openBrowser, openResource, forgetBrowserPage, workTabs, retainedTabs };
  `, context)
  return { ...context.h, props }
}

test('only live pages owned by this session appear, with current metadata', () => {
  const pages=liveSessionBrowserPages([{id:'closed'},{id:'open',title:'old'}],{ok:true,tabs:[{id:'open',title:'new'},{id:'other-session'}]})
  assert.deepEqual(pages,[{id:'open',title:'new',closed:false}])
})
test('temporary connection failure preserves pages but cannot resurrect known closures', () => {
  assert.equal(liveSessionBrowserPages([{id:'open'}],{ok:false}).length,1)
  assert.equal(liveSessionBrowserPages([{id:'closed'}],null,new Set(['closed'])).length,0)
  assert.equal(liveSessionBrowserPages([{id:'closed',closed:true}],null).length,0)
})
test('refresh removes closed page and exits its selected preview', async () => {
  const h=harness({api:async()=>({tabs:[{id:'closed'}],activeTabId:'closed'})})
  h.openResource({kind:'browser',id:'closed'})
  await h.refresh()
  assert.equal(h.tabs.value.length,0)
  assert.equal(h.activeTabId.value,'')
  assert.equal(h.selection.value,null)
  assert.equal(h.closedBrowserIds.has('closed'),true)
})
test('page closed between rendering and click is removed without raw IPC error', async () => {
  const h=harness({api:async method=>{
    if(method==='POST') throw new Error("Error invoking remote method 'agent:api': Error: 页面已关闭，请新建页面")
    return {tabs:[{id:'closed'}]}
  },list:async()=>({ok:false})})
  await h.openBrowser('closed')
  assert.equal(h.tabs.value.length,0)
  assert.equal(h.error.value,'')
  assert.equal(h.selection.value,null)
})
test('known closed page does not send a select request', async () => {
  let calls=0
  const h=harness({api:async()=>{calls++}})
  h.tabs.value=[]
  await h.openBrowser('closed')
  assert.equal(calls,0)
})
test('a late select response cannot restore a page removed during refresh', async () => {
  let resolve
  const h=harness({api:()=>new Promise(done=>{resolve=done})})
  const pending=h.openBrowser('closed')
  h.forgetBrowserPage('closed')
  resolve({})
  await pending
  assert.equal(h.activeTabId.value,'')
  assert.equal(h.selection.value,null)
})
test('a late error from the previous session cannot modify the current session', async () => {
  let reject
  const h=harness({api:()=>new Promise((_,fail)=>{reject=fail})})
  const pending=h.openBrowser('closed')
  h.props.sessionId='session-b'
  h.tabs.value=[{id:'new-session-page'}]
  reject(new Error('页面已关闭，请新建页面'))
  await pending
  assert.equal(h.tabs.value[0].id,'new-session-page')
  assert.equal(h.error.value,'')
})
test('other select failures keep the page and show a plain Chinese message', async () => {
  const h=harness({api:async()=>{throw new Error("Error invoking remote method 'agent:api': network failure")}})
  await h.openBrowser('closed')
  assert.equal(h.tabs.value.length,1)
  assert.equal(h.error.value,'选择页面失败，请稍后重试')
})
