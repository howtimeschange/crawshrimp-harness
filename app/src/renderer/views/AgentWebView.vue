<template>
  <div class="agent-web-view">
    <!-- 主体:iframe(DSH Web UI) + 可展开浏览器面板 -->
    <div class="web-body">
      <div class="web-frame-wrap">
        <iframe
          v-if="webUrl"
          ref="frameEl"
          class="web-frame"
          :src="frameSrc"
          :title="'抓虾智能体'"
          allow="clipboard-read; clipboard-write; fullscreen"
          @load="onFrameLoad"
        />
        <div v-else class="web-placeholder">
          <div class="placeholder-icon">🕐</div>
          <div class="placeholder-title">智能体启动中…</div>
          <div class="placeholder-text">正在准备会话环境,请稍候片刻。</div>
          <div class="placeholder-actions">
            <span class="recover-state">自动就绪中,无需操作</span>
          </div>
        </div>
        <!-- 实时浏览器面板悬浮开关 -->
        <button
          class="browser-toggle"
          type="button"
          :title="browserOpen ? '收起实时浏览器' : '展开实时浏览器(9222 CDP)'"
          @click="browserOpen = !browserOpen"
        >🖥️</button>
      </div>
      <AgentBrowserPanel v-if="browserOpen" class="web-browser-panel" @collapse="browserOpen = false" />
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import AgentBrowserPanel from '../components/agent/AgentBrowserPanel.vue'

const props = defineProps({
  theme: { type: String, default: '' },        // effectiveTheme(light|dark)
  navItems: { type: Array, default: () => [] }, // 抓虾一级菜单(注入会话侧边栏底部)
  activeNav: { type: String, default: '' },     // 当前激活菜单 id
})

const emit = defineEmits(['nav-select', 'rail-metrics', 'session-nav', 'repair-core'])

const webUrl = ref('')
const error = ref('')
const loading = ref(true)
const browserOpen = ref(false)
const recoverAttempts = ref(0)
const workspaceRoot = ref('')
const frameEl = ref(null)
let pollTimer = null
let warmStarted = false
let recovering = false

const frameSrc = computed(() => {
  if (!webUrl.value) return ''
  const url = new URL(webUrl.value, window.location.href)
  if (props.theme === 'light' || props.theme === 'dark') url.searchParams.set('theme', props.theme)
  return url.href
})

async function loadRuntime() {
  try {
    const result = await window.cs.agentApi('GET', '/agent/runtime')
    const url = result?.web_url || ''
    if (result?.workspace_root && result.workspace_root !== workspaceRoot.value) {
      workspaceRoot.value = result.workspace_root
      pushWorkspace()
    }
    if (url) {
      webUrl.value = url
      loading.value = false
      error.value = ''
      recoverAttempts.value = 0
      return true
    }
    webUrl.value = ''
    if (result?.state === 'failed' || result?.error) {
      error.value = result.error || '运行时启动失败'
      loading.value = false
    } else if (result?.enabled !== false && !result?.active_run) {
      // 预热:web host 未起(首轮会话前)→ 拉起 runtime
      try {
        const warm = await window.cs.agentApi('POST', '/agent/runtime/restart')
        if (warm?.ok || warm?.state === 'ready') return await loadRuntime()
        error.value = warm?.error || '运行时启动失败'
      } catch (err) {
        error.value = err?.message || '无法启动运行时'
      }
      loading.value = false
    }
  } catch (err) {
    error.value = err?.message || '无法连接本地服务'
    loading.value = false
  }
  return false
}

// 自动恢复:DSH 运行时不可用/后端掉线时循环自愈,不交给用户操作
async function autoRecover() {
  if (recovering) return
  recovering = true
  try {
    recoverAttempts.value += 1
    const ok = await loadRuntime()
    if (ok) return
    // ① runtime 层恢复:尝试 restart
    try {
      const warm = await window.cs.agentApi('POST', '/agent/runtime/restart')
      if (warm?.ok || warm?.state === 'ready') {
        await new Promise((r) => setTimeout(r, 3000))
        if (await loadRuntime()) return
      }
    } catch { /* API 不可达,进入后端恢复 */ }
    // ② 后端/Chrome 层恢复:重启本地后端(原设置页「修复核心服务」)
    if (recoverAttempts.value >= 2) {
      try {
        emit('repair-core')
        await new Promise((r) => setTimeout(r, 6000))
        if (await loadRuntime()) return
      } catch { /* 继续下一轮 */ }
    }
  } finally {
    recovering = false
  }
}

function retryLoad() {
  warmStarted = false
  error.value = ''
  loadRuntime()
}

function onFrameLoad() {
  // iframe 加载后同步主题、菜单与默认工作区
  pushTheme()
  pushNav()
  pushWorkspace()
}

function pushWorkspace() {
  if (!frameEl.value?.contentWindow || !workspaceRoot.value) return
  frameEl.value.contentWindow.postMessage({ __crawshrimp: 'workspace', root: workspaceRoot.value }, '*')
}

function pushTheme() {
  if (!frameEl.value?.contentWindow) return
  frameEl.value.contentWindow.postMessage({ __crawshrimp: 'theme', theme: props.theme }, '*')
}

function pushNav() {
  if (!frameEl.value?.contentWindow) return
  frameEl.value.contentWindow.postMessage({
    __crawshrimp: 'nav',
    items: (props.navItems || []).map((item) => ({ id: item.id, icon: item.icon, label: item.label })),
    active: props.activeNav,
  }, '*')
}

// iframe 内菜单点击 / 侧边栏宽度变化 / 会话导航 → shell
function onWindowMessage(event) {
  const data = event?.data
  if (!data || !data.__crawshrimp) return
  if (data.__crawshrimp === 'nav-click') {
    if (Number(data.railWidth) > 0) emit('rail-metrics', { width: data.railWidth, collapsed: false })
    emit('nav-select', data.id)
  } else if (data.__crawshrimp === 'rail-metrics') {
    emit('rail-metrics', { width: data.width, collapsed: data.collapsed })
  } else if (data.__crawshrimp === 'session-nav') {
    emit('session-nav', data.kind || 'session')
  }
}

onMounted(() => {
  loadRuntime()
  window.addEventListener('message', onWindowMessage)
  // 持续探活:runtime/后端不健康即自动恢复(webUrl 非空也检测,覆盖挂掉场景)
  pollTimer = setInterval(async () => {
    try {
      const st = await window.cs.agentApi('GET', '/agent/runtime')
      if (st?.web_url && st.state === 'ready') {
        if (!webUrl.value) webUrl.value = st.web_url
        return
      }
      webUrl.value = ''
      error.value = st?.error || '智能体运行时不可用'
      autoRecover()
    } catch {
      webUrl.value = ''
      error.value = '无法连接本地服务'
      autoRecover()
    }
  }, 5000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  window.removeEventListener('message', onWindowMessage)
})

watch(() => props.theme, (t) => {
  if (t) pushTheme()
})

watch(() => [props.navItems, props.activeNav], () => {
  pushNav()
}, { deep: false })
</script>

<style scoped>
.agent-web-view {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--bg);
}

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

.browser-toggle {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 10;
  width: 30px;
  height: 30px;
  border: 1px solid var(--border);
  background: var(--bg2);
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  opacity: 0.75;
}
.browser-toggle:hover { opacity: 1; background: var(--soft-fill-hover); }

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

.placeholder-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.recover-state {
  font-size: 12px;
  color: var(--text3);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.recover-state::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--yellow);
  animation: cs-pulse 1.2s infinite;
}
@keyframes cs-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
</style>
