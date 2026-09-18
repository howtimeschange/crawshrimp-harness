'use strict'
const fs = require('node:fs/promises')
const { createImageWorker } = require('./pythonImageWorker')
function createThumbnailReader(getPythonBin) {
  const cache = new Map(), pending = new Map()
  const worker = createImageWorker(getPythonBin)
  let queue = Promise.resolve(), cacheBytes = 0
  const read = async function read(imagePath, opts = {}) {
    const stat = await fs.stat(imagePath)
    if (!stat.isFile() || stat.size > 80 * 1024 * 1024) throw new Error('图片不存在或超过 80MB')
    const edge = Math.round(Math.max(64, Math.min(Number(opts.maxEdge || opts.max_edge) || 320, 1280)))
    const quality = Math.round(Math.max(.4, Math.min(Number(opts.quality) || .72, .95)) * 100)
    const key = JSON.stringify([imagePath, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, edge, quality])
    if (cache.has(key)) return cache.get(key)
    if (pending.has(key)) return pending.get(key)
    if (pending.size >= 32) throw new Error('缩略图队列繁忙，请稍后重试')
    const work = queue.then(() => worker({ path: imagePath, edge, quality })).then(result => ({ ...result, path: imagePath })).then(result => {
      cache.set(key, result); cacheBytes += result.data_url.length
      while (cacheBytes > 16 * 1024 * 1024 || cache.size > 128) {
        const first = cache.keys().next().value
        cacheBytes -= cache.get(first).data_url.length; cache.delete(first)
      }
      return result
    }).finally(() => pending.delete(key))
    pending.set(key, work)
    queue = work.catch(() => {})
    return work
  }
  read.dispose = () => worker.dispose()
  return read
}
module.exports = { createThumbnailReader }
