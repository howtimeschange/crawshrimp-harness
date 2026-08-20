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
      <AgentBrowserPanel
        v-for="(win, idx) in browserWindows"
        :key="win.tabId"
        :tab-id="win.tabId"
        :window-index="idx"
        :minimize-signal="browserMinimizeCount"
        @collapse="closeBrowserWindow(win.tabId)"
      />
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
  browserAutoOpen: { type: Number, default: 0 }, // 智能体调用浏览器工具时递增,自动弹出实时浏览器窗口
  browserTabs: { type: Object, default: () => ({ tabs: [], activeTabId: '' }) }, // 浏览器活动快照 → 多窗口跟随
})

const emit = defineEmits(['nav-select', 'rail-metrics', 'session-nav', 'runtime-session', 'repair-core'])

const webUrl = ref('')
const error = ref('')
const loading = ref(true)
const browserOpen = ref(false)
const browserMinimizeCount = ref(0)
const browserWindows = ref([])
const recoverAttempts = ref(0)
const workspaceRoot = ref('')
const runtimeGeneration = ref(0)
const frameEl = ref(null)
const activeRuntimeSessionId = ref('')
const lastRuntimeState = ref('')
let pollTimer = null
let tabPollTimer = null
let warmStarted = false
let recovering = false

const frameSrc = computed(() => {
  if (!webUrl.value) return ''
  const url = new URL(webUrl.value, window.location.href)
  if (props.theme === 'light' || props.theme === 'dark') url.searchParams.set('theme', props.theme)
  if (runtimeGeneration.value > 0) url.searchParams.set('csRuntimeGeneration', String(runtimeGeneration.value))
  return url.href
})
const frameOrigin = computed(() => {
  try { return webUrl.value ? new URL(webUrl.value, window.location.href).origin : '' } catch { return '' }
})

function postToFrame(message) {
  if (!frameEl.value?.contentWindow || !frameOrigin.value) return
  frameEl.value.contentWindow.postMessage(message, frameOrigin.value)
}

function applyRuntimeSnapshot(result) {
  const generation = Number(result?.generation || 0)
  if (Number.isFinite(generation) && generation > 0 && generation !== runtimeGeneration.value) {
    runtimeGeneration.value = generation
  }
  if (result?.workspace_root && result.workspace_root !== workspaceRoot.value) {
    workspaceRoot.value = result.workspace_root
    pushWorkspace()
  }
  return result?.web_url || ''
}

async function loadRuntime() {
  try {
    const result = await window.cs.agentApi('GET', '/agent/runtime')
    const state = String(result?.state || '')
    lastRuntimeState.value = state
    const url = applyRuntimeSnapshot(result)
    if (url && state === 'ready') {
      webUrl.value = url
      loading.value = false
      error.value = ''
      recoverAttempts.value = 0
      return true
    }
    webUrl.value = ''
    if (state === 'starting' || state === 'ready') {
      loading.value = true
      error.value = state === 'ready' ? '智能体会话界面启动中' : ''
      return true
    }
    if (state === 'failed' || state === 'crashed' || result?.error) {
      error.value = result.error || '运行时启动失败'
      loading.value = false
    } else if (result?.enabled !== false && !result?.active_run && ['stopped', 'unknown', ''].includes(state)) {
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
    lastRuntimeState.value = 'offline'
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
  if (!workspaceRoot.value) return
  postToFrame({ __crawshrimp: 'workspace', root: workspaceRoot.value })
}

function pushTheme() {
  postToFrame({ __crawshrimp: 'theme', theme: props.theme })
}

function pushNav() {
  postToFrame({
    __crawshrimp: 'nav',
    items: (props.navItems || []).map((item) => ({ id: item.id, icon: item.icon, label: item.label })),
    active: props.activeNav,
  })
}

// iframe 内菜单点击 / 侧边栏宽度变化 / 会话导航 → shell
function onWindowMessage(event) {
  const data = event?.data
  if (!data || !data.__crawshrimp) return
  // 仅接受智能体会话 iframe 的消息(防其他内嵌页面冒用特权通道)
  const sessionWin = frameEl.value?.contentWindow
  if (!sessionWin || event.source !== sessionWin || event.origin !== frameOrigin.value) return
  if (data.__crawshrimp === 'nav-click') {
    if (Number(data.railWidth) > 0) emit('rail-metrics', { width: data.railWidth, collapsed: false })
    // 菜单切换时最小化实时浏览器窗口,避免浮动窗口盖住界面拦截点击
    if (browserOpen.value) browserMinimizeCount.value += 1
    emit('nav-select', data.id)
  } else if (data.__crawshrimp === 'rail-metrics') {
    emit('rail-metrics', { width: data.width, collapsed: data.collapsed })
  } else if (data.__crawshrimp === 'session-nav') {
    emit('session-nav', data.kind || 'session')
  } else if (data.__crawshrimp === 'active-runtime-session') {
    activeRuntimeSessionId.value = String(data.runtimeSessionId || '')
    emit('runtime-session', activeRuntimeSessionId.value)
  } else if (data.__crawshrimp === 'open-file') {
    // 会话内附件点击 → 系统默认应用打开
    const p = String(data.path || '').trim()
    if (p && typeof window.cs?.openFile === 'function') {
      window.cs.openFile(p).catch(() => {})
    }
  } else if (data.__crawshrimp === 'upload-attachment') {
    // 会话界面拖入/粘贴文件 → 保存 + 注册为会话附件
    registerAttachmentFile(data.file, data.runtimeSessionId)
  } else if (data.__crawshrimp === 'upload-attachment-pick') {
    // 会话界面 📎 按钮 → 打开原生选择器逐个注册
    handlePickAttachments(data.runtimeSessionId)
  }
}

const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024
const IMAGE_MIME_PREFIX = 'image/'

function isImageLikeFile(file) {
  return String(file?.type || file?.mime || '').toLowerCase().startsWith(IMAGE_MIME_PREFIX)
}

async function registerAttachmentFile(file, runtimeSessionId = '') {
  if (!file || typeof window.cs?.saveAgentAttachment !== 'function') return
  if (isImageLikeFile(file)) return
  if (Number(file.size || 0) > MAX_ATTACHMENT_BYTES) {
    console.warn('[agent] 附件过大(>200MB),已跳过:', file.name)
    return
  }
  try {
    const runtimeId = String(runtimeSessionId || activeRuntimeSessionId.value || '')
    if (!runtimeId) throw new Error('当前 DSH 会话尚未就绪')
    const buffer = new Uint8Array(await file.arrayBuffer())
    const saved = await window.cs.saveAgentAttachment({
      buffer,
      name: file.name || 'file',
      mime: file.type || '',
    })
    if (!saved?.ok) return
    const registered = await window.cs.agentApi('POST', '/agent/attachments/inbox', {
      name: saved.name, path: saved.path, mime: saved.mime, size: saved.size,
      runtime_session_id: runtimeId,
    })
    const att = registered?.attachment
    if (att) {
      postToFrame({
        __crawshrimp: 'attachment-added',
        name: att.filename,
        attachmentId: att.attachment_id,
        runtimeSessionId: runtimeId,
      })
    }
  } catch (error) {
    console.warn('[agent] 附件注册失败:', error?.message)
  }
}

async function handlePickAttachments(runtimeSessionId = '') {
  if (typeof window.cs?.pickAgentAttachments !== 'function') return
  try {
    const runtimeId = String(runtimeSessionId || activeRuntimeSessionId.value || '')
    if (!runtimeId) throw new Error('当前 DSH 会话尚未就绪')
    const result = await window.cs.pickAgentAttachments()
    if (!result?.ok) return
    for (const file of result.files || []) {
      if (isImageLikeFile(file)) continue
      try {
        const registered = await window.cs.agentApi('POST', '/agent/attachments/inbox', {
          name: file.name, path: file.path, mime: file.mime, size: file.size,
          runtime_session_id: runtimeId,
        })
        const att = registered?.attachment
        if (att) {
          postToFrame({
            __crawshrimp: 'attachment-added',
            name: att.filename,
            attachmentId: att.attachment_id,
            runtimeSessionId: runtimeId,
          })
        }
      } catch (error) {
        console.warn('[agent] 附件注册失败:', error?.message)
      }
    }
  } catch (error) {
    console.warn('[agent] 附件选择失败:', error?.message)
  }
}

onMounted(() => {
  loadRuntime()
  window.addEventListener('message', onWindowMessage)
  // 持续探活:runtime/后端不健康即自动恢复(webUrl 非空也检测,覆盖挂掉场景)。
  // web_url 报告可能滞后于真实端口(DSH webserver 端口冲突内部 +1),
  // 因此额外做 HTTP 级探活:no-cors fetch 只判可达性,不可达即触发自愈。
  let probeFailCount = 0
  pollTimer = setInterval(async () => {
    try {
      const st = await window.cs.agentApi('GET', '/agent/runtime')
      const state = String(st?.state || '')
      lastRuntimeState.value = state
      const runtimeUrl = applyRuntimeSnapshot(st)
      if (runtimeUrl && state === 'ready') {
        let reachable = true
        try {
          await fetch(runtimeUrl.replace(/\/+$/, '') + '/?__probe=' + Date.now(), { mode: 'no-cors', cache: 'no-store' })
        } catch {
          reachable = false
        }
        if (reachable) {
          probeFailCount = 0
          if (!webUrl.value || webUrl.value !== runtimeUrl) webUrl.value = runtimeUrl
          return
        }
        // 连续两次不可达才重挂 iframe,避免瞬断闪烁
        probeFailCount += 1
        if (probeFailCount >= 2) {
          webUrl.value = ''
          error.value = '智能体会话界面未就绪'
          autoRecover()
        }
        return
      }
      if (state === 'starting' || state === 'ready') {
        probeFailCount = 0
        webUrl.value = ''
        loading.value = true
        error.value = state === 'ready' ? '智能体会话界面启动中' : ''
        return
      }
      probeFailCount = 0
      webUrl.value = ''
      error.value = st?.error || '智能体运行时不可用'
      autoRecover()
    } catch {
      probeFailCount = 0
      webUrl.value = ''
      error.value = '无法连接本地服务'
      autoRecover()
    }
  }, 5000)
  tabPollTimer = setInterval(async () => {
    if (!browserWindows.value.length || typeof window.cs?.listAgentBrowserTabs !== 'function') return
    try {
      const snapshot = await window.cs.listAgentBrowserTabs()
      if (!snapshot?.ok) return
      const live = new Set((snapshot.tabs || []).map((tab) => String(tab.id || '')).filter(Boolean))
      const closed = browserWindows.value.filter((win) => !live.has(String(win.tabId)))
      for (const win of closed) await closeBrowserWindow(win.tabId)
    } catch { /* 下一次快照重试 */ }
  }, 2000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (tabPollTimer) clearInterval(tabPollTimer)
  window.removeEventListener('message', onWindowMessage)
})

watch(() => props.theme, (t) => {
  if (t) pushTheme()
})

watch(() => [props.navItems, props.activeNav], () => {
  pushNav()
}, { deep: false })

// 智能体调用浏览器工具(浏览器操作画面)时自动弹出实时浏览器窗口
watch(() => props.browserAutoOpen, (count) => {
  if (Number(count) > 0) {
    browserOpen.value = true
  }
})

// 多窗口实时浏览器:按会话/页面(tab)绑定,一个页面一个窗口
watch(() => props.browserTabs, (payload) => {
  if (!payload || !Array.isArray(payload.tabs)) return
  if (!payload.tabs.length) {
    for (const win of browserWindows.value) void closeBrowserWindow(win.tabId)
    return
  }
  const next = []
  for (const tab of payload.tabs) {
    if (!tab || !tab.id) continue
    const existing = browserWindows.value.find((w) => w.tabId === String(tab.id))
    if (existing) {
      existing.url = tab.url || existing.url
      existing.title = tab.title || existing.title
      next.push(existing)
    } else {
      next.push({ tabId: String(tab.id), url: tab.url || '', title: tab.title || '' })
    }
  }
  browserWindows.value = next
  // 活跃 tab 的窗口置顶(排在数组尾部渲染在上层)
  const active = String(payload.activeTabId || '')
  if (active) {
    const idx = browserWindows.value.findIndex((w) => w.tabId === active)
    if (idx >= 0) {
      const [win] = browserWindows.value.splice(idx, 1)
      browserWindows.value.push(win)
    }
  }
}, { deep: true })

async function closeBrowserWindow(tabId) {
  browserWindows.value = browserWindows.value.filter((w) => w.tabId !== String(tabId))
  if (typeof window.cs?.stopAgentBrowserStream === 'function') {
    await window.cs.stopAgentBrowserStream(String(tabId))
    if (typeof window.cs?.getAgentBrowserStreamState === 'function') {
      const state = await window.cs.getAgentBrowserStreamState()
      if ((state?.streams || []).some((stream) => String(stream.targetId) === String(tabId))) {
        console.warn('[agent] 浏览器流关闭后仍存在:', tabId)
      }
    }
  }
}

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
