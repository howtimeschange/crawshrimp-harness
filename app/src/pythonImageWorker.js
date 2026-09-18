'use strict'
const { spawn } = require('node:child_process')
const SCRIPT = String.raw`
import sys,json,io,base64,warnings
from PIL import Image,ImageOps
warnings.simplefilter('error', Image.DecompressionBombWarning)
Image.MAX_IMAGE_PIXELS=40000000
for line in sys.stdin:
    try:
        item=json.loads(line)
        with Image.open(item['path']) as im:
            edge=item['edge'];im.draft('RGB',(edge,edge));im.thumbnail((edge,edge))
            im=ImageOps.exif_transpose(im).convert('RGB');out=io.BytesIO()
            im.save(out,format='JPEG',quality=item['quality']);raw=out.getvalue()
            result=dict(ok=True,data_url='data:image/jpeg;base64,'+base64.b64encode(raw).decode(),width=im.width,height=im.height,bytes=len(raw),thumbnail=True)
    except Exception:
        result=dict(ok=False,error='无法生成缩略图：图片过大、损坏或图像组件不可用')
    print(json.dumps(result),flush=True)
`
function createImageWorker(getPython) {
  let child, pending, output = '', idle, serial = Promise.resolve(), closed = false
  function stop() {
    clearTimeout(idle)
    const old = child; child = null; output = ''
    old?.kill()
    if (pending) { const p = pending; pending = null; clearTimeout(p.timer); p.reject(new Error('图像工作进程已停止')) }
  }
  function ensure() {
    if (child) return
    child = spawn(getPython(), ['-u', '-c', SCRIPT], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, PYTHONIOENCODING: 'utf-8', ELECTRON_RUN_AS_NODE: undefined } })
    const current = child
    current.stdout.setEncoding('utf8')
    current.stdout.on('data', data => {
      if (child !== current) return
      output += data
      if (output.length > 4 * 1024 * 1024) { stop(); return }
      const end = output.indexOf('\n')
      if (end < 0) return
      const line = output.slice(0, end); output = output.slice(end + 1)
      const p = pending; pending = null
      if (!p) return
      clearTimeout(p.timer)
      try { const result = JSON.parse(line); if (!result.ok) throw new Error(result.error); p.resolve(result) } catch (e) { p.reject(e) }
      idle = setTimeout(stop, 30000); idle.unref?.()
    })
    current.on('error', () => { if (child === current) stop() })
    current.on('exit', () => { if (child === current) stop() })
    current.stdin.on('error', () => { if (child === current) stop() })
  }
  const run = item => {
    const result = serial.then(() => new Promise((resolve, reject) => {
      if (closed) { reject(new Error('图像工作进程已关闭')); return }
      clearTimeout(idle); ensure()
      pending = { resolve, reject, timer: setTimeout(stop, 30000) }
      child.stdin.write(JSON.stringify(item) + '\n')
    }))
    serial = result.catch(() => {})
    return result
  }
  run.dispose = () => { closed = true; stop() }
  return run
}
module.exports = { createImageWorker }
