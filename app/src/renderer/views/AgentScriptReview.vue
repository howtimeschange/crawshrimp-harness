<template>
  <section class="script-review">
    <header class="review-head">
      <div class="review-title">
        <span class="title-main">脚本审核</span>
        <span class="title-sub">智能体脚本发布的第二道闸门(先测试、后审批)</span>
      </div>
      <button class="head-btn" type="button" @click="load">刷新</button>
    </header>

    <div class="review-body">
      <div class="review-list">
        <div v-if="loading" class="review-empty">加载中…</div>
        <div v-else-if="!revisions.length" class="review-empty">
          暂无脚本修订。智能体提交 <b>script_publish</b> 且审批卡通过后,会出现在这里等待测试与复核。
        </div>
        <button
          v-for="r in revisions"
          :key="r.rev_id"
          :class="['rev-row', { active: r.rev_id === selectedId }]"
          type="button"
          @click="select(r)"
        >
          <span class="rev-status" :class="r.status">{{ statusLabel(r.status) }}</span>
          <span class="rev-name">{{ revName(r) }}</span>
          <span class="rev-meta">{{ r.adapter_id || '通用' }} · {{ (r.updated_at || '').slice(5, 16).replace('T', ' ') }}</span>
        </button>
      </div>

      <div class="review-detail">
        <template v-if="selected">
          <!-- 测试运行中:内嵌正式脚本执行界面 -->
          <template v-if="testingTask">
            <div class="detail-head">
              <button class="back-btn" type="button" @click="testingTask = null">← 返回任务列表</button>
              <span class="detail-name">测试运行:{{ testingTask.task_name || testingTask.task_id }}</span>
              <span class="rev-status" :class="selected.status">{{ statusLabel(selected.status) }}</span>
            </div>
            <div class="task-runner-wrap">
              <TaskRunner
                :key="`review-${testAdapterId}-${testingTask.task_id}`"
                :adapter-id="testAdapterId"
                :task="testingTask"
                :initial-params="{}"
              />
            </div>
          </template>

          <!-- 常规:适配器预览 + 测试入口 + 审批 -->
          <template v-else>
            <div class="detail-head">
              <span class="detail-name">{{ revName(selected) }}</span>
              <span class="rev-status" :class="selected.status">{{ statusLabel(selected.status) }}</span>
            </div>

            <section class="review-gate" :class="gateTone">
              <div class="review-gate-main">
                <span class="review-gate-kicker">{{ gateKicker }}</span>
                <strong>{{ gateTitle }}</strong>
                <span>{{ gateDetail }}</span>
              </div>
              <div class="review-gate-badges">
                <span>{{ isManifestDraft ? '适配包入口' : '源文件草稿' }}</span>
                <span v-if="selected.test_adapter_id">测试区 {{ selected.test_adapter_id }}</span>
                <span v-if="sourceFileCount">{{ sourceFileCount }} 个文件</span>
              </div>
            </section>

            <div v-if="isReviewable && isManifestDraft" class="detail-spec-hint">
              先安装到隔离测试区，运行正式任务界面后再批准发布。
            </div>

            <div v-else-if="isReviewable && !isManifestDraft" class="detail-spec-hint warn">
              该修订不是 manifest.yaml 入口，不能进入测试安装和发布审批。
            </div>

            <!-- 适配器信息与测试入口 -->
            <div v-if="isManifestDraft && isReviewable" class="test-area">
              <template v-if="!testAdapter">
                <button class="test-install-btn" type="button" :disabled="busy" @click="installTest">
                  {{ busy === 'install' ? '安装中…' : '安装到测试区并测试' }}
                </button>
              </template>
              <template v-else>
                <div class="adapter-card">
                  <div class="adapter-card-head">
                    <span class="adapter-card-name">{{ testAdapter.name }}</span>
                    <span class="adapter-card-ver">v{{ testAdapter.version || '—' }}</span>
                    <button class="head-btn" type="button" :disabled="busy" @click="installTest">重新安装</button>
                  </div>
                  <div v-if="testAdapter.description" class="adapter-card-desc">{{ testAdapter.description }}</div>
                  <div class="adapter-card-tasks">
                    <div v-for="t in testTasks" :key="t.task_id" class="test-task-row">
                      <div class="test-task-info">
                        <span class="test-task-name">{{ t.task_name || t.task_id }}</span>
                        <span v-if="t.task_description" class="test-task-desc">{{ t.task_description }}</span>
                      </div>
                      <button class="run-btn" type="button" @click="testingTask = t">运行测试</button>
                    </div>
                    <div v-if="!testTasks.length" class="review-empty">适配器任务列表加载中或为空</div>
                  </div>
                </div>
              </template>
            </div>

            <section class="source-panel">
              <button class="source-toggle" type="button" @click="showSource = !showSource">
                <span>{{ showSource ? '收起源文件' : `查看源文件(${sourceFileCount || 1})` }}</span>
                <span aria-hidden="true">{{ showSource ? '↑' : '↓' }}</span>
              </button>
              <div v-if="showSource" class="package-files">
                <section v-for="file in packageFiles" :key="file.name" class="package-file">
                  <div class="package-file-name">{{ file.name }}</div>
                  <pre class="detail-content">{{ file.content || '(文件内容为空)' }}</pre>
                </section>
                <pre v-if="!packageFiles.length" class="detail-content">{{ content || '(草稿内容为空)' }}</pre>
              </div>
            </section>

            <div v-if="isReviewable" class="detail-actions">
              <button class="approve-btn" type="button" :disabled="busy || !canPublish" @click="decide('publish')">
                批准发布
              </button>
              <button class="reject-btn" type="button" :disabled="busy" @click="decide('reject')">
                拒绝
              </button>
            </div>
            <div v-else-if="resultMessage" class="detail-result">{{ resultMessage }}</div>
            <div v-if="busyMessage" class="detail-result warn">{{ busyMessage }}</div>
          </template>
        </template>
        <div v-else class="review-empty detail-empty">选择左侧修订,先安装测试区运行,确认无误后审批</div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import TaskRunner from './TaskRunner.vue'

const revisions = ref([])
const selectedId = ref('')
const selected = ref(null)
const content = ref('')
const packageFiles = ref([])
const loading = ref(false)
const busy = ref('')
const resultMessage = ref('')
const busyMessage = ref('')
const testAdapter = ref(null)
const testTasks = ref([])
const testingTask = ref(null)
const testAdapterId = ref('')
const showSource = ref(false)

const isReviewable = computed(() => ['pending_review', 'testing'].includes(selected.value?.status))
const canPublish = computed(() => selected.value?.status === 'testing' && Boolean(selected.value?.test_adapter_id))
const isManifestDraft = computed(() => {
  const path = String(selected.value?.draft_path || '')
  return path.split('/').pop() === 'manifest.yaml'
})
const sourceFileCount = computed(() => packageFiles.value.length || (content.value ? 1 : 0))
const gateTone = computed(() => {
  const status = selected.value?.status
  if (status === 'pending_review') return 'pending'
  if (status === 'testing') return 'testing'
  if (status === 'published') return 'published'
  if (status === 'rejected') return 'rejected'
  return 'draft'
})
const gateKicker = computed(() => {
  const status = selected.value?.status
  if (status === 'pending_review') return '待测试'
  if (status === 'testing') return '测试区'
  if (status === 'published') return '已完成'
  if (status === 'rejected') return '已结束'
  return '未提交'
})
const gateTitle = computed(() => {
  const status = selected.value?.status
  if (status === 'pending_review') return isManifestDraft.value ? '等待安装测试区' : '入口文件不符合发布条件'
  if (status === 'testing') return '可以运行任务界面复核'
  if (status === 'published') return '已发布到脚本库'
  if (status === 'rejected') return '该修订已拒绝'
  if (status === 'tested') return '仅完成规范校验'
  return '草稿还没有进入复核'
})
const gateDetail = computed(() => {
  const status = selected.value?.status
  if (status === 'pending_review') return isManifestDraft.value
    ? '安装后会出现正式任务运行入口。'
    : '需要以 manifest.yaml 作为适配包入口。'
  if (status === 'testing') return '运行测试任务确认页面行为，再决定批准或拒绝。'
  if (status === 'published') return '后续可在我的脚本和任务目录中使用。'
  if (status === 'rejected') return '测试安装已清理，不会进入正式脚本库。'
  if (status === 'tested') return '还需要提交发布审批，才会进入人工复核。'
  return '需要智能体提交 script_publish 并通过审批卡后，才会进入测试和审核。'
})

function statusLabel(status) {
  return {
    draft: '草稿',
    tested: '已测试',
    pending_review: '待复核',
    testing: '测试中',
    published: '已发布',
    rejected: '已拒绝',
  }[status] || status
}

function revName(rev) {
  const path = String(rev.draft_path || '')
  const name = path.split('/').pop() || rev.rev_id
  return name
}

async function load() {
  loading.value = true
  try {
    const result = await window.cs.agentApi('GET', '/agent/script-revisions')
    revisions.value = (result?.revisions || []).sort((a, b) => {
      const rank = { testing: 0, pending_review: 1, tested: 2, draft: 3, published: 4, rejected: 5 }
      return (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
    })
  } catch (error) {
    console.error('[script-review] 加载失败:', error)
    revisions.value = []
  } finally {
    loading.value = false
  }
}

async function select(rev) {
  selectedId.value = rev.rev_id
  selected.value = rev
  resultMessage.value = ''
  busyMessage.value = ''
  content.value = ''
  packageFiles.value = []
  testingTask.value = null
  testAdapter.value = null
  testTasks.value = []
  showSource.value = false
  try {
    const result = await window.cs.agentApi('GET', `/agent/script-revisions/${rev.rev_id}`)
    content.value = result?.content || ''
    packageFiles.value = result?.files || []
  } catch (error) {
    content.value = `(读取失败:${error?.message || error})`
  }
  // 已测试安装的修订:直接恢复适配器信息与任务列表
  if (rev.status === 'testing' && rev.test_adapter_id) {
    await refreshTestAdapter(rev.test_adapter_id)
  }
}

async function refreshTestAdapter(adapterId) {
  try {
    const tasks = await window.cs.getTasks()
    const mine = (tasks || []).filter((t) => t.adapter_id === adapterId)
    const first = mine[0]
    testAdapter.value = {
      id: adapterId,
      name: first?.adapter_name || adapterId,
      version: first?.adapter_version || '',
      description: first?.adapter_description || '',
    }
    testTasks.value = mine
    testAdapterId.value = adapterId
  } catch (error) {
    busyMessage.value = `任务列表加载失败:${error?.message || error}`
  }
}

async function installTest() {
  if (!selected.value || busy.value) return
  busy.value = 'install'
  busyMessage.value = ''
  resultMessage.value = ''
  try {
    const result = await window.cs.agentApi('POST', `/agent/script-revisions/${selected.value.rev_id}/test-install`)
    testAdapterId.value = result?.adapter_id || ''
    await load()
    const updated = revisions.value.find((r) => r.rev_id === selected.value.rev_id)
    if (updated) {
      selected.value = updated
      selectedId.value = updated.rev_id
    }
    if (result?.adapter) {
      testAdapter.value = {
        id: result.adapter.id,
        name: result.adapter.name,
        version: result.adapter.version,
        description: result.adapter.description,
      }
    }
    await refreshTestAdapter(testAdapterId.value)
    busyMessage.value = result?.message || '已安装到测试区'
  } catch (error) {
    busyMessage.value = `安装失败:${error?.message || error}`
  } finally {
    busy.value = ''
  }
}

async function decide(decision) {
  if (!selected.value || busy.value) return
  busy.value = 'decide'
  resultMessage.value = ''
  try {
    const result = await window.cs.agentApi('POST', `/agent/script-revisions/${selected.value.rev_id}/review`, { decision })
    if (result?.ok) {
      resultMessage.value = decision === 'publish'
        ? '已批准发布到脚本库(可在「我的脚本」查看)'
        : '已拒绝该修订(测试安装已卸载)'
      await load()
      const updated = revisions.value.find((r) => r.rev_id === selected.value.rev_id)
      if (updated) {
        selected.value = updated
        selectedId.value = updated.rev_id
      }
      testAdapter.value = null
      testTasks.value = []
      testingTask.value = null
    }
  } catch (error) {
    resultMessage.value = `操作失败:${error?.message || error}`
  } finally {
    busy.value = ''
  }
}

onMounted(load)
</script>

<style scoped>
.script-review {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
}
.package-files {
  display: grid;
  gap: 12px;
}
.package-file {
  min-width: 0;
}
.package-file-name {
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
  background: var(--bg2);
  color: var(--text2);
  font: 600 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.package-file .detail-content {
  margin-top: 0;
  border-radius: 0 0 8px 8px;
}
.review-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
}
.review-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.title-main {
  font-size: 15px;
  font-weight: 800;
  color: var(--text);
}
.title-sub {
  font-size: 11.5px;
  color: var(--text3);
}
.head-btn {
  margin-left: auto;
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: transparent;
  color: var(--text2);
  font-size: 12px;
  cursor: pointer;
}
.head-btn:hover {
  color: var(--text);
  background: var(--bg3);
}
.review-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.review-list {
  width: 300px;
  border-right: 1px solid var(--border);
  overflow-y: auto;
  padding: 10px;
}
.review-empty {
  padding: 18px 12px;
  color: var(--text3);
  font-size: 12px;
  line-height: 1.6;
}
.rev-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  margin-bottom: 6px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: var(--bg2);
  color: var(--text2);
  cursor: pointer;
}
.rev-row:hover {
  border-color: var(--border);
}
.rev-row.active {
  border-color: var(--orange);
  background: var(--bg3);
}
.rev-status {
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 999px;
  width: fit-content;
  background: var(--bg3);
  color: var(--text3);
}
.rev-status.pending_review {
  background: var(--orange-bg);
  color: var(--orange);
}
.rev-status.testing {
  background: rgba(96, 165, 250, 0.16);
  color: var(--blue);
}
.rev-status.published {
  background: rgba(52, 199, 89, 0.15);
  color: var(--green);
}
.rev-status.rejected {
  background: rgba(255, 59, 48, 0.12);
  color: var(--red);
}
.rev-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}
.rev-meta {
  font-size: 11px;
  color: var(--text3);
}
.review-detail {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 14px 18px;
  gap: 10px;
}
.detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.detail-name {
  font-size: 14px;
  font-weight: 800;
  color: var(--text);
}
.back-btn {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: transparent;
  color: var(--text2);
  font-size: 12px;
  cursor: pointer;
}
.back-btn:hover {
  color: var(--text);
  background: var(--bg3);
}
.detail-spec-hint {
  font-size: 12px;
  line-height: 1.55;
  color: var(--text3);
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
}
.detail-spec-hint.warn {
  border-color: rgba(255, 59, 48, 0.25);
  color: var(--red);
  background: rgba(255, 59, 48, 0.08);
}
.review-gate {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg2);
}
.review-gate.pending {
  border-color: rgba(255, 149, 0, 0.42);
  background: var(--orange-bg);
}
.review-gate.testing {
  border-color: rgba(96, 165, 250, 0.38);
  background: rgba(96, 165, 250, 0.1);
}
.review-gate.published {
  border-color: rgba(52, 199, 89, 0.34);
  background: rgba(52, 199, 89, 0.08);
}
.review-gate.rejected {
  border-color: rgba(255, 59, 48, 0.3);
  background: rgba(255, 59, 48, 0.08);
}
.review-gate-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.review-gate-kicker {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--text3);
}
.review-gate-main strong {
  font-size: 14px;
  color: var(--text);
}
.review-gate-main span:last-child {
  font-size: 12px;
  color: var(--text2);
}
.review-gate-badges {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  max-width: 44%;
}
.review-gate-badges span {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg);
  color: var(--text2);
  font-size: 11px;
  line-height: 1.2;
}
.test-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.test-install-btn {
  align-self: flex-start;
  padding: 9px 20px;
  border-radius: 8px;
  border: none;
  background: var(--blue);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.test-install-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.adapter-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg2);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.adapter-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.adapter-card-head .head-btn {
  margin-left: auto;
}
.adapter-card-name {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--text);
}
.adapter-card-ver {
  font-size: 11px;
  color: var(--text3);
}
.adapter-card-desc {
  font-size: 12px;
  color: var(--text2);
  line-height: 1.5;
}
.adapter-card-tasks {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.test-task-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}
.test-task-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.test-task-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
}
.test-task-desc {
  font-size: 11.5px;
  color: var(--text3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.run-btn {
  flex: none;
  padding: 6px 16px;
  border-radius: 7px;
  border: 1px solid var(--orange);
  background: transparent;
  color: var(--orange);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.run-btn:hover {
  background: var(--orange-bg);
}
.detail-content {
  flex: 1;
  min-height: 140px;
  max-height: 300px;
  overflow: auto;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}
.source-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.source-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 8px 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  color: var(--text2);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.source-toggle:hover {
  color: var(--text);
  background: var(--bg3);
}
.task-runner-wrap {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg);
}
.detail-actions {
  display: flex;
  gap: 10px;
}
.approve-btn,
.reject-btn {
  padding: 9px 22px;
  border-radius: 8px;
  border: none;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.approve-btn {
  background: var(--orange);
  color: #fff;
}
.reject-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text2);
}
.approve-btn:disabled,
.reject-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.detail-result {
  font-size: 12.5px;
  color: var(--green);
}
.detail-result.warn {
  color: var(--text2);
}
.detail-empty {
  margin: auto;
}
</style>
