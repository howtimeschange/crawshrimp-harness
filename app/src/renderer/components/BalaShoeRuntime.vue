<template>
  <section class="shoe-runtime" aria-live="polite">
    <div class="shoe-runtime-heading">
      <strong>巴拉鞋品专属模型</strong>
      <span>{{ status.state === 'ready' ? '已安装' : sizeLabel }}</span>
    </div>
    <p role="status">{{ message }}</p>
    <progress v-if="busy && status.state === 'downloading'" :value="status.downloaded_bytes || 0" :max="status.total_bytes || 1" aria-label="模型下载进度" />
    <div class="shoe-runtime-actions">
      <button v-if="!busy && status.state !== 'ready'" type="button" :disabled="loading || disabled || status.state === 'unsupported'" @click="install">{{ status.state === 'error' || status.state === 'cancelled' ? '重新下载并安装' : '下载并安装' }}</button>
      <button v-if="busy" type="button" @click="cancel">取消安装</button>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'

defineProps({ disabled: Boolean })
const emit = defineEmits(['ready'])
const status = ref({ state: 'checking' }), loading = ref(false), error = ref('')
const busy = computed(() => ['downloading', 'installing', 'verifying'].includes(status.value.state))
const sizeLabel = computed(() => status.value.model_bytes ? `模型 ${Math.ceil(status.value.model_bytes / 1024 / 1024)} MB` : '')
const message = computed(() => error.value || status.value.message || ({ checking: '正在检查组件', missing: '首次使用需要下载模型和识别组件' }[status.value.state] || '等待安装'))
let timer, disposed = false, checking = false
async function refresh() {
  if (checking) return
  checking = true
  try {
    const result = await window.cs.agentApi('GET', '/agent/runtimes/bala-shoe')
    if (disposed) return
    status.value = result
    emit('ready', result.state === 'ready')
    error.value = ''
  } catch (e) { if (!disposed) error.value = e.message }
  finally { checking = false }
}
async function install() {
  loading.value = true
  error.value = ''
  try {
    status.value = await window.cs.agentApi('POST', '/agent/runtimes/bala-shoe/install', {})
    emit('ready', status.value.state === 'ready')
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}
async function cancel() {
  try { await window.cs.agentApi('POST', '/agent/runtimes/bala-shoe/cancel', {}) }
  catch (e) { error.value = e.message }
}
onMounted(() => { refresh(); timer = setInterval(refresh, 1500) })
onUnmounted(() => { disposed = true; clearInterval(timer) })
</script>

<style scoped>
.shoe-runtime{margin-bottom:18px;padding:16px;border:1px solid var(--border);border-radius:10px;background:var(--bg2)}
.shoe-runtime-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}
.shoe-runtime-heading span,.shoe-runtime p{color:var(--text3);font-size:13px}
.shoe-runtime p{margin:10px 0}
.shoe-runtime progress{display:block;width:100%;height:7px;margin-bottom:12px;accent-color:var(--accent)}
.shoe-runtime-actions button{font:inherit;padding:7px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);cursor:pointer}
.shoe-runtime-actions button:disabled{opacity:.5;cursor:default}
</style>
