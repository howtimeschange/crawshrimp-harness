import test from 'node:test'
import assert from 'node:assert/strict'
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
