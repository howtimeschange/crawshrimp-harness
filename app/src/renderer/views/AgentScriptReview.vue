<template>
  <section class="script-review">
    <header class="review-head">
      <div class="review-title">
        <span class="title-main">脚本审核</span>
        <span class="title-sub">智能体脚本发布的第二道闸门(人工复核)</span>
      </div>
      <button class="head-btn" type="button" @click="load">刷新</button>
    </header>

    <div class="review-body">
      <div class="review-list">
        <div v-if="loading" class="review-empty">加载中…</div>
        <div v-else-if="!revisions.length" class="review-empty">
          暂无脚本修订。智能体提交 <b>script_publish</b> 且审批卡通过后,会出现在这里等待复核。
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
          <div class="detail-head">
            <span class="detail-name">{{ revName(selected) }}</span>
            <span class="rev-status" :class="selected.status">{{ statusLabel(selected.status) }}</span>
          </div>
          <div v-if="selected.status === 'pending_review'" class="detail-spec-hint">
            发布规范:抓虾适配器 = manifest.yaml + 页面 JS 脚本(async IIFE 返回 &#123; success, data, meta &#125;);独立 Python 脚本不符合规范,无法发布。
          </div>
          <pre class="detail-content">{{ content || '(草稿内容为空)' }}</pre>
          <div v-if="selected.status === 'pending_review'" class="detail-actions">
            <button class="approve-btn" type="button" :disabled="busy" @click="decide('publish')">
              发布到脚本库
            </button>
            <button class="reject-btn" type="button" :disabled="busy" @click="decide('reject')">
              拒绝
            </button>
          </div>
          <div v-else-if="resultMessage" class="detail-result">{{ resultMessage }}</div>
        </template>
        <div v-else class="review-empty detail-empty">选择左侧修订查看草稿内容</div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue'

const revisions = ref([])
const selectedId = ref('')
const selected = ref(null)
const content = ref('')
const loading = ref(false)
const busy = ref(false)
const resultMessage = ref('')

function statusLabel(status) {
  return {
    draft: '草稿',
    tested: '已测试',
    pending_review: '待复核',
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
      const rank = { pending_review: 0, tested: 1, draft: 2, published: 3, rejected: 4 }
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
  content.value = ''
  try {
    const result = await window.cs.agentApi('GET', `/agent/script-revisions/${rev.rev_id}`)
    content.value = result?.content || ''
  } catch (error) {
    content.value = `(读取失败:${error?.message || error})`
  }
}

async function decide(decision) {
  if (!selected.value || busy.value) return
  busy.value = true
  resultMessage.value = ''
  try {
    const result = await window.cs.agentApi('POST', `/agent/script-revisions/${selected.value.rev_id}/review`, { decision })
    if (result?.ok) {
      resultMessage.value = decision === 'publish'
        ? `已发布 → ${result.path || '脚本库'}`
        : '已拒绝该修订'
      await load()
      const updated = revisions.value.find((r) => r.rev_id === selected.value.rev_id)
      if (updated) {
        selected.value = updated
        selectedId.value = updated.rev_id
      }
    }
  } catch (error) {
    resultMessage.value = `操作失败:${error?.message || error}`
  } finally {
    busy.value = false
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
.detail-spec-hint {
  font-size: 12px;
  line-height: 1.55;
  color: var(--text3);
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
}
.detail-name {
  font-size: 14px;
  font-weight: 800;
  color: var(--text);
}
.detail-content {
  flex: 1;
  min-height: 0;
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
.detail-empty {
  margin: auto;
}
</style>
