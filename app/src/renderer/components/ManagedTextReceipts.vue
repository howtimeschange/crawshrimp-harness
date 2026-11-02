<template>
  <section class="requests" aria-labelledby="requests-title">
    <div class="heading"><h3 id="requests-title">官方文字请求记录</h3><button type="button" :disabled="loading" @click="refresh">{{ loading ? '读取中…' : '刷新记录' }}</button></div>
    <p>请求中断时可核对原编号；核对只读取状态，不会再次发送请求。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-else-if="!loading && !rows.length">当前账号在本机暂无记录。</p>
    <ul v-if="rows.length">
      <li v-for="row in rows" :key="row.request_id">
        <div><strong>{{ row.model }}</strong><small>{{ row.created_at }} · {{ row.state === 'completed' ? '本机已收到响应' : '结果待核对' }}</small><code>{{ row.request_id }}</code><p v-if="results[row.request_id]" role="status">{{ results[row.request_id] }}</p></div>
        <button type="button" :disabled="checking === row.request_id" @click="check(row.request_id)">{{ checking === row.request_id ? '核对中…' : '核对' }}</button>
      </li>
    </ul>
    <button v-if="nextOffset !== null" type="button" :disabled="loading" @click="loadMore">{{ loading ? '读取中…' : '加载更多' }}</button>
    <form class="lookup" @submit.prevent="check(manualId.trim())">
      <label for="request-id">按原请求编号核对</label>
      <div><input id="request-id" v-model="manualId" autocomplete="off" placeholder="输入请求编号"><button type="submit" :disabled="!manualId.trim() || !!checking">核对编号</button></div>
      <p v-if="manualResult" role="status">{{ manualResult }}</p>
    </form>
  </section>
</template>
<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
const rows = ref([]), results = ref({}), loading = ref(false), checking = ref(''), error = ref('')
const nextOffset = ref(null), manualId = ref(''), manualResult = ref('')
watch(manualId, () => { manualResult.value = '' }, { flush: 'sync' })
let generation = 0, unsubscribe
const labels = { in_progress: '处理中', completed: '服务端已完成', unknown: '结果未知', upstream_rejected: '上游拒绝', not_dispatched: '未转发', failed: '失败', canceled: '已取消' }
async function refresh() {
  const current = ++generation
  loading.value = true; error.value = ''; results.value = {}; checking.value = ''; nextOffset.value = null; manualResult.value = ''
  try {
    const result = await window.cs.listManagedTextRequests(0)
    if (current === generation) {
      rows.value = Array.isArray(result?.requests) ? result.requests : []
      nextOffset.value = validNextOffset(result?.next_offset, 0)
    }
  } catch {
    if (current === generation) { rows.value = []; error.value = '请求记录暂不可用，请检查本地服务后重试。' }
  } finally { if (current === generation) loading.value = false }
}
function validNextOffset(value, previous) {
  return Number.isSafeInteger(value) && value > previous ? value : null
}
async function loadMore() {
  if (loading.value || nextOffset.value === null) return
  const current = generation, offset = nextOffset.value
  loading.value = true; error.value = ''
  try {
    const result = await window.cs.listManagedTextRequests(offset)
    if (current !== generation) return
    const existing = new Set(rows.value.map(row => row.request_id))
    const more = Array.isArray(result?.requests) ? result.requests : []
    rows.value = [...rows.value, ...more.filter(row => !existing.has(row.request_id))]
    nextOffset.value = validNextOffset(result?.next_offset, offset)
  } catch {
    if (current === generation) error.value = '更多记录暂不可用，请检查本地服务后重试。'
  } finally { if (current === generation) loading.value = false }
}
async function check(id) {
  if (checking.value || !id) return
  const current = generation
  checking.value = id
  try {
    const result = await window.cs.traceManagedTextRequest(id)
    if (current !== generation) return
    const text = result?.status === 'found' ? `服务端状态：${labels[result.state] || '待确认'}。请结合账单核对。` : result?.status === 'not_found' ? '服务端未找到记录；这不能证明未受理或未计费。' : '状态尚未确认，请检查账号和网络后重试；不要重复提交。'
    results.value = { ...results.value, [id]: text }
    if (manualId.value.trim() === id) manualResult.value = text
  } catch {
    if (current === generation) {
      const text = '暂时无法核对，请稍后重试；不要重复提交。'
      results.value = { ...results.value, [id]: text }
      if (manualId.value.trim() === id) manualResult.value = text
    }
  } finally { if (current === generation) checking.value = '' }
}
onMounted(() => {
  unsubscribe = window.cs?.onAccountChanged?.(() => { generation++; rows.value = []; results.value = {}; loading.value = false; checking.value = ''; error.value = ''; nextOffset.value = null; manualId.value = ''; manualResult.value = ''; void refresh() })
  void refresh()
})
onBeforeUnmount(() => { generation++; unsubscribe?.() })
</script>
<style scoped>
.requests { margin-top: 28px; padding: 20px 24px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg2); }
.heading, li { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
h3 { font-size: 15px; margin: 0; }
p, small { color: var(--text2); font-size: 12px; line-height: 1.6; }
p { margin: 8px 0; }
ul { list-style: none; margin: 12px 0 0; padding: 0; }
li { padding: 12px 0; border-top: 1px solid var(--border); }
li > div { min-width: 0; }
small, code { display: block; overflow-wrap: anywhere; margin-top: 4px; }
code { font-size: 11px; color: var(--text2); }
button { border: 1px solid var(--border); border-radius: 8px; padding: 7px 12px; background: var(--bg3); color: var(--text); cursor: pointer; }
button:focus-visible { outline: 2px solid var(--orange); outline-offset: 3px; }
button:disabled { opacity: .5; cursor: default; }
.lookup { margin-top: 18px; font-size: 12px; color: var(--text2); }
.lookup div { display: flex; gap: 8px; margin-top: 6px; }
.lookup input { min-width: 0; flex: 1; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; background: var(--bg3); color: var(--text); }
</style>
