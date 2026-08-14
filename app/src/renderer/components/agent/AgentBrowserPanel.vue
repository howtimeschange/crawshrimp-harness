<template>
  <div class="agent-browser-panel">
    <div class="browser-panel-head">
      <span class="browser-panel-title">实时浏览器</span>
      <span class="browser-status" :class="statusClass" :title="statusText">
        <i></i>{{ statusLabel }}
      </span>
      <button
        class="panel-collapse-btn"
        type="button"
        title="收起浏览器面板"
        aria-label="收起浏览器面板"
        @click="$emit('collapse')"
      >
        ›
      </button>
    </div>
    <div class="browser-frame">
      <img
        v-if="frame"
        class="browser-frame-img"
        :src="frame.dataUrl"
        alt="浏览器实时画面"
      />
      <div v-else class="browser-frame-placeholder">
        <template v-if="statusState === 'error'">
          <div class="placeholder-icon">⚠️</div>
          <div class="placeholder-text">{{ statusMessage || '无法连接 9222 CDP 浏览器' }}</div>
          <button class="placeholder-btn" type="button" @click="restart">重试</button>
        </template>
        <template v-else>
          <div class="placeholder-icon">🌐</div>
          <div class="placeholder-text">连接 9222 CDP 浏览器中…</div>
        </template>
      </div>
    </div>
    <div class="browser-panel-foot" :title="frameUrl">
      <span class="url">{{ frameUrl || '—' }}</span>
      <button class="refresh-btn" type="button" title="刷新画面" aria-label="刷新画面" @click="restart">
        ↻
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'

const emit = defineEmits(['collapse'])

const frame = ref(null)
const frameUrl = ref('')
const statusState = ref('connecting') // connecting | connected | error | disconnected
const statusMessage = ref('')

let offFrame = null
let offStatus = null
let started = false

const statusClass = computed(() => ({
  connecting: 'connecting',
  connected: 'connected',
  error: 'error',
  disconnected: 'disconnected',
}[statusState.value] || 'connecting'))

const statusLabel = computed(() => ({
  connecting: '连接中',
  connected: '已连接',
  error: '错误',
  disconnected: '已断开',
}[statusState.value] || '连接中'))

const statusText = computed(() => {
  if (statusState.value === 'error' && statusMessage.value) return statusMessage.value
  return statusLabel.value
})

async function start() {
  if (started || typeof window.cs?.startAgentBrowserStream !== 'function') return
  started = true
  statusState.value = 'connecting'
  const result = await window.cs.startAgentBrowserStream()
  if (!result?.ok) {
    statusState.value = 'error'
    statusMessage.value = result?.error || '浏览器流启动失败'
    started = false
  }
}

async function restart() {
  if (typeof window.cs?.stopAgentBrowserStream === 'function') {
    await window.cs.stopAgentBrowserStream()
  }
  frame.value = null
  statusState.value = 'connecting'
  started = false
  start()
}

onMounted(() => {
  if (window.cs?.onAgentBrowserFrame) {
    offFrame = window.cs.onAgentBrowserFrame((payload) => {
      frame.value = payload
      if (payload?.url) frameUrl.value = payload.url
    })
  }
  if (window.cs?.onAgentBrowserStatus) {
    offStatus = window.cs.onAgentBrowserStatus((payload) => {
      statusState.value = payload?.state || 'connecting'
      if (payload?.message) statusMessage.value = payload.message
      if (payload?.url) frameUrl.value = payload.url
      if (payload?.state === 'error' || payload?.state === 'disconnected') started = false
    })
  }
  start()
})

onUnmounted(() => {
  offFrame?.()
  offStatus?.()
  if (typeof window.cs?.stopAgentBrowserStream === 'function') {
    window.cs.stopAgentBrowserStream()
  }
})
</script>

<style scoped>
.agent-browser-panel {
  display: flex;
  flex-direction: column;
  width: 420px;
  height: 100%;
  background: var(--bg);
  border-left: 1px solid var(--border);
  min-width: 0;
}
.browser-panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
}
.browser-panel-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}
.browser-status {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text3);
  margin-left: auto;
}
.browser-status i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text3);
}
.browser-status.connected i {
  background: var(--green);
  box-shadow: 0 0 6px var(--green);
}
.browser-status.error i {
  background: var(--red);
}
.browser-status.connecting i {
  background: var(--orange);
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
.panel-collapse-btn {
  width: 22px;
  height: 22px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text2);
  font-size: 14px;
  cursor: pointer;
}
.panel-collapse-btn:hover {
  color: var(--text);
  background: var(--bg3);
}
.browser-frame {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0b0b0e;
}
.browser-frame-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  image-rendering: auto;
}
.browser-frame-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--text3);
  padding: 24px;
  text-align: center;
}
.placeholder-icon {
  font-size: 30px;
}
.placeholder-text {
  font-size: 12.5px;
  max-width: 260px;
  line-height: 1.5;
}
.placeholder-btn {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg3);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.placeholder-btn:hover {
  border-color: var(--orange);
  color: var(--orange);
}
.browser-panel-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-top: 1px solid var(--border);
  background: var(--bg2);
}
.url {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--text3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.refresh-btn {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text2);
  font-size: 14px;
  cursor: pointer;
}
.refresh-btn:hover {
  color: var(--text);
  background: var(--bg3);
}
</style>
