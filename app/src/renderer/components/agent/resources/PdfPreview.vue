<template>
  <div class="pdf-preview">
    <div class="pdf-controls" role="toolbar" aria-label="PDF 阅读工具">
      <span class="pdf-page-count">共 {{ pages || '—' }} 页 · 连续滚动查看</span>
      <div class="pdf-control-group">
        <button type="button" aria-label="PDF 缩小" title="缩小" :disabled="zoom <= .5" @click="zoom = Math.max(.5, zoom - .25)"><IconMinus :size="16" /></button>
        <span class="pdf-zoom-value">{{ Math.round(zoom * 100) }}%</span>
        <button type="button" aria-label="PDF 放大" title="放大" :disabled="zoom >= 3" @click="zoom = Math.min(3, zoom + .25)"><IconPlus :size="16" /></button>
      </div>
      <button type="button" class="pdf-fit" aria-label="PDF 适合宽度" title="适合宽度" @click="zoom = 1"><IconArrowsHorizontal :size="16" /></button>
    </div>
    <p v-if="loading" role="status">正在渲染 PDF…</p><p v-if="error" role="alert">{{ error }}，请使用系统打开。</p>
    <div ref="container" class="pdf-scroll" tabindex="0" aria-label="PDF 连续页面"><PdfPagePreview v-for="number in pages" :key="number" :active="active" :document="document" :number="number" :root="container" :width="renderWidth" :zoom="zoom" :initial-size="initialSize" /></div>
  </div>
</template>
<script setup>
import { IconMinus, IconPlus, IconArrowsHorizontal } from '@tabler/icons-vue'
import { ref, shallowRef, watch, onMounted, onUnmounted } from 'vue'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import PdfPagePreview from './PdfPagePreview.vue'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
GlobalWorkerOptions.workerSrc = workerUrl
const props = defineProps({ path: String, active: {type:Boolean,default:true} })
const pages = ref(0), zoom = ref(1), loading = ref(true), error = ref(''), container = ref(null), document = shallowRef(null), renderWidth = ref(600), initialSize = ref({width:595,height:842})
let task, observer, generation = 0
watch(() => props.path, async () => {
  const token = ++generation
  task?.destroy(); task = null; document.value = null; pages.value = 0; zoom.value = 1; loading.value = true; error.value = ''
  if (container.value) container.value.scrollTop = 0
  try {
    const media = await window.cs.agentMediaUrl(props.path, null)
    const freshUrl = new URL(media); freshUrl.searchParams.set('_preview', String(Date.now()))
    if (token !== generation) return
    const base = new URL(`${import.meta.env.BASE_URL}pdfjs/`, location.href).href
    const loadingTask = getDocument({url:freshUrl.href,cMapUrl:base+'cmaps/',cMapPacked:true,standardFontDataUrl:base+'standard_fonts/',wasmUrl:base+'wasm/',isEvalSupported:false,disableAutoFetch:true,disableStream:true})
    task = loadingTask
    loadingTask.onPassword = () => { if (token === generation) { error.value = '加密 PDF 需在系统阅读器输入密码'; loading.value = false; loadingTask.destroy() } }
    const loaded = await loadingTask.promise
    if (token !== generation) { loaded.destroy(); return }
    const first = await loaded.getPage(1); if (token !== generation) return
    const view = first.getViewport({scale:1}); initialSize.value = {width:view.width,height:view.height}
    document.value = loaded; pages.value = loaded.numPages
  } catch(e) { if (token === generation && !error.value) error.value = `PDF 无法打开：${e.message}` }
  finally { if (token === generation) loading.value = false }
}, {immediate:true})
onMounted(() => { observer = new ResizeObserver(() => { const width = container.value?.clientWidth || 0; if (width > 0) renderWidth.value = Math.max(160,width - 26) });observer.observe(container.value) })
onUnmounted(() => { generation++;task?.destroy();observer?.disconnect() })
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
.pdf-controls .pdf-fit{width:28px;height:28px;padding:0;background:var(--bg2);border:1px solid var(--border);border-radius:9px;font-size:12px}
.pdf-scroll{flex:1;overflow:auto;min-height:0;background:var(--bg3,#e8e9ed);border:1px solid var(--border);border-radius:8px;padding:12px}
.pdf-page{position:relative;width:max-content;margin:auto;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.08)}.pdf-page canvas{display:block}.textLayer{inset:0;position:absolute}
.pdf-preview>p{font-size:12px;color:var(--text-muted);margin:0}
@media(prefers-reduced-motion:reduce){.pdf-controls button{transition:none}}
.pdf-controls button{position:relative}.pdf-controls button::after{content:attr(title);position:absolute;right:0;top:calc(100% + 6px);z-index:60;white-space:nowrap;padding:5px 8px;border-radius:6px;background:var(--tooltip-bg,#292932);color:#fff;font-size:11px;opacity:0;pointer-events:none}.pdf-controls button:hover::after,.pdf-controls button:focus-visible::after{opacity:1}
</style>
