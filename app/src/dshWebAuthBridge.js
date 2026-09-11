'use strict'

const http = require('node:http')

function parseLaunchUrl(value) {
  let url
  try { url = new URL(value) } catch {}
  if (!url || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      !url.port || url.username || url.password || url.pathname !== '/' ||
      url.searchParams.getAll('token').length !== 1 || !url.searchParams.get('token')) {
    throw new Error('智能体页面认证地址无效')
  }
  return url
}

// Use Node HTTP, not Electron's cookie jar: Strict cookies cannot authenticate a
// loopback iframe below the packaged file:// renderer. Never follow redirects.
function exchangeLaunchCookie(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      res.resume()
      const cookies = res.headers['set-cookie'] || []
      const cookie = cookies.find(value => /^dsh-auth-[\w-]+=[\w.-]+;/.test(value))
      const maxAge = Number(/(?:^|;)\s*Max-Age=(\d+)/i.exec(cookie || '')?.[1])
      if (res.statusCode !== 303 || res.headers.location !== '/' || !cookie || !maxAge) {
        reject(new Error('智能体页面认证失败，请重新连接智能体'))
        return
      }
      resolve({ cookie: cookie.split(';', 1)[0], expiresAt: Date.now() + maxAge * 1000 })
    })
    req.setTimeout(10000, () => req.destroy(new Error('智能体页面认证超时')))
    // Do not propagate errors that could contain the token-bearing URL.
    req.on('error', () => reject(new Error('无法连接智能体页面认证服务')))
  })
}

function requestOrigin(value) {
  try {
    const url = new URL(value)
    if (url.protocol === 'ws:') url.protocol = 'http:'
    return url.origin
  } catch { return '' }
}

function isTrustedRequest(details, webContents, origin, isTrustedRendererUrl) {
  if (!webContents || webContents.isDestroyed() || details.webContentsId !== webContents.id ||
      requestOrigin(details.url) !== origin || details.resourceType === 'mainFrame') return false
  try {
    let frame = details.frame
    // A new iframe initially has an empty/about:blank URL. Only allow its first
    // navigation when its direct parent is our shell or an authenticated DSH frame.
    if (details.resourceType === 'subFrame') frame = frame?.parent
    if (!frame) return false
    while (frame.parent) {
      if (requestOrigin(frame.url) !== origin) return false
      frame = frame.parent
    }
    return frame === webContents.mainFrame && isTrustedRendererUrl(frame.url)
  } catch { return false }
}

function createDshWebAuthBridge({ session, getWebContents, isTrustedRendererUrl, exchange = exchangeLaunchCookie }) {
  let current = null
  let pending = null
  let revision = 0
  let disposed = false
  const listener = (details, callback) => {
    if (!current || current.expiresAt <= Date.now() ||
        !isTrustedRequest(details, getWebContents(), current.origin, isTrustedRendererUrl)) {
      callback({})
      return
    }
    const headers = { ...details.requestHeaders }
    const name = current.cookie.split('=', 1)[0]
    const cookies = []
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() !== 'cookie') continue
      cookies.push(...headers[key].split(';').map(value => value.trim()).filter(value => value && value.split('=', 1)[0] !== name))
      delete headers[key]
    }
    headers.Cookie = [...cookies, current.cookie].join('; ')
    callback({ requestHeaders: headers })
  }
  session.webRequest.onBeforeSendHeaders({ urls: ['http://127.0.0.1/*', 'ws://127.0.0.1/*'] }, listener)

  return {
    async exportSessionLog(sessionId, destination) {
      if (!current || disposed || current.expiresAt <= Date.now()) throw new Error('智能体认证已过期，请重新连接后导出')
      if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 200) throw new Error('会话标识无效')
      const { createWriteStream } = require('node:fs')
      const { rename, rm, stat } = require('node:fs/promises')
      const { pipeline } = require('node:stream/promises')
      const temporary = `${destination}.${require('node:crypto').randomUUID()}.tmp`
      const url = new URL('/api/session.export', current.origin)
      url.searchParams.set('sessionId', sessionId)
      url.searchParams.set('includeDescendants', 'true')
      try {
        const response = await new Promise((resolve, reject) => {
          const request = http.get(url, { headers: { Cookie: current.cookie } }, resolve)
          request.setTimeout(120000, () => request.destroy(new Error('会话日志导出超时')))
          request.on('error', () => reject(new Error('无法连接会话日志服务')))
        })
        if (response.statusCode !== 200) {
          response.resume()
          throw new Error(`会话日志导出失败：HTTP ${response.statusCode}`)
        }
        await pipeline(response, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
        const info = await stat(temporary)
        if (!info.size) throw new Error('会话日志为空，未保存')
        await rename(temporary, destination)
        return { ok: true, dest: destination, size: info.size }
      } finally { await rm(temporary, { force: true }).catch(() => {}) }
    },
    async prepare(snapshot) {
      if (disposed) throw new Error('智能体窗口已关闭')
      const value = snapshot?.state === 'ready' ? snapshot.web_launch_url : ''
      if (!value) {
        revision++
        current = pending = null
        return snapshot
      }
      const url = parseLaunchUrl(value)
      if (!current || current.launchUrl !== value || current.expiresAt - Date.now() < 60000) {
        if (!pending || pending.launchUrl !== value) {
          const attempt = ++revision
          current = null
          const promise = exchange(url).then(auth => {
            if (attempt !== revision || disposed) throw new Error('智能体服务已切换，请重试')
            current = { ...auth, launchUrl: value, origin: url.origin }
          }).finally(() => { if (pending?.promise === promise) pending = null })
          pending = { launchUrl: value, promise }
        }
        await pending.promise
      }
      // The renderer only needs a clean URL. Keep the browser credential and
      // launch token in the trusted main process, scoped to this runtime/window.
      return { ...snapshot, web_launch_url: url.origin + '/' }
    },
    dispose() {
      disposed = true
      revision++
      current = pending = null
      session.webRequest.onBeforeSendHeaders(null)
    },
  }
}

module.exports = { createDshWebAuthBridge, exchangeLaunchCookie }
