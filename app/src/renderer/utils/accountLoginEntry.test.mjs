import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')
const action = source.slice(source.indexOf('async function openAccount('), source.indexOf("const currentView = ref('agent')"))
function fixture(state, failure) {
  const calls = [], ctx = { authDialogOpen: {value: false}, accountLoginBusy: {value: false}, accountLoginError: {value: ''}, agentView: {value: {openLoginWelcome: state => calls.push(['welcome', state.pending || ''])}}, openSettingsPanel: panel => calls.push(panel), window: {cs: {accountAction: async name => { calls.push(name); if (failure) throw failure; return state }}} }
  vm.runInNewContext(action, ctx)
  return {ctx, calls}
}
test('signed-out managed account opens the oil-painting welcome without launching OAuth or changing the page', async () => {
  const {ctx, calls} = fixture({managed:true,user:null})
  await ctx.openAccount(false)
  assert.deepEqual(calls, ['status', ['welcome', '']])
  assert.equal(ctx.authDialogOpen.value, false)
})
test('pending browser authorization is presented in welcome without reopening the browser', async () => {
  const {ctx, calls} = fixture({managed:true,user:null,pending:'oauth'})
  await ctx.openAccount(false)
  assert.deepEqual(calls, ['status', ['welcome', 'oauth']])
})
test('authenticated accounts retain profile entry', async () => {
  const {ctx,calls} = fixture({managed:true,user:{email:'test@example.com'}})
  await ctx.openAccount(true)
  assert.deepEqual(calls,['account'])
})
test('repeated click cannot initiate duplicate login', async () => {
  const {ctx,calls} = fixture({managed:true,user:null})
  await Promise.all([ctx.openAccount(false),ctx.openAccount(false)])
  assert.equal(calls.filter(x=>Array.isArray(x)&&x[0]==='welcome').length,1)
})
test('opening failure leaves a visible retryable error and clears busy state', async () => {
  const {ctx} = fixture({}, new Error('network unavailable'))
  await ctx.openAccount(false)
  assert.equal(ctx.accountLoginError.value,'network unavailable')
  assert.equal(ctx.accountLoginBusy.value,false)
  assert.equal(ctx.authDialogOpen.value,false)
})
