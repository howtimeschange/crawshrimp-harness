'use strict'

// Only these input commands can cross the renderer bridge. Never accept a CDP method.
function inputCommand(event, viewport) {
  if (!event || typeof event !== 'object') throw new Error('无效的浏览器输入')
  const modifiers = Number(event.modifiers || 0)
  if (!Number.isInteger(modifiers) || modifiers < 0 || modifiers > 15) throw new Error('无效的修饰键')
  if (event.kind === 'mouse' || event.kind === 'wheel') {
    const { x, y } = event
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= viewport.width || y >= viewport.height) throw new Error('输入坐标超出页面')
    const button = event.button || 'none'
    if (!['none', 'left', 'middle', 'right'].includes(button)) throw new Error('无效的鼠标按钮')
    const buttons = Number(event.buttons || 0)
    if (!Number.isInteger(buttons) || buttons < 0 || buttons > 7) throw new Error('无效的鼠标状态')
    const params = { x, y, modifiers, button, buttons }
    if (event.kind === 'wheel') {
      if (![event.deltaX, event.deltaY].every(n => Number.isFinite(n) && Math.abs(n) <= 10000)) throw new Error('无效的滚动距离')
      return ['Input.dispatchMouseEvent', { ...params, type: 'mouseWheel', deltaX: event.deltaX, deltaY: event.deltaY }]
    }
    if (!['mouseMoved', 'mousePressed', 'mouseReleased'].includes(event.type)) throw new Error('无效的鼠标事件')
    const clickCount = Number(event.clickCount || 0)
    if (!Number.isInteger(clickCount) || clickCount < 0 || clickCount > 3) throw new Error('无效的点击次数')
    return ['Input.dispatchMouseEvent', { ...params, type: event.type, clickCount }]
  }
  if (event.kind === 'text') {
    if (typeof event.text !== 'string' || !event.text || event.text.length > 65536) throw new Error('无效的输入文本')
    return ['Input.insertText', { text: event.text }]
  }
  if (event.kind === 'key') {
    if (!['rawKeyDown', 'keyUp'].includes(event.type) || typeof event.key !== 'string' || event.key.length > 64 || typeof event.code !== 'string' || event.code.length > 64) throw new Error('无效的键盘事件')
    const keyCode = Number(event.keyCode || 0)
    if (!Number.isInteger(keyCode) || keyCode < 0 || keyCode > 255) throw new Error('无效的键码')
    const commands = event.command ? [event.command] : []
    if (commands.some(c => !['selectAll', 'copy', 'cut'].includes(c))) throw new Error('无效的编辑命令')
    const enter = event.type === 'rawKeyDown' && event.key === 'Enter'
    return ['Input.dispatchKeyEvent', { type: enter ? 'keyDown' : event.type, key: event.key, code: event.code, windowsVirtualKeyCode: keyCode, modifiers, autoRepeat: !!event.repeat, ...(enter ? { text: '\r', unmodifiedText: '\r' } : {}), ...(commands.length ? { commands } : {}) }]
  }
  throw new Error('不支持的浏览器输入')
}

function createBrowserInputSession(send, isActive, viewport) {
  let queue = Promise.resolve(), pending = 0, disposed = false
  const keys = new Map(), buttons = new Map()
  async function release() {
    await Promise.allSettled([
      ...[...buttons.values()].map(p => send('Input.dispatchMouseEvent', { ...p, type: 'mouseReleased', buttons: 0, modifiers: 0 })),
      ...[...keys.values()].map(p => send('Input.dispatchKeyEvent', { ...p, type: 'keyUp', modifiers: 0, commands: [] })),
    ])
    buttons.clear(); keys.clear()
  }
  return {
    dispatch(event) {
      let command
      try { command = event?.kind === 'release' ? null : inputCommand(event, viewport()) } catch (error) { return Promise.resolve({ ok: false, error: error.message }) }
      if (disposed || !isActive()) return Promise.resolve({ ok: false, error: '浏览器画面已关闭，请重新打开' })
      if (pending >= 64) return Promise.resolve({ ok: false, error: '浏览器输入繁忙，请稍后操作' })
      pending++
      const result = queue.then(async () => {
        if (disposed || !isActive()) return { ok: false, error: '浏览器画面已关闭，请重新打开' }
        if (!command) { await release(); return { ok: true } }
        const [method, params] = command
        // Track before sending: a timeout does not prove the command was not applied.
        if (params.type === 'mousePressed') buttons.set(params.button, params)
        if (params.type === 'rawKeyDown' || params.type === 'keyDown') keys.set(params.code, params)
        if (params.type === 'mouseMoved') for (const [button, p] of buttons) buttons.set(button, { ...p, x: params.x, y: params.y })
        try {
          await send(method, params)
          if (params.type === 'mouseReleased') buttons.delete(params.button)
          if (params.type === 'keyUp') keys.delete(params.code)
          return { ok: true }
        } catch (error) { return { ok: false, error: `浏览器输入未确认：${error.message || error}` } }
      }).finally(() => { pending-- })
      queue = result.catch(() => {})
      return result
    },
    async dispose() {
      disposed = true
      await queue
      await release()
    },
  }
}

module.exports = { inputCommand, createBrowserInputSession }
