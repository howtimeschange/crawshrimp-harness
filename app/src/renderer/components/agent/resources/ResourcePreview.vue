<template>
  <div class="unified-preview" role="region" :aria-label="`${item.filename}预览`" :data-resource-path="item.path">
    <div class="preview-toolbar">
      <span class="preview-path-inline" :title="item.path"><bdi dir="ltr">{{ item.path }}</bdi></span>
      <select v-if="views.length > 1" :value="mode" aria-label="查看方式" title="切换预览或原文查看方式" @change="$emit('update:mode', $event.target.value)"><option v-for="view in views" :key="view.id" :value="view.id">{{ view.label }}</option></select>
      <button aria-label="重新读取文件" title="重新读取文件" @click="revision++"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/></svg></button>
      <button aria-label="系统打开" title="系统打开" @click="fileAction('openFile')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M14 3h7v7m0-7L10 14M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg></button><button aria-label="定位" title="在文件夹中显示" @click="fileAction('revealFile')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11H3Z"/></svg></button>
    </div>
    <p v-if="error" class="preview-error" role="alert">{{ error }}</p>
    <div class="preview-content">
      <OfficePreview :active="active" v-if="office" :office="item.office" :path="item.path" :revision="revision" />
      <p v-else-if="type === 'document' && !documentKind(item.filename)" class="notice">此文件暂不支持内置预览，请使用系统打开。</p>
      <DocumentPreview :active="active" v-else-if="type === 'document' || mode === 'source'" :path="item.path" :filename="item.filename" :kind="mode === 'source' ? 'code' : documentKind(item.filename)" :revision="`${item.updated_at || ''}:${revision}`" />
      <template v-else-if="type === 'table'">
        <p v-if="loading" role="status">正在读取表格…</p>
        <template v-else-if="!error">
          <p class="notice">{{ rows.length }} 行 · 横向滚动查看宽表<span v-if="truncated"> · 预览已截取（最多 256 KB / 1000 行 / 100 列），完整内容请使用系统打开</span></p>
          <div class="csv-scroll" tabindex="0" aria-label="CSV 表格"><table><tbody><tr v-for="(row, i) in rows" :key="i"><th class="row-number">{{ i + 1 }}</th><td v-for="(cell, j) in row" :key="j">{{ cell }}</td></tr></tbody></table></div>
        </template>
      </template>
      <template v-else-if="type === 'image'">
        <div class="image-controls"><button aria-label="缩小图片" title="缩小图片（最低 25%）" @click="setZoom(zoom - .25)">−</button><span>{{ Math.round(zoom * 100) }}%</span><button aria-label="放大图片" title="放大图片（最高 400%）" @click="setZoom(zoom + .25)">＋</button><button title="恢复图片为 100%" @click="setZoom(1)">适应</button></div>
        <p v-if="loading" role="status">正在读取图片…</p>
        <div v-else class="image-scroll" tabindex="0" aria-label="图片预览"><img v-if="url" :src="url" :alt="item.filename" :style="{ width: `${zoom * 100}%`, maxWidth: 'none' }" @error="error = '文件无法加载，可能已移动或删除'" /></div>
      </template>
      <video v-else-if="type === 'video' && url" :src="url" controls />
      <audio v-else-if="type === 'audio' && url" :src="url" controls />
    </div>
  </div>
</template>
<script setup>
import { computed, ref, watch, onUnmounted } from 'vue'
import DocumentPreview from './DocumentPreview.vue'
import OfficePreview from '../OfficePreview.vue'
import { documentKind, readDocumentText } from '../../../utils/documentPreview.js'
import { isOfficeDocument } from '../../../utils/artifactTime.js'
import { previewType, parseDelimited } from '../../../utils/resourceWorkspace.js'
const props = defineProps({ active: {type:Boolean,default:true}, item: Object, mode: { type: String, default: 'preview' }, zoom: { type: Number, default: 1 } })
const emit = defineEmits(['update:mode', 'update:zoom'])
const type = computed(() => previewType(props.item)), office = computed(() => isOfficeDocument(props.item))
const views = computed(() => office.value || documentKind(props.item.filename) === 'pdf' || type.value === 'video' || type.value === 'audio' || type.value === 'image' ? [] : [{ id: 'preview', label: type.value === 'table' ? '表格' : '预览' }, { id: 'source', label: '原文' }])
const revision = ref(0), url = ref(''), rows = ref([]), loading = ref(false), error = ref(''), truncated = ref(false)
const setZoom = value => emit('update:zoom', Math.max(.25, Math.min(4, value)))
let blobUrl = ''
function releaseBlob() { if (blobUrl) URL.revokeObjectURL(blobUrl); blobUrl = '' }
watch(() => [props.item.path, props.item.updated_at, revision.value], async (_, __, cleanup) => {
  const controller = new AbortController(), signal = controller.signal
  cleanup(() => controller.abort()); releaseBlob(); url.value = ''; error.value = ''; rows.value = []; loading.value = false
  if (office.value || type.value === 'document') return
  loading.value = true
  try {
    const media = await window.cs.agentMediaUrl(props.item.path, null); signal.throwIfAborted()
    if (type.value === 'table') {
      const result = await readDocumentText(media, signal); signal.throwIfAborted()
      const parsed = parseDelimited(result.text.replace(/^\uFEFF/, ''), props.item.filename.endsWith('.tsv') ? '\t' : ',')
      rows.value = parsed.rows; truncated.value = result.truncated || parsed.clipped || parsed.incomplete
    } else if (type.value === 'image') {
      const response = await fetch(media, { signal, cache: 'no-store' }); if (!response.ok) throw new Error('文件不存在或无法读取')
      // Refuse unbounded allocations; SVG retains the existing static image boundary.
      if (Number(response.headers.get('content-length')) > 32 * 1024 * 1024) throw new Error('图片超过 32 MB，请使用系统打开')
      const reader = response.body.getReader(), chunks = []; let size = 0
      try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 32 * 1024 * 1024) throw new Error('图片超过 32 MB，请使用系统打开'); chunks.push(value) } } finally { await reader.cancel() }
      signal.throwIfAborted(); blobUrl = URL.createObjectURL(new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' })); url.value = blobUrl
    } else url.value = media
  } catch (e) { if (!signal.aborted) error.value = `预览失败：${e.message}` }
  finally { if (!signal.aborted) loading.value = false }
}, { immediate: true })
onUnmounted(releaseBlob)
async function fileAction(action) { try { if (action === 'openFile' && props.item.filename?.endsWith('.zip')) action = 'revealFile'; const result = await window.cs[action](props.item.path); if (result?.ok === false || typeof result === 'string' && result) throw new Error(result.error || result) } catch (e) { error.value = `操作失败：${e.message}` } }
</script>
<style scoped>
.unified-preview{height:100%;min-height:0;display:flex;flex-direction:column}.preview-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:9px;border-bottom:1px solid var(--border)}.preview-toolbar strong{flex:1;min-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.preview-toolbar select,.preview-toolbar button,.image-controls button{font:12px inherit;color:var(--text);background:var(--bg2);border:1px solid var(--border);padding:5px 7px;border-radius:6px;cursor:pointer}.preview-path{font-size:10px;color:var(--text3);padding:5px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.preview-content{flex:1;min-height:0;overflow:auto;padding:12px}.preview-error{font-size:12px;color:#c66750;padding:8px 12px;margin:0}.notice{font-size:11px;color:var(--text3);margin:0 0 8px}.csv-scroll{overflow:auto;max-height:calc(100% - 32px);border:1px solid var(--border);border-radius:6px}table{border-collapse:separate;border-spacing:0;font:12px/1.6 monospace;min-width:100%}td,th{padding:6px 10px;white-space:pre;max-width:600px;border-right:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--bg)}tr:first-child td{position:sticky;top:0;background:var(--bg2);font-weight:600}.row-number{position:sticky;left:0;background:var(--bg2);color:var(--text3);z-index:1}.image-controls{display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:12px}.image-scroll{overflow:auto;height:calc(100% - 42px)}.image-scroll img{display:block;object-fit:contain}video{width:100%}button:focus-visible,select:focus-visible{outline:2px solid var(--orange,#ff6b2b)}
.preview-toolbar{flex-wrap:nowrap;min-height:36px;padding:0 8px;gap:4px}.preview-path-inline{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;font-size:11px;color:var(--text3)}.preview-toolbar button{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border-color:transparent;background:transparent;transition:background 120ms ease}.preview-toolbar button:hover{background:var(--bg2);border-color:var(--border)}.preview-toolbar select{max-width:90px;border-color:transparent;background:transparent;font-size:11px}.preview-content{padding:8px}.preview-toolbar button:active{transform:scale(.95)}@media(prefers-reduced-motion:reduce){.preview-toolbar button{transition:none;transform:none}}

.preview-toolbar button{position:relative}.preview-toolbar button::after{content:attr(title);position:absolute;right:0;top:calc(100% + 6px);z-index:60;white-space:nowrap;padding:5px 8px;border-radius:6px;background:var(--tooltip-bg,#292932);color:#f7f7fa;font:11px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 3px 12px #0002;opacity:0;pointer-events:none;transition:opacity 100ms ease}.preview-toolbar button:hover::after,.preview-toolbar button:focus-visible::after{opacity:1}
</style>
