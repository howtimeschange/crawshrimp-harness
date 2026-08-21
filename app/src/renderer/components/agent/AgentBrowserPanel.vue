<template>
  <Teleport to="body" :disabled="isDocked">
    <div
      class="agent-browser-window"
      :class="{ minimized, maximized, dragging, resizing, docked: isDocked }"
      :style="windowStyle"
      role="dialog"
      aria-label="实时浏览器窗口"
    >
      <div
        class="browser-window-head"
        @pointerdown.left="onDragStart"
        @dblclick="!isDocked && toggleMaximize()"
      >
        <span class="browser-window-title">
          <IconDeviceDesktop :size="15" :stroke-width="2.2" aria-hidden="true" />
          实时浏览器<span v-if="tabId" class="tab-chip">#{{ tabId.slice(-4) }}</span>
        </span>
        <span class="browser-status" :class="statusClass" :title="statusText">
          <i></i>{{ statusLabel }}
        </span>
        <span v-if="frameUrl && !minimized" class="browser-window-url" :title="frameUrl">{{ frameUrl }}</span>
        <span class="browser-window-spacer"></span>
        <button
          class="win-btn layout-btn"
          type="button"
          :title="layoutActionLabel"
          :aria-label="layoutActionLabel"
          :data-tooltip="layoutActionLabel"
          @pointerdown.stop
          @click="$emit('layout-change', isDocked ? 'floating' : 'docked')"
        >
          <IconExternalLink v-if="isDocked" :size="14" :stroke-width="2.2" aria-hidden="true" />
          <IconLayoutSidebarRight v-else :size="14" :stroke-width="2.2" aria-hidden="true" />
        </button>
        <button
          v-if="!isDocked"
          class="win-btn"
          type="button"
          :title="minimized ? '展开' : '最小化'"
          :aria-label="minimized ? '展开' : '最小化'"
          @pointerdown.stop
          @click="toggleMinimized"
        >
          <IconArrowsMaximize v-if="minimized" :size="14" :stroke-width="2.2" aria-hidden="true" />
          <IconMinus v-else :size="15" :stroke-width="2.4" aria-hidden="true" />
        </button>
        <button
          v-if="!minimized && !isDocked"
          class="win-btn"
          type="button"
          :title="maximized ? '还原' : '最大化'"
          :aria-label="maximized ? '还原' : '最大化'"
          @pointerdown.stop
          @click="toggleMaximize"
        >
          <IconArrowsMinimize v-if="maximized" :size="14" :stroke-width="2.2" aria-hidden="true" />
          <IconArrowsMaximize v-else :size="14" :stroke-width="2.2" aria-hidden="true" />
        </button>
        <button
          class="win-btn win-btn-close"
          type="button"
          title="关闭浏览器窗口"
          aria-label="关闭浏览器窗口"
          @pointerdown.stop
          @click="$emit('collapse')"
        >
          <IconX :size="15" :stroke-width="2.35" aria-hidden="true" />
        </button>
      </div>

      <div v-show="!minimized" class="browser-window-body">
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
        <div class="browser-window-foot">
          <span class="url" :title="frameUrl">{{ frameUrl || '—' }}</span>
          <span v-if="frame" class="frame-meta">{{ frame.width }}×{{ frame.height }}</span>
          <button class="refresh-btn" type="button" title="刷新画面" aria-label="刷新画面" @click="restart">
            <IconRefresh :size="14" :stroke-width="2.2" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        v-if="!isDocked && !minimized && !maximized"
        class="browser-window-resize"
        title="拖动调整大小"
        @pointerdown.left.prevent="onResizeStart"
      ></div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconDeviceDesktop,
  IconExternalLink,
  IconLayoutSidebarRight,
  IconMinus,
  IconRefresh,
  IconX,
} from '@tabler/icons-vue'

const props = defineProps({
  // 菜单切换等场景由父级递增 → 自动最小化,避免浮动窗口盖住界面拦截点击
  minimizeSignal: { type: Number, default: 0 },
  // 绑定的浏览器页面(target id);多窗口:一个页面一个窗口
  tabId: { type: String, default: '' },
  // 窗口序号(用于级联排列)
  windowIndex: { type: Number, default: 0 },
  // floating: 自由浮窗; docked: 固定在会话右侧
  layout: { type: String, default: 'floating' },
})

const emit = defineEmits(['collapse', 'layout-change'])

const frame = ref(null)
const frameUrl = ref('')
const statusState = ref('connecting') // connecting | connected | error | disconnected
const statusMessage = ref('')
const minimized = ref(false)
const maximized = ref(false)
const dragging = ref(false)
const resizing = ref(false)
const isDocked = computed(() => props.layout === 'docked')
const layoutActionLabel = computed(() => (isDocked.value ? '脱离为浮窗' : '固定到右侧'))

watch(() => props.minimizeSignal, (count) => {
  if (isDocked.value) return
  if (Number(count) > 0 && !minimized.value) {
    maximized.value = false
    minimized.value = true
    savePrefs()
  }
})

const MIN_W = 360
const MIN_H = 260
const DEFAULT_FLOAT_W = 520
const DEFAULT_FLOAT_H = 360
const storageKey = computed(() => `crawshrimp.browserWindow.v2.${String(props.tabId || 'default')}`)

const win = reactive({
  x: 0,
  y: 0,
  w: DEFAULT_FLOAT_W,
  h: DEFAULT_FLOAT_H,
})
const saved = reactive({ x: 0, y: 0, w: DEFAULT_FLOAT_W, h: DEFAULT_FLOAT_H, minimized: false, maximized: false })

let offFrame = null
let offStatus = null
let started = false
let drag = null
let resize = null
let interactionFrame = 0
let stopDragInteraction = null
let stopResizeInteraction = null
let hasStoredPrefs = false

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), Math.max(min, max))
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(storageKey.value)
    if (!raw) return
    const p = JSON.parse(raw)
    if (Number.isFinite(p.w) && Number.isFinite(p.h)) {
      hasStoredPrefs = true
      saved.w = clamp(p.w, MIN_W, window.innerWidth)
      saved.h = clamp(p.h, MIN_H, window.innerHeight)
      saved.x = Number.isFinite(p.x) ? p.x : 0
      saved.y = Number.isFinite(p.y) ? p.y : 0
      saved.minimized = Boolean(p.minimized)
      saved.maximized = Boolean(p.maximized)
    }
  } catch { /* ignore */ }
}

function savePrefs() {
  try {
    localStorage.setItem(storageKey.value, JSON.stringify({
      x: saved.x, y: saved.y, w: saved.w, h: saved.h,
      minimized: minimized.value, maximized: maximized.value,
    }))
  } catch { /* ignore */ }
}

function placeDefault() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  win.w = hasStoredPrefs ? saved.w : clamp(DEFAULT_FLOAT_W, MIN_W, Math.max(MIN_W, vw - 32))
  win.h = hasStoredPrefs ? saved.h : clamp(DEFAULT_FLOAT_H, MIN_H, Math.max(MIN_H, vh - 96))
  // 多窗口级联排列:按序号偏移 36px,循环避免无限右移
  const idx = Math.max(0, Number(props.windowIndex || 0)) % 4
  const off = idx * 36
  // 默认贴右上角,尽量不挡住主会话正文和输入框。
  const defaultX = vw - win.w - 16 - off
  const defaultY = 54 + off
  win.x = clamp(hasStoredPrefs ? saved.x : defaultX, 8, Math.max(8, vw - win.w - 8))
  win.y = clamp(hasStoredPrefs ? saved.y : defaultY, 48, Math.max(48, vh - win.h - 8))
  minimized.value = hasStoredPrefs ? saved.minimized : false
  maximized.value = hasStoredPrefs ? saved.maximized : false
}

const windowStyle = computed(() => {
  if (isDocked.value) return {}
  if (maximized.value) {
    return { left: '0px', top: '0px', width: '100vw', height: '100vh', transform: 'none' }
  }
  return {
    left: '0px',
    top: '0px',
    width: `${win.w}px`,
    height: minimized.value ? 'auto' : `${win.h}px`,
    transform: `translate3d(${win.x}px, ${win.y}px, 0)`,
  }
})

function scheduleInteractionFrame(apply) {
  if (interactionFrame) return
  interactionFrame = window.requestAnimationFrame(() => {
    interactionFrame = 0
    apply()
  })
}

function safelySetPointerCapture(target, pointerId) {
  try { target?.setPointerCapture?.(pointerId) } catch { /* ignore */ }
}

function safelyReleasePointerCapture(target, pointerId) {
  try {
    if (target?.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId)
  } catch { /* ignore */ }
}

function stopInteractions(options = {}) {
  stopDragInteraction?.(options)
  stopResizeInteraction?.(options)
}

watch(isDocked, (docked) => {
  stopInteractions({ save: true })
  if (docked) {
    minimized.value = false
    maximized.value = false
  } else {
    placeDefault()
  }
  if (frame.value) frame.value = { ...frame.value }
  if (!started) void start()
})

function onDragStart(event) {
  if (event.button !== 0) return
  if (isDocked.value) return
  if (maximized.value) return
  stopInteractions({ save: true })
  event.preventDefault()
  dragging.value = true
  drag = { startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, origX: win.x, origY: win.y }
  const pointerTarget = event.currentTarget
  const pointerId = event.pointerId
  safelySetPointerCapture(pointerTarget, pointerId)
  const applyDrag = () => {
    if (!drag) return
    win.x = clamp(drag.origX + (drag.lastX - drag.startX), 8, Math.max(8, window.innerWidth - win.w - 8))
    win.y = clamp(drag.origY + (drag.lastY - drag.startY), 8, Math.max(8, window.innerHeight - 46))
    saved.x = win.x
    saved.y = win.y
  }
  const onMove = (e) => {
    if (!drag) return
    drag.lastX = e.clientX
    drag.lastY = e.clientY
    scheduleInteractionFrame(applyDrag)
  }
  let done = false
  const onFinish = ({ save = true } = {}) => {
    if (done) return
    done = true
    applyDrag()
    drag = null
    dragging.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onFinish)
    window.removeEventListener('pointercancel', onFinish)
    window.removeEventListener('pointerdown', onNextPointerDown, true)
    window.removeEventListener('mouseup', onFinish)
    window.removeEventListener('blur', onFinish)
    safelyReleasePointerCapture(pointerTarget, pointerId)
    stopDragInteraction = null
    if (save) savePrefs()
  }
  const onNextPointerDown = () => onFinish()
  stopDragInteraction = onFinish
  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('pointerup', onFinish, { once: true })
  window.addEventListener('pointercancel', onFinish, { once: true })
  window.addEventListener('pointerdown', onNextPointerDown, { capture: true })
  window.addEventListener('mouseup', onFinish, { once: true })
  window.addEventListener('blur', onFinish, { once: true })
}

function onResizeStart(event) {
  if (event.button !== 0) return
  if (isDocked.value) return
  stopInteractions({ save: true })
  resizing.value = true
  resize = { startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, origW: win.w, origH: win.h }
  const pointerTarget = event.currentTarget
  const pointerId = event.pointerId
  safelySetPointerCapture(pointerTarget, pointerId)
  const applyResize = () => {
    if (!resize) return
    win.w = clamp(resize.origW + (resize.lastX - resize.startX), MIN_W, Math.max(MIN_W, window.innerWidth - win.x - 8))
    win.h = clamp(resize.origH + (resize.lastY - resize.startY), MIN_H, Math.max(MIN_H, window.innerHeight - win.y - 8))
    saved.w = win.w
    saved.h = win.h
  }
  const onMove = (e) => {
    if (!resize) return
    resize.lastX = e.clientX
    resize.lastY = e.clientY
    scheduleInteractionFrame(applyResize)
  }
  let done = false
  const onFinish = ({ save = true } = {}) => {
    if (done) return
    done = true
    applyResize()
    resize = null
    resizing.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onFinish)
    window.removeEventListener('pointercancel', onFinish)
    window.removeEventListener('pointerdown', onNextPointerDown, true)
    window.removeEventListener('mouseup', onFinish)
    window.removeEventListener('blur', onFinish)
    safelyReleasePointerCapture(pointerTarget, pointerId)
    stopResizeInteraction = null
    if (save) savePrefs()
  }
  const onNextPointerDown = () => onFinish()
  stopResizeInteraction = onFinish
  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('pointerup', onFinish, { once: true })
  window.addEventListener('pointercancel', onFinish, { once: true })
  window.addEventListener('pointerdown', onNextPointerDown, { capture: true })
  window.addEventListener('mouseup', onFinish, { once: true })
  window.addEventListener('blur', onFinish, { once: true })
}

function toggleMaximize() {
  if (isDocked.value) return
  maximized.value = !maximized.value
  if (maximized.value) minimized.value = false
  savePrefs()
}

function toggleMinimized() {
  if (isDocked.value) return
  minimized.value = !minimized.value
  if (minimized.value) maximized.value = false
  savePrefs()
}

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
  const result = await window.cs.startAgentBrowserStream(props.tabId)
  if (!result?.ok) {
    statusState.value = 'error'
    statusMessage.value = result?.error || '浏览器流启动失败'
    started = false
  }
}

async function restart() {
  if (typeof window.cs?.stopAgentBrowserStream === 'function') {
    await window.cs.stopAgentBrowserStream(props.tabId)
  }
  frame.value = null
  statusState.value = 'connecting'
  started = false
  start()
}

onMounted(() => {
  loadPrefs()
  if (isDocked.value) {
    minimized.value = false
    maximized.value = false
  } else {
    placeDefault()
  }
  if (window.cs?.onAgentBrowserFrame) {
    offFrame = window.cs.onAgentBrowserFrame((payload) => {
      if (String(payload?.targetId || '') !== String(props.tabId || '')) return
      frame.value = payload
      if (payload?.url) frameUrl.value = payload.url
    })
  }
  if (window.cs?.onAgentBrowserStatus) {
    offStatus = window.cs.onAgentBrowserStatus((payload) => {
      if (String(payload?.targetId || '') !== String(props.tabId || '')) return
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
  stopInteractions({ save: false })
  dragging.value = false
  resizing.value = false
  if (interactionFrame) window.cancelAnimationFrame(interactionFrame)
  if (typeof window.cs?.stopAgentBrowserStream === 'function') {
    window.cs.stopAgentBrowserStream(props.tabId)
  }
})
</script>

<style scoped>
.agent-browser-window {
  position: fixed;
  z-index: 1300;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.42);
  overflow: hidden;
  user-select: none;
  will-change: transform, width, height;
  contain: layout paint style;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.agent-browser-window.maximized {
  border-radius: 0;
}
.agent-browser-window.docked {
  position: relative;
  z-index: 0;
  width: 100%;
  height: 100%;
  border: none;
  border-radius: 0;
  box-shadow: none;
  transform: none;
}
.agent-browser-window.dragging,
.agent-browser-window.resizing {
  border-color: color-mix(in srgb, var(--orange) 52%, var(--border));
  box-shadow: 0 20px 58px rgba(0, 0, 0, 0.5);
  transition: none;
}
.browser-window-head {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 34px;
  padding: 6px 8px 6px 10px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg2) 94%, #000 6%);
  cursor: grab;
  flex: none;
  touch-action: none;
}
.agent-browser-window.docked .browser-window-head {
  cursor: default;
}
.browser-window-head:active {
  cursor: grabbing;
}
.agent-browser-window.docked .browser-window-head:active {
  cursor: default;
}
.browser-window-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.tab-chip {
  font-size: 10px;
  font-weight: 600;
  color: var(--text3);
  background: var(--bg3);
  border-radius: 4px;
  padding: 1px 5px;
}
.browser-status {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text3);
  white-space: nowrap;
  flex: none;
}
.browser-status i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text3);
  flex: none;
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
.browser-window-url {
  min-width: 0;
  flex: 1;
  font-size: 11.5px;
  color: var(--text3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.browser-window-spacer {
  flex: 1;
}
.win-btn {
  position: relative;
  width: 24px;
  height: 24px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text2);
  cursor: pointer;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.win-btn svg {
  display: block;
  pointer-events: none;
}
.win-btn:hover {
  background: var(--soft-fill-hover);
  color: var(--text);
  border-color: var(--border);
}
.win-btn-close:hover {
  background: color-mix(in srgb, var(--red) 88%, #000 12%);
  border-color: color-mix(in srgb, var(--red) 68%, #fff 10%);
  color: #fff;
}
.layout-btn::before,
.layout-btn::after {
  position: absolute;
  right: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease, transform 120ms ease;
  z-index: 4;
}
.layout-btn::before {
  content: '';
  top: calc(100% + 3px);
  width: 8px;
  height: 8px;
  background: var(--tooltip-bg);
  border: 1px solid color-mix(in srgb, var(--border-strong) 80%, #fff 8%);
  border-right: none;
  border-bottom: none;
  transform: translate(-8px, -1px) rotate(45deg);
}
.layout-btn::after {
  content: attr(data-tooltip);
  top: calc(100% + 7px);
  min-width: max-content;
  max-width: 160px;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--border-strong) 80%, #fff 8%);
  border-radius: 6px;
  background: var(--tooltip-bg);
  color: #f7f7fa;
  font-size: 11px;
  line-height: 1.2;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.34);
  transform: translateY(-2px);
}
.layout-btn:hover::before,
.layout-btn:hover::after,
.layout-btn:focus-visible::before,
.layout-btn:focus-visible::after {
  opacity: 1;
  transform: translateY(0);
}
.layout-btn:hover::before,
.layout-btn:focus-visible::before {
  transform: translate(-8px, -1px) rotate(45deg);
}
.browser-window-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.browser-frame {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0b0b0e;
  overflow: hidden;
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
  max-width: 300px;
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
.browser-window-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-top: 1px solid var(--border);
  background: var(--bg2);
  flex: none;
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
.frame-meta {
  font-size: 11px;
  color: var(--text3);
  white-space: nowrap;
  flex: none;
}
.refresh-btn {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text2);
  font-size: 14px;
  cursor: pointer;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.refresh-btn:hover {
  color: var(--text);
  background: var(--bg3);
}
.browser-window-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 22px;
  height: 22px;
  cursor: nwse-resize;
  touch-action: none;
  background:
    linear-gradient(135deg, transparent 0 55%, var(--text3) 55% 62%, transparent 62% 74%, var(--text3) 74% 82%, transparent 82%);
  opacity: 0.75;
}
.browser-window-resize:hover {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .browser-status.connecting i {
    animation: none;
  }
}
</style>
