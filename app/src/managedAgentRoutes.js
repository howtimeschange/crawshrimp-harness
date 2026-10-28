'use strict'

async function boundedResponse(response, limit) {
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader(), chunks = []; let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return Buffer.concat(chunks)
      size += value.byteLength
      if (size > limit) { await reader.cancel(); throw new Error('账号服务响应过大') }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
}

module.exports = { boundedResponse }
