<template>
  <div v-if="cards.length" class="agent-product-layer">
    <div v-for="card in cards" :key="card.uid" class="product-card" :class="card.kind">
      <!-- 任务卡 -->
      <template v-if="card.kind === 'task'">
        <div class="product-card-head">
          <span class="product-card-icon">📋</span>
          <span class="product-card-title">{{ card.title || '任务实例' }}</span>
          <span class="product-card-status" :class="taskStatusClass(card)">{{ taskStatusLabel(card) }}</span>
          <button class="product-card-close" type="button" title="关闭" @click="dismiss(card)">×</button>
        </div>
        <div class="product-card-uid">{{ card.taskInstanceUid }}</div>
        <div v-if="card.step" class="product-card-meta">当前步骤:{{ card.step }}</div>
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

const emit = defineEmits(['open-task-instance', 'browser-auto-open', 'browser-open-tabs', 'artifact-show'])

const cards = ref([])
let stopEvents = null
let taskPollTimer = null

function taskStatusLabel(card) {
  if (card.status === 'completed') return '已完成'
  if (card.status === 'failed') return '失败'
  if (card.status === 'canceled') return '已取消'
  if (card.status === 'paused') return '已暂停'
  return '运行中'
}

function taskStatusClass(card) {
  if (card.status === 'completed') return 'completed'
  if (card.status === 'failed' || card.status === 'canceled') return 'failed'
  if (card.status === 'paused') return 'paused'
  return 'running'
}

// 任务卡实时刷新:每 5s 轮询任务实例状态(方案 §11 任务卡由前端独立跟进进度)
async function pollTaskStatuses() {
  const taskCards = cards.value.filter((c) => c.kind === 'task' && c.status === 'running')
  for (const card of taskCards) {
    try {
      const result = await window.cs.agentApi('GET', `/agent/task-instances/${card.taskInstanceUid}`)
      if (!result) continue
      card.status = result.status || card.status
      card.step = result.current_step || ''
      card.title = result.title || card.title || ''
      if (card.status === 'completed' && Array.isArray(result.artifacts) && result.artifacts.length) {
        for (const item of result.artifacts.slice(0, 3)) {
          const filename = item.label || item.filename || ''
          if (filename && !cards.value.some((c) => c.kind === 'artifact' && c.filename === filename)) {
            pushCard({
              kind: 'artifact',
              artifactId: item.id,
              filename,
              path: item.path || '',
              size: item.size || 0,
              taskInstanceUid: card.taskInstanceUid,
            })
          }
        }
      }
    } catch { /* 后端暂时不可达,下轮重试 */ }
  }
}

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

function formatSize(size) {
  const n = Number(size) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
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
      // 会话内直接显示:图片多图/视频可播放/附件可点击。
      // 直接 postMessage 到智能体会话 iframe(不经 App/props 中转,链路最短最稳);
      // 同时保留 emit 供其他消费方。
      emit('artifact-show', {
        filename: data?.filename || '',
        path: data?.path || '',
        size: data?.size || 0,
        mediaKind: data?.media_kind || 'file',
        zipImages: Array.isArray(data?.zip_images) ? data.zip_images : [],
      })
      pushArtifactToSession(data)
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
    case 'browser.activity': {
      // 智能体正在调用浏览器工具 → 多窗口实时浏览器跟随会话/页面
      const tabs = Array.isArray(data?.tabs) ? data.tabs : []
      if (tabs.length) {
        emit('browser-open-tabs', { tabs, activeTabId: data?.active_tab_id || '' })
      } else {
        emit('browser-auto-open')
      }
      break
    }
    case 'tool.requested': {
      // 浏览器类工具调用(browser_observe/act/navigate 等)→ 自动弹出实时浏览器
      const name = String(data?.tool_name || '')
      if (name.startsWith('browser_')) emit('browser-auto-open')
      break
    }
    default:
      break
  }
}

let rebindTimer = null

// ---- 会话内媒体直接显示:SSE 事件 → iframe(DSH 消息流)直接注入 ----
const sentSessionArtifacts = []

async function pushArtifactToSession(data) {
  const path = String(data?.path || '').trim()
  if (!path) return
  const urlFor = async (entry) => {
    try {
      return window.cs?.agentMediaUrl ? await window.cs.agentMediaUrl(path, entry || null) : ''
    } catch {
      return ''
    }
  }
  const zipImages = Array.isArray(data?.zip_images) ? data.zip_images : []
  const [fileUrl, entryUrls] = await Promise.all([
    urlFor(null),
    Promise.all(zipImages.map((e) => urlFor(e))),
  ])
  const msg = {
    __crawshrimp: 'artifact-show',
    artifact: {
      filename: data?.filename || '',
      path,
      size: data?.size || 0,
      mediaKind: data?.media_kind || 'file',
      zipImages,
    },
    urls: {
      file: fileUrl,
      entries: entryUrls,
    },
    ts: Date.now(),
  }
  // 稳定定位智能体会话 iframe(AgentWebView 根容器内)
  const target = (document.querySelector('.agent-web-view iframe') || document.querySelector('iframe'))?.contentWindow
  if (target) {
    target.postMessage(msg, '*')
  }
  sentSessionArtifacts.push(msg)
  if (sentSessionArtifacts.length > 12) sentSessionArtifacts.shift()
}

function onSessionMessage(event) {
  const data = event?.data
  if (!data || !data.__crawshrimp) return
  // 仅接受智能体会话 iframe 的请求
  const iframeEl = document.querySelector('.agent-web-view iframe') || document.querySelector('iframe')
  if (event.source && iframeEl && event.source !== iframeEl.contentWindow) return
  if (data.__crawshrimp === 'artifact-replay') {
    // iframe(会话界面)重载后请求重放:把最近的产物媒体消息重发一遍
    if (iframeEl?.contentWindow && sentSessionArtifacts.length) {
      for (const msg of sentSessionArtifacts) iframeEl.contentWindow.postMessage(msg, '*')
    }
  }
}

async function bindEvents() {
  stopEvents?.()
  try {
    stopEvents = window.cs.streamGlobalAgentEvents(0, {
      onEvent: ({ event: eventType, data }) => handleEvent(eventType, data),
      onError: (error) => {
        console.warn('[agent] 全局事件流连接失败,4s 后重连:', error?.message)
        scheduleRebind()
      },
      onDone: () => scheduleRebind(),
    })
  } catch (error) {
    console.warn('[agent] 全局事件流连接失败:', error)
    scheduleRebind()
  }
}

// 后端重启会断开 SSE,自动重连保证事件链不断(审批/任务/产物/会话内媒体)
function scheduleRebind() {
  if (rebindTimer) return
  rebindTimer = setTimeout(() => {
    rebindTimer = null
    bindEvents()
  }, 4000)
}

onMounted(() => {
  bindEvents()
  taskPollTimer = setInterval(pollTaskStatuses, 5000)
  window.addEventListener('message', onSessionMessage)
})
onUnmounted(() => {
  stopEvents?.()
  window.removeEventListener('message', onSessionMessage)
  if (rebindTimer) {
    clearTimeout(rebindTimer)
    rebindTimer = null
  }
  if (taskPollTimer) clearInterval(taskPollTimer)
})
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
.product-card-status { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
.product-card-status.running { background: rgba(96, 165, 250, 0.16); color: var(--blue); }
.product-card-status.completed { background: rgba(74, 222, 128, 0.14); color: var(--green); }
.product-card-status.failed { background: rgba(248, 113, 113, 0.14); color: var(--red); }
.product-card-status.paused { background: rgba(251, 191, 36, 0.16); color: var(--yellow); }

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
