'use strict'
const { Agent, ProxyAgent, fetch: undiciFetch } = require('undici')

function proxyRoute(value) {
  // Honor the first OS/PAC route. Do not silently bypass a failed proxy or
  // replay a possibly accepted paid POST on an alternate route.
  const first = String(value || '').split(';')[0].trim()
  if (first === 'DIRECT') return null
  const match = /^(PROXY|HTTPS)\s+([^\s/]+)$/i.exec(first)
  if (!match) throw new Error('系统代理类型暂不支持，请配置 HTTP/HTTPS 代理后再试')
  const url = new URL(`${match[1].toUpperCase() === 'HTTPS' ? 'https' : 'http'}://${match[2]}`)
  if (url.username || url.password || !/:\d+$/.test(match[2])) throw new Error('系统代理地址无效')
  return url.origin
}

// Chromium resolves OS proxy/PAC settings; Undici sends exactly one request.
// Chromium fetch itself may replay a POST after a socket failure, so it must
// not be used for inference. No RetryAgent, route fallback, or cookie store.
function createManagedFetch(networkSession, { fetcher = undiciFetch, makeDispatcher = route => route ? new ProxyAgent(route) : new Agent() } = {}) {
  const dispatchers = new Map()
  const managedFetch = async (url, options = {}) => {
    const route = proxyRoute(await networkSession.resolveProxy(String(url)))
    if (!dispatchers.has(route)) dispatchers.set(route, makeDispatcher(route))
    return fetcher(url, { ...options, credentials: 'omit', dispatcher: dispatchers.get(route) })
  }
  managedFetch.close = async () => Promise.all([...dispatchers.values()].map(d => d.close()))
  return managedFetch
}
module.exports = { createManagedFetch, proxyRoute }
