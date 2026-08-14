<template>
  <div v-if="cards.length" class="agent-product-layer">
    <div v-for="card in cards" :key="card.uid" class="product-card" :class="card.kind">
      <!-- 审批卡 -->
      <template v-if="card.kind === 'approval'">
        <div class="product-card-head">
          <span class="product-card-icon">⚠️</span>
          <span class="product-card-title">需要你的批准</span>
          <button class="product-card-close" type="button" title="关闭" @click="dismiss(card)">×</button>
        </div>
        <div class="product-card-body">{{ approvalSummary(card) }}</div>
        <div class="product-card-risk">风险等级:{{ card.risk || 'read_only' }}</div>
        <div v-if="card.status === 'pending'" class="product-card-actions">
          <button class="product-btn approve" type="button" @click="decide(card, 'approved')">批准执行</button>
          <button class="product-btn reject" type="button" @click="decide(card, 'rejected')">拒绝</button>
        </div>
        <div v-else class="product-card-decided">已{{ card.status === 'approved' ? '批准' : '拒绝' }}</div>
      </template>

      <!-- 任务卡 -->
      <template v-else-if="card.kind === 'task'">
        <div class="product-card-head">
          <span class="product-card-icon">📋</span>
          <span class="product-card-title">任务实例</span>
          <span class="product-card-status running">运行中</span>
          <button class="product-card-close" type="button" title="关闭" @click="dismiss(card)">×</button>
        </div>
        <div class="product-card-uid">{{ card.taskInstanceUid }}</div>
        <div class="product-card-actions">
          <button class="product-btn" type="button" @click="openTask(card)">在任务中心打开</button>
        </div>
      </template>

      <!-- 产物卡 -->
      <template v-else-if="card.kind === 'artifact'">
        <div class="product-card-head">
          <span class="product-card-icon">📎</span>
          <span class="product-card-title">任务产物</span>
          <button class="product-card-close" type="button" title="关闭" @click="dismiss(card)">×</button>
        </div>
        <div class="product-card-name">{{ card.filename }}</div>
        <div class="product-card-meta">{{ formatSize(card.size) }} · {{ card.taskInstanceUid }}</div>
        <div class="product-card-actions">
          <button class="product-btn" type="button" @click="openArtifact(card)">打开</button>
          <button class="product-btn" type="button" @click="revealArtifact(card)">定位</button>
        </div>
      </template>

      <!-- 提示卡 -->
      <template v-else>
        <div class="product-card-head">
          <span class="product-card-icon">ℹ️</span>
          <span class="product-card-title">智能体</span>
          <button class="product-card-close" type="button" title="关闭" @click="dismiss(card)">×</button>
        </div>
        <div class="product-card-body">{{ card.text }}</div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'

const emit = defineEmits(['open-task-instance'])

const cards = ref([])
let stopEvents = null

function pushCard(card) {
  card.uid = card.uid || `${card.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  // 同一任务的重复卡只保留最新一张
  const dupKey = card.kind === 'task' ? card.taskInstanceUid : null
  if (dupKey) {
    cards.value = cards.value.filter((c) => !(c.kind === 'task' && c.taskInstanceUid === dupKey))
  }
  cards.value.push(card)
  if (cards.value.length > 4) cards.value = cards.value.slice(-4)
}

function dismiss(card) {
  cards.value = cards.value.filter((c) => c !== card)
}

function approvalSummary(card) {
  const s = card.summary || {}
  const parts = []
  if (s.tool_name) parts.push(String(s.tool_name))
  if (s.title) parts.push(String(s.title))
  if (s.action) parts.push(String(s.action))
  const extra = s.detail || s.description
  if (extra) parts.push(String(extra).slice(0, 160))
  return parts.join(' · ') || '一个敏感操作需要你的批准'
}

function formatSize(size) {
  const n = Number(size) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

async function decide(card, decision) {
  try {
    await window.cs.agentApi('POST', `/agent/approvals/${card.approvalId}/decision`, { decision })
    card.status = decision
  } catch (error) {
    card.status = 'error'
    pushCard({ kind: 'notice', text: `审批操作失败:${error?.message || error}` })
  }
}

function openTask(card) {
  if (card.taskInstanceUid) emit('open-task-instance', card.taskInstanceUid)
}

async function openArtifact(card) {
  if (!card.path) return
  try { await window.cs.openFile(card.path) } catch (error) {
    pushCard({ kind: 'notice', text: `打开失败:${error?.message || error}` })
  }
}

async function revealArtifact(card) {
  if (!card.path) return
  try { await window.cs.revealFile(card.path) } catch (error) {
    pushCard({ kind: 'notice', text: `定位失败:${error?.message || error}` })
  }
}

function handleEvent(eventType, data) {
  switch (eventType) {
    case 'tool.approval_required': {
      pushCard({
        kind: 'approval',
        approvalId: data?.approval_id || '',
        summary: data?.summary || {},
        risk: data?.risk || 'read_only',
        status: 'pending',
      })
      break
    }
    case 'task.linked': {
      pushCard({
        kind: 'task',
        taskInstanceUid: data?.task_instance_uid || '',
        planId: data?.plan_id || '',
        status: 'running',
      })
      break
    }
    case 'artifact.created': {
      pushCard({
        kind: 'artifact',
        artifactId: data?.artifact_id,
        filename: data?.filename || `artifact-${data?.artifact_id}`,
        path: data?.path || '',
        size: data?.size || 0,
        taskInstanceUid: data?.task_instance_uid || '',
      })
      break
    }
    case 'run.failed': {
      pushCard({ kind: 'notice', text: `运行失败:${data?.error || data?.error_code || '未知错误'}` })
      break
    }
    case 'run.canceled': {
      pushCard({ kind: 'notice', text: '已停止回答(已启动的业务任务不受影响)' })
      break
    }
    default:
      break
  }
}

async function bindEvents() {
  stopEvents?.()
  try {
    stopEvents = window.cs.streamGlobalAgentEvents(0, {
      onEvent: ({ event: eventType, data }) => handleEvent(eventType, data),
      onError: (error) => console.warn('[agent] 全局事件流连接失败:', error?.message),
    })
  } catch (error) {
    console.warn('[agent] 全局事件流连接失败:', error)
  }
  await loadPendingApprovals()
}

// 恢复未决策审批卡(刷新/晚连接不丢失)
async function loadPendingApprovals() {
  try {
    const result = await window.cs.agentApi('GET', '/agent/approvals?status=pending')
    for (const item of result?.approvals || []) {
      if (!cards.value.some((c) => c.kind === 'approval' && c.approvalId === item.approval_id)) {
        pushCard({
          kind: 'approval',
          approvalId: item.approval_id,
          summary: item.summary || {},
          risk: item.risk || 'read_only',
          status: 'pending',
        })
      }
    }
  } catch (error) {
    console.warn('[agent] 拉取待审批列表失败:', error?.message)
  }
}

onMounted(bindEvents)
onUnmounted(() => { stopEvents?.() })
</script>

<style scoped>
.agent-product-layer {
  position: fixed;
  right: 14px;
  bottom: 14px;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 340px;
  max-width: calc(100vw - 28px);
  pointer-events: none;
}

.product-card {
  pointer-events: auto;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 6px 18px var(--shadow);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.product-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.product-card-icon {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex: none;
  background: var(--soft-fill);
}
.product-card.approval .product-card-icon { background: rgba(251, 191, 36, 0.16); }
.product-card.task .product-card-icon { background: rgba(96, 165, 250, 0.16); }
.product-card.artifact .product-card-icon { background: rgba(74, 222, 128, 0.14); }
.product-card.notice .product-card-icon { background: var(--orange-bg); }
.product-card-title { flex: 1; font-size: 13px; font-weight: 600; color: var(--text); }
.product-card-close {
  border: none;
  background: transparent;
  color: var(--text3);
  font-size: 16px;
  cursor: pointer;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 6px;
}
.product-card-close:hover { color: var(--text); background: var(--soft-fill-hover); }

.product-card-body { font-size: 12.5px; color: var(--text2); line-height: 1.5; word-break: break-all; }
.product-card-risk { font-size: 12px; color: var(--yellow); }
.product-card-uid, .product-card-meta { font-size: 12px; color: var(--text3); word-break: break-all; }
.product-card-name { font-size: 13px; color: var(--text); word-break: break-all; }
.product-card-status { font-size: 11px; padding: 2px 8px; border-radius: 999px; }
.product-card-status.running { background: var(--blue); color: #0b1220; }

.product-card-actions { display: flex; gap: 8px; }
.product-btn {
  flex: 1;
  border: 1px solid var(--border-strong);
  background: var(--bg3);
  color: var(--text);
  font-size: 12.5px;
  padding: 7px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.product-btn:hover { background: var(--soft-fill-hover); }
.product-btn.approve { background: var(--orange); border-color: var(--orange); color: var(--on-orange); font-weight: 600; }
.product-btn.approve:hover { background: var(--orange-hover); }
.product-btn.reject { background: transparent; color: var(--red); border-color: var(--red); }

.product-card-decided { font-size: 12.5px; color: var(--text3); }
</style>
