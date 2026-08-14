<template>
  <div class="agent-web-view">
    <!-- 顶部工具条(抓虾 chrome) -->
    <div class="web-toolbar">
      <span class="web-toolbar-title">🤖 DSH 智能体</span>
      <span class="web-toolbar-status" :class="statusClass">
        <i></i>{{ statusLabel }}
      </span>
      <span v-if="webUrl" class="web-toolbar-url" :title="webUrl">{{ webUrl }}</span>
      <div class="web-toolbar-actions">
        <button v-if="browserSupported" class="toolbar-btn" type="button" :title="browserOpen ? '收起实时浏览器' : '展开实时浏览器(9222 CDP)'" @click="browserOpen = !browserOpen">
          {{ browserOpen ? '🖥️' : '🖥️' }}
        </button>
        <button class="toolbar-btn" type="button" title="刷新" @click="reload">↻</button>
        <button class="toolbar-btn" type="button" title="在浏览器打开" @click="openExternal">↗</button>
      </div>
    </div>

    <!-- 主体:iframe(DSH Web UI) + 可展开浏览器面板 -->
    <div class="web-body">
      <div class="web-frame-wrap">
        <iframe
          v-if="webUrl"
          ref="frameEl"
          class="web-frame"
          :src="frameSrc"
          :title="'DSH 智能体'"
          allow="clipboard-read; clipboard-write; fullscreen"
          @load="onFrameLoad"
        />
        <div v-else class="web-placeholder">
          <div class="placeholder-icon">{{ error ? '⚠️' : '🕐' }}</div>
          <div class="placeholder-title">{{ error ? 'DSH 运行时不可用' : '正在启动 DSH 智能体运行时…' }}</div>
          <div class="placeholder-text">{{ error || '首个会话启动后,DSH Web 界面会在这里加载(与抓虾同主题)。' }}</div>
          <button class="placeholder-btn" type="button" @click="retryLoad">重试</button>
        </div>
      </div>
      <AgentBrowserPanel v-if="browserOpen" class="web-browser-panel" @collapse="browserOpen = false" />
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import AgentBrowserPanel from '../components/agent/AgentBrowserPanel.vue'

const props = defineProps({
  theme: { type: String, default: '' },   // effectiveTheme(light|dark)
})

const webUrl = ref('')
const error = ref('')
const loading = ref(true)
const browserOpen = ref(false)
const browserSupported = ref(true)
const frameEl = ref(null)
const refreshKey = ref(0)
let pollTimer = null
let warmStarted = false

const statusClass = computed(() => (error.value ? 'error' : loading.value ? 'loading' : 'ready'))
const statusLabel = computed(() => (error.value ? '不可用' : loading.value ? '启动中' : '就绪'))
const frameSrc = computed(() => {
  if (!webUrl.value) return ''
  const url = new URL(webUrl.value, window.location.href)
  if (props.theme === 'light' || props.theme === 'dark') url.searchParams.set('theme', props.theme)
  return `${url.href}${refreshKey.value ? `#r=${refreshKey.value}` : ''}`
})

async function loadRuntime() {
  error.value = ''
  try {
    const result = await window.cs.agentApi('GET', '/agent/runtime')
    const url = result?.web_url || ''
    if (url) {
      webUrl.value = url
      loading.value = false
      return
    }
    webUrl.value = ''
    if (result?.state === 'failed' || result?.error) {
      error.value = result.error || '运行时启动失败'
      loading.value = false
      return
    }
    // 预热:web host 尚未启动(首轮会话前)且当前无 active run → 拉起 runtime
    if (result?.enabled !== false && !result?.active_run && !warmStarted) {
      warmStarted = true
      try {
        const warm = await window.cs.agentApi('POST', '/agent/runtime/restart')
        if (warm?.ok || warm?.state === 'ready') {
          await loadRuntime()
          return
        }
        error.value = warm?.error || '运行时启动失败'
      } catch (err) {
        error.value = err?.message || '无法启动运行时'
      }
    }
    loading.value = !error.value
  } catch (err) {
    error.value = err?.message || '无法连接本地服务'
    loading.value = false
  }
}

function retryLoad() {
  warmStarted = false
  error.value = ''
  loadRuntime()
}

function reload() {
  refreshKey.value += 1
}

function openExternal() {
  if (webUrl.value) window.open(webUrl.value, '_blank', 'noopener')
}

function onFrameLoad() {
  // 主题同步:iframe 加载后按当前主题再推一次
  pushTheme()
}

function pushTheme() {
  if (!frameEl.value?.contentWindow) return
  frameEl.value.contentWindow.postMessage({ __crawshrimp: 'theme', theme: props.theme }, '*')
}

onMounted(() => {
  loadRuntime()
  pollTimer = setInterval(() => {
    if (!webUrl.value && !error.value) loadRuntime()
  }, 3000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

watch(() => props.theme, (t) => {
  if (t) pushTheme()
})
</script>

<style scoped>
.agent-web-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--bg);
}

.web-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  flex: none;
}

.web-toolbar-title { font-size: 13px; font-weight: 600; color: var(--text); }

.web-toolbar-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text2);
}
.web-toolbar-status i { width: 8px; height: 8px; border-radius: 50%; background: var(--text3); }
.web-toolbar-status.ready i { background: var(--green); }
.web-toolbar-status.loading i { background: var(--yellow); animation: pulse 1.2s infinite; }
.web-toolbar-status.error i { background: var(--red); }

.web-toolbar-url {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--text3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.web-toolbar-actions { display: flex; gap: 6px; }
.toolbar-btn {
  border: 1px solid var(--border);
  background: var(--bg3);
  color: var(--text);
  width: 28px;
  height: 26px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}
.toolbar-btn:hover { background: var(--soft-fill-hover); }

.web-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.web-frame-wrap {
  flex: 1;
  min-width: 0;
  position: relative;
  background: var(--bg);
}

.web-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  background: var(--bg);
}

.web-browser-panel {
  width: 380px;
  flex: none;
  border-left: 1px solid var(--border);
}

.web-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
}
.placeholder-icon { font-size: 34px; }
.placeholder-title { font-size: 15px; font-weight: 600; color: var(--text); }
.placeholder-text { font-size: 13px; color: var(--text2); text-align: center; max-width: 420px; line-height: 1.6; }
.placeholder-btn {
  border: 1px solid var(--border-strong);
  background: var(--bg3);
  color: var(--text);
  font-size: 13px;
  padding: 8px 18px;
  border-radius: 8px;
  cursor: pointer;
}
.placeholder-btn:hover { background: var(--soft-fill-hover); }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
</style>
