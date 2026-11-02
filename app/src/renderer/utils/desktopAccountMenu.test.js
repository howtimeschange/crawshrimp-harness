import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { accountIdentity, runtimeIndicators } from './desktopAccountMenu.js'

test('local-only and anonymous identities never imply a paid plan or permanent account', () => {
  assert.equal(accountIdentity().name, '登录 / 注册')
  assert.equal(accountIdentity({user:{anonymous:true}}).name, '访客')
  assert.equal(accountIdentity({user:{email:'kim@example.com'}}).name, 'kim')
  assert.equal(accountIdentity({user:{email:'kim@example.com'}}, 'offline').authenticated, false)
})
test('on-demand browser is neutral; failure and core startup have distinct indicators', () => {
  assert.equal(runtimeIndicators({api:true,chrome:false}).browser.tone, 'idle')
  assert.equal(runtimeIndicators({apiState:'starting'}).core.tone, 'pending')
  assert.equal(runtimeIndicators({chromeDiagnostic:{kind:'invalid-cdp'}}).browser.tone, 'error')
  assert.equal(runtimeIndicators({api:false,apiState:'failed'}).core.tone, 'error')
})

// Run the actual footer handlers: a child-frame focus transition blurs Window
// without leaving the app, unlike a real switch to another application.
const footerSource = readFileSync(new URL('../components/DesktopStatusFooter.vue', import.meta.url), 'utf8')
function focusFixture() {
  let shown = true, focused = true, restored = 0, closed = 0
  const item = { focus() { restored++; context.document.activeElement = item } }
  const context = {
    open: { value: true }, trigger: { value: item },
    document: { hasFocus: () => focused, activeElement: { tagName: 'IFRAME' } },
    menu: { value: { matches: () => shown, contains: value => value === item } },
    nextTick: callback => Promise.resolve().then(callback),
    closeMenu() { closed++; shown = false; context.open.value = false },
  }
  for (const [name, next] of [['onMenuKeydown', 'onWindowBlur'], ['onWindowBlur', 'onFocusOut'], ['onFocusOut', 'requestLogout']]) {
    const start = footerSource.indexOf('function ' + name + '('), end = footerSource.indexOf('\nfunction ' + next + '(', start)
    assert.ok(start >= 0 && end > start)
    vm.runInNewContext(footerSource.slice(start, end), context)
  }
  return { context, item, leaveApp: () => { focused = false }, dismissNative: () => { shown = false }, counts: () => ({ restored, closed }) }
}
test('late iframe autofocus preserves the menu and returns focus to its item', async () => {
  const { context, item, counts } = focusFixture()
  context.onFocusOut({ target: item, relatedTarget: null })
  context.onWindowBlur()
  await Promise.resolve()
  assert.equal(context.open.value, true)
  assert.deepEqual(counts(), { restored: 1, closed: 0 })
  assert.equal(context.document.activeElement, item)
})
test('real application blur still dismisses and never restores menu focus', async () => {
  const { context, item, counts, leaveApp } = focusFixture()
  context.onFocusOut({ target: item, relatedTarget: null })
  leaveApp(); context.onWindowBlur()
  await Promise.resolve()
  assert.deepEqual(counts(), { restored: 0, closed: 1 })
})
test('Tab and native outside dismissal remain effective across iframe focus', async () => {
  for (const native of [false, true]) {
    const { context, item, counts, dismissNative } = focusFixture()
    if (native) dismissNative()
    else context.onMenuKeydown({ key: 'Tab' })
    context.onFocusOut({ target: item, relatedTarget: null })
    await Promise.resolve()
    assert.equal(counts().restored, 0)
    assert.equal(counts().closed, native ? 0 : 1)
  }
})
test('focus to a different shell control continues to dismiss the menu', () => {
  const { context, item, counts } = focusFixture()
  context.onFocusOut({ target: item, relatedTarget: {} })
  assert.equal(counts().closed, 1)
})

function actualFunction(source, name) {
  const start = source.indexOf('function ' + name + '(')
  assert.ok(start >= 0, name)
  const brace = source.indexOf('{', start)
  let depth = 1, end = brace + 1
  for (; depth && end < source.length; end++) {
    if (source[end] === '{') depth++
    else if (source[end] === '}') depth--
  }
  return source.slice(start, end)
}
const slotsSource = readFileSync(new URL('../../../../integrations/deepseek-harness/crawshrimp-slots/lib/client.js', import.meta.url), 'utf8')
function bridgeFixture() {
  const styles = [], messages = [], windowListeners = {}, documentListeners = {}, parent = {}
  const createElement = () => {
    const node = { attributes: {}, setAttribute(key, value) { this.attributes[key] = value }, remove() { const at = styles.indexOf(node); if (at >= 0) styles.splice(at, 1) } }
    return node
  }
  const context = {
    shellAccountMenuOpen: false, shellAccountMenuStyle: null,
    document: { body: { inert: true, style: { interactivity: 'auto' } }, createElement,
      head: { appendChild: node => styles.push(node) },
      addEventListener: (name, fn) => { documentListeners[name] = fn },
      removeEventListener: (name, fn) => { if (documentListeners[name] === fn) delete documentListeners[name] } },
    window: { parent, addEventListener: (name, fn) => { windowListeners[name] = fn }, removeEventListener: (name, fn) => { if (windowListeners[name] === fn) delete windowListeners[name] } },
    shellOrigin: () => 'https://shell.test', postToShell: value => messages.push(value),
  }
  for (const name of ['updateShellAccountMenuState', 'dismissShellAccountMenu', 'installShellMessageBridge']) vm.runInNewContext(actualFunction(slotsSource, name), context)
  const dispose = context.installShellMessageBridge({})
  const receive = (data, source = parent, origin = 'https://shell.test') => windowListeners.message({ data, source, origin })
  return { context, styles, messages, documentListeners, receive, dispose }
}
test('menu focus lock owns only its temporary style and preserves concurrent inert owners', () => {
  const { context, styles, receive } = bridgeFixture()
  receive({ __crawshrimp: 'shell-account-menu-state', open: true })
  const own = () => styles.filter(node => 'data-crawshrimp-menu-focus-lock' in node.attributes)
  assert.equal(own().length, 1)
  assert.equal(context.document.body.inert, true)
  assert.equal(context.document.body.style.interactivity, 'auto')
  receive({ __crawshrimp: 'shell-account-menu-state', open: true })
  assert.equal(own().length, 1)
  context.document.body.inert = false // A different owner changes its own state while the menu is open.
  receive({ __crawshrimp: 'shell-account-menu-state', open: false })
  assert.equal(own().length, 0)
  assert.equal(context.document.body.inert, false)
  assert.equal(context.document.body.style.interactivity, 'auto')
})
test('focus lock accepts only parent/origin boolean UI state and cleanup restores interactivity', () => {
  const { receive, styles, dispose, documentListeners } = bridgeFixture()
  const own = () => styles.filter(node => 'data-crawshrimp-menu-focus-lock' in node.attributes)
  receive({ __crawshrimp: 'shell-account-menu-state', open: true }, {})
  receive({ __crawshrimp: 'shell-account-menu-state', open: true }, undefined, 'https://foreign.test')
  receive({ __crawshrimp: 'shell-account-menu-state', open: 'true' })
  assert.equal(own().length, 0)
  receive({ __crawshrimp: 'shell-account-menu-state', open: true })
  assert.equal(own().length, 1)
  dispose()
  assert.equal(own().length, 0)
  assert.equal(documentListeners.pointerdown, undefined)
})
test('a pointer in the temporarily inert conversation only dismisses an open shell menu', () => {
  const { context, messages, receive, documentListeners } = bridgeFixture()
  let prevented = 0
  const event = { preventDefault() { prevented++ }, stopPropagation() {}, stopImmediatePropagation() {} }
  documentListeners.pointerdown(event)
  assert.equal(prevented, 0)
  receive({ __crawshrimp: 'shell-account-menu-state', open: true })
  documentListeners.pointerdown(event)
  assert.equal(prevented, 1)
  assert.equal(messages.at(-1).__crawshrimp, 'shell-account-menu-dismiss')
  assert.deepEqual(Object.keys(messages.at(-1)), ['__crawshrimp'])
  context.updateShellAccountMenuState({ open: false })
})
const viewSource = readFileSync(new URL('../views/AgentWebView.vue', import.meta.url), 'utf8')
test('an iframe mounted after menu opening receives current state on load and bridge-ready', () => {
  const sent = [], events = [], frame = {}
  const context = {
    props: { active: true }, accountMenuOpen: false, frameEl: { value: null }, frameOrigin: { value: 'http://frame.test' }, frameReady: { value: false }, fileDropOverlay: { value: null },
    pushTheme() {}, pushNav() {}, pushAppVersion() {}, pushWorkspace() {}, pushRuntimeModelConfiguration() {},
    postToFrame(value) { if (context.frameEl.value) sent.push(value) },
    window: { dispatchEvent: event => events.push(event.type) }, Event: class { constructor(type) { this.type = type } },
  }
  for (const name of ['pushAccountMenuState', 'onAccountMenuState', 'onFrameLoad', 'onWindowMessage']) vm.runInNewContext(actualFunction(viewSource, name), context)
  context.onAccountMenuState({ detail: true })
  assert.equal(sent.length, 0)
  context.frameEl.value = { contentWindow: frame }
  context.onFrameLoad()
  assert.equal(sent.at(-1).open, true)
  context.onWindowMessage({ source: frame, origin: 'http://frame.test', data: { __crawshrimp: 'workspace-ready' } })
  assert.equal(sent.at(-1).open, true)
  context.onWindowMessage({ source: {}, origin: 'http://frame.test', data: { __crawshrimp: 'shell-account-menu-dismiss' } })
  assert.equal(events.length, 0)
  context.onWindowMessage({ source: frame, origin: 'http://frame.test', data: { __crawshrimp: 'shell-account-menu-dismiss' } })
  assert.deepEqual(events, ['cs-account-menu-dismiss'])
  context.onAccountMenuState({ detail: false })
  assert.equal(sent.at(-1).open, false)
  context.props.active = false
  context.onAccountMenuState({ detail: true })
  assert.equal(sent.at(-1).open, false)
})
