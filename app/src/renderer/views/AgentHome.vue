<template>
  <section class="agent-home">
    <!-- 中间:会话区 -->
    <div class="agent-chat">
      <header class="chat-head">
        <div class="chat-title">
          <span class="chat-title-text">{{ sessionTitle }}</span>
          <span class="chat-subtitle">智能体</span>
          <span v-if="queuePosition > 0" class="chat-queue">排队中(第 {{ queuePosition }} 位)</span>
        </div>
        <div class="chat-actions">
          <button
            v-if="!browserOpen"
            class="head-btn"
            type="button"
            title="展开浏览器面板"
            aria-label="展开浏览器面板"
            @click="browserOpen = true"
          >
            🌐 浏览器
          </button>
          <button
            class="head-btn stop-btn"
            type="button"
            title="停止回答"
            aria-label="停止回答"
            :disabled="!activeRunId"
            @click="stopRun"
          >
            ⏹ 停止
          </button>
        </div>
      </header>

      <div ref="messageListEl" class="chat-messages">
        <div v-if="!messages.length" class="chat-empty">
          <div class="chat-empty-icon">🦐</div>
          <div class="chat-empty-title">抓虾 Harness 智能体</div>
          <div class="chat-empty-text">
            用自然语言驱动浏览器完成网页采集、脚本复用、数据分析与任务编排。
          </div>
          <ul class="chat-empty-caps">
            <li>🌐 网页自动化(实时可见)</li>
            <li>📋 任务编排与审批</li>
            <li>📜 抓虾脚本调用与创作</li>
            <li>📊 爬取数据分析</li>
          </ul>
        </div>

        <template v-for="m in messages" :key="m.id">
          <div v-if="m.role === 'user'" class="chat-msg chat-msg-user">
            <div class="chat-msg-body">{{ m.text }}</div>
          </div>

          <div v-else-if="m.role === 'assistant'" class="chat-msg chat-msg-assistant">
            <div class="chat-msg-body">
              {{ m.text }}<span v-if="m.streaming" class="stream-cursor">▍</span>
            </div>
          </div>

          <div v-else-if="m.kind === 'tool'" class="tool-card">
            <div class="tool-card-head">
              <span class="tool-card-icon">🔧</span>
              <span class="tool-card-name">{{ toolLabel(m.toolName) }}</span>
              <span class="tool-card-status" :class="m.status">
                {{ { requested: '调用中…', succeeded: '完成', failed: '失败', canceled: '已取消' }[m.status] || m.status }}
              </span>
            </div>
            <div v-if="m.argsText" class="tool-card-body tool-card-args">{{ m.argsText }}</div>
            <div v-if="m.resultText" class="tool-card-body tool-card-result">{{ m.resultText }}</div>
          </div>

          <div v-else-if="m.kind === 'approval'" class="approval-card">
            <div class="approval-card-head">⚠️ 需要你的批准</div>
            <div class="approval-card-body">{{ approvalSummary(m) }}</div>
            <div class="approval-card-risk">风险等级:{{ m.risk || 'read_only' }}</div>
            <div v-if="m.status === 'pending'" class="approval-card-actions">
              <button class="approve-btn" type="button" @click="decideApproval(m, 'approved')">批准</button>
              <button class="reject-btn" type="button" @click="decideApproval(m, 'rejected')">拒绝</button>
            </div>
            <div v-else class="approval-card-decided">
              {{ m.status === 'approved' ? '已批准 ✓' : m.status === 'rejected' ? '已拒绝 ✗' : `已${m.status}` }}
            </div>
          </div>

          <div v-else-if="m.kind === 'task'" class="task-card">
            <div class="task-card-head">
              <span class="task-card-icon">📋</span>
              <span class="task-card-name">任务实例</span>
              <span class="task-card-status running">运行中</span>
            </div>
            <div class="task-card-uid">{{ m.taskInstanceUid }}</div>
            <div class="task-card-actions">
              <button class="task-open-btn" type="button" @click="openTaskInstance(m.taskInstanceUid)">
                在任务中心打开
              </button>
            </div>
          </div>

          <div v-else-if="m.kind === 'notice'" class="chat-notice">
            {{ m.text }}
          </div>
        </template>
      </div>

      <div class="chat-composer-wrap">
        <div class="composer-chips">
          <button
            :class="['composer-chip', { active: attachBrowser }]"
            type="button"
            title="将当前 9222 Chrome 页面作为本次运行上下文(仅授予观察/求值/验证,页面操作需逐次授权)"
            @click="attachBrowser = !attachBrowser"
          >
            🌐 带上当前浏览器页面
          </button>
        </div>
        <div class="chat-composer">
        <textarea
          v-model="draft"
          class="composer-input"
          rows="2"
          :placeholder="sessionId ? '描述你想让智能体做的事情…(Enter 发送,Shift+Enter 换行)' : '请先在左侧新建或选择会话'"
          :disabled="!sessionId"
          @keydown.enter.exact.prevent="send"
        ></textarea>
        <button class="composer-send" type="button" :disabled="!sessionId || !draft.trim()" @click="send">发送</button>
        </div>
      </div>
    </div>

    <!-- 右侧:实时浏览器窗口(可展开收起) -->
    <AgentBrowserPanel v-if="browserOpen" @collapse="browserOpen = false" />
    <div v-else class="agent-browser-rail">
      <button class="browser-rail-btn" type="button" title="展开浏览器" aria-label="展开浏览器" @click="browserOpen = true">
        <span class="rail-vertical">浏 览 器</span>
        <span class="rail-icon">‹</span>
      </button>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import AgentBrowserPanel from '../components/agent/AgentBrowserPanel.vue'

const BROWSER_PANEL_STORAGE_KEY = 'crawshrimp.agent.browserPanelOpen'

const props = defineProps({
  sessionId: { type: String, default: '' },
})

const emit = defineEmits(['open-task-instance'])

const attachBrowser = ref(false)
const sessionTitle = ref('新会话')
const browserOpen = ref(true)
const draft = ref('')
const messages = ref([])
const messageListEl = ref(null)
const activeRunId = ref('')
const queuePosition = ref(0)
let stopEvents = null
let localSeq = 0

const TOOL_LABELS = {
  tasks_search: '查找任务',
  task_describe: '查看任务详情',
  task_prepare: '准备任务',
  task_run: '执行任务',
  task_status: '查询任务状态',
  task_wait: '等待任务',
  task_control: '控制任务',
  artifacts_list: '查看产物',
  data_preview: '数据预览',
  browser_observe: '观察页面',
  browser_eval: '页面求值',
  browser_act: '页面操作',
  browser_verify: '页面验证',
  browser_navigate: '页面跳转',
  browser_capture_requests: '捕获请求',
  script_list: '列出脚本',
  script_describe: '脚本详情',
  script_run: '运行脚本',
  script_create_draft: '创建脚本草稿',
  script_publish: '发布脚本',
  script_test: '测试脚本',
}

function toolLabel(name) {
  const key = String(name || '').replace(/^mcp__crawshrimp__/, '')
  return TOOL_LABELS[key] || name
}

function readBrowserPanelPref() {
  try {
    return window.localStorage?.getItem(BROWSER_PANEL_STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

function writeBrowserPanelPref(open) {
  try {
    window.localStorage?.setItem(BROWSER_PANEL_STORAGE_KEY, open ? '1' : '0')
  } catch {}
}

function pushMessage(message) {
  messages.value.push({ id: `m-${Date.now()}-${localSeq++}`, ...message })
}

async function scrollToBottom() {
  await nextTick()
  if (messageListEl.value) {
    messageListEl.value.scrollTop = messageListEl.value.scrollHeight
  }
}

function approvalSummary(m) {
  const s = m.summary || {}
  if (s.kind === 'script_publish') return `发布脚本修订:${s.rev_id || ''}(经审批后进入脚本审核页复核)`
  if (s.kind === 'capability_upgrade') return `页面操作授权请求:允许智能体在本次运行中执行浏览器点击/输入(当前页面 ${s.tab_url || ''})`
  if (s.kind === 'sensitive_click') return `敏感操作:点击「${s.text || s.selector || ''}」(${s.tab_url || ''})`
  if (s.kind === 'data_export') return `导出产物 ${s.name || ''} 为 ${s.format || ''}`
  if (s.action) return `任务控制:对 ${s.task_instance_uid} 执行 ${s.action}`
  const params = s.params || {}
  const paramText = Object.entries(params).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')
  return `任务:${s.task_id || ''}(${paramText || '无参数'})`
}

// ---------- SSE ----------

function bindEvents() {
  stopEvents?.()
  stopEvents = null
  if (!props.sessionId) return

  let afterSeq = 0
  stopEvents = window.cs.streamAgentEvents(props.sessionId, afterSeq, {
    onEvent: ({ event, data }) => handleEvent(event, data),
    onError: (error) => {
      console.warn('[agent] SSE 断开:', error?.message)
      pushMessage({ kind: 'notice', text: '事件流断开,3 秒后重连…' })
      setTimeout(() => { if (props.sessionId) bindEvents() }, 3000)
    },
    onDone: () => {
      console.warn('[agent] SSE 结束')
    },
  })
}

function handleEvent(event, data) {
  switch (event) {
    case 'turn.queued': {
      activeRunId.value = data?.run_id || ''
      queuePosition.value = data?.queue_depth || 0
      break
    }
    case 'assistant.delta': {
      const existing = messages.value.find((m) => m.kind === 'assistant-stream')
      if (existing) {
        existing.text += data?.delta || ''
      } else {
        pushMessage({ role: 'assistant', kind: 'assistant-stream', text: data?.delta || '', streaming: true })
      }
      scrollToBottom()
      break
    }
    case 'assistant.completed': {
      const existing = messages.value.find((m) => m.kind === 'assistant-stream')
      if (existing) {
        existing.text = data?.text || existing.text
        existing.streaming = false
        existing.kind = 'assistant'
      } else if (data?.text) {
        pushMessage({ role: 'assistant', kind: 'assistant', text: data.text, streaming: false })
      }
      scrollToBottom()
      break
    }
    case 'tool.requested': {
      pushMessage({
        kind: 'tool',
        toolName: data?.tool_name || '',
        argsText: JSON.stringify(data?.arguments || {}, null, 1),
        resultText: '',
        status: 'requested',
      })
      scrollToBottom()
      break
    }
    case 'tool.completed': {
      const card = [...messages.value].reverse().find((m) => m.kind === 'tool' && m.status === 'requested')
      if (card) {
        card.resultText = data?.result || ''
        card.status = 'succeeded'
      }
      scrollToBottom()
      break
    }
    case 'tool.approval_required': {
      pushMessage({
        kind: 'approval',
        approvalId: data?.approval_id || '',
        summary: data?.summary || {},
        risk: data?.risk || 'read_only',
        status: 'pending',
      })
      scrollToBottom()
      break
    }
    case 'run.failed': {
      activeRunId.value = ''
      queuePosition.value = 0
      pushMessage({ kind: 'notice', text: `运行失败:${data?.error || data?.error_code || '未知错误'}` })
      scrollToBottom()
      break
    }
    case 'run.completed': {
      activeRunId.value = ''
      queuePosition.value = 0
      break
    }
    case 'run.canceled': {
      activeRunId.value = ''
      queuePosition.value = 0
      pushMessage({ kind: 'notice', text: '已停止回答(已启动的业务任务不受影响)' })
      scrollToBottom()
      break
    }
    case 'task.linked': {
      pushMessage({
        kind: 'task',
        taskInstanceUid: data?.task_instance_uid || '',
        planId: data?.plan_id || '',
        status: 'running',
      })
      scrollToBottom()
      break
    }
    case 'session.updated': {
      if (data?.title) sessionTitle.value = data.title
      break
    }
    default:
      break
  }
}

// ---------- 动作 ----------

async function send() {
  const text = String(draft.value || '').trim()
  if (!text || !props.sessionId) return
  draft.value = ''
  pushMessage({ role: 'user', text })
  scrollToBottom()
  try {
    const refs = attachBrowser.value ? [{ type: 'browser_tab', id: 'current' }] : []
    const result = await window.cs.agentApi('POST', `/agent/sessions/${props.sessionId}/turns`, {
      text,
      context_refs: refs,
    })
    queuePosition.value = result?.queue_depth || 0
  } catch (error) {
    pushMessage({ kind: 'notice', text: `发送失败:${error?.message || error}` })
    scrollToBottom()
  }
}

async function stopRun() {
  if (!activeRunId.value) return
  try {
    await window.cs.agentApi('POST', `/agent/runs/${activeRunId.value}/cancel`, {})
  } catch (error) {
    pushMessage({ kind: 'notice', text: `停止失败:${error?.message || error}` })
    scrollToBottom()
  }
}

function openTaskInstance(instanceUid) {
  emit('open-task-instance', instanceUid)
}

async function decideApproval(m, decision) {
  try {
    await window.cs.agentApi('POST', `/agent/approvals/${m.approvalId}/decision`, { decision })
    m.status = decision
  } catch (error) {
    m.status = 'error'
    pushMessage({ kind: 'notice', text: `审批操作失败:${error?.message || error}` })
  }
  scrollToBottom()
}

async function loadSession() {
  messages.value = []
  activeRunId.value = ''
  queuePosition.value = 0
  if (!props.sessionId) return
  try {
    const result = await window.cs.agentApi('GET', `/agent/sessions/${props.sessionId}`)
    sessionTitle.value = result?.session?.title || '新会话'
    for (const m of result?.messages || []) {
      try {
        const content = typeof m.content_json === 'string' ? JSON.parse(m.content_json) : m.content_json
        if (m.role === 'user') {
          pushMessage({ role: 'user', text: content?.text || '' })
        } else if (m.role === 'assistant') {
          pushMessage({ role: 'assistant', kind: 'assistant', text: content?.text || '', streaming: false })
        }
      } catch {}
    }
    scrollToBottom()
  } catch (error) {
    console.warn('[agent] 加载会话失败:', error)
  }
  bindEvents()
}

watch(() => props.sessionId, () => {
  stopEvents?.()
  loadSession()
})

watch(browserOpen, (open) => writeBrowserPanelPref(open))

onMounted(() => {
  browserOpen.value = readBrowserPanelPref()
  if (props.sessionId) loadSession()
})

onUnmounted(() => {
  stopEvents?.()
})
</script>

<style scoped>
.agent-home {
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.agent-chat {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.chat-head {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
}
.chat-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.chat-title-text {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
}
.chat-subtitle {
  font-size: 11px;
  color: var(--text3);
}
.chat-queue {
  font-size: 11px;
  color: var(--orange);
}
.chat-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
.head-btn {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: transparent;
  color: var(--text2);
  font-size: 12px;
  cursor: pointer;
}
.head-btn:hover:not(:disabled) {
  color: var(--text);
  background: var(--bg3);
}
.head-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.stop-btn:hover:not(:disabled) {
  color: var(--red);
  border-color: var(--red);
}
.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px;
}
.chat-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  padding: 24px;
}
.chat-empty-icon {
  font-size: 44px;
}
.chat-empty-title {
  font-size: 17px;
  font-weight: 800;
  color: var(--text);
}
.chat-empty-text {
  font-size: 13px;
  color: var(--text2);
  max-width: 420px;
  line-height: 1.6;
}
.chat-empty-caps {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
.chat-empty-caps li {
  font-size: 12px;
  color: var(--text2);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 5px 12px;
  background: var(--bg2);
}
.chat-msg {
  display: flex;
  margin-bottom: 14px;
}
.chat-msg-user {
  justify-content: flex-end;
}
.chat-msg-assistant {
  justify-content: flex-start;
}
.chat-msg-body {
  max-width: 76%;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.chat-msg-user .chat-msg-body {
  background: var(--orange);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.chat-msg-assistant .chat-msg-body {
  background: var(--bg3);
  color: var(--text);
  border-bottom-left-radius: 4px;
}
.stream-cursor {
  animation: blink 1s step-start infinite;
  color: var(--orange);
}
@keyframes blink {
  50% { opacity: 0; }
}
.tool-card {
  margin-bottom: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg2);
  overflow: hidden;
}
.tool-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12.5px;
}
.tool-card-icon {
  font-size: 13px;
}
.tool-card-name {
  font-weight: 700;
  color: var(--text);
}
.tool-card-status {
  margin-left: auto;
  font-size: 11px;
  color: var(--text3);
}
.tool-card-status.succeeded {
  color: var(--green);
}
.tool-card-status.failed {
  color: var(--red);
}
.tool-card-status.requested {
  color: var(--orange);
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
.tool-card-body {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text2);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
}
.tool-card-args {
  color: var(--text3);
}
.approval-card {
  margin-bottom: 12px;
  border: 1px solid var(--orange);
  border-radius: 10px;
  background: var(--orange-bg);
  padding: 12px 14px;
}
.approval-card-head {
  font-size: 13px;
  font-weight: 800;
  color: var(--orange);
  margin-bottom: 6px;
}
.approval-card-body {
  font-size: 12.5px;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}
.approval-card-risk {
  font-size: 11px;
  color: var(--text3);
  margin-top: 6px;
}
.approval-card-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.approve-btn,
.reject-btn {
  padding: 7px 18px;
  border-radius: 8px;
  border: none;
  font-size: 12.5px;
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
.approval-card-decided {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text2);
}
.chat-notice {
  margin: 0 auto 12px;
  width: fit-content;
  max-width: 80%;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--bg3);
  color: var(--text3);
  font-size: 11.5px;
}
.chat-composer-wrap {
  border-top: 1px solid var(--border);
  background: var(--bg2);
}
.composer-chips {
  display: flex;
  gap: 8px;
  padding: 8px 16px 0;
}
.composer-chip {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--text3);
  font-size: 11.5px;
  cursor: pointer;
}
.composer-chip:hover {
  color: var(--text2);
}
.composer-chip.active {
  border-color: var(--orange);
  color: var(--orange);
  background: var(--orange-bg);
}
.task-card {
  margin-bottom: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg2);
  padding: 10px 14px;
}
.task-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.task-card-icon {
  font-size: 14px;
}
.task-card-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}
.task-card-status {
  margin-left: auto;
  font-size: 11px;
  color: var(--text3);
}
.task-card-status.running {
  color: var(--orange);
  animation: pulse 1.2s ease-in-out infinite;
}
.task-card-uid {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text3);
  font-family: monospace;
}
.task-card-actions {
  margin-top: 8px;
}
.task-open-btn {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: transparent;
  color: var(--text2);
  font-size: 12px;
  cursor: pointer;
}
.task-open-btn:hover {
  color: var(--orange);
  border-color: var(--orange);
}
.chat-composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px 16px;
}
.composer-input {
  flex: 1;
  min-height: 44px;
  resize: none;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font-size: 13.5px;
  line-height: 1.5;
  padding: 11px 13px;
  outline: none;
  font-family: inherit;
}
.composer-input:focus {
  border-color: var(--orange);
}
.composer-input:disabled {
  opacity: 0.5;
}
.composer-send {
  height: 44px;
  padding: 0 18px;
  border: none;
  border-radius: 10px;
  background: var(--orange);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.composer-send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.agent-browser-rail {
  flex: none;
  width: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-left: 1px solid var(--border);
  background: var(--bg2);
}
.browser-rail-btn {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: none;
  background: transparent;
  color: var(--text3);
  cursor: pointer;
}
.browser-rail-btn:hover {
  color: var(--orange);
}
.rail-vertical {
  writing-mode: vertical-rl;
  font-size: 12px;
  letter-spacing: 2px;
}
.rail-icon {
  font-size: 16px;
}
</style>
