<template>
  <div class="document-preview">
    <PdfPreview v-if="kind === 'pdf'" :path="path" />
    <template v-else>
      <p v-if="loading" role="status">正在加载文档…</p>
      <p v-else-if="error" role="alert">{{ error }}，可使用系统打开。</p>
      <template v-else>
        <p v-if="truncated" class="preview-notice">仅预览前 256 KB，完整内容请使用系统打开。</p>
        <template v-if="kind === 'html' || kind === 'markdown'">
          <p class="preview-notice">{{ kind === 'html' ? 'HTML 静态预览' : 'Markdown 预览' }} · 脚本、外部资源与链接跳转已禁用</p>
          <p v-if="warnings.length" class="preview-notice">{{ warnings.join('；') }}</p>
          <iframe :class="{ 'markdown-preview-frame': kind === 'markdown' }" title="文档静态预览" sandbox="" referrerpolicy="no-referrer" :srcdoc="srcdoc"></iframe>
        </template>
        <template v-else>
          <div class="code-toolbar"><span>{{ language || '纯文本' }}</span><button type="button" @click="copy"><IconCheck v-if="copied" :size="15" /><IconCopy v-else :size="15" />{{ copied ? '已复制' : '复制预览内容' }}</button></div>
          <pre class="code-preview"><code v-html="highlighted"></code></pre>
        </template>
      </template>
    </template>
  </div>
</template>
<script setup>
import { ref, computed, watch } from 'vue'
import { IconCopy, IconCheck } from '@tabler/icons-vue'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import PdfPreview from './PdfPreview.vue'
import { readDocumentText } from '../../../utils/documentPreview.js'
import { resourceLoader, prepareStaticHtml } from '../../../utils/staticPreview.js'
const props = defineProps({ path: String, filename: String, kind: String, revision: [String, Number] })
const loading = ref(false), error = ref(''), text = ref(''), truncated = ref(false), srcdoc = ref(''), warnings = ref([]), copied = ref(false)
const aliases = { py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', md: 'markdown', yml: 'yaml', sh: 'bash' }
const language = computed(() => { const ext = props.filename?.split('.').pop().toLowerCase(); const lang = aliases[ext] || ext; return hljs.getLanguage(lang || '') ? lang : '' })
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const highlighted = computed(() => language.value && text.value.length < 65536 ? hljs.highlight(text.value, { language: language.value, ignoreIllegals: true }).value : escape(text.value))
const md = new MarkdownIt({ html: false, linkify: false, typographer: false })
watch(() => [props.path, props.kind, props.revision], async (_, __, cleanup) => {
  const controller = new AbortController(), signal = controller.signal
  cleanup(() => controller.abort())
  text.value = ''; srcdoc.value = ''; error.value = ''; warnings.value = []; truncated.value = false; copied.value = false
  if (props.kind === 'pdf') return
  loading.value = true
  try {
    const url = await window.cs.agentMediaUrl(props.path, null)
    signal.throwIfAborted()
    const result = await readDocumentText(url, signal)
    signal.throwIfAborted()
    text.value = result.text; truncated.value = result.truncated
    if (['html', 'markdown'].includes(props.kind)) {
      const rendered = await prepareStaticHtml(props.kind === 'markdown' ? md.render(result.text) : result.text, resourceLoader(props.path, signal), signal, { kind: props.kind })
      signal.throwIfAborted(); srcdoc.value = rendered.srcdoc; warnings.value = rendered.warnings
    }
  } catch (e) { if (!signal.aborted) error.value = `预览失败：${e.message}` }
  finally { if (!signal.aborted) loading.value = false }
}, { immediate: true })
async function copy() { try { await navigator.clipboard.writeText(text.value); copied.value = true } catch { error.value = '复制失败' } }
</script>
<style scoped>
.document-preview{display:flex;flex-direction:column;min-height:100%;height:100%;gap:8px}.document-preview iframe{border:1px solid var(--border);border-radius:6px;background:var(--bg2);flex:1;min-height:350px;width:100%}.preview-notice{font-size:12px;color:var(--text-muted);margin:0}.code-toolbar{display:flex;justify-content:space-between;align-items:center;font-size:12px}.code-toolbar button{display:inline-flex;align-items:center;gap:6px;appearance:none;padding:5px 10px;border:1px solid var(--border);border-radius:7px;background:var(--bg2);color:var(--text);font:inherit;cursor:pointer}.code-toolbar button:hover{background:var(--bg3)}.code-toolbar button:focus-visible{outline:2px solid var(--accent,#ff6b35);outline-offset:2px}.code-preview{color-scheme:light;white-space:pre!important;overflow:auto;tab-size:2;margin:0;background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:14px;flex:1}.code-preview code{font:12px/1.7 monospace}
:global(:root[data-theme="dark"] .code-preview){color-scheme:dark}
.code-preview :deep(.hljs-keyword),.code-preview :deep(.hljs-literal){color:light-dark(#a626a4,#c792ea)}
.code-preview :deep(.hljs-title),.code-preview :deep(.hljs-built_in){color:light-dark(#4078f2,#82aaff)}
.code-preview :deep(.hljs-string),.code-preview :deep(.hljs-attr){color:light-dark(#287b36,#c3e88d)}
.code-preview :deep(.hljs-number){color:light-dark(#986801,#f78c6c)}
.code-preview :deep(.hljs-comment){color:var(--text-muted);font-style:italic}
.markdown-preview-frame{color-scheme:light}
:global(:root[data-theme="dark"] .markdown-preview-frame){color-scheme:dark}
</style>
