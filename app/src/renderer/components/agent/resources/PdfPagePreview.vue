<template>
  <section ref="host" class="pdf-page" :style="{ width: `${viewport.width}px`, height: `${viewport.height}px` }" :aria-label="`PDF 第 ${number} 页`" :data-page="number">
    <canvas ref="canvas"></canvas><div ref="textLayer" class="textLayer"></div>
    <p v-if="error" role="alert">{{ error }}</p><span v-else-if="!rendered" class="page-placeholder">第 {{ number }} 页</span>
  </section>
</template>
<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { TextLayer } from 'pdfjs-dist'
const props = defineProps({ active: {type:Boolean,default:true}, document: Object, number: Number, root: Object, width: Number, zoom: Number, initialSize: Object })
const host = ref(null), canvas = ref(null), textLayer = ref(null), visible = ref(false), rendered = ref(false), error = ref(''), size = ref(props.initialSize)
const viewport = computed(() => { const unit = size.value || {width:595,height:842}; const scale = Math.min(4, Math.max(160, props.width || 160) / unit.width * props.zoom); return {width:unit.width * scale,height:unit.height * scale,scale} })
let observer, renderTask, textTask, generation = 0
function cancel() { generation++; renderTask?.cancel(); textTask?.cancel(); renderTask = null; textTask = null }
function clear() { cancel(); rendered.value = false; if (canvas.value) { canvas.value.width = 0; canvas.value.height = 0 }; textLayer.value?.replaceChildren() }
async function render() {
  clear(); if (!props.active || !visible.value || !props.document || !canvas.value) return
  const token = generation; error.value = ''
  try {
    const page = await props.document.getPage(props.number)
    if (token !== generation) return
    const unit = page.getViewport({scale:1}); size.value = {width:unit.width,height:unit.height}
    const view = page.getViewport({scale:viewport.value.scale}), ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8000000 / (view.width * view.height)))
    canvas.value.width = Math.ceil(view.width * ratio); canvas.value.height = Math.ceil(view.height * ratio)
    canvas.value.style.width = `${view.width}px`; canvas.value.style.height = `${view.height}px`
    host.value.style.setProperty('--scale-factor',view.scale)
    renderTask = page.render({canvasContext:canvas.value.getContext('2d'),viewport:view,transform:[ratio,0,0,ratio,0,0]})
    await renderTask.promise; if (token !== generation) return
    textTask = new TextLayer({textContentSource:page.streamTextContent(),container:textLayer.value,viewport:view})
    await textTask.render(); if (token === generation) rendered.value = true
  } catch(e) { if (token === generation && !['RenderingCancelledException','AbortException'].includes(e.name)) error.value = `第 ${props.number} 页无法渲染：${e.message}` }
}
watch([visible, () => props.active, () => props.width, () => props.zoom, () => props.document],render)
onMounted(() => { observer = new IntersectionObserver(entries => { visible.value = entries[0].isIntersecting },{root:props.root,rootMargin:'600px 0px'});observer.observe(host.value) })
onUnmounted(() => { clear();observer?.disconnect() })
</script>
<style scoped>
.pdf-page{position:relative;flex:none;margin:0 auto 16px;background:#fff;box-shadow:0 2px 10px #0001;overflow:hidden}.pdf-page canvas{display:block}.textLayer{position:absolute;inset:0}.page-placeholder,.pdf-page>p{position:absolute;top:20px;left:20px;font-size:12px;color:#777}.pdf-page>p{color:#b34e4e}
</style>
