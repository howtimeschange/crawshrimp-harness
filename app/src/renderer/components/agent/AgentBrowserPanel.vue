<template>
  <Teleport to="body" :disabled="isDocked">
    <div
      v-show="visible"
      class="agent-browser-window"
      :class="{ minimized, maximized, dragging, resizing, docked: isDocked }"
      :style="windowStyle"
      role="dialog"
      aria-label="实时浏览器窗口"
    >
      <div
        v-if="!compact"
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
        <button class="win-btn" type="button" title="在原生浏览器中操作" aria-label="在原生浏览器中操作" @pointerdown.stop @click="openNativeBrowser">
          <IconBrowser :size="15" :stroke-width="2.2" aria-hidden="true" />
        </button>
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
          title="收起浏览器画面"
          aria-label="收起浏览器画面"
          @pointerdown.stop
          @click="$emit('collapse')"
        >
          <IconX :size="15" :stroke-width="2.35" aria-hidden="true" />
        </button>
      </div>

      <p v-if="activity?.active_tab_id === tabId && !compact" class="execution-context" :title="`run ${activity.run_id || ''} · ${activity.tool_call_id || ''}`">{{ activity.operation || '页面观察' }} · {{ activity.phase === 'uncertain' ? '结果待核实，恢复画面不会重放操作' : 'Agent 当前页面' }} · {{ activity.run_id?.slice(-8) }}</p>
      <div v-show="!minimized" class="browser-window-body">
        <div class="browser-frame" :class="{ interactive: canInteract }"
          @pointerdown="onBrowserPointerDown" @pointermove="onBrowserPointerMove"
          @pointerup="onBrowserPointerUp" @pointercancel="releaseBrowserInput"
          @lostpointercapture="onBrowserPointerCaptureLost" @wheel="onBrowserWheel" @contextmenu.prevent>
          <img
            v-if="frame"
            class="browser-frame-img"
            ref="frameImage"
            :src="frame.dataUrl"
            alt="浏览器实时画面"
            draggable="false"
            @load="displayedFrame = frame"
          />
          <textarea v-if="!compact" ref="inputSink" class="browser-input-sink" aria-label="浏览器页面键盘输入"
            autocomplete="off" autocapitalize="off" spellcheck="false"
            @keydown="onBrowserKeyDown" @keyup="onBrowserKeyUp" @input="onBrowserText"
            @compositionstart="composing = true" @compositionend="onBrowserCompositionEnd"
            @paste="onBrowserPaste" @blur="releaseBrowserInput" />
          <div v-if="!frame" class="browser-frame-placeholder">
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
        <p v-if="inputError && !compact" class="browser-input-error" role="alert">{{ inputError }}</p>
        <div v-if="!compact" class="browser-window-foot">
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
  IconBrowser,
  IconDeviceDesktop,
  IconExternalLink,
  IconLayoutSidebarRight,
  IconMinus,
  IconRefresh,
  IconX,
} from '@tabler/icons-vue'

import { setBrowserPreviewVisible, subscribeBrowserPreview } from '../../utils/browserPreviewStreams.js'
import { browserPoint, browserModifiers, browserButton, browserWheel, createBrowserInputQueue } from '../../utils/browserInput.js'
const props = defineProps({
  // 菜单切换等场景由父级递增 → 自动最小化,避免浮动窗口盖住界面拦截点击
  minimizeSignal: { type: Number, default: 0 },
  // 绑定的浏览器页面(target id);多窗口:一个页面一个窗口
  tabId: { type: String, default: '' },
  // 窗口序号(用于级联排列)
  windowIndex: { type: Number, default: 0 },
  // floating: 自由浮窗; docked: 固定在会话右侧
  layout: { type: String, default: 'floating' },
  visible: { type: Boolean, default: true },
  activity: Object,
  compact: { type: Boolean, default: false },
  dockActionLabel: { type: String, default: '脱离为浮窗' },
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
const layoutActionLabel = computed(() => (isDocked.value ? props.dockActionLabel : '固定到右侧'))
const frameImage = ref(null), inputSink = ref(null), displayedFrame = ref(null), inputError = ref('')
const canInteract = computed(() => !props.compact && props.visible && !minimized.value && statusState.value === 'connected' && !!displayedFrame.value && !!props.tabId)
let composing = false, compositionCommit = '', pointer = null
let lastClick = null
const remoteKeys = new Set()
let inputQueue = makeInputQueue()
function makeInputQueue() {
  const targetId = props.tabId
  return createBrowserInputQueue(event => window.cs?.sendAgentBrowserInput?.(targetId, event) || Promise.resolve({ ok: false, error: '当前客户端不支持浏览器输入，请重启开发客户端' }), message => {
    inputError.value = message
    sendInputRelease(targetId)
  })
}
function sendBrowserInput(event) {
  if (!canInteract.value || document.hidden) return
  inputError.value = ''
  inputQueue.push(event)
}
async function openNativeBrowser() {
  releaseBrowserInput(true)
  try {
    const result = await window.cs.showAgentBrowserNative(props.tabId)
    if (result?.ok === false) inputError.value = result.error
  } catch (error) { inputError.value = error.message || '打开浏览器窗口失败' }
}
function onBrowserPointerDown(e) {
  if (!canInteract.value || e.button > 2) return
  const point = browserPoint(e, frameImage.value, displayedFrame.value)
  if (!point) return
  e.preventDefault()
  inputSink.value?.focus({ preventScroll: true })
  const repeated = lastClick && lastClick.button === e.button && e.timeStamp - lastClick.time < 500 && Math.hypot(point.x - lastClick.x, point.y - lastClick.y) < 5
  const clickCount = repeated ? lastClick.count % 3 + 1 : 1
  lastClick = { ...point, button: e.button, time: e.timeStamp, count: clickCount }
  pointer = { id: e.pointerId, target: e.currentTarget, button: browserButton(e.button), clickCount }
  safelySetPointerCapture(e.currentTarget, e.pointerId)
  sendBrowserInput({ kind: 'mouse', type: 'mousePressed', ...point, button: pointer.button, buttons: e.buttons, clickCount: pointer.clickCount, modifiers: browserModifiers(e) })
}
function onBrowserPointerMove(e) {
  const point = browserPoint(e, frameImage.value, displayedFrame.value, !!pointer)
  if (!point) return
  sendBrowserInput({ kind: 'mouse', type: 'mouseMoved', ...point, button: pointer?.button || 'none', buttons: e.buttons & 7, modifiers: browserModifiers(e) })
}
function onBrowserPointerUp(e) {
  if (!pointer || pointer.id !== e.pointerId) return
  const point = browserPoint(e, frameImage.value, displayedFrame.value, true), held = pointer
  pointer = null
  if (point) sendBrowserInput({ kind: 'mouse', type: 'mouseReleased', ...point, button: held.button, buttons: e.buttons & 7, clickCount: held.clickCount, modifiers: browserModifiers(e) })
  safelyReleasePointerCapture(held.target, held.id)
}
function onBrowserWheel(e) {
  if (!canInteract.value) return
  const point = browserPoint(e, frameImage.value, displayedFrame.value)
  if (!point) return
  e.preventDefault()
  sendBrowserInput({ kind: 'wheel', ...point, ...browserWheel(e, displayedFrame.value.height), modifiers: browserModifiers(e) })
}
function onBrowserKeyDown(e) {
  if (!canInteract.value || e.isComposing || composing || e.keyCode === 229) return
  // Native paste delivers clipboard text to this textarea; do not also paste remotely.
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') return
  const command = (e.metaKey || e.ctrlKey) ? ({ a: 'selectAll', c: 'copy', x: 'cut' })[e.key.toLowerCase()] : undefined
  if (e.key.length > 1 || e.metaKey || e.ctrlKey) e.preventDefault()
  remoteKeys.add(e.code)
  sendBrowserInput({ kind: 'key', type: 'rawKeyDown', key: e.key, code: e.code, keyCode: e.keyCode, modifiers: browserModifiers(e), repeat: e.repeat, command })
}
function onBrowserKeyUp(e) {
  if (!remoteKeys.delete(e.code)) return
  e.preventDefault()
  sendBrowserInput({ kind: 'key', type: 'keyUp', key: e.key, code: e.code, keyCode: e.keyCode, modifiers: browserModifiers(e) })
}
function onBrowserText(e) {
  if (e.isComposing || composing) return
  const text = e.data || e.target.value
  e.target.value = ''
  if (text && text !== compositionCommit) sendBrowserInput({ kind: 'text', text })
  compositionCommit = ''
}
function onBrowserCompositionEnd(e) {
  composing = false
  compositionCommit = e.data || ''
  if (compositionCommit) sendBrowserInput({ kind: 'text', text: compositionCommit })
  e.target.value = ''
  setTimeout(() => { compositionCommit = '' }, 0)
}
function onBrowserPaste(e) {
  e.preventDefault()
  const text = e.clipboardData?.getData('text/plain')
  if (text) sendBrowserInput({ kind: 'text', text })
  e.target.value = ''
}
function onBrowserPointerCaptureLost(event) {
  if (pointer?.id === event.pointerId) releaseBrowserInput()
}
function sendInputRelease(targetId) {
  if (targetId) Promise.resolve(window.cs?.sendAgentBrowserInput?.(targetId, { kind: 'release' })).catch(() => {})
}
function releaseBrowserInput(force = false) {
  const held = pointer
  const hadInput = !!held || remoteKeys.size > 0
  pointer = null; remoteKeys.clear(); composing = false
  if (inputSink.value) inputSink.value.value = ''
  if (held) safelyReleasePointerCapture(held.target, held.id)
  if (force === true) {
    // Local key/pointer state may already be empty while their up events are
    // still queued. The backend serializes this release after in-flight input.
    inputQueue.clear()
    sendInputRelease(props.tabId)
  } else if (hadInput) inputQueue.push({ kind: 'release' })
}
function disposeBrowserInput(targetId) {
  inputQueue.dispose()
  releaseBrowserInput()
  // A queued release would be discarded during teardown. Send it directly to
  // the old target; the backend orders it after input already in flight.
  sendInputRelease(targetId)
}
watch(() => props.tabId, (_, oldTargetId) => {
  disposeBrowserInput(oldTargetId); inputQueue = makeInputQueue()
  displayedFrame.value = null; frame.value = null; frameUrl.value = ''
  statusState.value = 'connecting'; statusMessage.value = ''
  if (offPreview) { offPreview(); offPreview = bindPreview(); setBrowserPreviewVisible(oldTargetId, streamOwner, false); syncStreamVisibility() }
})
watch(canInteract, active => { if (!active) { releaseBrowserInput(true); inputSink.value?.blur() } })

watch(() => props.minimizeSignal, (count) => {
  if (isDocked.value) return
  if (Number(count) > 0 && !minimized.value) {
    maximized.value = false
    minimized.value = true
    savePrefs()
  }
})

defineExpose({ focusWindow() { minimized.value = false; savePrefs() } })

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

let offPreview = null
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
  syncStreamVisibility()
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
  paused: 'disconnected',
}[statusState.value] || 'connecting'))

const statusLabel = computed(() => ({
  connecting: '连接中',
  connected: '已连接',
  error: '错误',
  disconnected: '已断开',
  paused: '画面已暂停',
}[statusState.value] || '连接中'))

const statusText = computed(() => {
  if (statusState.value === 'error' && statusMessage.value) return statusMessage.value
  return statusLabel.value
})

const streamOwner = Symbol('browser-preview')
let streamDisposed = false
function restart() { return syncStreamVisibility(true) }
function syncStreamVisibility(forceRestart = false) {
  if (forceRestart === true) { frame.value = null; statusState.value = 'connecting'; statusMessage.value = '' }
  const visible = !streamDisposed && !document.hidden && !minimized.value && props.visible
  if (!visible) statusState.value = 'paused'
  else if (statusState.value === 'paused') { statusState.value = 'connecting'; statusMessage.value = '' }
  return setBrowserPreviewVisible(props.tabId, streamOwner, visible, forceRestart === true).then(result => {
    if (!streamDisposed && visible && props.visible && !document.hidden && !minimized.value && result?.ok === false) { statusState.value = 'error'; statusMessage.value = result?.error || '浏览器预览连接失败' }
  }).catch(error => {
    if (!streamDisposed && props.visible && !document.hidden && !minimized.value) { statusState.value = 'error'; statusMessage.value = error?.message || '浏览器预览连接失败' }
  })
}
watch([minimized, () => props.visible], () => syncStreamVisibility())
function onWindowBlur() { releaseBrowserInput(true) }
function bindPreview() {
  return subscribeBrowserPreview(props.tabId, streamOwner, {
    onFrame(payload) {
      frame.value = payload
      if (!document.hidden && !minimized.value && props.visible) { statusState.value = 'connected'; statusMessage.value = '' }
      if (typeof payload?.url === 'string') frameUrl.value = payload.url
    },
    onStatus(payload) {
      if (!payload?.metadataOnly) {
        statusState.value = document.hidden || minimized.value || !props.visible ? 'paused' : payload?.state || 'connecting'
        statusMessage.value = payload?.message || ''
      }
      if (typeof payload?.url === 'string') frameUrl.value = payload.url
    },
  })
}
onMounted(() => {
  window.addEventListener('blur', onWindowBlur)
  document.addEventListener('visibilitychange', syncStreamVisibility)
  loadPrefs()
  if (isDocked.value) {
    minimized.value = false
    maximized.value = false
  } else {
    placeDefault()
  }
  offPreview = bindPreview()
  syncStreamVisibility()
})

onUnmounted(() => {
  window.removeEventListener('blur', onWindowBlur)
  disposeBrowserInput(props.tabId)
  streamDisposed = true
  document.removeEventListener('visibilitychange', syncStreamVisibility)
  offPreview?.()
  stopInteractions({ save: false })
  dragging.value = false
  resizing.value = false
  if (interactionFrame) window.cancelAnimationFrame(interactionFrame)
  syncStreamVisibility()
})
</script>

<style scoped>
.execution-context{margin:0;padding:6px 10px;font-size:10px;color:var(--text3);border-bottom:1px solid var(--border)}
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
  position: relative;
  z-index: 2;
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
.win-btn::before,
.win-btn::after {
  position: absolute;
  right: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease, transform 120ms ease;
  z-index: 4;
}
.win-btn::before {
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
.win-btn::after {
  content: attr(title);
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
.layout-btn::after { content: attr(data-tooltip); }
.win-btn:hover::before,
.win-btn:hover::after,
.win-btn:focus-visible::before,
.win-btn:focus-visible::after {
  opacity: 1;
  transform: translateY(0);
}
.win-btn:hover::before,
.win-btn:focus-visible::before {
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
.browser-frame.interactive { touch-action: none; }
.browser-frame.interactive:focus-within { box-shadow: inset 0 0 0 2px var(--orange,#ff6b2b); }
.browser-input-sink { position: absolute; bottom: 0; left: 0; width: 1px; height: 1px; padding: 0; border: 0; opacity: 0; resize: none; pointer-events: none; }
.browser-input-error { margin: 0; padding: 6px 10px; color: var(--red,#c66750); font-size: 11px; }
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
.agent-browser-window:not(.docked):not(.maximized) .browser-window-foot {
  padding-right: 32px;
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
