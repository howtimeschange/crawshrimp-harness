<template>
  <div class="agent-web-view">
    <!-- 主体:iframe(DSH Web UI) + 可展开浏览器面板 -->
    <div
      class="web-body"
    >
      <div class="web-frame-wrap" :style="{ marginRight: frameReady && resourcesCompact ? '332px' : undefined }">
        <iframe
          v-if="webUrl"
          ref="frameEl"
          class="web-frame"
          :src="frameSrc"
          :title="'抓虾智能体'"
          allow="clipboard-read; clipboard-write; fullscreen"
          @load="onFrameLoad"
        />
        <div v-else :class="['web-placeholder-shell', { 'has-fallback-nav': showFallbackNav }]">
          <aside v-if="showFallbackNav" class="fallback-nav" aria-label="抓虾菜单">
            <div class="fallback-nav-head">
              <strong>抓虾智能体</strong>
              <span>模型待配置</span>
            </div>
            <nav class="fallback-nav-list">
              <template v-for="item in props.navItems.filter(item => item.id !== 'settings')" :key="item.id">
                <div
                  v-if="item.children?.length"
                  :class="['fallback-nav-group', { active: isFallbackNavGroupActive(item), open: isFallbackNavGroupExpanded(item) }]"
                >
                  <button
                    type="button"
                    class="fallback-nav-item fallback-nav-group-btn"
                    :class="{ active: isFallbackNavGroupActive(item) }"
                    :aria-expanded="isFallbackNavGroupExpanded(item)"
                    :aria-controls="`fallback-${item.id}-children`"
                    @click="toggleFallbackNavGroup(item)"
                  >
                    <span class="fallback-nav-icon" aria-hidden="true">{{ item.icon }}</span>
                    <span>{{ item.label }}</span>
                    <span class="fallback-nav-chevron" aria-hidden="true">›</span>
                  </button>
                  <div v-if="isFallbackNavGroupExpanded(item)" :id="`fallback-${item.id}-children`" class="fallback-nav-children">
                    <button
                      v-for="child in item.children"
                      :key="child.id"
                      type="button"
                      :class="['fallback-nav-item', 'fallback-nav-child', { active: child.id === props.activeNav }]"
                      @click="selectFallbackNav(child)"
                    >
                      <span class="fallback-nav-icon" aria-hidden="true">{{ child.icon }}</span>
                      <span>{{ child.label }}</span>
                    </button>
                  </div>
                </div>
                <button
                  v-else
                  type="button"
                  :class="['fallback-nav-item', { active: item.id === props.activeNav }]"
                  @click="selectFallbackNav(item)"
                >
                  <span class="fallback-nav-icon" aria-hidden="true">{{ item.icon }}</span>
                  <span>{{ item.label }}</span>
                </button>
              </template>
            </nav>
          </aside>
          <section class="web-placeholder">
            <VoyageLoader v-if="!runtimeNeedsAttention && !isRuntimeNeedsConfiguration && !isRuntimeDisabled" />
            <template v-else>
            <div class="placeholder-icon">{{ placeholderIcon }}</div>
            <div class="placeholder-title">{{ placeholderTitle }}</div>
            <div class="placeholder-text">{{ placeholderText }}</div>
            </template>
            <div class="placeholder-actions">
              <span :class="['recover-state', { muted: runtimeNeedsAttention }]">{{ placeholderStateText }}</span>
              <button v-if="runtimeNeedsAttention" class="placeholder-btn primary" type="button" @click="retryLoad">
                重新连接智能体
              </button>
            </div>
          </section>
        </div>
      </div>
      <SessionResources v-if="frameReady" ref="resourcesPanel" @compact-change="resourcesCompact = $event" :session-id="activeRuntimeSessionId" :conversation-phase="activeConversationPhase" :revision="props.resourceRevision" @download-log="exportSessionLog" />
      <div v-if="fileDropOverlay" class="resource-drop-overlay" :style="fileDropOverlay" aria-hidden="true" />
    </div>
    <Teleport to="body">
      <div v-if="inlineLlmModalOpen" class="inline-llm-modal-backdrop" @click.self="closeInlineLlmModal">
        <section
          class="inline-llm-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inline-llm-modal-title"
        >
          <header class="inline-modal-head">
            <div>
              <strong id="inline-llm-modal-title">配置大模型供应商</strong>
              <span>当前对话需要至少一个可用供应商；其它抓虾功能不受影响。</span>
            </div>
          </header>

          <div class="inline-llm-card in-modal">
            <div class="inline-card-head">
              <div>
                <strong>选择一种配置方式</strong>
                <span>进入设置页后会打开对应的大模型配置入口。</span>
              </div>
            </div>
            <div class="provider-guide-list" aria-label="大模型供应商配置说明">
              <div class="provider-guide-row">
                <div>
                  <strong>DeepSeek 官方 API</strong>
                  <span>
                    适合新用户直接接入官方 Key；
                    <button class="provider-text-link" type="button" @click="openDeepSeekPlatform">
                      <IconExternalLink :size="13" :stroke-width="2.1" aria-hidden="true" />
                      <span>打开 DeepSeek 平台</span>
                    </button>
                    创建 Key 后进入配置弹窗粘贴保存。
                  </span>
                </div>
                <div class="provider-guide-actions">
                  <button class="placeholder-btn primary" type="button" @click="openDeepSeekProviderSettings">
                    <IconSettings :size="15" :stroke-width="2.1" aria-hidden="true" />
                    <span>配置 DeepSeek</span>
                  </button>
                </div>
              </div>
              <div class="provider-guide-row">
                <div>
                  <strong>森马 AI 网关</strong>
                  <span>适合使用公司网关；进入大模型配置页后分别编辑海外 OpenAI、海外 Anthropic、国内 OpenAI。</span>
                </div>
                <div class="provider-guide-actions">
                  <button class="placeholder-btn primary" type="button" @click="openSemirProviderSettings">
                    <IconSettings :size="15" :stroke-width="2.1" aria-hidden="true" />
                    <span>配置森马 AI 网关</span>
                  </button>
                </div>
              </div>
              <div class="provider-guide-row">
                <div>
                  <strong>自定义模型供应商</strong>
                  <span>适合接入其它 OpenAI/Anthropic 兼容服务；进入设置页后会直接打开新增供应商弹窗。</span>
                </div>
                <div class="provider-guide-actions">
                  <button class="placeholder-btn primary" type="button" @click="openCustomProviderSettings">
                    <IconSettings :size="15" :stroke-width="2.1" aria-hidden="true" />
                    <span>添加自定义供应商</span>
                  </button>
                </div>
              </div>
            </div>
            <div class="inline-form-actions">
              <button class="placeholder-btn" type="button" @click="closeInlineLlmModal">取消</button>
              <button class="placeholder-btn primary" type="button" @click="openSemirProviderSettings">
                <IconSettings :size="15" :stroke-width="2.1" aria-hidden="true" />
                <span>进入大模型配置页</span>
              </button>
            </div>
          </div>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { IconExternalLink, IconSettings } from '@tabler/icons-vue'
import VoyageLoader from '../components/agent/VoyageLoader.vue'
import SessionResources from '../components/agent/SessionResources.vue'
import { DEEPSEEK_PLATFORM_URL } from '../utils/llmSettings.mjs'


const props = defineProps({
  theme: { type: String, default: '' },        // effectiveTheme(light|dark)
  navItems: { type: Array, default: () => [] }, // 抓虾一级菜单(注入会话侧边栏底部)
  activeNav: { type: String, default: '' },     // 当前激活菜单 id
  appVersion: { type: String, default: '' },     // 抓虾桌面版本号,同步到 DSH 侧栏品牌区
  resourceRevision: { type: Number, default: 0 },
})

const emit = defineEmits(['nav-select', 'rail-metrics', 'session-nav', 'runtime-session', 'repair-core', 'open-settings', 'shell-controls-change'])

const resourcesPanel = ref(null)
const resourcesCompact = ref(false)
const webUrl = ref('')
const frameReady = ref(false)
const error = ref('')
const loading = ref(true)
const recoverAttempts = ref(0)
const workspaceRoot = ref('')
const runtimeGeneration = ref(0)
const frameEl = ref(null)
const fileDropOverlay = ref(null)
const activeRuntimeSessionId = ref('')
const activeConversationPhase = ref('hero')
const lastRuntimeState = ref('')
let pollTimer = null
let warmStarted = false
let recovering = false
let nativeWebFollowRetryTimer = null
let nativeWebFollowSessionId = ''
const nativeWebFollowOwner = `agent-webview:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
const MISSING_LLM_PROVIDER_MESSAGE = '请先配置任一可用的大模型供应商。'
const NATIVE_WEB_FOLLOW_RETRY_DELAYS_MS = [250, 750, 1500]

const frameSrc = computed(() => {
  if (!webUrl.value) return ''
  const url = new URL(webUrl.value, window.location.href)
  if (props.theme === 'light' || props.theme === 'dark') url.searchParams.set('theme', props.theme)
  if (shouldUseShellDirectoryPicker()) url.searchParams.set('csDirectoryPicker', 'shell')
  if (runtimeNeedsModelKey.value) url.searchParams.set('csNeedsModelKey', '1')
  if (runtimeGeneration.value > 0) url.searchParams.set('csRuntimeGeneration', String(runtimeGeneration.value))
  return url.href
})
const frameOrigin = computed(() => {
  try { return webUrl.value ? new URL(webUrl.value, window.location.href).origin : '' } catch { return '' }
})
const isRuntimeNeedsConfiguration = computed(() => lastRuntimeState.value === 'needs_configuration')
const isRuntimeDisabled = computed(() => lastRuntimeState.value === 'disabled_until_manual_restart')
const runtimeNeedsAttention = computed(() => {
  if (isRuntimeNeedsConfiguration.value || ['starting', 'ready'].includes(lastRuntimeState.value)) return false
  return Boolean(error.value)
})
const showFallbackNav = computed(() => Boolean(isRuntimeNeedsConfiguration.value && !webUrl.value && props.navItems?.length))
const expandedFallbackNavGroupIds = ref(new Set(['ai_workflows']))
const placeholderIcon = computed(() => {
  if (isRuntimeNeedsConfiguration.value) return '钥'
  return runtimeNeedsAttention.value ? '!' : '…'
})
const placeholderTitle = computed(() => {
  if (isRuntimeNeedsConfiguration.value) return '智能体待配置'
  if (isRuntimeDisabled.value) return '智能体核心已暂停'
  if (runtimeNeedsAttention.value) return '智能体启动失败'
  return '智能体启动中…'
})
const placeholderText = computed(() => (
  isRuntimeNeedsConfiguration.value
    ? normalizeModelConfigMessage(error.value)
    : error.value || '正在准备会话环境,请稍候片刻。'
))
const placeholderStateText = computed(() => (
  isRuntimeNeedsConfiguration.value
    ? '等待模型配置'
    : runtimeNeedsAttention.value ? '需要重新连接' : '自动就绪中,无需操作'
))
const runtimeNeedsModelKey = ref(false)
const inlineLlmModalOpen = ref(false)

function syncRuntimeModelConfiguration(result) {
  const needsModelKey = result?.api_key_configured === false
  const changed = runtimeNeedsModelKey.value !== needsModelKey
  runtimeNeedsModelKey.value = needsModelKey
  if (!needsModelKey) {
    inlineLlmModalOpen.value = false
  }
  if (changed) pushRuntimeModelConfiguration()
}

const exportingLogs = new Set()
async function exportSessionLog() {
  const sessionId = activeRuntimeSessionId.value
  if (!sessionId || exportingLogs.has(sessionId)) return
  exportingLogs.add(sessionId)
  try {
    await window.cs.exportSessionLog(sessionId)
  } catch (error) {
    if (sessionId === activeRuntimeSessionId.value) resourcesPanel.value?.showError(`会话日志导出失败：${error.message}`)
  } finally { exportingLogs.delete(sessionId) }
}

function postToFrame(message) {
  if (!frameEl.value?.contentWindow || !frameOrigin.value) return false
  try {
    frameEl.value.contentWindow.postMessage(message, frameOrigin.value)
    return true
  } catch {
    return false
  }
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
  // The main process authenticates this iframe before returning the clean URL.
  // Packaged file:// pages cannot rely on DSH's SameSite=Strict browser cookie.
  return result?.web_launch_url || ''
}

async function loadRuntime() {
  try {
    const result = await window.cs.agentApi('GET', '/agent/runtime')
    const state = String(result?.state || '')
    lastRuntimeState.value = state
    syncRuntimeModelConfiguration(result)
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
    if (state === 'needs_configuration') {
      error.value = normalizeModelConfigMessage(result?.error)
      loading.value = false
      return false
    }
    if (state === 'failed' || state === 'crashed' || state === 'disabled_until_manual_restart' || result?.error) {
      error.value = result.error || '运行时启动失败'
      if (state === 'disabled_until_manual_restart' && !result?.error) {
        error.value = '核心服务连续崩溃，已暂停自动重试。请点击“重新连接智能体”或重启核心服务。'
      }
      loading.value = false
    } else if (result?.enabled !== false && !result?.active_run && ['stopped', 'unknown', ''].includes(state)) {
      // 预热:web host 未起(首轮会话前)→ 拉起 runtime
      try {
        const warm = await window.cs.agentApi('POST', '/agent/runtime/restart')
        if (warm?.ok || warm?.state === 'ready') return await loadRuntime()
        if (warm?.state === 'needs_configuration') {
          lastRuntimeState.value = 'needs_configuration'
          error.value = normalizeModelConfigMessage(warm?.error)
          loading.value = false
          return false
        }
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
  if (lastRuntimeState.value === 'needs_configuration' || lastRuntimeState.value === 'disabled_until_manual_restart') return
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

async function retryLoad() {
  warmStarted = false
  error.value = ''
  recoverAttempts.value = 0
  if (lastRuntimeState.value === 'disabled_until_manual_restart') {
    try {
      const restarted = await window.cs.agentApi('POST', '/agent/runtime/restart')
      if (restarted?.state) lastRuntimeState.value = String(restarted.state)
      if (!restarted?.ok && restarted?.state === 'disabled_until_manual_restart') {
        error.value = restarted.error || '核心服务仍处于暂停状态，请重启核心服务后再试。'
        return
      }
    } catch (err) {
      error.value = err?.message || '无法重启智能体运行时'
      return
    }
  }
  await autoRecover()
}

function selectFallbackNav(item) {
  if (!item?.id) return
  emit('nav-select', item.id)
}

function isFallbackNavGroupActive(item = {}) {
  return Boolean(item?.children?.some(child => child.id === props.activeNav))
}

function isFallbackNavGroupExpanded(item = {}) {
  return expandedFallbackNavGroupIds.value.has(item?.id)
}

function toggleFallbackNavGroup(item = {}) {
  if (!item?.id || !item?.children?.length) return
  const next = new Set(expandedFallbackNavGroupIds.value)
  if (next.has(item.id)) next.delete(item.id)
  else next.add(item.id)
  expandedFallbackNavGroupIds.value = next
}

function normalizeModelConfigMessage(message = '') {
  const text = String(message || '').trim()
  if (!text || /DeepSeek 官方 API Key|网关 API Key/.test(text)) return MISSING_LLM_PROVIDER_MESSAGE
  return text
}

function openInlineLlmModal() {
  inlineLlmModalOpen.value = true
}

function closeInlineLlmModal() {
  inlineLlmModalOpen.value = false
}

function openLlmSettings() {
  inlineLlmModalOpen.value = false
  emit('open-settings', {
    panelId: 'ai-llm',
  })
}

function openDeepSeekProviderSettings() {
  openLlmSettings()
}

function openSemirProviderSettings() {
  openLlmSettings()
}

function openCustomProviderSettings() {
  openLlmSettings()
}

function openDeepSeekPlatform() {
  if (typeof window.cs?.openExternalUrl === 'function') {
    window.cs.openExternalUrl(DEEPSEEK_PLATFORM_URL).catch((err) => {
      console.warn('[agent] 打开 DeepSeek 官方平台失败:', err?.message || err)
    })
    return
  }
  window.open(DEEPSEEK_PLATFORM_URL, '_blank', 'noopener,noreferrer')
}

function onFrameLoad() {
  fileDropOverlay.value = null
  // iframe 加载后同步主题、菜单、版本号与默认工作区
  pushTheme()
  pushNav()
  pushAppVersion()
  pushWorkspace()
  pushRuntimeModelConfiguration()
}

function pushWorkspace() {
  if (!workspaceRoot.value) return
  postToFrame({ __crawshrimp: 'workspace', root: workspaceRoot.value })
}

function pushRuntimeModelConfiguration() {
  // rc.1 exchanges the one-time launch URL and redirects to a clean address,
  // so a csNeedsModelKey query flag cannot survive as application state. The
  // authenticated Shell bridge is the durable source of this product setting.
  postToFrame({
    __crawshrimp: 'runtime-model-configuration',
    apiKeyConfigured: !runtimeNeedsModelKey.value,
  })
}

function pushTheme() {
  postToFrame({ __crawshrimp: 'theme', theme: props.theme })
}

function pushNav() {
  postToFrame({
    __crawshrimp: 'nav',
    items: serializeShellNavItems(props.navItems || []),
    active: props.activeNav,
  })
}

function serializeShellNavItems(items = []) {
  return (items || []).map((item) => {
    const normalized = {
      id: String(item?.id || ''),
      icon: String(item?.icon || ''),
      label: String(item?.label || item?.id || ''),
    }
    const children = serializeShellNavItems(item?.children || []).filter(child => child.id)
    if (children.length) normalized.children = children
    return normalized
  }).filter(item => item.id)
}

function normalizedAppVersionLabel() {
  const version = String(props.appVersion || '').trim().replace(/^v(?=\d)/i, '')
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version) ? `v${version}` : ''
}

function pushAppVersion() {
  const version = normalizedAppVersionLabel()
  if (!version) return
  postToFrame({ __crawshrimp: 'app-version', version })
}

function shouldUseShellDirectoryPicker() {
  const platform = String(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '').toLowerCase()
  return platform.includes('win')
}

async function handleWorkspaceDirectoryPick(data = {}) {
  const requestId = String(data.requestId || '').trim()
  if (!requestId) return
  try {
    if (typeof window.cs?.browseFile !== 'function') throw new Error('当前环境不支持系统文件夹选择器')
    const selectedPath = await window.cs.browseFile({
      directory: true,
      createDirectory: true,
      title: String(data.title || '选择工作区目录'),
      defaultPath: workspaceRoot.value || undefined,
    })
    postToFrame({
      __crawshrimp: 'workspace-directory-picked',
      requestId,
      path: selectedPath || '',
      canceled: !selectedPath,
    })
  } catch (error) {
    postToFrame({
      __crawshrimp: 'workspace-directory-picked',
      requestId,
      error: error?.message || String(error),
    })
  }
}

// iframe 内菜单点击 / 侧边栏宽度变化 / 会话导航 → shell
function onWindowMessage(event) {
  const data = event?.data
  if (!data || !data.__crawshrimp) return
  // 仅接受智能体会话 iframe 的消息(防其他内嵌页面冒用特权通道)
  const sessionWin = frameEl.value?.contentWindow
  if (!sessionWin || event.source !== sessionWin || event.origin !== frameOrigin.value) return
  if (data.__crawshrimp === 'file-drop-overlay') {
    const frame = frameEl.value.getBoundingClientRect()
    const shell = frameEl.value.closest('.agent-web-view').getBoundingClientRect()
    fileDropOverlay.value = data.active ? {
      left: `${frame.right - shell.left}px`,
      backgroundColor: data.background,
    } : null
  } else if (data.__crawshrimp === 'nav-click') {
    if (Number(data.railWidth) > 0) emit('rail-metrics', { width: data.railWidth, collapsed: false })
    // 菜单切换时最小化实时浏览器窗口,避免浮动窗口盖住界面拦截点击
    emit('nav-select', data.id)
  } else if (data.__crawshrimp === 'rail-metrics') {
    emit('rail-metrics', { width: data.width, collapsed: data.collapsed })
  } else if (data.__crawshrimp === 'session-log-error') {
    if (data.runtimeSessionId === activeRuntimeSessionId.value) resourcesPanel.value?.showError(data.message)
  } else if (data.__crawshrimp === 'session-nav') {
    if (data.kind === 'new') activeConversationPhase.value = 'hero'
    emit('session-nav', data.kind || 'session')
  } else if (data.__crawshrimp === 'active-runtime-session') {
    const previousRuntimeSessionId = activeRuntimeSessionId.value
    activeRuntimeSessionId.value = String(data.runtimeSessionId || '')
    activeConversationPhase.value = ['hero', 'active', 'settling'].includes(data.conversationPhase) ? data.conversationPhase : 'settling'
    emit('runtime-session', activeRuntimeSessionId.value)
    if (previousRuntimeSessionId && previousRuntimeSessionId !== activeRuntimeSessionId.value) {
      void unobserveNativeWebSession(previousRuntimeSessionId)
    }
    if (!activeRuntimeSessionId.value) {
      if (nativeWebFollowRetryTimer) clearTimeout(nativeWebFollowRetryTimer)
      nativeWebFollowRetryTimer = null
      nativeWebFollowSessionId = ''
    } else if (previousRuntimeSessionId !== activeRuntimeSessionId.value) {
      void observeNativeWebSession(activeRuntimeSessionId.value)
    }
  } else if (data.__crawshrimp === 'reveal-file') {
    const p = String(data.path || '').trim()
    if (p && typeof window.cs?.revealFile === 'function') {
      window.cs.revealFile(p).catch(() => {})
    }
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
  } else if (data.__crawshrimp === 'workspace-directory-pick') {
    handleWorkspaceDirectoryPick(data)
  } else if (data.__crawshrimp === 'workspace-ready') {
    frameReady.value = true
    // The slots client registers after the iframe's initial load event. Replay
    // the default workspace only after it explicitly confirms that its
    // postMessage listener is ready, so first launch cannot lose the binding.
    pushWorkspace()
    pushRuntimeModelConfiguration()
  } else if (data.__crawshrimp === 'llm-config-request') {
    openInlineLlmModal()
  }
}

const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024
const IMAGE_MIME_PREFIX = 'image/'

function isImageLikeFile(file) {
  return String(file?.type || file?.mime || '').toLowerCase().startsWith(IMAGE_MIME_PREFIX)
}

function scheduleNativeWebSessionFollow(runtimeId, attempt) {
  if (nativeWebFollowRetryTimer || activeRuntimeSessionId.value !== runtimeId) return
  const delay = NATIVE_WEB_FOLLOW_RETRY_DELAYS_MS[attempt]
  if (delay === undefined) return
  nativeWebFollowRetryTimer = setTimeout(() => {
    nativeWebFollowRetryTimer = null
    void observeNativeWebSession(runtimeId, attempt + 1)
  }, delay)
}

async function observeNativeWebSession(runtimeSessionId, attempt = 0) {
  const runtimeId = String(runtimeSessionId || '').trim()
  if (!runtimeId || typeof window.cs?.agentApi !== 'function') return
  if (nativeWebFollowSessionId !== runtimeId) {
    if (nativeWebFollowRetryTimer) clearTimeout(nativeWebFollowRetryTimer)
    nativeWebFollowRetryTimer = null
    nativeWebFollowSessionId = runtimeId
  }
  try {
    const result = await window.cs.agentApi('POST', '/agent/runtime/web-session', {
      runtime_session_id: runtimeId,
      owner: nativeWebFollowOwner,
    })
    if (result?.ok) return
    scheduleNativeWebSessionFollow(runtimeId, attempt)
  } catch (error) {
    scheduleNativeWebSessionFollow(runtimeId, attempt)
    if (attempt >= NATIVE_WEB_FOLLOW_RETRY_DELAYS_MS.length) {
      // Do not expose backend transport detail as a fake composer success.
      console.warn('[agent] 原生 Web 会话绑定失败:', error?.message)
    }
  }
}

async function unobserveNativeWebSession(runtimeSessionId) {
  const runtimeId = String(runtimeSessionId || '').trim()
  if (!runtimeId || typeof window.cs?.agentApi !== 'function') return
  try {
    await window.cs.agentApi('DELETE', '/agent/runtime/web-session', {
      runtime_session_id: runtimeId,
      owner: nativeWebFollowOwner,
    })
  } catch {
    // The worker also clears all follows on runtime stop.  A UI unmount must
    // remain idempotent while that shutdown race is in progress.
  }
}

async function pushNativeImageDraft(file, runtimeSessionId = '') {
  if (!isImageLikeFile(file) || typeof window.cs?.readAgentAttachment !== 'function') return false
  const runtimeId = String(runtimeSessionId || activeRuntimeSessionId.value || '')
  if (!runtimeId || !file?.path) return false
  try {
    const image = await window.cs.readAgentAttachment(file.path)
    if (!image?.ok || !image.bytes || !image.mime) return false
    if (!postToFrame({
      __crawshrimp: 'native-image-attachment',
      runtimeSessionId: runtimeId,
      name: String(file.name || image.name || 'image'),
      mime: image.mime,
      bytes: image.bytes,
    })) return false
    return true
  } catch (error) {
    console.warn('[agent] 图片交给 DSH 原生附件通道失败:', error?.message)
    return false
  }
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
      if (isImageLikeFile(file)) {
        await pushNativeImageDraft(file, runtimeId)
        continue
      }
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
  // 持续读取受控 runtime 状态来恢复。rc.1 的 Web Host 对裸 HTTP 正确返回
  // 401，因此不能以无 cookie 的 fetch 误判它离线。
  let runtimePollInFlight = false
  pollTimer = setInterval(async () => {
    if (runtimePollInFlight) return
    runtimePollInFlight = true
    try {
      const st = await window.cs.agentApi('GET', '/agent/runtime')
      const state = String(st?.state || '')
      lastRuntimeState.value = state
      syncRuntimeModelConfiguration(st)
      const runtimeUrl = applyRuntimeSnapshot(st)
      if (runtimeUrl && state === 'ready') {
        if (!webUrl.value || webUrl.value !== runtimeUrl) webUrl.value = runtimeUrl
        loading.value = false
        error.value = ''
        return
      }
      if (state === 'starting' || state === 'ready') {
        webUrl.value = ''
        loading.value = true
        error.value = state === 'ready' ? '智能体会话界面启动中' : ''
        return
      }
      if (state === 'needs_configuration') {
        webUrl.value = ''
        loading.value = false
        error.value = normalizeModelConfigMessage(st?.error)
        return
      }
      webUrl.value = ''
      error.value = st?.error || '智能体运行时不可用'
      autoRecover()
    } catch {
      // A failed status probe does not mean the independent DSH iframe died.
      // Preserve the mounted conversation; the next successful poll reconciles it.
      if (webUrl.value) return
      error.value = '无法连接本地服务'
      autoRecover()
    } finally {
      runtimePollInFlight = false
    }
  }, 5000)

})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  window.removeEventListener('message', onWindowMessage)
  if (nativeWebFollowRetryTimer) clearTimeout(nativeWebFollowRetryTimer)
  nativeWebFollowRetryTimer = null
  void unobserveNativeWebSession(nativeWebFollowSessionId || activeRuntimeSessionId.value)
  nativeWebFollowSessionId = ''
})

watch(() => props.theme, (t) => {
  if (t) pushTheme()
})

watch(() => [props.navItems, props.activeNav], () => {
  pushNav()
}, { deep: false })

watch(() => props.appVersion, () => {
  pushAppVersion()
})

// A runtime URL alone does not mean the embedded conversation UI is ready.
watch(frameSrc, () => {
  fileDropOverlay.value = null
  frameReady.value = false
  resourcesCompact.value = false
}, { flush: 'sync' })

watch(() => frameReady.value || isRuntimeNeedsConfiguration.value || runtimeNeedsAttention.value || isRuntimeDisabled.value, (visible) => {
  emit('shell-controls-change', visible)
}, { immediate: true })

watch(showFallbackNav, (visible) => {
  if (visible) emit('rail-metrics', { width: 280, collapsed: false })
}, { immediate: true })


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
  min-width: 0;
  display: flex;
}

.resource-drop-overlay {
  position: absolute;
  inset: 0 0 0 auto;
  z-index: 1000;
  pointer-events: none;
  backdrop-filter: blur(10px);
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

.web-placeholder-shell {
  position: absolute;
  inset: 0;
  display: flex;
  min-width: 0;
  min-height: 0;
}

.fallback-nav {
  padding-bottom:44px;
  width: 280px;
  flex: 0 0 280px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 12px;
  border-right: 1px solid var(--border);
  background: var(--dock-bg);
  overflow-y: auto;
}

.fallback-nav-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 9px 10px;
  color: var(--text);
}

.fallback-nav-head strong {
  font-size: 13px;
  font-weight: 760;
}

.fallback-nav-head span {
  color: var(--text3);
  font-size: 11px;
}

.fallback-nav-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.fallback-nav-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.fallback-nav-item {
  width: 100%;
  min-height: 38px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text2);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
}

.fallback-nav-item:hover {
  background: var(--soft-fill-hover);
  color: var(--text);
}

.fallback-nav-item.active {
  background: var(--orange-bg);
  border-color: rgba(var(--orange-rgb), 0.22);
  color: var(--orange-text);
}

.fallback-nav-group-btn.active {
  background: var(--soft-fill-hover);
  color: var(--text);
}

.fallback-nav-chevron {
  margin-left: auto;
  color: var(--text3);
  line-height: 1;
  transition: transform 0.15s ease;
}

.fallback-nav-group.open .fallback-nav-chevron {
  transform: rotate(90deg);
}

.fallback-nav-children {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-left: 18px;
}

.fallback-nav-child {
  min-height: 34px;
  padding-left: 9px;
  font-size: 12.5px;
}

.fallback-nav-icon {
  width: 20px;
  flex: 0 0 20px;
  text-align: center;
}

.web-placeholder {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 28px;
  overflow: auto;
}

.placeholder-icon { font-size: 34px; }
.placeholder-title { font-size: 15px; font-weight: 600; color: var(--text); }
.placeholder-text { font-size: 13px; color: var(--text2); text-align: center; max-width: 560px; line-height: 1.6; }
.placeholder-btn {
  border: 1px solid var(--border-strong);
  background: var(--bg3);
  color: var(--text);
  font-size: 13px;
  min-height: 34px;
  padding: 8px 14px;
  border-radius: 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  white-space: nowrap;
}
.placeholder-btn:hover { background: var(--soft-fill-hover); }
.placeholder-btn.primary {
  border-color: color-mix(in srgb, var(--orange) 68%, var(--border-strong));
  background: var(--orange-bg);
  color: var(--orange-text);
}
.placeholder-btn.link {
  flex: 0 0 auto;
  color: var(--text2);
}
.placeholder-btn:disabled {
  opacity: 0.58;
  cursor: default;
}

.placeholder-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
}

.inline-llm-card {
  width: min(100%, 640px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 6px 0 2px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg2);
}

.inline-llm-card.in-modal {
  width: 100%;
  margin: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0;
}

.inline-llm-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.58);
  backdrop-filter: blur(10px);
}

.inline-llm-modal {
  width: min(720px, calc(100vw - 32px));
  max-height: min(760px, calc(100vh - 32px));
  display: flex;
  flex-direction: column;
  overflow: auto;
  gap: 16px;
  padding: 18px;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  background: var(--bg2);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.36);
}

.inline-modal-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  align-items: start;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}

.inline-modal-head div {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.inline-modal-head strong {
  color: var(--text);
  font-size: 16px;
  font-weight: 760;
}

.inline-modal-head span {
  color: var(--text3);
  font-size: 12px;
  line-height: 1.5;
}

.inline-card-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}

.inline-card-head div,
.provider-guide-row,
.provider-guide-row > div,
.provider-guide-actions {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.inline-card-head strong,
.provider-guide-row strong {
  color: var(--text);
  font-size: 12px;
  font-weight: 760;
}

.inline-card-head span,
.provider-guide-row > div > span,
.runtime-detail {
  color: var(--text3);
  font-size: 11px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.inline-card-head div {
  gap: 5px;
}

.provider-guide-list {
  display: grid;
  gap: 10px;
}

.provider-guide-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--soft-fill);
}

.provider-guide-row > div {
  gap: 5px;
}

.provider-text-link {
  margin: 0 1px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--orange-text);
  font: inherit;
  font-weight: 720;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  vertical-align: baseline;
}

.provider-text-link:hover {
  text-decoration: underline;
}

.provider-guide-actions {
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: nowrap;
  gap: 8px;
}

.provider-guide-actions .placeholder-btn.primary {
  width: 178px;
}

.inline-form-actions {
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.runtime-detail {
  max-width: min(100%, 640px);
  margin: 0;
  padding: 7px 10px;
  border-radius: 7px;
  background: rgba(248, 113, 113, 0.1);
  color: var(--red);
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
.recover-state.muted::before {
  background: var(--text3);
  animation: none;
}
@keyframes cs-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

@media (max-width: 760px) {
  .web-placeholder-shell {
    flex-direction: column;
  }
  .fallback-nav {
    width: 100%;
    flex: 0 0 auto;
    max-height: 184px;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
  .fallback-nav-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .web-placeholder {
    justify-content: flex-start;
    padding-top: 36px;
  }
  .inline-card-head,
  .inline-modal-head {
    grid-template-columns: 1fr;
  }
  .inline-llm-modal-backdrop {
    padding: 12px;
  }
}
</style>
