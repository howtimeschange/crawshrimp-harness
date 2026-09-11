'use strict'

const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const { atomicWriteFileSync } = require('./atomicFile')

const CALLBACK_URL = 'http://127.0.0.1:18941/auth/callback'

function validateConfig(config = {}) {
  const url = String(config.url || '').trim()
  const key = String(config.publishableKey || '').trim()
  if (!url && !key) return null
  let parsed
  try { parsed = new URL(url) } catch { throw new Error('账号服务地址配置无效') }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) {
    throw new Error('账号服务必须使用 HTTPS 项目地址')
  }
  let legacyAnon = false
  try { legacyAnon = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon' } catch {}
  if (!key.startsWith('sb_publishable_') && !legacyAnon) throw new Error('账号服务只能使用 publishable key 或 anon key')
  return { url: parsed.origin, publishableKey: key }
}

function createEncryptedStorage({ file, safeStorage }) {
  function available() {
    return safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text'
  }
  function read() {
    if (!available()) throw new Error('系统安全存储不可用，暂时无法登录；本地功能仍可使用')
    if (!fs.existsSync(file)) return {}
    try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(file))) }
    catch { throw new Error('无法读取账号凭证，请退出账号后重新登录') }
  }
  return {
    getItem(key) { return read()[key] ?? null },
    setItem(key, value) {
      const data = read()
      data[key] = value
      atomicWriteFileSync(file, safeStorage.encryptString(JSON.stringify(data)))
    },
    removeItem(key) {
      const data = read()
      delete data[key]
      if (!Object.keys(data).length) { fs.rmSync(file, { force: true }); return }
      atomicWriteFileSync(file, safeStorage.encryptString(JSON.stringify(data)))
    },
    clear() { fs.rmSync(file, { force: true }) },
  }
}

function publicUser(user) {
  return user ? { id: user.id, email: user.email || '', anonymous: Boolean(user.is_anonymous) } : null
}

function authError(error) {
  const messages = {
    invalid_credentials: '邮箱或密码不正确',
    email_not_confirmed: '请先在邮箱中确认注册',
    email_address_not_authorized: '邮件服务尚未对该收件人开放，请联系应用维护者配置邮件服务',
    email_address_invalid: '该邮箱地址不可用，请检查后重试',
    user_already_exists: '该邮箱已有账号，请直接登录',
    email_exists: '该邮箱已有账号，请直接登录；访客身份不会自动合并',
    same_password: '新密码不能与原密码相同，请换一个新密码',
    session_not_found: '验证会话已失效，请重新获取邮箱验证码',
    session_expired: '验证会话已过期，请重新获取邮箱验证码',
    weak_password: '密码强度不足，请使用更长的密码',
    over_email_send_rate_limit: '邮件发送过于频繁，请稍后再试',
    over_request_rate_limit: '请求过于频繁，请稍后再试',
    otp_expired: '验证码或链接已过期，请重新发送',
    anonymous_provider_disabled: '访客登录尚未启用，请使用邮箱登录',
    provider_disabled: '该登录方式尚未启用',
    captcha_failed: '需要完成账号服务的人机验证',
  }
  return new Error(messages[error?.code] || '账号服务请求失败，请检查网络或稍后重试')
}

function createAccountAuth({ config, directory, safeStorage, openExternal, createClient, notify = () => {} }) {
  let client = null
  let storage = null
  let callbackServer = null
  let callbackTimer = null
  let pending = ''
  let pendingEmail = ''
  let resendAfter = 0
  let recovery = false
  let lastMessage = ''
  let queue = Promise.resolve()
  const serialize = work => {
    const result = queue.then(work)
    queue = result.catch(() => {})
    return result
  }
  function getClient() {
    if (client) return client
    const settings = validateConfig(config)
    if (!settings) throw new Error('账号服务尚未配置，本地功能可直接使用')
    const project = crypto.createHash('sha256').update(settings.url).digest('hex').slice(0, 20)
    storage = createEncryptedStorage({ file: path.join(directory, `account-${project}.enc`), safeStorage })
    client = createClient(settings.url, settings.publishableKey, {
      auth: { storage, storageKey: `harness-${project}`, flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      global: { fetch: (url, options) => fetch(url, { ...options, cache: 'no-store', signal: options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) }) },
    })
    client.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') recovery = true
      if (event === 'SIGNED_OUT') recovery = false
      // Never call an async auth method within this SDK callback (auth lock).
      notify()
    })
    return client
  }
  function closeCallback() {
    clearTimeout(callbackTimer)
    callbackTimer = null
    callbackServer?.close()
    callbackServer = null
    pending = ''
    pendingEmail = ''
    resendAfter = 0
  }
  async function listenForCallback(kind) {
    if (pending) throw new Error('请先完成或取消当前邮箱 / 浏览器验证')
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, CALLBACK_URL)
      if (req.method !== 'GET' || req.headers.host !== '127.0.0.1:18941' || url.pathname !== '/auth/callback') {
        res.writeHead(404).end(); return
      }
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Referrer-Policy', 'no-referrer')
      const code = url.searchParams.get('code')
      if (!code || code.length > 4096) { res.writeHead(400).end('登录链接无效，请返回抓虾重新操作。'); return }
      res.end('已收到验证，请返回抓虾查看结果。')
      const callbackKind = pending
      closeCallback()
      serialize(async () => {
        const { error } = await getClient().auth.exchangeCodeForSession(code)
        if (error) throw authError(error)
        recovery = ['recovery', 'email_change'].includes(callbackKind)
        lastMessage = recovery ? '邮箱已验证，请设置新密码' : '账号验证完成'
      }).catch(() => { lastMessage = '验证未完成，请重新发起登录或邮箱验证' }).finally(notify)
    })
    await new Promise((resolve, reject) => {
      server.once('error', () => reject(new Error('登录回调端口被占用，请关闭其他抓虾登录窗口后重试')))
      server.listen(18941, '127.0.0.1', resolve)
    })
    callbackServer = server
    pending = kind
    callbackTimer = setTimeout(() => { closeCallback(); lastMessage = '验证等待已结束，请重新操作'; notify() }, 10 * 60 * 1000)
    callbackTimer.unref?.()
  }
  async function state() {
    const settings = validateConfig(config)
    if (!settings) return { configured: false, user: null, pending: '', recovery: false }
    const { data, error } = await getClient().auth.getSession()
    if (error) throw authError(error)
    return { configured: true, user: pending === 'signup' || recovery ? null : publicUser(data.session?.user), pending, pendingEmail, resendAfter, recovery, message: lastMessage, providers: config.providers || [] }
  }
  async function perform(action, input = {}) {
    if (action === 'status') return state()
    if (action === 'cancel') { closeCallback(); lastMessage = ''; return state() }
    if (action === 'logout') {
      closeCallback()
      // Local sign-out is always available, including when offline.
      if (client) {
        try { await client.auth.signOut({ scope: 'local' }) } catch {}
        client.auth.stopAutoRefresh()
      }
      storage?.clear()
      client = null
      recovery = false
      lastMessage = ''
      return { configured: Boolean(validateConfig(config)), user: null, pending: '', recovery: false }
    }
    const api = getClient().auth
    if (action === 'resend') {
      if (pending !== 'recovery' || !pendingEmail) throw new Error('请先发起找回密码')
      if (Date.now() < resendAfter) throw new Error('请稍后再发送验证码')
      const result = await api.resetPasswordForEmail(pendingEmail, { redirectTo: CALLBACK_URL })
      if (result.error) throw authError(result.error)
      resendAfter = Date.now() + 60000
      lastMessage = '如该邮箱已注册，验证码将发送至邮箱，请使用最新验证码'
      return state()
    }
    if (pending && action !== 'verify') throw new Error('请先完成或取消当前验证')
    const email = String(input.email || '').trim()
    const password = String(input.password || '')
    if (['login', 'register', 'recovery'].includes(action) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('请输入有效邮箱')
    if (action === 'password' && password.length < 8) throw new Error('密码至少需要 8 位')
    let result
    try {
      if (action === 'login') result = await api.signInWithPassword({ email, password })
      else if (action === 'anonymous') {
        const existing = await api.getSession()
        result = existing.data.session ? existing : await api.signInAnonymously()
      } else if (action === 'register') {
        const current = await api.getSession()
        const anonymous = Boolean(current.data.session?.user?.is_anonymous)
        if (!anonymous && password.length < 8) throw new Error('密码至少需要 8 位')
        await listenForCallback(anonymous ? 'email_change' : 'signup')
        result = anonymous
          ? await api.updateUser({ email }, { emailRedirectTo: CALLBACK_URL })
          : await api.signUp({ email, password, options: { emailRedirectTo: CALLBACK_URL } })
        if (!anonymous && result.data?.session) {
          await api.signOut({ scope: 'local' })
          throw new Error('注册邮箱验证未启用，请联系管理员后重试')
        }
        pendingEmail = email
        lastMessage = anonymous ? '请验证新邮箱以完成绑定' : '验证码已发送，请查收邮箱并输入验证码完成注册'

      } else if (action === 'recovery') {
        await listenForCallback('recovery')
        pendingEmail = email
        result = await api.resetPasswordForEmail(email, { redirectTo: CALLBACK_URL })
        resendAfter = Date.now() + 60000
        lastMessage = '如该邮箱已注册，验证码将发送至邮箱'
      } else if (action === 'verify') {
        if (!['signup', 'email_change', 'recovery'].includes(pending)) throw new Error('请先发送邮箱验证邮件')
        const type = pending
        const token = String(input.code || '').trim()
        if (!/^\d{6,10}$/.test(token)) throw new Error('请输入邮件中的数字验证码')
        result = await api.verifyOtp({ email: pendingEmail || email, token, type })
        if (!result.error) { recovery = ['recovery', 'email_change'].includes(type); closeCallback(); lastMessage = recovery ? '请设置新密码' : '邮箱验证完成' }
      } else if (action === 'password') {
        if (!recovery) throw new Error('请先完成找回密码验证')
        result = await api.updateUser({ password })
        if (!result.error) {
          // Discard the temporary recovery session and require the new password to log in.
          await api.signOut({ scope: 'local' })
          api.stopAutoRefresh()
          storage?.clear()
          client = null
          recovery = false
          lastMessage = '密码已重置，请使用新密码登录'
        }
      } else if (action === 'oauth') {
        const provider = String(input.provider || '')
        if (!(config.providers || []).includes(provider)) throw new Error('该登录方式尚未启用')
        const current = await api.getSession()
        await listenForCallback('oauth')
        const args = { provider, options: { redirectTo: CALLBACK_URL, skipBrowserRedirect: true } }
        result = current.data.session?.user?.is_anonymous ? await api.linkIdentity(args) : await api.signInWithOAuth(args)
        if (!result.error) {
          const target = new URL(result.data.url)
          const projectAuthorize = target.origin === validateConfig(config).url && target.pathname.startsWith('/auth/v1/')
          const linkedGoogle = provider === 'google' && target.origin === 'https://accounts.google.com'
          if ((!projectAuthorize && !linkedGoogle) || target.username || target.password) throw new Error('账号服务返回了无效登录地址')
          await openExternal(target.href)
          lastMessage = '请在系统浏览器中完成登录'
        }
      } else throw new Error('不支持的账号操作')
      if (result?.error) throw authError(result.error)
      return await state()
    } catch (error) {
      if (action !== 'verify') closeCallback()
      throw error
    }
  }
  return {
    // Main-process services share the encrypted session; never expose this over IPC.
    getClient,
    run: (action, input) => serialize(() => perform(action, input)),
    async analyticsSession() {
      if (!validateConfig(config) || pending || recovery) return null
      const { data, error } = await getClient().auth.getSession()
      if (error) throw authError(error)
      return data.session
    },
    dispose() { closeCallback(); client?.auth.stopAutoRefresh() },
  }
}
module.exports = { CALLBACK_URL, validateConfig, createEncryptedStorage, publicUser, createAccountAuth }
