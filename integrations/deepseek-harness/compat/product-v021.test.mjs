import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { quotaClassification, runningBrand } from './backports/product-v021.mjs'
const read = (pkg, file) => readFileSync(new URL(`../node_modules/@deepseek-ai/${pkg}/lib/${file}`, import.meta.url), 'utf8')
test('real adapter classifies gateway quota before 403 auth, without masking bad keys', () => {
  const source = quotaClassification(read('dsh-llm-pi-ai','index.js'))
  const common = read('dsh-llm','index.js')
  const helper = common.slice(common.indexOf('function isQuotaExceededError('), common.indexOf('\n}',common.indexOf('function isQuotaExceededError('))+2)
  const body = source.slice(source.indexOf('function classifyPiAiError('),source.indexOf('\n}',source.indexOf('function classifyPiAiError('))+2)
  const classify = vm.runInNewContext(helper+'\n'+body+'\nclassifyPiAiError',{QUOTA_EXCEEDED_CODE:'QUOTA'})
  for (const message of ['403 Insufficient user quota, remaining quota: 0', '403 insufficient_user_quota', '403 insufficient_quota', '429 quota exceeded']) assert.equal(classify(message),'QUOTA')
  for (const message of ['401 invalid API key','403 access denied']) assert.equal(classify(message),'AUTH')
  assert.equal(classify('429 rate limit'),'RATE_LIMIT')
  assert.equal(quotaClassification(source),source)
  assert.throws(()=>quotaClassification('drift'),/anchor/)
})
test('rc.2 visible and accessible running copy share the brand and retain duration', () => {
  const source = runningBrand(read('dsh-client-ui-chat','client.js'))
  assert.match(source, /"chat.deepDiving": "抓虾中"/)
  assert.match(source, /抓虾中，用时 \{duration\}/)
  assert.doesNotMatch(source, /"chat.deepDiving(?:For)?": "深度求索/)
  assert.equal(runningBrand(source),source)
  assert.throws(()=>runningBrand('drift'),/anchor/)
})

test('embedded sidebar hides both surface and toggle, standalone retains native rendering', async () => {
  const {embeddedSidebar}=await import('./backports/product-v021.mjs')
  const source=embeddedSidebar(read('dsh-client-ui-sidebar-right','client.js'))
  assert.equal(embeddedSidebar(source),source)
  assert.throws(()=>embeddedSidebar('drift'),/anchor/)
  for(const name of ['RightbarRoot','ExpandButton']) {
    const start=source.indexOf(`function ${name}(`)
    const end=source.indexOf('return null;',start)+'return null;'.length
    const fn=source.slice(start,end)+' return "native"; }'
    const child={},top={};
    assert.equal(vm.runInNewContext(fn+`; ${name}({})`,{window:{parent:top}}),null)
    child.parent=child
    assert.equal(vm.runInNewContext(fn+`; ${name}({})`,{window:child}),'native')
  }
})
test('duplicate export menu is suppressed only in the embedded app', async () => {
  const {embeddedSessionMenu}=await import('./backports/product-v021.mjs')
  const source=embeddedSessionMenu(read('dsh-session-log-export','client.js'))
  assert.equal(embeddedSessionMenu(source),source)
  assert.throws(()=>embeddedSessionMenu('drift'),/anchor/)
  const start=source.indexOf('function SessionLogDownloadHeaderAction(')
  const end=source.indexOf('return null;',start)+'return null;'.length
  const fn=source.slice(start,end)+' return "native"; }'
  assert.equal(vm.runInNewContext(fn+'; SessionLogDownloadHeaderAction({})',{window:{parent:{}}}),null)
  const win={};win.parent=win
  assert.equal(vm.runInNewContext(fn+'; SessionLogDownloadHeaderAction({})',{window:win}),'native')
})

test('embedded settings opens only the IM section in its dedicated frame', async () => {
  const { embeddedSettings } = await import('./backports/product-v021.mjs')
  const source='const { close, openSection } = actions;'
  const patched=embeddedSettings(source)
  assert.equal(embeddedSettings(patched), patched)
  for (const search of ['', '?csImSettings=1']) {
    const opened=[]
    Function('react','window','actions',patched)({useEffect:fn=>fn()},{location:{search}},{openSection:id=>opened.push(id)})
    assert.deepEqual(opened,search ? ['xmanrui-dsh-im'] : [])
  }
})

test('welcome has real accessible text rather than generated duplicate copy', async () => {
  const { welcomeBrand } = await import('./backports/product-v021.mjs')
  const patched=welcomeBrand('(0, react_jsx_runtime.jsx)("span", { children: t("hero.headline") })')
  const jsx=(tag,props)=>({tag,...props})
  const tree=Function('react_jsx_runtime','return '+patched)({jsx,jsxs:jsx})
  assert.deepEqual(tree.children.map(child=>child.children),['抓虾智能体','· 抓住灵感，拿到结果'])
  assert.equal(welcomeBrand(patched),patched)
})

test('obsolete composer hints are hidden without suppressing unrelated tooltips', () => {
  const slots = readFileSync(new URL('../crawshrimp-slots/lib/client.js', import.meta.url), 'utf8')
  const start = slots.indexOf('function suppressNativeCommandTooltips() {')
  const end = slots.indexOf('function installNativeCommandTooltipSuppressor()', start)
  const labels = ['添加文件或调用指令', 'Add files or run commands', 'Add files or invoke commands', '上传附件', '模型详情']
  const nodes = labels.map(textContent => ({textContent, dataset: {}, attributes: {}, getAttribute(k) { return this.attributes[k] }, setAttribute(k,v) { this.attributes[k]=v }}))
  vm.runInNewContext(slots.slice(start,end)+'; suppressNativeCommandTooltips()', {COMMAND_BUTTON_LABEL:'命令',document:{querySelectorAll:()=>nodes}})
  assert.deepEqual(nodes.map(n=>n.dataset.csSuppressedTooltip), ['1','1','1',undefined,undefined])
  assert.deepEqual(nodes.map(n=>n.attributes['aria-hidden']), ['true','true','true',undefined,undefined])
  assert.match(slots, /\[role="tooltip"\]\[data-cs-suppressed-tooltip="1"\] \{ display: none !important;/)
})

test('running icon removal migrates whale and shrimp without altering status text', async () => {
  const { runningShrimp } = await import('./backports/product-v021.mjs')
  for (const name of ['RunningWhaleTail', 'RunningShrimp']) {
    const source = `function ${name}() { return 'icon'; }\n\t\t//#endregion\n(0, react_jsx_runtime.jsx)(${name}, {})`
    const patched = runningShrimp(source)
    assert.equal(Function(patched.slice(0, patched.indexOf('//#endregion')) + '; return RunningStatusIcon()')(), null)
    assert.equal(runningShrimp(patched), patched)
    assert.doesNotMatch(patched, /RunningWhaleTail|RunningShrimp/)
  }
  assert.throws(() => runningShrimp('drift'), /anchor/)
})

test('embedded navigation opens plugins only and leaves native schedule entry out', async () => {
  const { embeddedPanels } = await import('./backports/product-v021.mjs')
  const source = embeddedPanels(read('dsh-client-ui-sidebar', 'client.js'))
  assert.equal(embeddedPanels(source), source)
  assert.throws(() => embeddedPanels('drift'), /anchor/)
  const effect = source.match(/\(0, react.useEffect\)\(\(\) => \{ if \(window.parent !== window && new URLSearchParams\(window.location.search\).get\('csPanel'\)[^\n]+/)[0]
  for (const [embedded, search, expected] of [[true,'?csPanel=plugins',['plugins']], [true,'?csPanel=schedules',[]], [false,'?csPanel=plugins',[]]]) {
    const selected = [], win = {location:{search}}; win.parent = embedded ? {} : win
    Function('react','window','selectPanel',effect)({useEffect: fn=>fn()},win,id=>selected.push(id))
    assert.deepEqual(selected,expected)
  }
})
