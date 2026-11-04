'use strict'
const { Transform } = require('node:stream')

// Observe framing only. Never retain model output or buffer the response. A
// clean HTTP EOF alone does not prove a paid SSE response completed.
function managedInferenceStream(contentType, pathname) {
  if (!['/v1/chat/completions', '/v1/responses'].includes(pathname) || contentType.split(';')[0].trim().toLowerCase() !== 'text/event-stream') return null
  const decoder = new TextDecoder()
  let line = '', oversized = false, data = '', frameOversized = false, complete = false
  function endLine() {
    const value = line.replace(/\r$/, '')
    if (!oversized && value === '') {
      if (!frameOversized) {
        if (pathname.endsWith('/chat/completions') && data.trim() === '[DONE]') complete = true
        if (pathname.endsWith('/responses')) {
          try { const event = JSON.parse(data); if (event.type === 'response.completed' && event.response?.status === 'completed' && typeof event.response.id === 'string' && event.response.id) complete = true } catch {}
        }
      }
      data = ''; frameOversized = false
    } else if (oversized) { frameOversized = true; data = '' }
    else if (value.startsWith('data:') && !frameOversized) {
      if (data.length + value.length <= 65536) data += value.slice(5).replace(/^ /, '') + '\n'
      else { data = ''; frameOversized = true }
    }
    line = ''; oversized = false
  }
  function consume(text) {
    for (const char of text) {
      if (char === '\n') endLine()
      else if (!oversized) {
        if (line.length < 65536) line += char
        else { line = ''; oversized = true }
      }
    }
  }
  return new Transform({
    transform(chunk, encoding, callback) { consume(decoder.decode(chunk, { stream: true })); callback(null, chunk) },
    flush(callback) {
      consume(decoder.decode())
      callback(complete ? null : new Error('Managed stream ended without completion marker; outcome unknown'))
    },
  })
}
module.exports = { managedInferenceStream }
