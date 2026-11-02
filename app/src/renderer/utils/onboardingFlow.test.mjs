import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { hasManagedTextModel, firstRunCompletion, finishFirstRun } from './firstRun.mjs'
import { createAccountRuntimeSync } from './accountRuntimeSync.mjs'

const source = readFileSync(new URL('../views/AgentWebView.vue', import.meta.url), 'utf8')
function actualFunction(name) {
  const start = source.indexOf('function ' + name + '(')
  assert.ok(start >= 0, name)
  const brace = source.indexOf('{', start)
  let at = brace + 1, depth = 1
  for (; depth; at++) { if (source[at] === '{') depth++; else if (source[at] === '}') depth-- }
  return (source.slice(start - 6, start) === 'async ' ? 'async ' : '') + source.slice(start, at)
}
function fixture({ active = true, required = false } = {}) {
  let state = { managed: true, user: null, models: [], onboardingRequired: required }
  let failure, statusGate
  const calls = [], records = new Map()
  const c = {
    props: { active }, document: { activeElement: { focus() {} } },
    window: { localStorage: { getItem: key => records.get(key), setItem: (key, value) => records.set(key, value) }, cs: {
      async accountAction(action) {
        calls.push(action)
        if (failure) throw failure
        if (action === 'status' && statusGate) return statusGate
        if (action === 'login' || action === 'register') state = { ...state, pending: 'oauth' }
        if (action === 'cancel') state = { ...state, pending: '' }
        if (action === 'finish-onboarding') state = { ...state, onboardingRequired: false }
        return state
      },
    } },
    inlineLlmModalOpen: { value: false }, loginWelcomeOpen: { value: false },
    onboardingAccount: { value: {} }, onboardingStep: { value: 'choice' },
    onboardingError: { value: '' }, onboardingBusy: { value: false },
    runtimeNeedsModelKey: { value: false }, onboardingPresented: false,
    onboardingPreviousFocus: null, onboardingRefreshGeneration: 0,
    completedOnboardingOwners: new Set(), hasManagedTextModel, firstRunCompletion, finishFirstRun,
    accountRuntimeSync: createAccountRuntimeSync({ restart: async () => { calls.push('restart-runtime'); return { ok: true } } }),
    loadRuntime: async () => calls.push('read-runtime'), pushRuntimeModelConfiguration() {},
  }
  for (const name of ['onboardingIsComplete', 'showOnboardingSetup', 'finishOnboarding', 'refreshOnboardingAccount', 'onboardingAction', 'syncRuntimeModelConfiguration', 'openInlineLlmModal', 'openLoginWelcome', 'closeInlineLlmModal']) {
    vm.runInNewContext(actualFunction(name), c)
  }
  return { c, calls, set: next => { state = { ...state, ...next } }, fail: error => { failure = error },
    delayStatus: promise => { statusGate = promise }, open: () => c.openLoginWelcome(state),
    authorized: (id = 'existing-owner') => { state = { ...state, user: { id }, pending: '', models: [{ kind: 'text' }], accountSessionEpoch: id + '-session' } },
  }
}

test('all explicit entries can show welcome over an inactive agent and survive late runtime status', () => {
  for (const active of [true, false]) {
    const f = fixture({ active }); f.open()
    assert.equal(f.c.inlineLlmModalOpen.value, true)
    assert.equal(f.c.onboardingStep.value, 'choice')
    f.c.syncRuntimeModelConfiguration({ api_key_configured: true })
    assert.equal(f.c.inlineLlmModalOpen.value, true)
    assert.deepEqual(f.calls, [], 'No OAuth, task submission or navigation before clicking login')
  }
})
test('composer welcome and cancellation survive late configured-runtime polls', async () => {
  const f = fixture()
  f.c.openInlineLlmModal()
  f.c.syncRuntimeModelConfiguration({ api_key_configured: true })
  assert.equal(f.c.inlineLlmModalOpen.value, true)
  await f.c.onboardingAction('login')
  await f.c.onboardingAction('cancel')
  f.c.syncRuntimeModelConfiguration({ api_key_configured: true })
  assert.equal(f.c.inlineLlmModalOpen.value, true)
  f.c.closeInlineLlmModal()
  f.c.syncRuntimeModelConfiguration({ api_key_configured: true })
  assert.equal(f.c.inlineLlmModalOpen.value, false)
})
test('returning-user OAuth closes welcome on every page and duplicate callbacks do not replay actions', async () => {
  for (const active of [true, false]) {
    const f = fixture({ active }); f.open(); await f.c.onboardingAction('login'); f.authorized()
    await Promise.all([f.c.refreshOnboardingAccount(), f.c.refreshOnboardingAccount()])
    assert.equal(f.c.inlineLlmModalOpen.value, false)
    assert.equal(f.c.loginWelcomeOpen.value, false)
    assert.notEqual(f.c.onboardingStep.value, 'ready')
    assert.equal(f.calls.filter(call => call === 'login').length, 1)
    assert.equal(f.calls.filter(call => call === 'restart-runtime').length, 1)
    assert.ok(f.calls.every(call => ['login', 'status', 'restart-runtime', 'read-runtime'].includes(call)))
  }
})
test('fresh desktop shows ready once, persists completion and suppresses it after account switch', async () => {
  const f = fixture({ required: true, active: false }); f.open(); f.authorized('new-owner')
  await f.c.refreshOnboardingAccount()
  assert.equal(f.c.onboardingStep.value, 'ready')
  assert.equal(f.c.inlineLlmModalOpen.value, true)
  await Promise.all([f.c.finishOnboarding(), f.c.finishOnboarding()])
  assert.equal(f.calls.filter(call => call === 'finish-onboarding').length, 1)
  assert.equal(f.c.inlineLlmModalOpen.value, false)
  f.authorized('another-owner'); await f.c.refreshOnboardingAccount()
  assert.equal(f.c.inlineLlmModalOpen.value, false)
})
test('cancel and authorization failure retain welcome for retry, while back closes it', async () => {
  const f = fixture(); f.open(); await f.c.onboardingAction('login')
  await f.c.onboardingAction('cancel')
  assert.equal(f.c.inlineLlmModalOpen.value, true)
  f.fail(new Error('authorization denied')); await f.c.onboardingAction('login')
  assert.equal(f.c.onboardingError.value, 'authorization denied')
  assert.equal(f.c.onboardingBusy.value, false)
  assert.equal(f.c.inlineLlmModalOpen.value, true)
  f.fail(null); await f.c.onboardingAction('login')
  f.c.closeInlineLlmModal()
  assert.equal(f.c.inlineLlmModalOpen.value, false)
  assert.equal(f.c.loginWelcomeOpen.value, false)
})
test('a stale pre-entry account read cannot overwrite welcome opened on another page', async () => {
  const f = fixture({ active: false }); let release
  f.delayStatus(new Promise(resolve => { release = resolve }))
  const oldRead = f.c.refreshOnboardingAccount()
  f.open()
  release({ user: { id: 'stale' }, models: [{ kind: 'text' }], onboardingRequired: true })
  await oldRead
  assert.equal(f.c.onboardingAccount.value.user, null)
  assert.equal(f.c.onboardingStep.value, 'choice')
  assert.equal(f.c.inlineLlmModalOpen.value, true)
})
test('back cannot abandon an in-flight browser open or first-run save', () => {
  const f = fixture(); f.open(); f.c.onboardingBusy.value = true
  f.c.closeInlineLlmModal()
  assert.equal(f.c.inlineLlmModalOpen.value, true)
  assert.equal(f.c.loginWelcomeOpen.value, true)
})
test('a failed completion save stays retryable and does not mark the local owner complete', async () => {
  const f = fixture({ required: true }); f.open(); f.authorized('fresh')
  await f.c.refreshOnboardingAccount()
  f.fail(new Error('disk full')); await f.c.finishOnboarding()
  assert.equal(f.c.inlineLlmModalOpen.value, true)
  assert.equal(f.c.completedOnboardingOwners.has('fresh'), false)
  assert.equal(f.c.onboardingBusy.value, false)
  f.fail(null); await f.c.finishOnboarding()
  assert.equal(f.c.inlineLlmModalOpen.value, false)
})
