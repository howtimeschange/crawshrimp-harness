<template>
  <div class="office-preview">
    <div class="office-controls">
      <button class="page-button" type="button" :disabled="page <= 1" @click="page--" aria-label="上一页">上一页</button>
      <span class="page-count" aria-live="polite">{{ page }} / {{ pages.length }} 页</span>
      <button class="page-button" type="button" :disabled="page >= pages.length" @click="page++" aria-label="下一页">下一页</button>
      <button v-if="documentPath" class="open-document" type="button" @click="openDocument">打开 {{ documentType }}</button>
    </div>
    <p class="office-status" role="status">{{ status }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-else-if="loading">正在加载第 {{ page }} 页…</p>
    <img v-else-if="url" :src="url" :alt="`文档第 ${page} 页`" @error="error = '预览文件无法加载，请重新生成预览。'" />
    <p v-else>尚未生成逐页预览。</p>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
const props = defineProps({ office: { type: Object, required: true }, path: { type: String, default: '' } })
const documentPath = computed(() => props.path || props.office.document || '')
const documentType = computed(() => ({ docx: 'Word', pptx: 'PPT', xlsx: 'Excel' })[documentPath.value.split('.').pop().toLowerCase()] || '原件')
const pages = computed(() => props.office.pages || [])
const page = ref(1), url = ref(''), error = ref(''), loading = ref(false)
let generation = 0
const status = computed(() => {
  const visual = props.office.visual
  const count = visual?.reviewed?.length || 0
  if (visual?.status === 'passed') return `已完成 ${count} 页视觉检查`
  if (visual?.status === 'issues') return '视觉检查发现问题，请查看会话中的检查结果'
  if (visual?.status === 'partial') return `已检查 ${count} / ${pages.value.length} 页，部分页面待检查`
  return pages.value.length ? '已生成预览，视觉检查尚未完成' : '等待生成预览'
})
watch(() => props.office.revision, () => { page.value = 1 })
watch([page, () => pages.value], async () => {
  const token = ++generation
  url.value = ''; error.value = ''; loading.value = true
  try {
    const item = pages.value[page.value - 1]
    if (!item) return
    const result = await window.cs.agentMediaUrl(item.path, null)
    if (token === generation) url.value = result
  } catch (e) { if (token === generation) error.value = `预览失败：${e.message}` }
  finally { if (token === generation) loading.value = false }
}, { immediate: true })
async function openDocument() {
  try { const result = await window.cs.openFile(documentPath.value); if (result?.ok === false) throw new Error(result.error) }
  catch (e) { error.value = `打开失败：${e.message}` }
}
</script>

<style scoped>
.office-controls{display:flex;align-items:center;gap:6px;flex-wrap:wrap;position:sticky;top:0;z-index:1;background:var(--bg2);padding:8px;border:1px solid var(--border);border-radius:10px}
button{appearance:none;display:inline-flex;align-items:center;justify-content:center;min-height:30px;padding:5px 10px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--text2);font-family:inherit;font-size:12px;font-weight:500;line-height:1.4;cursor:pointer;transition:background 120ms,color 120ms}
button:hover:not(:disabled){background:var(--bg);color:var(--text)}button:focus-visible{outline:2px solid var(--orange,#ff6b2b);outline-offset:2px}button:disabled{opacity:.35;cursor:default}
.page-button{border-color:var(--border)}.page-count{min-width:64px;text-align:center;color:var(--text3);font-size:12px;font-variant-numeric:tabular-nums}
.open-document{margin-left:auto;color:var(--orange,#ff6b2b);background:color-mix(in srgb,var(--orange,#ff6b2b) 9%,transparent)}.open-document:hover:not(:disabled){background:color-mix(in srgb,var(--orange,#ff6b2b) 16%,transparent);color:var(--orange,#ff6b2b)}
.office-status{font-size:12px;color:var(--text3);line-height:1.6;margin:10px 2px}img{display:block;max-width:100%;height:auto;margin:12px auto;box-shadow:0 1px 8px #0002}
@media(prefers-reduced-motion:reduce){button{transition:none}}
</style>
