<template>
  <div class="office-preview">
    <p v-if="error" class="office-error" role="alert">{{ error }}</p>
    <button v-if="error" type="button" class="office-retry" @click="retryCount++">重新尝试</button>
    <p v-else class="office-status" role="status">{{ status }}</p>
    <OfficePagePreview :active="active" v-for="(item, index) in pages" :key="`${item.path}:${resolvedOffice?.revision || ''}:${revision || 0}`" :item="item" :number="index + 1" :revision="`${resolvedOffice?.revision || ''}:${revision || 0}`" />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import OfficePagePreview from './resources/OfficePagePreview.vue'
import { resolveOfficePreview } from '../../utils/officePreview.js'
const props = defineProps({ active: {type:Boolean,default:true}, office: Object, path: { type: String, default: '' }, updatedAt: { type: String, default: '' }, revision: Number })
const resolvedOffice = ref(null), loading = ref(false), error = ref(''), runtimeProgress = ref(null), retryCount = ref(0)
let loadedPath, loadedRevision, loadedMetadata, loadedUpdatedAt, forceResolve = false
const pages = computed(() => resolvedOffice.value?.pages || [])
watch(() => [props.path, props.revision, props.office, props.updatedAt, props.active, retryCount.value], async (_, __, cleanup) => {
  const controller = new AbortController(), signal = controller.signal
  cleanup(() => controller.abort())
  if (loadedPath !== props.path || loadedRevision !== props.revision || loadedMetadata !== props.office || loadedUpdatedAt !== props.updatedAt) {
    forceResolve = Boolean(props.revision) || (loadedPath === props.path && loadedMetadata === props.office && loadedUpdatedAt !== props.updatedAt)
    resolvedOffice.value = null
    loadedPath = props.path; loadedRevision = props.revision; loadedMetadata = props.office; loadedUpdatedAt = props.updatedAt
  }
  loading.value = false; error.value = ''; runtimeProgress.value = null
  if (resolvedOffice.value?.pages?.length) return
  // Preserve already published previews. A manual reread resolves the current
  // file revision through the same path as a message link or restored tab.
  if (props.office?.pages?.length && !forceResolve) { resolvedOffice.value = props.office; return }
  if (!props.active || !props.path) return
  loading.value = true
  try {
    const office = await resolveOfficePreview(props.path, { api: (...args) => window.cs.agentApi(...args), signal,
      onProgress: progress => { if (!signal.aborted) runtimeProgress.value = progress } })
    if (!signal.aborted) resolvedOffice.value = office
  } catch (e) { if (!signal.aborted) error.value = `预览失败：${e.message}` }
  finally { if (!signal.aborted) loading.value = false }
}, { immediate: true })
const status = computed(() => {
  if (loading.value && runtimeProgress.value && runtimeProgress.value.state !== 'ready') {
    const progress = runtimeProgress.value
    const size = Number(progress.total_bytes) > 0 ? ` ${Math.min(100, Math.floor(Number(progress.downloaded_bytes || 0) / progress.total_bytes * 100))}%` : ''
    return `${progress.message || '首次使用，正在准备 Office 组件…'}${progress.state === 'downloading' ? size : ''}`
  }
  if (loading.value) return '正在生成文档预览…'
  const visual = resolvedOffice.value?.visual
  const count = visual?.reviewed?.length || 0
  if (visual?.status === 'passed') return `已完成 ${count} 页视觉检查`
  if (visual?.status === 'issues') return '视觉检查发现问题，请查看会话中的检查结果'
  if (visual?.status === 'partial') return `已检查 ${count} / ${pages.value.length} 页，部分页面待检查`
  return pages.value.length ? '已生成预览，视觉检查尚未完成' : '等待生成预览'
})
</script>

<style scoped>
.office-status,.office-error{font-size:12px;color:var(--text3);line-height:1.6;margin:10px 2px}.office-error{color:#c66750}
.office-retry{font:inherit;font-size:12px;color:var(--text2);background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:5px 10px;cursor:pointer}
</style>
