'use strict'
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads')
const fs = require('node:fs/promises')
if (!isMainThread && workerData?.imageDataUrl) {
  ;(async () => {
    const stat = await fs.stat(workerData.path)
    if (!stat.isFile() || stat.size > 80 * 1024 * 1024) throw Error('图片不存在或超过 80MB')
    const raw = await fs.readFile(workerData.path)
    if (raw.length > 80 * 1024 * 1024) throw Error('图片超过 80MB')
    parentPort.postMessage({ ok: true, path: workerData.path, data_url: `data:${workerData.mime};base64,${raw.toString('base64')}` })
  })().catch(error => parentPort.postMessage({ ok: false, error: error.message }))
}
let queue = Promise.resolve(), pending = 0
function readImageDataUrl(path, mime) {
  if (pending >= 8) return Promise.reject(new Error('图片读取队列繁忙，请稍后重试'))
  pending++
  const work = queue.then(() => new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { imageDataUrl: true, path, mime } })
    const timeout = setTimeout(() => { void worker.terminate(); reject(new Error('图片读取超时')) }, 30000)
    worker.once('message', result => { clearTimeout(timeout); result.ok ? resolve(result) : reject(new Error(result.error)) })
    worker.once('error', error => { clearTimeout(timeout); reject(error) })
    worker.once('exit', code => { clearTimeout(timeout); if (code) reject(new Error('图片读取进程退出')) })
  })).finally(() => { pending-- })
  queue = work.catch(() => {})
  return work
}
module.exports = { readImageDataUrl }
