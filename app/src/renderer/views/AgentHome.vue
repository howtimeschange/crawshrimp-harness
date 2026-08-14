<template>
  <section class="agent-home">
    <!-- 中间:会话区 -->
    <div class="agent-chat">
      <header class="chat-head">
        <div class="chat-title">
          <span class="chat-title-text">{{ sessionTitle }}</span>
          <span class="chat-subtitle">智能体</span>
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
          <button class="head-btn" type="button" title="停止回答(开发中)" aria-label="停止回答" disabled>
            ⏹
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
        <div v-for="m in messages" :key="m.id" :class="['chat-msg', `chat-msg-${m.role}`]">
          <div class="chat-msg-body">{{ m.text }}</div>
        </div>
      </div>

      <div class="chat-composer">
        <textarea
          v-model="draft"
          class="composer-input"
          rows="2"
          placeholder="描述你想让智能体做的事情,例如:导出最近 7 天的订单数据…(Enter 发送,Shift+Enter 换行)"
          @keydown.enter.exact.prevent="send"
        ></textarea>
        <button class="composer-send" type="button" :disabled="!draft.trim()" @click="send">发送</button>
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
import { nextTick, onMounted, ref, watch } from 'vue'
import AgentBrowserPanel from '../components/agent/AgentBrowserPanel.vue'

const BROWSER_PANEL_STORAGE_KEY = 'crawshrimp.agent.browserPanelOpen'

const sessionTitle = ref('新会话')
const browserOpen = ref(true)
const draft = ref('')
const messages = ref([])
const messageListEl = ref(null)
let localSeq = 0

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

function pushMessage(role, text) {
  messages.value.push({ id: `m-${Date.now()}-${localSeq++}`, role, text })
}

async function scrollToBottom() {
  await nextTick()
  if (messageListEl.value) {
    messageListEl.value.scrollTop = messageListEl.value.scrollHeight
  }
}

function send() {
  const text = String(draft.value || '').trim()
  if (!text) return
  pushMessage('user', text)
  draft.value = ''
  // 骨架阶段:智能体运行时(DSH Worker)尚未接入,本地回显提示
  pushMessage('assistant', '智能体运行时尚未接入(骨架阶段)。这条消息已记录,接入 DSH 内核后这里会显示真实回答。')
  scrollToBottom()
}

watch(browserOpen, (open) => writeBrowserPanelPref(open))

onMounted(() => {
  browserOpen.value = readBrowserPanelPref()
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
.chat-composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  background: var(--bg2);
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
/* 收起后的窄栏 */
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
  writing-mode: initial;
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
