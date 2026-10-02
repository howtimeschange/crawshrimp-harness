'use strict'

/**
 * Agent 实时浏览器视图与手动输入(CDP screencast)。
 *
 * 连接抓虾托管 Chrome 的 CDP 端点，由合成器持续推送画面，
 * 不支持 screencast 的浏览器才回退到定时 Page.captureScreenshot，
 * 以 JPEG dataURL 推送给渲染端(agent:browser:frame),供智能体页右侧
 * 浏览器面板实时展示网页自动化过程。
 *
 * 设计约束:
 * - 每个 target 独立串行启动，不同页面可并行建立流;
 * - 渲染端消失/销毁时自动停止;
 * - 9222 无 Chrome 或断连时通过 agent:browser:status 上报状态,不抛进程异常;
 * - 帧发送失败(webContents 已销毁)时静默降级,不中断 CDP 连接。
 */

const http = require('node:http')
const { resolveCdpPort } = require('./cdpPort')
const { createBrowserInputSession } = require('./browserInput')

const CDP_PORT = resolveCdpPort()
const CDP_HTTP_TIMEOUT_MS = 3000
const CDP_WS_TIMEOUT_MS = 5000
const CDP_COMMAND_TIMEOUT_MS = 5000
const FRAME_INTERVAL_MS = 800
const SCREENSHOT_QUALITY = 55
const STREAM_QUALITY = 75

/** @type {Map<string, { ws: WebSocket, timer: NodeJS.Timeout | null, targetUrl: string, targetId: string, send: (method: string, params?: object) => Promise<any> }>} */
const streams = new Map()
const startingByTarget = new Map()
const startingSockets = new Map()

function fetchJson(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: CDP_HTTP_TIMEOUT_MS }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (error) { reject(new Error('CDP 响应不是有效 JSON')) }
      })
    })
    req.on('timeout', () => req.destroy(new Error(`${CDP_PORT} CDP HTTP 超时`)))
    req.on('error', reject)
  })
}

async function pickPageTarget(targetId) {
  let targets
  try {
    targets = await fetchJson(CDP_PORT, '/json')
  } catch (error) {
    throw new Error(`无法连接 ${CDP_PORT} CDP 浏览器,请先启动 Chrome`)
  }
  const pages = (Array.isArray(targets) ? targets : []).filter(
    (t) => t && t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string' && t.webSocketDebuggerUrl
  )
  if (!pages.length) throw new Error(`${CDP_PORT} CDP 上没有可用的页面标签`)
  if (targetId) {
    const found = pages.find((p) => String(p.id) === String(targetId))
    if (found) return found
    throw new Error(`绑定的浏览器页面已关闭: ${targetId}`)
  }
  return pages[0]
}

function notify(webContents, state, extra = {}) {
  if (webContents && !webContents.isDestroyed()) {
    webContents.send('agent:browser:status', { state, ...extra })
  }
}

const canceledStarts = new Set()
function closeStream(st) {
  if (st.timer) clearInterval(st.timer)
  const close = () => { try { st.ws.close() } catch {} }
  if (st.input) st.input.dispose().finally(close)
  else close()
}

function publishScreencastFrame(st, webContents, params) {
  // Acknowledge every received frame, including a late frame from a stopped stream.
  st.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {})
  if (streams.get(st.targetId) !== st || webContents.isDestroyed()) return
  const meta = params.metadata || {}
  const scale = Number(meta.pageScaleFactor) || 1
  const width = Math.round(Number(meta.deviceWidth) / scale) || st.width
  const height = Math.round((Number(meta.deviceHeight) - Number(meta.offsetTop || 0)) / scale) || st.height
  st.width = width; st.height = height
  st.liveFrames = (st.liveFrames || 0) + 1
  st.captureFailures = 0
  try {
    webContents.send('agent:browser:frame', { targetId: st.targetId, dataUrl: `data:image/jpeg;base64,${params.data}`, url: st.targetUrl, width, height, ts: Date.now() })
  } catch { /* Renderer may disappear between the ownership check and send. */ }
}

function updateStreamUrl(st, url) {
  if (typeof url !== 'string' || url === st.targetUrl || streams.get(st.targetId) !== st) return
  st.targetUrl = url
  // Route changes can occur without a compositor frame. Publish only metadata,
  // leaving the consumer's connection/error state and visible image intact.
  try {
    if (!st.webContents.isDestroyed()) st.webContents.send('agent:browser:status', { targetId: st.targetId, url, metadataOnly: true })
  } catch { /* Renderer may disappear between the ownership check and send. */ }
}

function dispatchAgentBrowserInput(webContents, payload) {
  // No implicit current/first-page fallback: manual input must target its visible stream.
  const st = payload?.targetId && streams.get(String(payload.targetId))
  if (!st || st.webContents !== webContents || webContents?.isDestroyed() || st.ws.readyState !== WebSocket.OPEN) return Promise.resolve({ ok: false, error: '浏览器画面未连接，请重新打开' })
  return st.input.dispatch(payload.event)
}

async function showAgentBrowserNative(webContents, targetId) {
  const st = targetId && streams.get(String(targetId))
  if (!st || st.webContents !== webContents || webContents?.isDestroyed() || st.ws.readyState !== WebSocket.OPEN) return { ok: false, error: '浏览器页面已关闭，请重新打开' }
  try {
    const window = await st.send('Browser.getWindowForTarget', { targetId: st.targetId })
    if (window.bounds?.windowState === 'minimized') await st.send('Browser.setWindowBounds', { windowId: window.windowId, bounds: { windowState: 'normal' } })
    await st.send('Page.bringToFront')
    return { ok: true, windowId: window.windowId, targetId: st.targetId, url: st.targetUrl }
  } catch (error) { return { ok: false, error: `打开浏览器窗口失败：${error.message || error}` } }
}

function stopAgentBrowserStream(targetId) {
  if (targetId) {
    const startKey = String(targetId)
    if (startingByTarget.has(startKey)) canceledStarts.add(startKey)
    const startingSocket = startingSockets.get(startKey)
    if (startingSocket) {
      startingSockets.delete(startKey)
      try { startingSocket.close() } catch {}
    }
    const stopped = streams.get(String(targetId))
    if (!stopped) return { ok: true, stopped: Boolean(startingSocket) }
    streams.delete(String(targetId))
    closeStream(stopped)
    return { ok: true, stopped: true, targetId: String(targetId) }
  }
  for (const key of startingByTarget.keys()) canceledStarts.add(key)
  for (const [, socket] of startingSockets) {
    try { socket.close() } catch {}
  }
  startingSockets.clear()
  let count = 0
  for (const [, st] of streams) {
    closeStream(st)
    count += 1
  }
  streams.clear()
  return { ok: true, stopped: count > 0, count }
}

function getAgentBrowserState() {
  const list = []
  for (const [, st] of streams) {
    list.push({ targetId: st.targetId, url: st.targetUrl, active: true })
  }
  return { active: list.length > 0, streams: list }
}

function listAgentBrowserTabs() {
  return fetchJson(CDP_PORT, '/json').then((targets) => {
    const pages = (Array.isArray(targets) ? targets : []).filter(
      (t) => t && t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string' && t.webSocketDebuggerUrl
    )
    return { ok: true, tabs: pages.map((p) => ({ id: p.id, url: p.url || '', title: p.title || '' })) }
  }).catch((error) => ({ ok: false, error: String(error.message || error) }))
}

function startAgentBrowserStream(webContents, targetId) {
  const tid = targetId ? String(targetId) : ''
  const startKey = tid || '__current__'
  if (streams.has(tid)) {
    const st = streams.get(tid)
    return Promise.resolve({ ok: true, resumed: true, url: st.targetUrl, targetId: tid })
  }
  if (startingByTarget.has(startKey)) return startingByTarget.get(startKey)
  const pending = doStartAgentBrowserStream(webContents, tid, startKey)
    .catch((error) => {
      const message = String(error?.message || error)
      notify(webContents, 'error', { message, targetId: tid })
      return { ok: false, error: message, targetId: tid }
    })
    .finally(() => {
      canceledStarts.delete(startKey)
      startingByTarget.delete(startKey)
      startingSockets.delete(startKey)
    })
  startingByTarget.set(startKey, pending)
  return pending
}

async function doStartAgentBrowserStream(webContents, tid, startKey) {
  if (!webContents || webContents.isDestroyed()) return { ok: false, error: '渲染端不可用' }

  let target
  try {
    target = await pickPageTarget(tid)
  } catch (error) {
    notify(webContents, 'error', { message: String(error.message || error), targetId: tid })
    return { ok: false, error: String(error.message || error) }
  }
  if (canceledStarts.has(startKey)) return { ok: false, canceled: true }
  const actualTid = String(target.id || tid || 'tab')
  if (streams.has(actualTid)) {
    const existing = streams.get(actualTid)
    return { ok: true, resumed: true, url: existing.targetUrl, targetId: actualTid }
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  startingSockets.set(startKey, ws)
  const nextIdRef = { value: 1 }
  const pending = new Map()
  // 局部流引用:本 target 的流
  let st = null

  ws.onmessage = (event) => {
    let msg
    try { msg = JSON.parse(String(event.data)) } catch { return }
    if (msg && msg.id && pending.has(msg.id)) {
      const { resolve, reject, timer } = pending.get(msg.id)
      pending.delete(msg.id)
      clearTimeout(timer)
      if (msg.error) reject(new Error(msg.error.message || 'CDP 命令失败'))
      else resolve(msg.result)
    } else if (msg && msg.method === 'Page.screencastFrame' && st) {
      publishScreencastFrame(st, webContents, msg.params || {})
    } else if (msg && msg.method === 'Page.frameNavigated') {
      // 实时跟进页面导航:只取主 frame(parentId 为空)的 URL,窗口地址栏即时刷新
      const frame = msg.params?.frame
      const url = frame?.url
      if (url && !frame.parentId && st) {
        st.mainFrameId = frame.id
        updateStreamUrl(st, url)
      }
    } else if (msg && msg.method === 'Page.navigatedWithinDocument' && st && msg.params?.frameId === st.mainFrameId) {
      updateStreamUrl(st, msg.params.url)
    }
  }
  const ownsStream = () => st ? streams.get(actualTid) === st : startingSockets.get(startKey) === ws
  ws.onerror = () => { if (ownsStream()) notify(webContents, 'error', { message: 'CDP websocket 错误', targetId: actualTid }) }
  ws.onclose = () => {
    const owned = ownsStream()
    for (const [, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error('CDP websocket 已断开'))
    }
    pending.clear()
    if (st && streams.get(actualTid) === st) {
      if (st.timer) clearInterval(st.timer)
      streams.delete(actualTid)
    }
    if (owned) notify(webContents, 'disconnected', { targetId: actualTid })
  }

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextIdRef.value++
    const timer = setTimeout(() => {
      if (!pending.has(id)) return
      pending.delete(id)
      reject(new Error(`CDP 命令超时: ${method}`))
    }, CDP_COMMAND_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    try {
      ws.send(JSON.stringify({ id, method, params }))
    } catch (error) {
      clearTimeout(timer)
      pending.delete(id)
      reject(error)
    }
  })

  try {
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        ws.removeEventListener('open', onOpen)
        ws.removeEventListener('error', onError)
        ws.removeEventListener('close', onClose)
      }
      const onOpen = () => { cleanup(); resolve() }
      const onError = () => { cleanup(); reject(new Error('CDP websocket 连接失败')) }
      const onClose = () => { cleanup(); reject(new Error('CDP websocket 在连接完成前关闭')) }
      const timer = setTimeout(() => { cleanup(); reject(new Error('CDP websocket 连接超时')) }, CDP_WS_TIMEOUT_MS)
      ws.addEventListener('open', onOpen, { once: true })
      ws.addEventListener('error', onError, { once: true })
      ws.addEventListener('close', onClose, { once: true })
    })
  } catch (error) {
    try { ws.close() } catch {}
    throw error
  }
  ws.onerror = () => { if (ownsStream()) notify(webContents, 'error', { message: 'CDP websocket 错误', targetId: actualTid }) }

  try {
    await send('Page.enable')
  } catch (error) {
    try { ws.close() } catch {}
    throw error
  }

  let viewport = { width: 0, height: 0 }
  try {
    const metrics = await send('Page.getLayoutMetrics')
    const visual = metrics?.cssVisualViewport || metrics?.visualViewport || {}
    viewport = { width: Math.round(Number(visual.clientWidth || 0)), height: Math.round(Number(visual.clientHeight || 0)) }
  } catch { /* 首帧仍可继续 */ }

  st = { ws, webContents, timer: null, targetUrl: target.url || '', targetId: actualTid,
    send, frameCount: 0, capturing: false, ...viewport }
  streams.set(actualTid, st)
  try { st.mainFrameId = (await send('Page.getFrameTree'))?.frameTree?.frame?.id } catch { /* URL polling remains available. */ }
  st.input = createBrowserInputSession(send, () => streams.get(actualTid) === st && !webContents.isDestroyed() && ws.readyState === WebSocket.OPEN, () => st)
  // 在 stream 正式登记前始终保留 starting socket。这样用户恰好在
  // websocket open 与 Page.enable 之间关闭窗口时，stop 仍能取消启动。
  startingSockets.delete(startKey)
  try {
    await send('Page.startScreencast', { format: 'jpeg', quality: STREAM_QUALITY, maxWidth: 1920, maxHeight: 1440, everyNthFrame: 1 })
    st.screencastStarted = true
  } catch { st.screencastStarted = false }
  if (streams.get(actualTid) !== st) return { ok: false, canceled: true, targetId: actualTid }
  st.timer = setInterval(async () => {
    if (st !== streams.get(actualTid)) return
    if (st.ws.readyState !== WebSocket.OPEN) return
    if (st.capturing) return
    if (webContents?.isDestroyed()) return
    st.capturing = true
    try {
      const layout = await send('Page.getLayoutMetrics')
      const view = layout?.cssVisualViewport || layout?.visualViewport || {}
      if (st.screencastStarted) {
        // Keep the dimensions carried by the visible frame. Layout metrics can
        // exclude scrollbar gutters that are present in the screencast image.
        const loc = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true, awaitPromise: false })
        updateStreamUrl(st, loc?.result?.value)
        return
      }
      st.width = Math.round(Number(view.clientWidth || st.width || 0))
      st.height = Math.round(Number(view.clientHeight || st.height || 0))
      const shot = await send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: SCREENSHOT_QUALITY,
        fromSurface: true,
        ...(st.width > 0 && st.height > 0 ? { clip: { x: Number(view.pageX || 0), y: Number(view.pageY || 0), width: st.width, height: st.height, scale: Math.min(1, 1440 / Math.max(st.width, st.height)) }, captureBeyondViewport: false } : {}),
      })
      // SPA 内部路由(hash/history)不触发 frameNavigated,定期回读 location.href 兜底
      st.frameCount = (st.frameCount || 0) + 1
      if (st.frameCount % 5 === 0) {
        try {
          const loc = await send('Runtime.evaluate', {
            expression: 'location.href',
            returnByValue: true,
            awaitPromise: false,
          })
          const href = loc?.result?.value
          updateStreamUrl(st, href)
        } catch { /* 忽略单次 URL 回读失败 */ }
        try {
          const metrics = await send('Page.getLayoutMetrics')
          const visual = metrics?.cssVisualViewport || metrics?.visualViewport || {}
          st.width = Math.round(Number(visual.clientWidth || st.width || 0))
          st.height = Math.round(Number(visual.clientHeight || st.height || 0))
        } catch { /* 忽略单次尺寸回读失败 */ }
      }
      if (streams.get(actualTid) === st && webContents && !webContents.isDestroyed()) {
        if (st.captureFailures >= 3) notify(webContents, 'connected', { url: st.targetUrl, targetId: actualTid })
        st.captureFailures = 0
        webContents.send('agent:browser:frame', {
          targetId: actualTid,
          dataUrl: `data:image/jpeg;base64,${shot.data}`,
          url: st.targetUrl || target.url || '',
          width: st.width || 0,
          height: st.height || 0,
          ts: Date.now(),
        })
      }
    } catch (error) {
      if (streams.get(actualTid) !== st || !webContents || webContents.isDestroyed()) return
      st.captureFailures = (st.captureFailures || 0) + 1
      if (st.captureFailures === 3) notify(webContents, 'error', { message: `画面暂未更新：${error?.message || '截图失败'}`, targetId: actualTid })
    } finally {
      st.capturing = false
    }
  }, FRAME_INTERVAL_MS)

  notify(webContents, 'connected', { url: target.url || '', targetId: actualTid })
  return { ok: true, resumed: false, url: target.url || '', targetId: actualTid }
}

module.exports = {
  startAgentBrowserStream,
  stopAgentBrowserStream,
  getAgentBrowserState,
  listAgentBrowserTabs,
  dispatchAgentBrowserInput,
  showAgentBrowserNative,
}
