'use strict'
const { execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const SCRIPT = String.raw`
import sys,json,io,base64,warnings
from PIL import Image,ImageOps
warnings.simplefilter('error', Image.DecompressionBombWarning)
Image.MAX_IMAGE_PIXELS=40000000
with Image.open(sys.argv[1]) as image:
    edge=int(sys.argv[2])
    image.draft('RGB',(edge,edge))
    image.thumbnail((edge,edge))
    image=ImageOps.exif_transpose(image).convert('RGB')
    out=io.BytesIO()
    image.save(out,format='JPEG',quality=int(sys.argv[3]))
    raw=out.getvalue()
    print(json.dumps(dict(ok=True,data_url='data:image/jpeg;base64,'+base64.b64encode(raw).decode(),width=image.width,height=image.height,bytes=len(raw),thumbnail=True)))
`
function createThumbnailReader(getPythonBin) {
  const cache = new Map(), pending = new Map()
  let queue = Promise.resolve(), cacheBytes = 0
  return async function read(imagePath, opts = {}) {
    const stat = await fs.stat(imagePath)
    if (!stat.isFile() || stat.size > 80 * 1024 * 1024) throw new Error('图片不存在或超过 80MB')
    const edge = Math.round(Math.max(64, Math.min(Number(opts.maxEdge || opts.max_edge) || 320, 1280)))
    const quality = Math.round(Math.max(.4, Math.min(Number(opts.quality) || .72, .95)) * 100)
    const key = JSON.stringify([imagePath, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, edge, quality])
    if (cache.has(key)) return cache.get(key)
    if (pending.has(key)) return pending.get(key)
    if (pending.size >= 32) throw new Error('缩略图队列繁忙，请稍后重试')
    const work = queue.then(() => new Promise((resolve, reject) => {
      execFile(getPythonBin(), ['-c', SCRIPT, imagePath, String(edge), String(quality)], { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
        if (error) return reject(new Error('无法生成缩略图：图片过大、损坏或图像组件不可用'))
        try { resolve({ ...JSON.parse(stdout), path: imagePath }) } catch (error) { reject(error) }
      })
    })).then(result => {
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
}
module.exports = { createThumbnailReader }
