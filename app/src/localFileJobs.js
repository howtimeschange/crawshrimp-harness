'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const PDF_SCRIPT = String.raw`
import sys,json,math
from pathlib import Path
import pymupdf as fitz
source,out,page=sys.argv[1],Path(sys.argv[2]),int(sys.argv[3])
out.parent.mkdir(parents=True,exist_ok=True)
with fitz.open(source) as doc:
    if not 1 <= page <= doc.page_count: raise ValueError('PDF page out of range')
    p=doc.load_page(page-1)
    w,h=max(p.rect.width,1),max(p.rect.height,1)
    scale=min(3,1800/max(w,h),math.sqrt(3000000/(w*h)))
    meta=out.with_suffix('.meta.json')
    try: cached=json.loads(meta.read_text())
    except (OSError,ValueError): cached={}
    if not out.exists() or cached.get('engine') != fitz.VersionBind:
        pix=p.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False)
        temp=out.with_suffix('.tmp.png');pix.save(str(temp));temp.replace(out)
        meta.write_text(json.dumps(dict(engine=fitz.VersionBind)))
    print(json.dumps(dict(page_count=doc.page_count,page=page,width=round(w*scale),height=round(h*scale))))
`
function runFile(bin, args, options = {}) {
  return new Promise((resolve, reject) => execFile(bin, args, {
    windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024, ...options,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, PYTHONIOENCODING: 'utf-8' },
  }, (error, stdout) => error ? reject(error) : resolve(stdout)))
}
async function listDirectoryFilesSnapshot(rawRoot, opts = {}) {
  const checkCanceled = () => { if (opts.signal?.aborted) throw new Error('文件扫描已取消') }
  checkCanceled()
  if (!String(rawRoot || '').trim()) throw new Error('目录路径不能为空')
  const root = await fs.realpath(path.resolve(String(rawRoot)))
  if (!(await fs.stat(root)).isDirectory()) throw new Error('不是有效目录')
  const extensions = new Set((Array.isArray(opts.extensions) ? opts.extensions : []).map(x => String(x).toLowerCase().replace(/^\./, '')))
  const maxFiles = Math.max(1, Math.min(Number(opts.max_files || opts.maxFiles) || 5000, 20000))
  const maxVisited = Math.max(1, Math.min(Number(opts.maxVisited) || 100000, 100000))
  const deadline = performance.now() + Math.max(1, Math.min(Number(opts.timeoutMs) || 10000, 30000))
  let visited = 0, reason = '', unreadable = 0
  const paths = []
  async function walk(dir, depth) {
    checkCanceled()
    if (depth > 32) { reason ||= 'depth'; return }
    let iterator
    try { iterator = await fs.opendir(dir) } catch { unreadable++; return }
    for await (const entry of iterator) {
      if (opts.signal?.aborted) throw new Error('文件扫描已取消')
      if (visited >= maxVisited || performance.now() > deadline) { reason = 'scan_budget'; break }
      visited++
      if (paths.length >= maxFiles) { reason = 'max_files'; break }
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(fullPath, depth + 1)
      else if (entry.isFile() && (!extensions.size || extensions.has(path.extname(entry.name).slice(1).toLowerCase()))) {
        try {
          const stat = await fs.stat(fullPath)
          paths.push({ path: fullPath, relativePath: path.relative(root, fullPath).replace(/\\/g, '/'), mtimeMs: stat.mtimeMs, size: stat.size })
        } catch { unreadable++ }
      }
      if (reason === 'scan_budget' || reason === 'max_files') break
    }
  }
  await walk(root, 0)
  checkCanceled()
  paths.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-CN', { numeric: true }))
  return { ok: true, root, paths, truncated: Boolean(reason), reason, visited, unreadable }
}
function createDirectoryScanner(scan = listDirectoryFilesSnapshot) {
  const jobs = new Map()
  const run = async (root, opts = {}) => {
    const id = String(opts.requestId || crypto.randomUUID())
    jobs.get(id)?.abort()
    if (jobs.size >= 8 && !jobs.has(id)) throw new Error('目录扫描繁忙，请稍后重试')
    const controller = new AbortController()
    jobs.set(id, controller)
    try { return await scan(root, { ...opts, signal: controller.signal }) }
    finally { if (jobs.get(id) === controller) jobs.delete(id) }
  }
  run.cancel = id => jobs.get(String(id))?.abort()
  run.dispose = () => { for (const job of jobs.values()) job.abort() }
  return run
}
function createPdfPreviewer(getPython, getCacheRoot) {
  let queue = Promise.resolve(), count = 0
  const jobs = new Map()
  async function render(source, opts = {}) {
    if (count >= 16) throw new Error('预览队列繁忙，请稍后重试')
    const controller = new AbortController(), id = String(opts.requestId || crypto.randomUUID())
    jobs.get(id)?.abort(); jobs.set(id, controller); count++
    const work = queue.then(async () => {
      if (controller.signal.aborted) throw new Error('预览已取消')
      const file = await fs.realpath(source), stat = await fs.stat(file)
      if (!stat.isFile() || path.extname(file).toLowerCase() !== '.pdf') throw new Error('请选择 PDF 文件')
      const page = Math.max(1, Math.floor(Number(opts.page) || 1))
      const key = crypto.createHash('sha256').update(JSON.stringify([file, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, 'preview-v2', page])).digest('hex')
      const root = getCacheRoot(), target = path.join(root, `${key}.png`)
      let data
      try {
        data = JSON.parse(await runFile(getPython(), ['-c', PDF_SCRIPT, file, target, String(page)], { signal: controller.signal }))
      } catch (error) {
        if (controller.signal.aborted || process.platform !== 'darwin' || page !== 1) throw error
        const fallback = path.join(root, `${key}.quicklook`)
        try {
          await fs.mkdir(fallback, { recursive: true })
          await runFile('/usr/bin/qlmanage', ['-t', '-s', '1800', '-o', fallback, file], { timeout: 45000, signal: controller.signal })
          const names = await fs.readdir(fallback)
          const png = names.find(name => name.toLowerCase().endsWith('.png'))
          if (!png) throw error
          await fs.copyFile(path.join(fallback, png), target)
          data = { page: 1, page_count: 1, width: 0, height: 0, fallback: 'quicklook' }
        } finally { await fs.rm(fallback, { recursive: true, force: true }).catch(() => {}) }
      }
      if (controller.signal.aborted) throw new Error('预览已取消')
      const image = await fs.readFile(target)
      if (image.length > 16 * 1024 * 1024) throw new Error('预览图片超过大小限制')
      const result = { ...data, preview_path: target, data_url: `data:image/png;base64,${image.toString('base64')}` }
      // Reconstructible cache only. Never delete documents or active task records.
      const entries = await fs.readdir(root, { withFileTypes: true })
      const files = await Promise.all(entries.filter(e => e.isFile() && /^[a-f0-9]{64}\.png$/.test(e.name)).map(async e => {
        const name = path.join(root, e.name); return { name, stat: await fs.stat(name) }
      }))
      files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
      let bytes = 0
      for (let i = 0; i < files.length; i++) {
        bytes += files[i].stat.size
        if ((i >= 128 || bytes > 256 * 1024 * 1024) && files[i].name !== target) {
          await fs.unlink(files[i].name).catch(() => {})
          await fs.unlink(files[i].name.replace(/\.png$/, '.meta.json')).catch(() => {})
        }
      }
      return { ok: true, engine: data.fallback || 'pymupdf', page_count: data.page_count, pages: [result], preview_path: target, data_url: result.data_url }
    }).finally(() => { count--; if (jobs.get(id) === controller) jobs.delete(id) })
    queue = work.catch(() => {})
    return work
  }
  render.cancel = id => jobs.get(String(id))?.abort()
  render.dispose = () => { for (const job of jobs.values()) job.abort() }
  return render
}
module.exports = { listDirectoryFilesSnapshot, createDirectoryScanner, createPdfPreviewer, runFile }
