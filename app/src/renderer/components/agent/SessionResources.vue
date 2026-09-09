<template>
  <button v-if="!opened || !selection" class="session-panel-toggle" type="button" :title="opened ? '收起会话资源' : '展开会话资源'" :aria-label="opened ? '收起会话资源' : '展开会话资源'" :aria-expanded="opened" @click="togglePanel">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M15 4v16" /></svg>
    <small v-if="unseen" class="unseen-count">{{ unseen }}</small>
  </button>
  <aside v-if="opened" class="session-resources" :class="{ viewing: selection, maximized, compact: !selection }" :style="{ width: maximized ? undefined : selection ? `${width}px` : '300px' }" aria-label="会话资源">
    <div v-if="selection && !maximized" class="resource-resizer" role="separator" aria-label="调整会话面板宽度" aria-orientation="vertical" :aria-valuenow="Math.round(width)" :aria-valuemin="320" :aria-valuemax="900" tabindex="0" @pointerdown="resize" @keydown.left.prevent="adjustWidth(20)" @keydown.right.prevent="adjustWidth(-20)"></div>
    <div class="resource-card">
    <header>
      <button v-if="selection" @click="back">← 资源 <small v-if="unseen">{{ unseen }}</small></button><strong v-else>会话资源</strong>
      <span class="spacer"></span>
      <button v-if="!selection" ref="searchButton" class="search-toggle" :aria-expanded="searching" aria-label="搜索会话资源" title="搜索会话资源" @click="toggleSearch"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg></button>
      <button v-if="selection" :title="maximized ? '还原' : '最大化'" @click="maximized = !maximized">⛶</button>
      <button title="收起会话面板" aria-label="收起会话面板" @click="opened = false">›</button>
    </header>
    <p v-if="error" class="resource-error" role="alert">{{ error }}</p>
    <template v-if="selection?.kind === 'browser'">
      <div class="browser-tabs" role="tablist" aria-label="浏览器标签页">
        <div v-for="tab in tabs" :key="tab.id" class="browser-tab" :class="{ selected: selection.id === tab.id }">
          <button :id="`resource-tab-${tab.id}`" role="tab" :aria-selected="selection.id === tab.id" aria-controls="resource-browser-content" :tabindex="selection.id === tab.id ? 0 : -1" :title="`${tab.title || tab.url}\n${tab.url}`" @click="openBrowser(tab.id)" @keydown.right.prevent="stepTab(1)" @keydown.left.prevent="stepTab(-1)" @keydown.home.prevent="selectEdgeTab(false)" @keydown.end.prevent="selectEdgeTab(true)">
            <span class="tab-site-icon" aria-hidden="true">◎</span><span class="tab-label">{{ tab.title || tab.url || '新页面' }}</span><span v-if="tab.closed" class="tab-closed">已关闭</span>
          </button>
          <button v-if="!tab.closed" class="tab-close" :aria-label="`关闭页面 ${tab.title || tab.url || '新页面'}`" @click="closePage(tab)">×</button>
        </div>
        <button class="tab-add" title="新开页面" aria-label="新开页面" :disabled="busy" @click="newPage">＋</button>
      </div>
      <div id="resource-browser-content" class="browser-content" role="tabpanel" :aria-labelledby="`resource-tab-${selection.id}`">
        <p v-if="selectedTab?.closed" class="empty">该浏览器页面已关闭</p>
        <AgentBrowserPanel v-else-if="browserReady" :key="selection.id" :tab-id="selection.id" layout="docked" dock-action-label="缩为小窗" @collapse="back" @layout-change="back" />
      </div>
    </template>
    <template v-else-if="selection?.kind === 'artifact'">
      <div class="resource-toolbar"><strong :title="selection.path">{{ selection.filename }}</strong><button @click="fileAction('openFile', selection)">系统打开</button><button @click="fileAction('revealFile', selection)">定位</button></div>
      <div class="resource-preview">
        <p v-if="previewLoading" class="empty">正在加载…</p>
        <img v-else-if="previewKind === 'image'" :src="previewUrl" :alt="selection.filename" @error="error = '文件无法加载，可能已移动或删除'" />
        <video v-else-if="previewKind === 'video'" :src="previewUrl" controls />
        <audio v-else-if="previewKind === 'audio'" :src="previewUrl" controls />
        <pre v-else-if="previewKind === 'text'">{{ previewText }}</pre>
        <p v-else class="empty">此文件暂不支持内置预览，请使用系统打开。</p>
      </div>
    </template>
    <template v-else>
      <div v-if="searching" class="resource-search"><input ref="searchInput" v-model="query" placeholder="搜索文件或页面" aria-label="搜索文件或页面" @keydown.esc.prevent="closeSearch" /><button aria-label="关闭搜索" title="关闭搜索" @click="closeSearch">×</button></div>
      <div class="resource-list">
        <section>
          <div class="section-heading"><button :aria-expanded="pagesExpanded || !!query" @click="pagesExpanded = !pagesExpanded">{{ pagesExpanded || query ? '▾' : '▸' }} 浏览器页面 <small>{{ query ? `${filteredTabs.length} / ${tabs.length}` : tabs.length }}</small></button><button title="新开页面" aria-label="新开页面" :disabled="busy || !sessionId" @click="newPage">＋</button></div>
          <div v-if="pagesExpanded || query" class="section-items page-items" aria-label="浏览器页面列表" tabindex="0"><p v-if="!filteredTabs.length" class="empty">{{ query ? '没有匹配的页面' : '当前会话暂无浏览器页面' }}</p>
            <div v-for="tab in filteredTabs" :key="tab.id" class="resource-row">
              <button class="resource-main" :title="`${tab.title || tab.url}\n${tab.url}`" @click="openBrowser(tab.id)"><span class="type-icon">◎</span><span class="resource-name">{{ tab.title || tab.url || '新页面' }}</span><small v-if="tab.closed" class="closed-label">已关闭</small><i v-if="tab.id === activeTabId && !tab.closed" title="最近执行的页面" class="activity-dot"></i></button>
              <details class="row-menu"><summary aria-label="页面操作">⋯</summary><div><button @click="copy(tab.url)">复制链接</button><button v-if="!tab.closed" @click="closePage(tab)">关闭页面</button></div></details>
            </div>
          </div>
        </section>
        <section><div class="section-heading"><button :aria-expanded="filesExpanded || !!query" @click="filesExpanded = !filesExpanded">{{ filesExpanded || query ? '▾' : '▸' }} 产物 <small>{{ query ? `${filteredArtifacts.length} / ${artifacts.length}` : artifacts.length }}</small></button></div>
          <div v-if="filesExpanded || query" class="section-items file-items" aria-label="产物列表" tabindex="0"><p v-if="!filteredArtifacts.length" class="empty">{{ loading ? '正在加载资源…' : query ? '没有匹配的产物' : '生成的文件会显示在这里' }}</p>
            <div v-for="item in filteredArtifacts" :key="item.path || item.artifact_id" class="resource-row">
              <button class="resource-main" :title="`${item.filename}\n${size(item.size)} · ${item.path}`" @click="openArtifact(item)"><span class="type-icon">{{ extension(item.filename) }}</span><span class="resource-name">{{ item.filename }}</span></button>
              <details class="row-menu"><summary aria-label="文件操作">⋯</summary><div><button @click="fileAction('openFile', item)">系统打开</button><button @click="fileAction('revealFile', item)">在文件夹中定位</button><button @click="copy(item.path)">复制路径</button></div></details>
            </div>
          </div>
        </section>
      </div>
      <footer><button :disabled="!sessionId" @click="error = ''; $emit('download-log')">↓ 下载 Session 日志</button></footer>
    </template>
    </div>
    <div v-if="!selection && miniTab" class="browser-mini" aria-label="主浏览器实时画面">
      <AgentBrowserPanel v-if="browserReady" :key="miniTab.id" :tab-id="miniTab.id" layout="docked" compact />
      <button class="mini-expand" :aria-label="`半屏查看 ${miniTab.title || miniTab.url}`" @click="openBrowser(miniTab.id)"><span>半屏查看 ↗</span></button>
      <div class="mini-caption"><span>{{ miniTab.title || miniTab.url || '浏览器画面' }}</span><small>实时画面</small></div>
    </div>
  </aside>

</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import AgentBrowserPanel from './AgentBrowserPanel.vue'
const props = defineProps({ sessionId: { type: String, default: '' }, revision: Number })
const emit = defineEmits(['download-log', 'compact-change'])
const isSmallViewport = () => window.innerWidth < 1180 || window.innerHeight < 620
const smallViewport = ref(isSmallViewport())
let previousViewportWidth = window.innerWidth, previousViewportHeight = window.innerHeight
const opened = ref(false), selection = ref(null), maximized = ref(false), width = ref(700)
const searching = ref(false), searchInput = ref(null), searchButton = ref(null)
const query = ref(''), pagesExpanded = ref(true), filesExpanded = ref(true)
const artifacts = ref([]), tabs = ref([]), activeTabId = ref('')
const unseen = ref(0), error = ref(''), loading = ref(false), busy = ref(false)
const previewUrl = ref(''), previewKind = ref(''), previewText = ref(''), previewLoading = ref(false)
const browserReady = ref(true)
let browserTransition = 0
function prepareBrowserTransition() {
  const token = ++browserTransition
  browserReady.value = false
  // Let the old panel unmount and queue stream stop before mounting its replacement.
  nextTick(() => { if (token === browserTransition) browserReady.value = true })
}
let generation = 0, previewGeneration = 0, timer, stopResize
const states = new Map()
let loadedOnce = false
const stateKey = id => `crawshrimp.sessionPanel.v2.${id}`
function saveState(id) { if (!id) return; const state = { opened: opened.value, selection: selection.value, width: width.value }; states.set(id, state); try { localStorage.setItem(stateKey(id), JSON.stringify(state)) } catch {} }
function readState(id) { try { return states.get(id) || JSON.parse(localStorage.getItem(stateKey(id)) || 'null') } catch { return null } }
defineExpose({ showError: message => { error.value = message; opened.value = true }, collapse: () => { opened.value = false } })
const selectedTab = computed(() => tabs.value.find(t => t.id === selection.value?.id))
const miniTab = computed(() => tabs.value.find(t => t.id === activeTabId.value && !t.closed) || tabs.value.find(t => !t.closed))
const filteredTabs = computed(() => tabs.value.filter(t => `${t.title} ${t.url}`.toLowerCase().includes(query.value.toLowerCase())))
const filteredArtifacts = computed(() => artifacts.value.filter(t => `${t.filename} ${t.path}`.toLowerCase().includes(query.value.toLowerCase())))
const extension = name => String(name || '').split('.').pop().slice(0, 4).toUpperCase()
const size = value => Number(value) > 1048576 ? `${(value / 1048576).toFixed(1)} MB` : `${Math.max(0, Number(value) || 0) / 1024 < 1 ? '<1' : (value / 1024).toFixed(1)} KB`
function onViewportResize() {
  const nextSmall = isSmallViewport()
  const shrinking = window.innerWidth < previousViewportWidth || window.innerHeight < previousViewportHeight
  if (nextSmall && (!smallViewport.value || shrinking)) {
    opened.value = false
    maximized.value = false
    stopResize?.()
  }
  smallViewport.value = nextSmall
  previousViewportWidth = window.innerWidth
  previousViewportHeight = window.innerHeight
  adjustWidth(0)
}
onMounted(() => window.addEventListener('resize', onViewportResize))
function closeSearch() { searching.value = false; query.value = ''; nextTick(() => searchButton.value?.focus()) }
function toggleSearch() {
  if (searching.value) { closeSearch(); return }
  searching.value = true
  nextTick(() => searchInput.value?.focus())
}
const compactOpen = computed(() => opened.value && !selection.value)
watch(compactOpen, value => emit('compact-change', value), { immediate: true })
function togglePanel() { opened.value = !opened.value; if (opened.value && !selection.value) unseen.value = 0 }
function back() { prepareBrowserTransition(); selection.value = null; maximized.value = false; unseen.value = 0; error.value = ''; previewGeneration++ }
function openBrowser(id) {
  prepareBrowserTransition()
  selection.value = { kind: 'browser', id }
  nextTick(() => document.getElementById(`resource-tab-${id}`)?.closest('.browser-tab')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
  opened.value = true
  error.value = ''
  previewGeneration++
}
function focusSelectedTab() {
  requestAnimationFrame(() => document.getElementById(`resource-tab-${selection.value?.id}`)?.focus())
}
function stepTab(direction) {
  if (!tabs.value.length) return
  const index = tabs.value.findIndex(t => t.id === selection.value?.id)
  openBrowser(tabs.value[(index + direction + tabs.value.length) % tabs.value.length].id)
  focusSelectedTab()
}
function selectEdgeTab(last) {
  const tab = last ? tabs.value.at(-1) : tabs.value[0]
  if (tab) { openBrowser(tab.id); focusSelectedTab() }
}
function adjustWidth(delta) { width.value = Math.max(320, Math.min(900, window.innerWidth * .7, width.value + delta)) }
async function fileAction(action, item) { try { const result = await window.cs[action](item.path); if (result?.ok === false || typeof result === 'string' && result) throw new Error(result.error || result) } catch (e) { error.value = `操作失败：${e.message}` } }
async function copy(value) { try { await navigator.clipboard.writeText(value || '') } catch (e) { error.value = `复制失败：${e.message}` } }
async function openArtifact(item) {
  selection.value = { ...item, kind: 'artifact' }; opened.value = true; error.value = ''
  const token = ++previewGeneration; previewKind.value = ''; previewText.value = ''; previewLoading.value = true
  try {
    const ext = extension(item.filename).toLowerCase()
    const kind = /^(png|jpg|jpeg|webp|gif|bmp|svg)$/.test(ext) ? 'image' : /^(mp4|webm|mov)$/.test(ext) ? 'video' : /^(mp3|wav|ogg|m4a)$/.test(ext) ? 'audio' : /^(md|txt|csv|json|js|py|ts|log|yaml|yml|html|css)$/.test(ext) ? 'text' : ''
    if (!kind) return
    const url = await window.cs.agentMediaUrl(item.path, null)
    let text = ''
    if (kind === 'text') { const response = await fetch(url, { headers: { Range: 'bytes=0-262143' } }); if (!response.ok) throw new Error('文件不存在或无法读取'); text = await response.text(); if (response.status === 206) text += '\n\n预览已截取，完整内容请使用系统打开。' }
    if (token !== previewGeneration) return
    previewUrl.value = url; previewText.value = text; previewKind.value = kind
  } catch (e) { if (token === previewGeneration) error.value = `预览失败：${e.message}` }
  finally { if (token === previewGeneration) previewLoading.value = false }
}
async function refresh() {
  const id = props.sessionId; if (!id) return
  const token = ++generation; loading.value = true
  try {
    const data = await window.cs.agentApi('GET', `/agent/session-resources?runtime_session_id=${encodeURIComponent(id)}`)
    const live = await window.cs.listAgentBrowserTabs().catch(() => null)
    if (token !== generation || id !== props.sessionId) return
    const previous = new Set(artifacts.value.map(a => a.path || a.artifact_id))
    const next = data.artifacts || []
    if (loadedOnce && (!opened.value || selection.value)) unseen.value += next.filter(a => !previous.has(a.path || a.artifact_id)).length
    if (error.value.startsWith('资源加载失败：')) error.value = ''
    loadedOnce = true
    artifacts.value = next
    const liveById = new Map((live?.tabs || []).map(t => [t.id, t]))
    tabs.value = (data.tabs || []).map(t => ({ ...t, ...(liveById.get(t.id) || {}), closed: live?.ok === true && !liveById.has(t.id) }))
    activeTabId.value = data.activeTabId || ''
  } catch (e) { if (token === generation) error.value = `资源加载失败：${e.message}` }
  finally { if (token === generation) loading.value = false }
}
async function newPage() { busy.value = true; error.value = ''; const id = props.sessionId; try { const tab = await window.cs.agentApi('POST', '/agent/session-resources/pages', { runtime_session_id: id }); if (id !== props.sessionId) return; await refresh(); openBrowser(tab.id) } catch (e) { error.value = `新建失败：${e.message}` } finally { busy.value = false } }
async function closePage(tab) { const id = props.sessionId; error.value = ''; try { await window.cs.agentApi('DELETE', `/agent/session-resources/pages/${encodeURIComponent(tab.id)}?runtime_session_id=${encodeURIComponent(id)}`); if (id !== props.sessionId) return; if (selection.value?.id === tab.id) { const next = tabs.value.find(t => t.id !== tab.id && !t.closed); if (next) openBrowser(next.id); else back() }; await refresh() } catch (e) { error.value = `关闭失败：${e.message}` } }
function resize(event) {
  if (event.button !== 0) return
  event.preventDefault()
  stopResize?.()
  const target = event.currentTarget, pointerId = event.pointerId
  const x = event.clientX, initial = width.value
  target.setPointerCapture?.(pointerId)
  const move = e => { width.value = Math.max(320, Math.min(900, window.innerWidth * .7, initial + x - e.clientX)) }
  const finish = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', finish)
    window.removeEventListener('pointercancel', finish)
    window.removeEventListener('blur', finish)
    if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId)
    stopResize = null
  }
  stopResize = finish
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', finish, { once: true })
  window.addEventListener('pointercancel', finish, { once: true })
  window.addEventListener('blur', finish, { once: true })
}

watch(() => props.sessionId, (id, old) => {
  if (old) saveState(old)
  loadedOnce = false
  generation++; previewGeneration++; artifacts.value = []; tabs.value = []; query.value = ''; searching.value = false; error.value = ''; unseen.value = 0; maximized.value = false
  const state = readState(id); opened.value = !smallViewport.value && (state?.opened ?? false); selection.value = state?.selection || null; width.value = Math.max(320, Math.min(900, window.innerWidth * .7, state?.width || window.innerWidth * .45))
  if (selection.value?.kind === 'artifact') { void openArtifact(selection.value); opened.value = !smallViewport.value && (state?.opened ?? false) }
  void refresh()
}, { immediate: true })
watch([opened, selection, width], () => saveState(props.sessionId))
watch(() => props.revision, () => { clearTimeout(timer); timer = setTimeout(refresh, 150) })
const polling = setInterval(refresh, 5000)
onUnmounted(() => { browserTransition++; window.removeEventListener('resize', onViewportResize); generation++; previewGeneration++; clearInterval(polling); clearTimeout(timer); stopResize?.() })
</script>

<style scoped>
.session-panel-toggle{position:absolute;right:16px;top:14px;z-index:20;width:32px;height:32px;border:0;border-radius:7px;background:transparent;color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:6px}
.session-panel-toggle:hover{background:var(--bg2)}.unseen-count{position:absolute;right:-3px;top:-3px;min-width:14px;height:14px;border-radius:7px;background:var(--orange,#ff6b2b);color:white;font-size:9px;line-height:14px;text-align:center}
.session-resources{position:relative;flex-shrink:0;max-width:70%;min-width:280px;display:flex;flex-direction:column;background:var(--bg);border-left:1px solid var(--border);padding-top:0;min-height:0;color:var(--text);font-size:13px}
.session-resources.compact{position:absolute;right:16px;top:56px;bottom:auto;z-index:18;max-width:calc(100% - 32px);max-height:calc(100% - 80px);min-width:0;padding:0;border:0;background:transparent;gap:10px}
.resource-card{display:contents}.compact .resource-card{display:flex;flex-direction:column;min-height:0;flex:0 1 auto;border:1px solid var(--border);border-radius:14px;background:var(--bg2);box-shadow:0 4px 18px #0000000a;overflow:hidden}
.viewing header{height:38px;padding:0 10px}.viewing .browser-tabs{padding-top:4px}.viewing .browser-tab>[role=tab]{padding-top:8px;padding-bottom:8px}
.session-resources.maximized{position:absolute;inset:0 0 0 auto;width:calc(100% - 280px);max-width:100%;z-index:19}
.compact header{height:42px;border-bottom:0}.compact .resource-search{padding-top:0}.compact .resource-search input{background:var(--bg);font-size:12px}.compact .resource-list{flex:0 1 auto;min-height:0;max-height:calc(100vh - 330px)}.compact footer{padding:8px 12px}.compact .resource-row{min-height:30px}.compact .resource-main{padding:5px 4px;gap:7px}.compact .type-icon{width:25px}.compact .resource-name{line-height:20px}.closed-label{flex:none;font-size:10px}
.browser-mini{position:relative;align-self:flex-end;width:230px;max-width:100%;flex:0 0 144px;height:144px;margin:0;border:1px solid var(--border);border-radius:9px;overflow:hidden;background:var(--bg)}
.browser-mini :deep(.agent-browser-window){height:119px}.mini-expand{position:absolute;inset:0 0 24px;z-index:2;border-radius:0;display:flex;align-items:center;justify-content:center}.mini-expand span{opacity:0;background:var(--bg2);padding:7px 10px;border-radius:8px;box-shadow:0 2px 8px #0002}.mini-expand:hover{background:#00000012}.mini-expand:hover span,.mini-expand:focus-visible span{opacity:1}.mini-caption{position:absolute;bottom:0;left:0;right:0;height:24px;padding:0 8px;display:flex;align-items:center;gap:6px;background:var(--bg);font-size:11px}.mini-caption>span{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.browser-tabs{scroll-padding-inline:8px 44px;display:flex;align-items:stretch;overflow-x:auto;flex-shrink:0;gap:3px;padding:8px 8px 0;background:var(--bg2);border-bottom:1px solid var(--border);scrollbar-width:thin}
.browser-tab{display:flex;align-items:center;flex:1 0 125px;min-width:100px;max-width:220px;border-radius:9px 9px 0 0;border:1px solid transparent;border-bottom:0;color:var(--text2)}.browser-tab.selected{background:var(--bg);border-color:var(--border);color:var(--text)}.browser-tab>[role=tab]{display:flex;align-items:center;gap:7px;min-width:0;flex:1;padding:10px 8px;text-align:left;border-radius:9px 9px 0 0}.tab-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tab-site-icon,.tab-closed{font-size:11px;color:var(--text3)}.tab-close{margin-right:4px;padding:2px 5px;font-size:16px}.tab-add{position:sticky;right:0;background:var(--bg2);align-self:center;flex:none;margin:0 4px 5px}.browser-content{flex:1;min-height:0;overflow:hidden}

header{height:48px;display:flex;align-items:center;padding:0 16px;border-bottom:1px solid var(--border);gap:8px;flex-shrink:0}.spacer{flex:1}
button,select,input{font:inherit;color:inherit}button{background:none;border:0;cursor:pointer;padding:6px;border-radius:6px}button:hover{background:var(--bg2)}button:disabled{opacity:.5;cursor:default}button:focus-visible,summary:focus-visible{outline:2px solid var(--accent,#ff6b2b)}small{color:var(--text3);font-size:11px}
.search-toggle{display:flex;align-items:center;justify-content:center}.resource-search{padding:0 12px 6px;display:flex;gap:4px;align-items:center}.resource-search input{min-width:0}.resource-search input:focus-visible{outline:2px solid var(--accent,#ff6b2b);outline-offset:-1px}.resource-search input{box-sizing:border-box;width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:7px;padding:8px 10px;outline:none}
.resource-list{display:flex;flex-direction:column;flex:1;overflow:hidden;padding:0 8px 6px}.resource-list section{display:flex;flex-direction:column;flex:0 1 auto;min-height:36px}.section-heading{flex-shrink:0}section+section{margin-top:6px}.section-items{flex:0 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-gutter:stable}.page-items{max-height:150px}.file-items{max-height:210px}.section-items:focus-visible{outline:1px solid var(--border);outline-offset:-1px}.section-heading{display:flex;justify-content:space-between;align-items:center;color:var(--text2);padding:4px 0}.section-heading small{margin-left:6px}
.resource-row{display:flex;align-items:center;border-radius:7px;min-width:0;position:relative}.resource-row:hover{background:var(--bg2)}.resource-main{display:flex;align-items:center;text-align:left;gap:10px;flex:1;min-width:0;padding:10px 6px}.resource-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;line-height:1.5}.resource-name small{display:block;overflow:hidden;text-overflow:ellipsis}.type-icon{width:30px;flex-shrink:0;color:var(--text3);font-size:10px}.activity-dot{width:6px;height:6px;background:#73b894;border-radius:50%}
.row-menu{position:relative}.row-menu summary{cursor:pointer;list-style:none;padding:5px;opacity:.4}.resource-row:hover summary,.row-menu[open] summary{opacity:1}.row-menu>div{position:absolute;right:0;top:26px;z-index:30;min-width:140px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:5px;box-shadow:0 8px 24px #0004}.resource-row:has(.row-menu[open]){padding-bottom:112px;align-items:flex-start}.row-menu button{display:block;width:100%;text-align:left}
footer{border-top:1px solid var(--border);padding:12px;flex-shrink:0}footer button{width:100%;text-align:left;color:var(--text2)}.empty{margin:0;padding:8px 6px;color:var(--text3);font-size:12px;line-height:1.7}.resource-error{padding:8px 16px;color:#e18b74;font-size:12px;margin:0;overflow-wrap:anywhere}
.resource-toolbar{display:flex;gap:8px;align-items:center;padding:10px 14px;flex-shrink:0;border-bottom:1px solid var(--border)}.resource-toolbar strong{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.resource-toolbar select{width:100%;padding:8px;background:var(--bg2);border:1px solid var(--border);border-radius:6px}.resource-preview{overflow:auto;flex:1;padding:18px;min-height:0}.resource-preview img,.resource-preview video{display:block;max-width:100%;height:auto;margin:auto}.resource-preview pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.7 monospace}.resource-resizer{position:absolute;left:-4px;top:0;touch-action:none;bottom:0;width:8px;cursor:col-resize;z-index:25}
@media(max-width:1000px){.session-resources.viewing{position:absolute;right:0;top:0;bottom:0;max-width:calc(100% - 60px);z-index:15;box-shadow:-8px 0 30px #0003}.session-resources.maximized{width:calc(100% - 60px)}}
</style>
