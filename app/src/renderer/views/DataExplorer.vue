<template>
  <div class="view">
    <header class="view-header">
      <h2>Data</h2>
      <select v-model="selAdapter">
        <option value="">All platforms</option>
        <option v-for="a in adapters" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
    </header>
    <div class="runs-list">
      <div v-if="loadError" class="notice error">{{ loadError }}</div>
      <div v-if="loading" class="placeholder">Loading...</div>
      <div v-else-if="!filteredRuns.length" class="placeholder">No data yet. Run a task first.</div>
      <div v-for="run in filteredRuns" :key="run.id" class="run-row">
        <div class="run-info">
          <strong>{{ run.adapter_id }} / {{ run.task_id }}</strong>
          <span :class="['status-badge', run.status]">{{ run.status }}</span>
        </div>
        <div class="run-meta">
          <span>{{ run.records_count }} records</span>
          <span>{{ formatTime(run.finished_at) }}</span>
        </div>
        <div class="run-actions">
          <button class="btn btn-sm" :disabled="!hasFile(run, '.xlsx')" @click="doExport(run, 'excel')">Excel</button>
          <button class="btn btn-sm btn-ghost" :disabled="!hasFile(run, '.json')" @click="doExport(run, 'json')">JSON</button>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
const adapters = ref([]); const allRuns = ref([]); const selAdapter = ref('')
const loading = ref(false); const loadError = ref('')
let loadSeq = 0
const filteredRuns = computed(() =>
  selAdapter.value ? allRuns.value.filter(r => r.adapter_id === selAdapter.value) : allRuns.value
)
async function mapLimit(items, limit, worker) {
  const result = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      result[index] = await worker(items[index], index)
    }
  })
  await Promise.all(workers)
  return result
}
async function load() {
  const seq = ++loadSeq
  loading.value = true
  loadError.value = ''
  try {
    const loadedAdapters = await window.cs.getAdapters()
    if (seq !== loadSeq) return
    const targets = loadedAdapters.flatMap(a => (a.tasks || []).map(t => ({ adapter: a, task: t })))
    const results = await mapLimit(targets, 4, async ({ adapter, task }) => {
      try {
        const r = await window.cs.getData(adapter.id, task.id)
        return { adapter, task, runs: r?.runs || [] }
      } catch (error) {
        return { adapter, task, runs: [], error }
      }
    })
    if (seq !== loadSeq) return
    const runs = []
    for (const result of results) {
      runs.push(...result.runs.map(x => ({ ...x, adapter_id: result.adapter.id, task_id: result.task.id })))
    }
    adapters.value = loadedAdapters
    allRuns.value = runs.sort((a, b) => b.id - a.id)
    const failedCount = results.filter(result => result.error).length
    if (failedCount) loadError.value = `部分数据加载失败：${failedCount} 个任务暂不可用。`
  } catch (error) {
    if (seq === loadSeq) loadError.value = '数据加载失败：' + (error?.message || error)
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}
async function doExport(run, fmt) { await window.cs.exportData(run.adapter_id, run.task_id, fmt) }
function hasFile(run, ext) {
  try {
    const files = typeof run.output_files === 'string' ? JSON.parse(run.output_files) : run.output_files
    return Array.isArray(files) && files.some(f => f.endsWith(ext))
  } catch { return false }
}
function formatTime(iso) { if (!iso) return ''; return new Date(iso).toLocaleString('zh-CN', { hour12: false }).replace(',', '') }
onMounted(load)
onUnmounted(() => { loadSeq += 1 })
</script>
<style scoped>
.view { height: 100%; display: flex; flex-direction: column; }
.view-header { display: flex; align-items: center; padding: 20px 24px 12px; border-bottom: 1px solid var(--bg3); gap: 16px; }
.view-header h2 { font-size: 18px; font-weight: 700; color: var(--text); flex: 1; }
select { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; color: var(--text); font-size: 12px; outline: none; }
.runs-list { flex: 1; overflow-y: auto; padding: 8px 0; }
.placeholder { color: var(--text3); text-align: center; padding: 40px; font-size: 14px; }
.notice { margin: 8px 24px; padding: 8px 10px; border-radius: 8px; font-size: 12px; }
.notice.error { color: var(--red); background: rgba(248, 113, 113, 0.08); border: 1px solid rgba(248, 113, 113, 0.25); }
.run-row { display: flex; align-items: center; padding: 14px 24px; border-bottom: 1px solid var(--bg3); gap: 16px; }
.run-row:hover { background: var(--bg2); }
.run-info { flex: 1; display: flex; align-items: center; gap: 10px; }
.run-info strong { font-size: 13px; color: var(--text); }
.run-meta { display: flex; gap: 16px; font-size: 12px; color: var(--text2); }
.run-actions { display: flex; gap: 8px; }
.status-badge { font-size: 11px; padding: 2px 8px; border-radius: 6px; }
.status-badge.done { background: #14532d33; color: var(--green); }
.status-badge.error { background: #450a0a33; color: var(--red); }
.status-badge.running { background: #1e3a5f33; color: var(--blue); }
.btn { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 12px; font-weight: 600; background: var(--orange); color: var(--on-orange); }
.btn:hover { background: var(--orange-hover); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-sm { padding: 5px 12px; }
.btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--text2); }
.btn-ghost:hover { background: var(--bg3); }
</style>
