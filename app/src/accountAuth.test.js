const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { validateConfig, createEncryptedStorage, createAccountAuth } = require('./accountAuth')

const config = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test', providers: ['google'] }
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => {
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.alloc(32, 7), Buffer.alloc(12, 9))
    return Buffer.concat([cipher.update(value), cipher.final(), cipher.getAuthTag()])
  },
  decryptString: value => {
    const cipher = crypto.createDecipheriv('aes-256-gcm', Buffer.alloc(32, 7), Buffer.alloc(12, 9))
    cipher.setAuthTag(value.subarray(-16))
    return Buffer.concat([cipher.update(value.subarray(0, -16)), cipher.final()]).toString()
  },
}
function harness(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-account-'))
  let session = null
  const calls = []
  const auth = {
    onAuthStateChange() {}, stopAutoRefresh() {},
    async getSession() { return { data: { session } } },
    async signInWithPassword() { calls.push('login'); session = { access_token: 'secret-access', refresh_token: 'secret-refresh', user: { id: 'u1', email: 'user@example.com', identities: ['private'] } }; return { data: { session } } },
    async signInAnonymously() { calls.push('anonymous'); session = { user: { id: 'guest', is_anonymous: true } }; return { data: { session } } },
    async signOut() { calls.push('logout'); session = null },
    async updateUser(input) { calls.push(['update', input]); return { data: { user: session?.user } } },
    async verifyOtp(input) { calls.push(['verify', input]); session.user.is_anonymous = false; return { data: { session } } },
    ...overrides,
  }
  const service = createAccountAuth({ config, directory, safeStorage, createClient: () => ({ auth }), openExternal: async url => calls.push(['open', url]) })
  t.after(() => { service.dispose(); fs.rmSync(directory, { recursive: true, force: true }) })
  return { service, calls }
}

test('unconfigured status is local-only and does not initialize a client', async () => {
  const service = createAccountAuth({ config: {}, createClient() { throw new Error('must not connect') } })
  assert.equal((await service.run('status')).configured, false)
})
test('reject privileged keys and unsafe project origins', () => {
  assert.throws(() => validateConfig({ ...config, publishableKey: 'sb_secret_test' }))
  assert.throws(() => validateConfig({ ...config, url: 'http://example.com' }))
  assert.throws(() => validateConfig({ ...config, url: 'https://user:pass@example.com' }))
  assert.throws(() => validateConfig({ ...config, url: 'https://example.com/other' }))
})
test('persistent auth data is encrypted and insecure storage fails closed', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-store-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'account.enc')
  const storage = createEncryptedStorage({ file, safeStorage })
  storage.setItem('session', 'secret-refresh-token')
  assert.equal(fs.readFileSync(file).includes(Buffer.from('secret-refresh-token')), false)
  assert.equal(storage.getItem('session'), 'secret-refresh-token')
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  const insecure = createEncryptedStorage({ file, safeStorage: { ...safeStorage, getSelectedStorageBackend: () => 'basic_text' } })
  assert.throws(() => insecure.getItem('session'), /安全存储/)
  storage.clear()
  assert.equal(fs.existsSync(file), false)
})
test('renderer receives only identity, never tokens; anonymous action preserves existing account', async t => {
  const { service, calls } = harness(t)
  const state = await service.run('login', { email: 'user@example.com', password: 'password' })
  assert.deepEqual(state.user, { id: 'u1', email: 'user@example.com', anonymous: false })
  assert.doesNotMatch(JSON.stringify(state), /secret|identities/)
  await service.run('anonymous')
  assert.deepEqual(calls, ['login'])
  await service.run('logout')
  assert.equal((await service.run('status')).user, null)
})
test('anonymous email upgrade verifies email before setting a password', async t => {
  const { service, calls } = harness(t)
  await service.run('anonymous')
  const state = await service.run('register', { email: 'user@example.com' })
  assert.equal(state.pending, 'email_change')
  assert.deepEqual(calls[1], ['update', { email: 'user@example.com' }])
  await assert.rejects(service.run('login', { email: 'user@example.com', password: 'password' }), /当前验证/)
  const verified = await service.run('verify', { email: 'user@example.com', code: '123456' })
  assert.equal(verified.recovery, true)
  assert.equal(verified.user, null) // Hide the temporary session until password setup is finished.
  const updated = await service.run('password', { password: 'new-password' })
  assert.equal(updated.recovery, false)
})
test('password change requires recovery; errors do not reflect provider secrets', async t => {
  const { service } = harness(t, { signInWithPassword: async () => ({ error: { message: 'secret-token', code: 'unknown_error' } }) })
  await assert.rejects(service.run('password', { password: 'new-password' }), /先完成/)
  await assert.rejects(service.run('login', { email: 'user@example.com', password: 'password' }), error => !error.message.includes('secret-token'))
})

test('PKCE callback exchanges only a code and releases the loopback listener', async t => {
  const { service, calls } = harness(t, {
    signInWithOAuth: async () => ({ data: { url: 'https://example.supabase.co/auth/v1/authorize?provider=google' } }),
    exchangeCodeForSession: async code => { calls.push(['exchange', code]); return { data: {} } },
  })
  assert.equal((await service.run('oauth', { provider: 'google' })).pending, 'oauth')
  assert.match(calls[0][1], /^https:\/\/example.supabase.co\/auth\/v1\//)
  assert.equal((await fetch('http://127.0.0.1:18941/elsewhere?code=wrong')).status, 404)
  assert.equal((await fetch('http://127.0.0.1:18941/auth/callback?code=auth-code')).status, 200)
  const state = await service.run('status')
  assert.equal(state.pending, '')
  assert.deepEqual(calls.at(-1), ['exchange', 'auth-code'])
})

test('official SDK persists and restores a session through encrypted storage', async t => {
  const { createClient } = require('@supabase/supabase-js')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-sdk-'))
  const requests = []
  const user = { id: '11111111-1111-4111-8111-111111111111', email: '', is_anonymous: true, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
  const token = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now()/1000) + 3600 })).toString('base64url') + '.test'
  const factory = (url, key, options) => createClient(url, key, {
    ...options,
    global: { fetch: async (url) => {
      requests.push(String(url))
      if (String(url).includes('/logout')) return new Response('{}', { status: 200 })
      return new Response(JSON.stringify({ access_token: token, refresh_token: 'sdk-secret-refresh', expires_in: 3600, token_type: 'bearer', user }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    } },
  })
  const options = { config, directory, safeStorage, createClient: factory, openExternal: async () => {} }
  const first = createAccountAuth(options)
  let second
  t.after(() => { first.dispose(); second?.dispose(); fs.rmSync(directory, { recursive: true, force: true }) })
  assert.equal((await first.run('anonymous')).user.id, user.id)
  first.dispose()
  second = createAccountAuth(options)
  assert.equal((await second.run('status')).user.id, user.id)
  assert.equal(requests.filter(url => url.includes('/signup')).length, 1)
  const encrypted = fs.readFileSync(path.join(directory, fs.readdirSync(directory)[0]))
  assert.equal(encrypted.includes(Buffer.from('sdk-secret-refresh')), false)
  await second.run('logout')
  assert.equal((await second.run('status')).user, null)
})

test('signup remains unsigned until a valid code verifies the original email', async t => {
  let session = null
  let verifiedEmail
  const { service } = harness(t, {
    async getSession() { return { data: { session } } },
    async signUp() { return { data: { user: { id: 'pending' }, session: null } } },
    async verifyOtp({ email, token }) {
      verifiedEmail = email
      if (token !== '123456') return { error: { code: 'otp_expired' } }
      session = { user: { id: 'verified', email } }
      return { data: { session } }
    },
  })
  const pending = await service.run('register', { email: 'user@example.com', password: 'password123' })
  assert.equal(pending.user, null)
  assert.equal(pending.pending, 'signup')
  assert.equal(pending.pendingEmail, 'user@example.com')
  await assert.rejects(service.run('verify', { email: 'other@example.com', code: '000000' }))
  assert.equal((await service.run('status')).pending, 'signup')
  assert.equal((await service.run('status')).user, null)
  const verified = await service.run('verify', { email: 'other@example.com', code: '123456' })
  assert.equal(verifiedEmail, 'user@example.com')
  assert.equal(verified.pending, '')
  assert.equal(verified.user.id, 'verified')
})

test('signup rejects an auto-confirmed session if server confirmation is disabled', async t => {
  const { service, calls } = harness(t, {
    async signUp() { return { data: { session: { user: { id: 'unexpected' } } } } },
  })
  await assert.rejects(service.run('register', { email: 'user@example.com', password: 'password123' }), /验证未启用/)
  assert.ok(calls.includes('logout'))
  assert.equal((await service.run('status')).user, null)
})

test('password recovery requires the emailed code, hides its session, and returns to login after reset', async t => {
  let session = null
  let savedPassword = 'old-password'
  let sends = 0
  const { service } = harness(t, {
    async getSession() { return { data: { session } } },
    async resetPasswordForEmail(email) { assert.equal(email, 'user@example.com'); sends++; return { data: {} } },
    async verifyOtp({ email, token, type }) {
      assert.equal(email, 'user@example.com')
      assert.equal(type, 'recovery')
      if (token !== '123456') return { error: { code: 'otp_expired' } }
      session = { user: { id: 'u1', email } }
      return { data: { session } }
    },
    async updateUser({ password }) { savedPassword = password; return { data: { user: session.user } } },
    async signOut() { session = null },
    async signInWithPassword({ email, password }) {
      if (password !== savedPassword) return { error: { code: 'invalid_credentials' } }
      session = { user: { id: 'u1', email } }; return { data: { session } }
    },
  })
  const pending = await service.run('recovery', { email: 'user@example.com' })
  assert.equal(pending.pending, 'recovery')
  await assert.rejects(service.run('resend'), /稍后/)
  assert.equal(sends, 1)
  await assert.rejects(service.run('password', { password: 'new-password' }))
  await assert.rejects(service.run('verify', { code: '000000' }), /过期/)
  assert.equal((await service.run('status')).pending, 'recovery')
  const verified = await service.run('verify', { code: '123456', email: 'other@example.com' })
  assert.equal(verified.recovery, true)
  assert.equal(verified.user, null)
  await assert.rejects(service.run('password', { password: 'short' }), /8 位/)
  const changed = await service.run('password', { password: 'new-password' })
  assert.equal(changed.recovery, false)
  assert.equal(changed.user, null)
  assert.match(changed.message, /新密码登录/)
  await assert.rejects(service.run('verify', { code: '123456' }), /先发送/)
  await assert.rejects(service.run('login', { email: 'user@example.com', password: 'old-password' }))
  assert.equal((await service.run('login', { email: 'user@example.com', password: 'new-password' })).user.id, 'u1')
})

test('same-password rejection is actionable and preserves recovery for another password', async t => {
  let updates = 0
  const { service } = harness(t, {
    async resetPasswordForEmail() { return { data: {} } },
    async verifyOtp() { return { data: { session: { user: { id: 'u1' } } } } },
    async updateUser() { updates++; return updates === 1 ? { error: { code: 'same_password' } } : { data: {} } },
  })
  await service.run('recovery', { email: 'user@example.com' })
  await service.run('verify', { code: '123456' })
  await assert.rejects(service.run('password', { password: 'old-password' }), /新密码不能与原密码相同/)
  assert.equal((await service.run('status')).recovery, true)
  assert.equal((await service.run('password', { password: 'different-password' })).recovery, false)
})
