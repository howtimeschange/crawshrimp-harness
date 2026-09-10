import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { liveSessionBrowserPages, isClosedBrowserPageError } from './sessionBrowserPages.js'

const source = readFileSync(new URL('../components/agent/SessionResources.vue', import.meta.url), 'utf8')
function harness({ api = async () => ({}), list = async () => ({ok:true,tabs:[]}) } = {}) {
  const ref = value => ({value})
  const context = {
    props:{sessionId:'session-a'}, tabs:ref([{id:'closed',title:'Old page'}]), activeTabId:ref('closed'), selection:ref(null),
    closedBrowserIds:new Set(), error:ref(''), generation:0, previewGeneration:0, loading:ref(false), artifacts:ref([]),
    loadedOnce:true, opened:ref(true), unseen:ref(0), window:{cs:{agentApi:api,listAgentBrowserTabs:list}},
    back(){context.selection.value=null;context.error.value=''}, prepareBrowserTransition(){},nextTick(){},
    liveSessionBrowserPages,isClosedBrowserPageError,
  }
  vm.runInNewContext(source.slice(source.indexOf('function forgetBrowserPage('),source.indexOf('function focusSelectedTab(')),context)
  vm.runInNewContext(source.slice(source.indexOf('async function refresh()'),source.indexOf('async function newPage()')),context)
  return context
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
  h.selection.value={kind:'browser',id:'closed'}
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
