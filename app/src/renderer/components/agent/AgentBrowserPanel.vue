<template>
  <Teleport to="body">
    <div
      class="agent-browser-window"
      :class="{ minimized, maximized }"
      :style="windowStyle"
      role="dialog"
      aria-label="实时浏览器窗口"
    >
      <div
        class="browser-window-head"
        @mousedown.left="onDragStart"
        @dblclick="toggleMaximize"
      >
        <span class="browser-window-title">🖥️ 实时浏览器<span v-if="tabId" class="tab-chip">#{{ tabId.slice(-4) }}</span></span>
        <span class="browser-status" :class="statusClass" :title="statusText">
          <i></i>{{ statusLabel }}
        </span>
        <span v-if="frameUrl && !minimized" class="browser-window-url" :title="frameUrl">{{ frameUrl }}</span>
        <span class="browser-window-spacer"></span>
        <button
          v-if="!minimized"
          class="win-btn"
          type="button"
          :title="maximized ? '还原' : '最大化'"
          :aria-label="maximized ? '还原' : '最大化'"
          @mousedown.stop
          @click="toggleMaximize"
        >{{ maximized ? '❐' : '□' }}</button>
        <button
          class="win-btn"
          type="button"
          :title="minimized ? '展开' : '最小化'"
          :aria-label="minimized ? '展开' : '最小化'"
          @mousedown.stop
          @click="toggleMinimized"
        >{{ minimized ? '▣' : '—' }}</button>
        <button
          class="win-btn win-btn-close"
          type="button"
          title="关闭浏览器窗口"
          aria-label="关闭浏览器窗口"
          @mousedown.stop
          @click="$emit('collapse')"
        >×</button>
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
          <button class="refresh-btn" type="button" title="刷新画面" aria-label="刷新画面" @click="restart">↻</button>
        </div>
      </div>

      <div
        v-if="!minimized && !maximized"
        class="browser-window-resize"
        title="拖动调整大小"
        @mousedown.left.prevent="onResizeStart"
      ></div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'

const props = defineProps({
  // 菜单切换等场景由父级递增 → 自动最小化,避免浮动窗口盖住界面拦截点击
  minimizeSignal: { type: Number, default: 0 },
  // 绑定的浏览器页面(target id);多窗口:一个页面一个窗口
  tabId: { type: String, default: '' },
  // 窗口序号(用于级联排列)
  windowIndex: { type: Number, default: 0 },
})

const emit = defineEmits(['collapse'])

const frame = ref(null)
const frameUrl = ref('')
const statusState = ref('connecting') // connecting | connected | error | disconnected
const statusMessage = ref('')
const minimized = ref(false)
const maximized = ref(false)

watch(() => props.minimizeSignal, (count) => {
  if (Number(count) > 0 && !minimized.value) {
    maximized.value = false
    minimized.value = true
    savePrefs()
  }
})

const MIN_W = 360
const MIN_H = 260

const win = reactive({
  x: 0,
  y: 0,
  w: 760,
  h: 520,
})
const saved = reactive({ x: 0, y: 0, w: 760, h: 520, minimized: false, maximized: false })

let offFrame = null
let offStatus = null
let started = false
let drag = null
let resize = null

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), Math.max(min, max))
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem('crawshrimp.browserWindow')
    if (!raw) return
    const p = JSON.parse(raw)
    if (Number.isFinite(p.w) && Number.isFinite(p.h)) {
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
    localStorage.setItem('crawshrimp.browserWindow', JSON.stringify({
      x: saved.x, y: saved.y, w: saved.w, h: saved.h,
      minimized: minimized.value, maximized: maximized.value,
    }))
  } catch { /* ignore */ }
}

function placeDefault() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  win.w = saved.w
  win.h = saved.h
  // 多窗口级联排列:按序号偏移 36px,循环避免无限右移
  const idx = Math.max(0, Number(props.windowIndex || 0)) % 4
  const off = idx * 36
  // 默认贴右下,避开产品卡(bottom 14 + 卡高),留 16px 边距
  win.x = clamp(saved.x || (vw - win.w - 16 - off), 8, Math.max(8, vw - win.w - 8))
  win.y = clamp(saved.y || (vh - win.h - 16 - off), 8, Math.max(8, vh - win.h - 8))
  minimized.value = saved.minimized
  maximized.value = saved.maximized
}

const windowStyle = computed(() => {
  if (maximized.value) {
    return { left: '0px', top: '0px', width: '100vw', height: '100vh' }
  }
  return { left: `${win.x}px`, top: `${win.y}px`, width: `${win.w}px`, height: minimized.value ? 'auto' : `${win.h}px` }
})

function onDragStart(event) {
  if (event.button !== 0) return
  if (maximized.value) return
  drag = { startX: event.clientX, startY: event.clientY, origX: win.x, origY: win.y }
  const onMove = (e) => {
    if (!drag) return
    win.x = clamp(drag.origX + (e.clientX - drag.startX), 8, Math.max(8, window.innerWidth - win.w - 8))
    win.y = clamp(drag.origY + (e.clientY - drag.startY), 0, Math.max(0, window.innerHeight - 46))
    saved.x = win.x
    saved.y = win.y
  }
  const onUp = () => {
    drag = null
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    savePrefs()
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function onResizeStart(event) {
  if (event.button !== 0) return
  resize = { startX: event.clientX, startY: event.clientY, origW: win.w, origH: win.h }
  const onMove = (e) => {
    if (!resize) return
    win.w = clamp(resize.origW + (e.clientX - resize.startX), MIN_W, window.innerWidth - 8)
    win.h = clamp(resize.origH + (e.clientY - resize.startY), MIN_H, window.innerHeight - 8)
    saved.w = win.w
    saved.h = win.h
  }
  const onUp = () => {
    resize = null
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    savePrefs()
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function toggleMaximize() {
  maximized.value = !maximized.value
  if (maximized.value) minimized.value = false
  savePrefs()
}

function toggleMinimized() {
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
  placeDefault()
  if (window.cs?.onAgentBrowserFrame) {
    offFrame = window.cs.onAgentBrowserFrame((payload) => {
      if (props.tabId && payload?.targetId && String(payload.targetId) !== String(props.tabId)) return
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
  drag = null
  resize = null
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
}
.agent-browser-window.maximized {
  border-radius: 0;
}
.browser-window-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg2);
  cursor: grab;
  flex: none;
}
.browser-window-head:active {
  cursor: grabbing;
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
  width: 26px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--text2);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.win-btn:hover {
  background: var(--soft-fill-hover);
  color: var(--text);
}
.win-btn-close:hover {
  background: var(--red);
  color: #fff;
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
