<template>
  <section class="panel automation-permissions">
    <div class="panel-head">
      <div><p class="panel-kicker">应用</p><h3>桌面自动化权限</h3></div>
      <span class="badge neutral">{{ applications.length }} 个应用</span>
    </div>
    <div class="side-note permission-intro">
      <strong>选择需要控制的应用</strong>
      <p>勾选需要抓虾控制的应用，点击“授权所选应用”。已授权的会直接更新状态；需要授权的，macOS 会逐个弹窗确认。</p>
      <p>授权后，抓虾可按你的任务要求读取内容或操作应用。如需取消授权，点击下方“管理系统授权”，在 macOS 中关闭对应应用，返回后会自动刷新状态。取消勾选仅改变本次选择。</p>
    </div>
    <div class="application-toolbar">
      <input v-model="query" class="input" aria-label="搜索本机应用" placeholder="搜索应用名称或 Bundle ID" :disabled="busy" @input="page = 0" />
      <label class="selected-filter"><input v-model="onlySelected" type="checkbox" :disabled="busy" @change="page = 0" />仅看已选</label>
      <button class="btn-ghost" :disabled="busy || loading" @click="load">{{ loading ? '正在读取…' : '刷新列表' }}</button>
    </div>
    <p v-if="error" class="permission-error" role="alert">{{ error }}</p>
    <div class="application-list" aria-label="本机应用列表" :aria-busy="loading">
      <div class="application-list-head"><span>应用</span><span>AppleScript 权限</span></div>
      <div v-for="application in visible" :key="application.bundle_id" class="application-row">
        <label class="application-choice">
          <input v-model="selected" type="checkbox" :value="application.bundle_id" :disabled="busy" :aria-label="`选择 ${application.name}`" />
          <img v-if="application.icon_data_url && !failedIcons[application.bundle_id]" class="app-icon" :src="application.icon_data_url" alt="" loading="lazy" @error="failedIcons[application.bundle_id] = true" />
          <span v-else class="app-mark" aria-hidden="true">{{ application.name.slice(0, 1).toUpperCase() }}</span>
          <span class="application-copy"><strong>{{ application.name }}</strong><small>{{ application.bundle_id }}<template v-if="application.running"> · 运行中</template></small></span>
        </label>
        <button class="status-button" :aria-label="`查看 ${application.name} 权限详情`" @click="detailId = application.bundle_id">
          <span :class="['badge', results[application.bundle_id]?.status === 'authorized' ? 'on' : results[application.bundle_id]?.canRequest ? 'pending' : 'neutral']">{{ label(results[application.bundle_id]) }}</span>
        </button>
      </div>
      <p v-if="!visible.length" class="empty-list">{{ loading ? '正在读取本机应用…' : '没有匹配的应用' }}</p>
    </div>
    <div class="list-navigation">
      <span>共 {{ filtered.length }} 个匹配 · 第 {{ Math.min(page + 1, pageCount) }} / {{ pageCount }} 页</span>
      <div class="panel-actions">
        <button class="btn-ghost" :disabled="page === 0 || busy" @click="page--">上一页</button>
        <button class="btn-ghost" :disabled="page + 1 >= pageCount || busy" @click="page++">下一页</button>
      </div>
    </div>
    <div class="panel-actions permission-actions">
      <span class="selection-count">已选 {{ selected.length }} 个 · {{ grantable.length }} 个待授权</span>
      <button class="btn-ghost" :disabled="busy" @click="manage">管理系统授权</button>
      <button class="btn-orange" :disabled="busy || !selected.length" @click="batch">授权所选应用</button>
      <button v-if="busy" class="btn-ghost" :disabled="stopRequested" @click="stopRequested = true">{{ stopRequested ? '本次结束后停止' : '停止后续操作' }}</button>
      <button v-else class="btn-ghost" :disabled="!selected.length" @click="selected = []; page = 0">清空选择</button>
    </div>
    <p v-if="progress" class="field-hint" role="status">{{ progress }}</p>
    <div v-if="detailApp" class="side-note permission-result" role="status" aria-live="polite">
      <strong>{{ detailApp.name }} · {{ label(detail) }}</strong>
      <p>{{ detail?.target_path || detailApp.path }}</p>
      <p>{{ detail?.message || '尚未检查。勾选此应用后点击“授权所选应用”，将自动判断当前状态。' }}</p>
      <p v-if="detail?.canRequest">用途：在你要求的桌面任务中读取和操作 {{ detailApp.name }}。点击“授权所选应用”才会请求系统授权。</p>
      <p v-if="detail?.status === 'authorized'">可回到原任务继续。智能体会在执行环境复检，不自动重发已投递的操作。</p>
      <p v-if="detail?.fallback === 'ax'">AX 通道可用，可操作已观察到、支持相应动作的控件。</p>
      <p v-if="!detailApp.scripting_declared">此应用未声明脚本字典，是否支持具体 AppleScript 指令仍需在任务中确认。</p>
      <details v-if="detail"><summary>诊断信息</summary><pre>{{ JSON.stringify(detail, null, 2) }}</pre></details>
    </div>
    <p class="field-hint">列表来自 /Applications、/System/Applications、~/Applications 和当前运行的应用（含 System Events）。{{ partial ? '部分目录无法读取，可打开目标应用后刷新列表。' : '其他位置的软件可先打开，再刷新列表。' }}</p>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { runPermissionBatch } from '../utils/automationPermissionBatch.mjs'
const failedIcons = ref({})
const applications = ref([]), selected = ref([]), results = ref({}), query = ref(''), onlySelected = ref(false), page = ref(0)
const loading = ref(false), busy = ref(false), error = ref(''), progress = ref(''), detailId = ref(''), partial = ref(false), stopRequested = ref(false)
const labels = { authorized: '已授权', not_determined: '待授权', denied_or_restricted: '已拒绝 / 受限', configuration_blocked: '配置不完整', sandbox_restricted: '沙箱限制', target_unavailable: '应用不可用', target_not_running: '请先打开应用', unsupported: '系统不适用', unknown: '待确认' }
const label = result => result ? labels[result.status] || '待确认' : '未检查'
const filtered = computed(() => applications.value.filter(app => (!onlySelected.value || selected.value.includes(app.bundle_id)) && `${app.name} ${app.bundle_id}`.toLowerCase().includes(query.value.trim().toLowerCase())))
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / 12)))
const visible = computed(() => filtered.value.slice(page.value * 12, (page.value + 1) * 12))
const grantable = computed(() => selected.value.filter(id => results.value[id]?.canRequest))
const detailApp = computed(() => applications.value.find(app => app.bundle_id === detailId.value))
const detail = computed(() => results.value[detailId.value])
let awaitingSystemReturn = false
let refreshAfterManagement = []
async function manage() {
  if (busy.value) return
  stopRequested.value = false
  try {
    refreshAfterManagement = [...new Set([...Object.keys(results.value), ...selected.value])]
    awaitingSystemReturn = true
    const response = await window.cs.manageAutomationPermissions()
    if (!response.opened) awaitingSystemReturn = false
    progress.value = '请在系统“自动化”中关闭或开启目标应用。返回抓虾后会刷新已查看及已选应用的状态。'
  } catch (err) { awaitingSystemReturn = false; error.value = err.message || String(err) }
}
async function onReturn() {
  if (!awaitingSystemReturn || busy.value) return
  awaitingSystemReturn = false; busy.value = true
  try {
    await runPermissionBatch({ ids: refreshAfterManagement, call: id => window.cs.checkAutomationPermission(id),
      onResult: (id, result) => { results.value[id] = result }, shouldStop: () => stopRequested.value })
    progress.value = '已重新读取系统授权状态。'
  } finally { busy.value = false }
}
onBeforeUnmount(() => { stopRequested.value = true; window.removeEventListener('focus', onReturn) })
onMounted(() => { window.addEventListener('focus', onReturn); load() })
async function load() {
  if (loading.value || busy.value) return
  loading.value = true; error.value = ''
  try {
    if (!window.cs?.listAutomationApplications) throw new Error('请在最新版抓虾桌面客户端中查看本机应用。')
    const result = await window.cs.listAutomationApplications()
    if (result.status !== 'ok') throw new Error('AppleScript 授权仅适用于 macOS。')
    applications.value = result.applications; partial.value = !!result.unavailable_roots?.length
    selected.value = selected.value.filter(id => applications.value.some(app => app.bundle_id === id))
    failedIcons.value = {}; results.value = {}; progress.value = ''; page.value = 0
  } catch (err) { error.value = err.message || String(err) }
  finally { loading.value = false }
}
async function batch() {
  if (busy.value) return
  const ids = [...selected.value]
  if (!ids.length) return
  busy.value = true; stopRequested.value = false; error.value = ''
  let count = 0
  try {
    await runPermissionBatch({ ids, shouldStop: () => stopRequested.value,
      call: async id => {
        detailId.value = id
        progress.value = `正在检查或等待授权：${applications.value.find(app => app.bundle_id === id)?.name}（${count + 1}/${ids.length}）`
        return window.cs.requestAutomationPermission(id)
      },
      onResult: (id, result) => { results.value[id] = result; count++ },
    })
    progress.value = `${stopRequested.value ? '已停止后续操作' : '处理完成'}：${count}/${ids.length} 个应用。`
  } finally { busy.value = false }
}
</script>
<style scoped src="../views/settingsPanel.css"></style>
<style scoped>
.application-toolbar { display: flex; align-items: center; gap: 12px; }
.application-toolbar .input { flex: 1; }
.selected-filter { display: flex; align-items: center; gap: 7px; white-space: nowrap; font-size: 12px; color: var(--text2); }
input[type=checkbox] { accent-color: var(--orange); width: 15px; height: 15px; flex-shrink: 0; cursor: pointer; }
.application-list { border: 1px solid var(--border); border-radius: 9px; max-height: 360px; overflow: auto; }
.application-list-head, .application-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 11px 14px; }
.application-list-head { position: sticky; top: 0; z-index: 1; background: var(--bg3); color: var(--text3); font-size: 11px; }
.application-row + .application-row { border-top: 1px solid var(--border); }
.application-row:hover { background: var(--soft-fill); }
.application-choice { display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1; cursor: pointer; }
.app-icon { width: 32px; height: 32px; object-fit: contain; flex-shrink: 0; }
.app-mark { display: grid; place-items: center; flex-shrink: 0; width: 30px; height: 30px; border-radius: 8px; background: var(--bg3); border: 1px solid var(--border); color: var(--text2); font-size: 13px; }
.application-copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.application-copy strong { font-size: 13px; color: var(--text); overflow-wrap: anywhere; }
.application-copy small { color: var(--text3); font-size: 11px; overflow-wrap: anywhere; }
.status-button { border: 0; padding: 0; background: transparent; cursor: pointer; flex-shrink: 0; }
.badge.pending { color: var(--orange-text); background: var(--soft-fill); }
.list-navigation { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--text3); font-size: 11px; }
.permission-actions { flex-wrap: wrap; border-top: 1px solid var(--border); padding-top: 16px; }
.selection-count { font-size: 12px; color: var(--text2); margin-right: auto; }
.permission-error { margin: 0; color: var(--red); font-size: 12px; line-height: 1.6; }
.permission-result pre { margin: 12px 0 0; overflow-wrap: anywhere; white-space: pre-wrap; font-size: 11px; color: var(--text3); }
summary { cursor: pointer; font-size: 12px; color: var(--text2); }
.empty-list { padding: 18px; color: var(--text3); font-size: 12px; }
@media (max-width: 980px) { .application-toolbar { flex-wrap: wrap; } .application-toolbar .input { flex-basis: 100%; } }
</style>
