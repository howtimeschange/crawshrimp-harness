<template>
  <div class="pdf-preview">
    <div class="pdf-controls" role="toolbar" aria-label="PDF 阅读工具">
      <div class="pdf-control-group">
        <button type="button" :disabled="page <= 1 || loading" aria-label="PDF 上一页" title="上一页" @click="page--"><IconChevronLeft :size="16" /></button>
        <span class="pdf-page-count"><b>{{ page }}</b><span>/ {{ pages || '—' }}</span></span>
        <button type="button" :disabled="page >= pages || loading" aria-label="PDF 下一页" title="下一页" @click="page++"><IconChevronRight :size="16" /></button>
      </div>
      <div class="pdf-control-group">
        <button type="button" aria-label="PDF 缩小" title="缩小" :disabled="zoom <= .5" @click="zoom = Math.max(.5, zoom - .25)"><IconMinus :size="16" /></button>
        <span class="pdf-zoom-value">{{ Math.round(zoom * 100) }}%</span>
        <button type="button" aria-label="PDF 放大" title="放大" :disabled="zoom >= 3" @click="zoom = Math.min(3, zoom + .25)"><IconPlus :size="16" /></button>
      </div>
      <button type="button" class="pdf-fit" aria-label="PDF 适合宽度" title="适合宽度" @click="zoom = 1"><IconArrowsHorizontal :size="16" /><span>适宽</span></button>
    </div>
    <p v-if="loading" role="status">正在渲染 PDF…</p><p v-if="error" role="alert">{{ error }}，请使用系统打开。</p>
    <div ref="container" class="pdf-scroll"><div class="pdf-page"><canvas ref="canvas"></canvas><div ref="textLayer" class="textLayer"></div></div></div>
  </div>
</template>
<script setup>
import { IconChevronLeft, IconChevronRight, IconMinus, IconPlus, IconArrowsHorizontal } from '@tabler/icons-vue'
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
GlobalWorkerOptions.workerSrc = workerUrl
const props = defineProps({ path: String })
const page = ref(1), pages = ref(0), zoom = ref(1), loading = ref(true), error = ref(''), container = ref(null), canvas = ref(null), textLayer = ref(null)
let doc, task, renderTask, textTask, observer, frame, generation = 0, renderGeneration = 0, lastWidth = 0
function cancelRender() { renderGeneration++; renderTask?.cancel(); textTask?.cancel(); renderTask = null; textTask = null }
async function render() {
  cancelRender()
  if (!doc || !canvas.value || !container.value) return
  const token = renderGeneration
  loading.value = true; error.value = ''
  try {
    const pdfPage = await doc.getPage(page.value)
    if (token !== renderGeneration) return
    const unit = pdfPage.getViewport({ scale: 1 })
    const width = Math.max(160, container.value.clientWidth - 18)
    const viewport = pdfPage.getViewport({ scale: Math.min(4, width / unit.width * zoom.value) })
    const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16000000 / (viewport.width * viewport.height)))
    canvas.value.width = Math.ceil(viewport.width * ratio); canvas.value.height = Math.ceil(viewport.height * ratio)
    canvas.value.style.width = `${viewport.width}px`; canvas.value.style.height = `${viewport.height}px`
    textLayer.value.replaceChildren()
    textLayer.value.parentElement.style.setProperty('--scale-factor', viewport.scale)
    renderTask = pdfPage.render({ canvasContext: canvas.value.getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
    await renderTask.promise
    if (token !== renderGeneration) return
    textTask = new TextLayer({ textContentSource: pdfPage.streamTextContent(), container: textLayer.value, viewport })
    await textTask.render()
  } catch (e) { if (token === renderGeneration && e.name !== 'RenderingCancelledException' && e.name !== 'AbortException') error.value = `PDF 无法渲染：${e.message}` }
  finally { if (token === renderGeneration) loading.value = false }
}
watch(() => props.path, async () => {
  const token = ++generation
  cancelRender(); task?.destroy(); task = null; doc = null; pages.value = 0; page.value = 1; zoom.value = 1; loading.value = true; error.value = ''
  try {
    const url = await window.cs.agentMediaUrl(props.path, null)
    if (token !== generation) return
    const base = new URL(`${import.meta.env.BASE_URL}pdfjs/`, location.href).href
    task = getDocument({ url, cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/', wasmUrl: base + 'wasm/', isEvalSupported: false, disableAutoFetch: true, disableStream: true })
    task.onPassword = () => { if (token === generation) { error.value = '加密 PDF 需在系统阅读器输入密码'; loading.value = false; task.destroy() } }
    const loaded = await task.promise
    if (token !== generation) { loaded.destroy(); return }
    doc = loaded; pages.value = doc.numPages; await nextTick(); await render()
  } catch (e) { if (token === generation) { if (!error.value) error.value = `PDF 无法打开：${e.message}`; loading.value = false } }
}, { immediate: true })
watch([page, zoom], render)
onMounted(() => { observer = new ResizeObserver(() => { const width = Math.round(container.value?.clientWidth || 0); if (width === lastWidth) return; lastWidth = width; cancelAnimationFrame(frame); frame = requestAnimationFrame(render) }); observer.observe(container.value) })
onUnmounted(() => { generation++; cancelRender(); task?.destroy(); observer?.disconnect(); cancelAnimationFrame(frame) })
</script>
<style scoped>
.pdf-preview{display:flex;flex-direction:column;height:100%;min-height:420px;gap:12px}
.pdf-controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px;color:var(--text);flex-shrink:0}
.pdf-control-group{display:flex;align-items:center;gap:2px;padding:3px;background:var(--bg2);border:1px solid var(--border);border-radius:9px}
.pdf-controls button{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--text);font:inherit;cursor:pointer;transition:background .12s,color .12s}
.pdf-controls button:hover:not(:disabled){background:var(--bg3,rgba(128,128,128,.14));color:var(--accent,#ff6b35)}
.pdf-controls button:focus-visible{outline:2px solid var(--accent,#ff6b35);outline-offset:2px}
.pdf-controls button:disabled{opacity:.32;cursor:default}
.pdf-page-count{display:flex;align-items:center;justify-content:center;gap:5px;min-width:50px;font-size:12px;font-variant-numeric:tabular-nums}
.pdf-page-count b{font-weight:600}.pdf-page-count>span{color:var(--text-muted)}
.pdf-zoom-value{min-width:43px;text-align:center;font-size:12px;font-variant-numeric:tabular-nums}
.pdf-controls .pdf-fit{width:auto;height:36px;padding:0 10px;background:var(--bg2);border:1px solid var(--border);border-radius:9px;font-size:12px}
.pdf-scroll{flex:1;overflow:auto;min-height:0;background:var(--bg3,#e8e9ed);border:1px solid var(--border);border-radius:8px;padding:12px}
.pdf-page{position:relative;width:max-content;margin:auto;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.08)}.pdf-page canvas{display:block}.textLayer{inset:0;position:absolute}
.pdf-preview>p{font-size:12px;color:var(--text-muted);margin:0}
@media(prefers-reduced-motion:reduce){.pdf-controls button{transition:none}}
</style>
