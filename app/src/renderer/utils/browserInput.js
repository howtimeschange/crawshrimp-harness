export function browserPoint(event, image, frame, clamp = false) {
  if (!image || !frame?.width || !frame?.height) return null
  const rect = image.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  let x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height
  if (!clamp && (x < 0 || y < 0 || x >= 1 || y >= 1)) return null
  x = Math.max(0, Math.min(1 - 1 / frame.width, x))
  y = Math.max(0, Math.min(1 - 1 / frame.height, y))
  return { x: x * frame.width, y: y * frame.height }
}

export const browserModifiers = e => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0)
export const browserButton = n => ['left', 'middle', 'right'][n] || 'none'
export function browserWheel(event, height) {
  const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1
  return { deltaX: Math.max(-10000, Math.min(10000, event.deltaX * factor)), deltaY: Math.max(-10000, Math.min(10000, event.deltaY * factor)) }
}

// Coalesce only adjacent motion/scroll events; press, release and typing retain order.
export function createBrowserInputQueue(send, onError) {
  let running = false, disposed = false
  const events = []
  async function drain() {
    if (running) return
    running = true
    while (events.length) {
      const event = events.shift()
      try {
        const result = await send(event)
        if (result?.ok === false) { events.length = 0; onError(result.error); break }
      } catch (error) { events.length = 0; onError(error.message || String(error)); break }
    }
    running = false
  }
  return {
    push(event) {
      if (disposed) return
      const last = events.at(-1)
      if (last && event.kind === 'mouse' && event.type === 'mouseMoved' && last.type === 'mouseMoved') events[events.length - 1] = event
      else if (last && event.kind === 'wheel' && last.kind === 'wheel') events[events.length - 1] = { ...event, deltaX: Math.max(-10000, Math.min(10000, last.deltaX + event.deltaX)), deltaY: Math.max(-10000, Math.min(10000, last.deltaY + event.deltaY)) }
      else if (events.length < 64) events.push(event)
      else { events.length = 0; onError('浏览器输入繁忙，请稍后操作'); return }
      drain()
    },
    clear() { events.length = 0 },
    dispose() { disposed = true; events.length = 0 },
  }
}
