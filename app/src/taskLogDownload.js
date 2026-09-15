'use strict'
const http = require('node:http')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { pipeline } = require('node:stream/promises')
async function downloadTaskLog({ port, token, tokenHeader, urlPath, filePath }) {
  const temporary = `${filePath}.${crypto.randomUUID()}.part`
  try {
    const response = await new Promise((resolve, reject) => {
      const request = http.get({ hostname: '127.0.0.1', port, path: urlPath, headers: { [tokenHeader]: token } }, response => {
        if (response.statusCode !== 200) { response.resume(); reject(new Error(`日志下载失败 (${response.statusCode})`)); return }
        resolve(response)
      })
      request.setTimeout(30000, () => request.destroy(new Error('日志下载超时')))
      request.on('error', reject)
    })
    await pipeline(response, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
    await fs.promises.rename(temporary, filePath)
    return { ok: true }
  } finally { await fs.promises.rm(temporary, { force: true }) }
}
module.exports = { downloadTaskLog }
