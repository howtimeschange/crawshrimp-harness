<template>
  <div v-if="!opened || !selection" class="session-header-actions" :class="{ 'extends-divider': compactOpen }">
  <button v-if="!opened || !selection" class="session-export-button export-log" type="button" :disabled="!sessionId" aria-label="导出会话日志" title="导出会话日志" data-tooltip="导出会话日志" @click="error = ''; $emit('download-log')"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg></button>
  <button v-if="!opened || !selection" class="session-panel-toggle" type="button" :title="opened ? '收起会话资源' : '展开会话资源'" :aria-label="opened ? '收起会话资源' : '展开会话资源'" :aria-expanded="opened" @click="togglePanel">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M15 4v16" /></svg>
    <small v-if="unseen" class="unseen-count">{{ unseen }}</small>
  </button>
  </div>
  <aside v-show="opened" class="session-resources" :class="{ viewing: selection, maximized, compact: !selection }" :style="{ width: maximized ? undefined : selection ? `${width}px` : '300px' }" aria-label="会话资源">
    <div v-if="selection && !maximized" class="resource-resizer" role="separator" aria-label="调整会话面板宽度" aria-orientation="vertical" :aria-valuenow="Math.round(width)" :aria-valuemin="320" :aria-valuemax="900" tabindex="0" @pointerdown="resize" @keydown.left.prevent="adjustWidth(20)" @keydown.right.prevent="adjustWidth(-20)"></div>
    <div class="resource-card">
    <header>
      <button v-if="selection" title="返回会话资源列表" aria-label="返回会话资源列表" @click="back">← 资源 <small v-if="unseen">{{ unseen }}</small></button><strong v-else>会话资源</strong>
      <span class="spacer"></span>
      <button v-if="!selection" ref="searchButton" class="search-toggle" :aria-expanded="searching" aria-label="搜索会话资源" title="搜索会话资源" @click="toggleSearch"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg></button>
      <button v-if="selection" class="resource-icon-button" :aria-pressed="split" :title="split ? '合并为单栏' : '双栏比较 / 合并'" :aria-label="split ? '合并为单栏' : '双栏比较'" @click="toggleSplit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M12 4v16"/></svg></button>
      <button v-if="selection && split && !effectiveSplit" title="切换文件栏" aria-label="切换文件栏" @click="switchPane">切换栏</button>
      <button v-if="selection" class="resource-icon-button" :title="maximized ? '还原面板大小' : '最大化面板'" :aria-label="maximized ? '还原面板大小' : '最大化面板'" @click="maximized = !maximized"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg></button>
      <button class="resource-icon-button" title="收起会话面板" aria-label="收起会话面板" @click="opened = false"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>
    </header>
    <p v-if="error" class="resource-error" role="alert">{{ error }}</p>
    <div class="file-workspace" :class="{ split: effectiveSplit, inactive: !selection }" :style="effectiveSplit ? { gridTemplateColumns: `${splitRatio}fr ${1 - splitRatio}fr` } : undefined" :inert="!selection || !opened">
      <div v-for="pane in [0, 1]" :key="pane" v-show="effectiveSplit || pane === focusedPane" class="workspace-tabbar" :data-pane="pane" :class="{ 'drop-pane': dropTarget?.pane === pane && !dropTarget?.key }" @dragover="dragOverResource($event, pane)" @dragleave="leaveDropTarget($event)" @drop="dropResource($event, pane)" :style="{ gridColumn: effectiveSplit ? pane + 1 : 1 }" role="tablist" :aria-label="`文件面板 ${pane + 1}`">
        <div v-for="item in paneTabs(pane)" :key="item.key" class="workspace-tab" title="拖动排序或移到另一栏；Alt + 方向键跨栏" draggable="true" @dragstart="startTabDrag($event, item)" @dragend="clearTabDrag" @dragover.stop="dragOverResource($event, pane, item)" @drop.stop="dropResource($event, pane, item)" :class="{ selected: activeIds[pane] === item.key, dragging: draggedTab === item.key, 'drop-before': dropTarget?.key === item.key && !dropTarget?.after, 'drop-after': dropTarget?.key === item.key && dropTarget?.after }">
          <button :id="tabDomId(item)" role="tab" :aria-selected="activeIds[pane] === item.key" :tabindex="activeIds[pane] === item.key ? 0 : -1" :aria-controls="`${tabDomId(item)}-content`" :title="item.path || item.url" @click="activateResource(item); $event.currentTarget.focus()" @keydown.right.prevent="tabArrow($event, item, 1)" @keydown.left.prevent="tabArrow($event, item, -1)"><ResourceIcon :item="item" /><span class="workspace-tab-label">{{ item.filename || item.title || item.url || '浏览器' }}</span></button>
          <button class="workspace-tab-close resource-icon-button" :title="`关闭标签 ${item.filename || item.title || '浏览器'}`" :aria-label="`关闭标签 ${item.filename || item.title || '浏览器'}`" @click="closeResource(item)">×</button>
        </div>
        <button class="workspace-tab-add resource-icon-button" title="添加资源" aria-label="添加资源" @click="focusedPane = pane; back()">＋</button>
      </div>
      <div v-if="effectiveSplit" class="workspace-divider" :style="{ left: `${splitRatio * 100}%` }" role="separator" aria-label="调整双栏比例" aria-orientation="vertical" :aria-valuenow="Math.round(splitRatio * 100)" :aria-valuemin="30" :aria-valuemax="70" tabindex="0" @pointerdown="resizeSplit" @keydown.left.prevent="splitRatio = Math.max(.3, splitRatio - .02)" @keydown.right.prevent="splitRatio = Math.min(.7, splitRatio + .02)"></div>
      <!-- Flat keyed containers never move between Vue parents: switching or splitting retains DOM, scroll and renderer state. Visibility avoids iframe scroll resets caused by display:none. -->
      <div v-for="item in retainedTabs" :key="`${item.scope}:${item.key}`" class="workspace-content" :class="{ inactive: !isVisible(item) }" :inert="!isVisible(item) || !selection || !opened" :aria-hidden="!isVisible(item) || !selection || !opened" :style="{ gridColumn: effectiveSplit ? item.pane + 1 : 1 }" :id="`${tabDomId(item)}-content`" role="tabpanel" :aria-labelledby="tabDomId(item)" @pointerdown="focusedPane = item.pane; selection = item">
        <AgentBrowserPanel v-if="item.kind === 'browser'" :tab-id="item.id" :visible="opened && item.scope === sessionId && (item.layout === 'floating' || !!selection && isVisible(item))" :activity="browserActivity" :layout="item.layout || 'docked'" @collapse="collapseBrowser(item)" @layout-change="changeBrowserLayout(item, $event)" />
        <ResourcePreview v-else :active="opened && !!selection && isVisible(item)" :item="item" :mode="item.mode || 'preview'" :zoom="item.zoom || 1" @update:mode="item.mode = $event" @update:zoom="item.zoom = $event" />
      </div>
      <template v-for="pane in [0, 1]" :key="`empty-${pane}`"><div v-if="(!activeIds[pane] || activePaneTab(pane)?.layout === 'floating') && (effectiveSplit || pane === focusedPane)" class="workspace-empty" :class="{ 'drop-pane': dropTarget?.pane === pane && !dropTarget?.key }" :style="{ gridColumn: effectiveSplit ? pane + 1 : 1 }" @dragover="dragOverResource($event, pane)" @dragleave="leaveDropTarget($event)" @drop="dropResource($event, pane)"><template v-if="activePaneTab(pane)?.layout === 'floating'"><span>浏览器正在浮窗中显示</span><button @click="changeBrowserLayout(activePaneTab(pane), 'docked')">固定回这一栏</button></template><template v-else><span>拖入标签，在这里并排查看</span><button @click="focusedPane = pane; back()">选择文件或浏览器页面</button></template></div></template>
    </div>
    <div v-show="!selection" class="resource-inventory">
      <div v-if="searching" class="resource-search"><input ref="searchInput" v-model="query" placeholder="搜索文件或页面" aria-label="搜索文件或页面" @keydown.esc.prevent="closeSearch" /><button aria-label="关闭搜索" title="关闭搜索" @click="closeSearch">×</button></div>
      <div class="resource-list">
        <section>
          <div class="section-heading"><button :aria-expanded="pagesExpanded || !!query" @click="pagesExpanded = !pagesExpanded"><span class="section-chevron" :class="{ expanded: pagesExpanded || query }" aria-hidden="true">›</span> 浏览器页面 <small>{{ query ? `${filteredTabs.length} / ${tabs.length}` : tabs.length }}</small></button><button title="新开页面" aria-label="新开页面" :disabled="busy || !sessionId" @click="newPage">＋</button></div>
          <div v-if="pagesExpanded || query" class="section-items page-items" aria-label="浏览器页面列表" tabindex="0"><p v-if="!filteredTabs.length" class="empty">{{ query ? '没有匹配的页面' : '当前会话暂无浏览器页面' }}</p>
            <div v-for="tab in filteredTabs" :key="tab.id" class="resource-row">
              <button class="resource-main" :title="`${tab.title || tab.url}\n${tab.url}`" @click="openBrowser(tab.id)"><ResourceIcon :item="{ ...tab, kind: 'browser' }" /><span class="resource-name">{{ tab.title || tab.url || '新页面' }}</span><i v-if="tab.id === activeTabId" title="最近执行的页面" class="activity-dot"></i></button>
              <ResourceMenu label="页面操作"><button @click="copy(tab.url)">复制链接</button><button @click="closePage(tab)">关闭页面</button></ResourceMenu>
            </div>
          </div>
        </section>
        <section><div class="section-heading"><button :aria-expanded="filesExpanded || !!query" @click="filesExpanded = !filesExpanded"><span class="section-chevron" :class="{ expanded: filesExpanded || query }" aria-hidden="true">›</span> 产物 <small>{{ query ? `${filteredArtifacts.length} / ${artifacts.length}` : artifacts.length }}</small></button></div>
          <div v-if="filesExpanded || query" class="section-items file-items" aria-label="产物列表" tabindex="0"><p v-if="!filteredArtifacts.length" class="empty">{{ loading ? '正在加载资源…' : query ? '没有匹配的产物' : '生成的文件会显示在这里' }}</p>
            <div v-for="item in filteredArtifacts" :key="item.path || item.artifact_id" class="resource-row">
              <button class="resource-main" :title="`${item.filename}\n${size(item.size)} · ${item.path}`" @click="openArtifact(item)"><ResourceIcon :item="item" /><span class="resource-name">{{ item.filename }}</span><small v-if="item.exists === false">已缺失</small><small v-if="item.source">{{ ({ shell: '命令', office: 'Office', adapter: '适配器' })[item.source] || item.source }}</small><small v-if="item.office?.delivery?.status === 'final'" title="文件哈希与数据、视觉验收记录一致">已验收交付</small><small v-else-if="item.office" title="尚未登记为最终交付">待交付</small><small v-if="artifactAge(item)" class="artifact-age">{{ artifactAge(item) }}</small></button>
              <ResourceMenu label="文件操作"><button @click="fileAction('openFile', item)">{{ extension(item.filename).toLowerCase() === 'zip' ? '显示文件' : '系统打开' }}</button><button @click="fileAction('revealFile', item)">在文件夹中定位</button><button @click="copy(item.path)">复制路径</button></ResourceMenu>
            </div>
          </div>
        </section>
      </div>
    </div>
    </div>
    <div v-if="!selection && miniTab && opened" class="browser-mini" aria-label="主浏览器实时画面">
      <AgentBrowserPanel v-if="browserReady" :key="miniTab.id" :tab-id="miniTab.id" layout="docked" compact />
      <button class="mini-expand" :aria-label="`半屏查看 ${miniTab.title || miniTab.url}`" @click="openBrowser(miniTab.id)"><span>半屏查看 ↗</span></button>
      <div class="mini-caption"><span>{{ miniTab.title || miniTab.url || '浏览器画面' }}</span><small>实时画面</small></div>
    </div>
  </aside>

</template>

<script setup>
import { liveSessionBrowserPages, isClosedBrowserPageError } from '../../utils/sessionBrowserPages.js'
import { resourceId, restoreWorkspace } from '../../utils/resourceWorkspace.js'
import ResourcePreview from './resources/ResourcePreview.vue'
import ResourceMenu from './ResourceMenu.vue'
import { formatArtifactAge, sortArtifactsByUpdated } from '../../utils/artifactTime.js'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import AgentBrowserPanel from './AgentBrowserPanel.vue'
import ResourceIcon from './resources/ResourceIcon.vue'
const props = defineProps({ sessionId: { type: String, default: '' }, conversationPhase: { type: String, default: 'hero' }, revision: Number })
const emit = defineEmits(['download-log', 'compact-change', 'viewing-change'])
const isSmallViewport = () => window.innerWidth < 1180 || window.innerHeight < 620
const smallViewport = ref(isSmallViewport())
let previousViewportWidth = window.innerWidth, previousViewportHeight = window.innerHeight
const opened = ref(false), selection = ref(null), maximized = ref(false), width = ref(700)
const retainedTabs = ref([])
const splitRatio = ref(.5), draggedTab = ref(null), dropTarget = ref(null)
const workTabs = ref([]), activeIds = ref(['', '']), split = ref(false), focusedPane = ref(0), browserActivity = ref(null)
const effectiveSplit = computed(() => split.value && (maximized.value ? window.innerWidth - 280 : width.value) >= 640 && !smallViewport.value)
const searching = ref(false), searchInput = ref(null), searchButton = ref(null)
const query = ref(''), pagesExpanded = ref(true), filesExpanded = ref(true)
const now = ref(Date.now())
const artifactAge = item => formatArtifactAge(item.updated_at || item.created_at, now.value)
const artifacts = ref([]), tabs = ref([]), activeTabId = ref('')
const closedBrowserIds = new Set()
const unseen = ref(0), error = ref(''), loading = ref(false), busy = ref(false)
const browserReady = ref(true)
let generation = 0, timer, stopResize, stopSplitResize
const states = new Map()
let loadedOnce = false
const stateKey = id => `crawshrimp.sessionPanel.v2.${id}`
let panelSessionId = '', panelConversationPhase = 'hero'
function saveState(id) { if (!id || id !== panelSessionId || panelConversationPhase !== 'active') return; const state = { opened: opened.value, selection: selection.value, width: width.value, maximized: maximized.value, workTabs: workTabs.value, activeIds: activeIds.value, split: split.value, splitRatio: splitRatio.value, focusedPane: focusedPane.value }; states.set(id, state); try { localStorage.setItem(stateKey(id), JSON.stringify(state)) } catch {} }
function readState(id) { try { return states.get(id) || JSON.parse(localStorage.getItem(stateKey(id)) || 'null') } catch { return null } }
defineExpose({ openResource, followBrowserActivity, showError: message => { error.value = message; opened.value = true }, collapse: () => { opened.value = false } })
const miniTab = computed(() => { const available = tabs.value.filter(t => !t.closed && !workTabs.value.some(item => item.kind === 'browser' && item.id === t.id && item.layout === 'floating')); return available.find(t => t.id === activeTabId.value) || available[0] })
const filteredTabs = computed(() => tabs.value.filter(t => `${t.title} ${t.url}`.toLowerCase().includes(query.value.toLowerCase())))
const filteredArtifacts = computed(() => sortArtifactsByUpdated(artifacts.value).filter(t => `${t.filename} ${t.path}`.toLowerCase().includes(query.value.toLowerCase())))
const extension = name => String(name || '').split('.').pop().slice(0, 4).toUpperCase()
const size = value => Number(value) > 1048576 ? `${(value / 1048576).toFixed(1)} MB` : `${Math.max(0, Number(value) || 0) / 1024 < 1 ? '<1' : (value / 1024).toFixed(1)} KB`
function onViewportResize() {
  const nextSmall = isSmallViewport()
  const shrinking = window.innerWidth < previousViewportWidth || window.innerHeight < previousViewportHeight
  if (nextSmall && (!smallViewport.value || shrinking)) {
    maximized.value = false
    stopResize?.(); stopSplitResize?.()
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
watch([opened, selection], () => emit('viewing-change', opened.value && Boolean(selection.value)), { immediate: true })
watch(compactOpen, value => emit('compact-change', value), { immediate: true })
function togglePanel() { opened.value = !opened.value; if (opened.value && !selection.value) unseen.value = 0 }
function back() { selection.value = null; maximized.value = false; unseen.value = 0; error.value = '' }
function forgetBrowserPage(id) {
  closedBrowserIds.add(id)
  tabs.value = tabs.value.filter(tab => tab.id !== id)
  if (activeTabId.value === id) activeTabId.value = ''
  for (const item of [...workTabs.value]) if (item.kind === 'browser' && item.id === id) closeResource(item)
}
async function openBrowser(id) {
  const sessionId = props.sessionId
  if (!tabs.value.some(tab => tab.id === id && !tab.closed)) {
    forgetBrowserPage(id)
    return
  }
  try {
    await window.cs.agentApi('POST', `/agent/session-resources/pages/${encodeURIComponent(id)}/select`, { runtime_session_id: sessionId })
    if (sessionId !== props.sessionId) return
  } catch (e) {
    if (sessionId !== props.sessionId) return
    if (isClosedBrowserPageError(e)) {
      forgetBrowserPage(id)
      error.value = ''
      await refresh()
    } else {
      error.value = '选择页面失败，请稍后重试'
    }
    return
  }
  if (!tabs.value.some(tab => tab.id === id)) return
  window.cs?.analyticsFeature?.('browser')?.catch(() => {})
  activeTabId.value = id
  openResource({ ...tabs.value.find(t => t.id === id), kind: 'browser', id })
  opened.value = true
  error.value = ''
}
function adjustWidth(delta) { width.value = Math.max(320, Math.min(900, window.innerWidth * .7, width.value + delta)) }
async function fileAction(action, item) { if (action === 'openFile' && extension(item.filename).toLowerCase() === 'zip') action = 'revealFile'; try { const result = await window.cs[action](item.path); if (result?.ok === false || typeof result === 'string' && result) throw new Error(result.error || result) } catch (e) { error.value = `操作失败：${e.message}` } }
async function copy(value) { try { await navigator.clipboard.writeText(value || '') } catch (e) { error.value = `复制失败：${e.message}` } }
function tabDomId(item) { return `workspace-${encodeURIComponent(item.scope || props.sessionId)}-${encodeURIComponent(item.key)}` }
function paneTabs(pane) { return workTabs.value.filter(t => t.pane === pane) }
function activePaneTab(pane) { return workTabs.value.find(t => t.key === activeIds.value[pane]) }
function isVisible(item) { return item.layout !== 'floating' && item.scope === props.sessionId && activeIds.value[item.pane] === item.key && (effectiveSplit.value || item.pane === focusedPane.value) }
function focusResource(item) { nextTick(() => { const button = item ? document.getElementById(tabDomId(item)) : document.querySelector?.(`.workspace-tabbar[data-pane="${focusedPane.value}"] .workspace-tab-add`); button?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); button?.focus() }) }
function switchPane() { focusedPane.value = 1 - focusedPane.value; selection.value = activePaneTab(focusedPane.value) || selection.value; focusResource(activePaneTab(focusedPane.value)) }
function changeBrowserLayout(item, layout) { if (!item || item.kind !== 'browser') return; item.layout = layout === 'floating' ? 'floating' : 'docked'; if (item.layout === 'floating') back(); else { activateResource(item); focusResource(item) } }
function collapseBrowser(item) { item.layout = 'docked'; back() }
function activateResource(item) { if (item.kind === 'browser') item.layout = 'docked'; activeIds.value[item.pane] = item.key; focusedPane.value = item.pane; selection.value = item; opened.value = true }
function openResource(item, { focus = true } = {}) {
  if (!item || (item.kind === 'browser' ? !item.id : !item.path)) return
  const known = artifacts.value.find(t => t.path === item.path) || {}
  const resource = { ...known, ...item, kind: item.kind === 'browser' ? 'browser' : 'artifact' }
  resource.key = resourceId(resource)
  let tab = workTabs.value.find(t => t.key === resource.key)
  if (!tab) { tab = { ...resource, scope: props.sessionId, pane: split.value ? focusedPane.value : 0 }; workTabs.value.push(tab); tab = workTabs.value.at(-1); retainedTabs.value.push(tab) }
  else Object.assign(tab, resource)
  if (!focus && tab.layout === 'floating') { opened.value = true; error.value = ''; return }
  activateResource(tab); error.value = ''
  nextTick(() => { const button = document.getElementById(tabDomId(tab)); button?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); if (focus) button?.focus() })
}
function openArtifact(item) { window.cs?.analyticsFeature?.('file_preview')?.catch(() => {}); openResource(item) }
function closeResource(item) {
  const pane = item.pane, old = paneTabs(pane), index = old.findIndex(t => t.key === item.key)
  workTabs.value = workTabs.value.filter(t => t.key !== item.key)
  retainedTabs.value = retainedTabs.value.filter(t => t.scope !== props.sessionId || t.key !== item.key)
  if (activeIds.value[pane] === item.key) activeIds.value[pane] = paneTabs(pane)[Math.max(0, index - 1)]?.key || ''
  focusedPane.value = activeIds.value[pane] ? pane : 1 - pane
  selection.value = workTabs.value.find(t => t.key === activeIds.value[focusedPane.value]) || null
  focusResource(selection.value)
}
function stepResource(pane, delta) {
  const items = paneTabs(pane); if (!items.length) return
  const index = items.findIndex(t => t.key === activeIds.value[pane])
  activateResource(items[(index + delta + items.length) % items.length])
  focusResource(selection.value)
}
function clearTabDrag() { draggedTab.value = null; dropTarget.value = null }
function startTabDrag(event, item) {
  draggedTab.value = item.key
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-crawshrimp-tab', item.key)
}
function dragOverResource(event, pane, before) {
  if (!workTabs.value.some(t => t.key === draggedTab.value)) return
  event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const box = event.currentTarget.getBoundingClientRect()
  dropTarget.value = { pane, key: before?.key || '', after: !!before && event.clientX > box.left + box.width / 2 }
  const bar = event.currentTarget.closest('.workspace-tabbar')
  if (bar) { const bounds = bar.getBoundingClientRect(); if (event.clientX < bounds.left + 24) bar.scrollLeft -= 20; else if (event.clientX > bounds.right - 40) bar.scrollLeft += 20 }
}
function leaveDropTarget(event) { if (!event.currentTarget.contains(event.relatedTarget)) dropTarget.value = null }
function tabArrow(event, item, delta) {
  if (event.altKey && split.value) { draggedTab.value = item.key; dropResource(event, 1 - item.pane) }
  else stepResource(item.pane, delta)
}
function dropResource(event, pane, before) {
  const item = workTabs.value.find(t => t.key === draggedTab.value)
  const box = before && event.currentTarget?.getBoundingClientRect?.()
  const after = box && Number.isFinite(event.clientX) ? event.clientX > box.left + box.width / 2 : dropTarget.value?.key === before?.key && dropTarget.value?.after
  clearTabDrag()
  if (!item || item === before) return
  event.preventDefault?.()
  const oldPane = item.pane
  const next = workTabs.value.filter(t => t !== item)
  item.pane = pane
  const index = before ? next.indexOf(before) : next.length
  next.splice(index < 0 ? next.length : index + (after ? 1 : 0), 0, item)
  workTabs.value = next
  if (oldPane !== pane && activeIds.value[oldPane] === item.key) activeIds.value[oldPane] = paneTabs(oldPane).at(-1)?.key || ''
  activateResource(item); focusResource(item)
}
function resizeSplit(event) {
  if (event.button !== 0) return
  event.preventDefault(); stopSplitResize?.()
  const handle = event.currentTarget, box = handle.parentElement.getBoundingClientRect(), pointerId = event.pointerId
  if (!box.width) return
  handle.setPointerCapture?.(pointerId)
  const move = e => { splitRatio.value = Math.max(.3, Math.min(.7, (e.clientX - box.left) / box.width)) }
  const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); window.removeEventListener('blur', end); if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId); stopSplitResize = null }
  stopSplitResize = end
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', end, { once: true }); window.addEventListener('pointercancel', end, { once: true }); window.addEventListener('blur', end, { once: true })
}
function toggleSplit() {
  split.value = !split.value
  if (split.value) {
    const tab = selection.value || workTabs.value.at(-1)
    if (tab && paneTabs(0).length > 1) {
      tab.pane = 1; activeIds.value[1] = tab.key
      activeIds.value[0] = paneTabs(0).at(-1)?.key || ''; focusedPane.value = 1
    }
    width.value = Math.min(900, window.innerWidth * .7, Math.max(720, width.value))
  } else {
    const key = activeIds.value[focusedPane.value]
    for (const tab of workTabs.value) tab.pane = 0
    activeIds.value = [key || workTabs.value[0]?.key || '', '']; focusedPane.value = 0
  }
}
function followBrowserActivity(activity) {
  if (!activity?.active_tab_id || activity.runtime_session_id && activity.runtime_session_id !== props.sessionId) return
  const old = browserActivity.value
  browserActivity.value = activity
  if (old && old.active_tab_id === activity.active_tab_id && old.tool_call_id === activity.tool_call_id && old.run_id === activity.run_id && old.operation === activity.operation && old.phase === activity.phase) return
  const page = activity.tabs?.find(t => t.id === activity.active_tab_id)
  if (!page) return
  // Observing the selected execution target never performs a browser action.
  if (!tabs.value.some(t => t.id === page.id)) tabs.value.push(page)
  activeTabId.value = page.id
  if (activity.source === 'agent') openResource({ ...page, kind: 'browser' }, { focus: false })
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
    const wasLoaded = loadedOnce
    loadedOnce = true
    artifacts.value = next
    for (const tab of workTabs.value) {
      const updated = next.find(item => item.path === tab.path)
      if (tab.kind === 'artifact' && updated) Object.assign(tab, updated, { kind: 'artifact' })
    }
    if (data.browserActivity) { if (wasLoaded) followBrowserActivity(data.browserActivity); else browserActivity.value = data.browserActivity }
    if (live?.ok === true && Array.isArray(live.tabs)) {
      const liveIds = new Set(live.tabs.map(tab => tab.id))
      for (const tab of data.tabs || []) {
        if (!liveIds.has(tab.id)) closedBrowserIds.add(tab.id)
      }
    }
    tabs.value = liveSessionBrowserPages(data.tabs, live, closedBrowserIds)
    for (const item of workTabs.value) { if (item.kind === 'browser') { const livePage = tabs.value.find(t => t.id === item.id); if (livePage) Object.assign(item, livePage, { kind: 'browser' }) } }
    activeTabId.value = tabs.value.some(tab => tab.id === data.activeTabId) ? data.activeTabId : ''
    for (const item of [...workTabs.value]) if (item.kind === 'browser' && !tabs.value.some(tab => tab.id === item.id)) closeResource(item)
  } catch (e) { if (token === generation) error.value = `资源加载失败：${e.message}` }
  finally { if (token === generation) loading.value = false }
}
async function newPage() { busy.value = true; error.value = ''; const id = props.sessionId; try { const tab = await window.cs.agentApi('POST', '/agent/session-resources/pages', { runtime_session_id: id }); if (id !== props.sessionId) return; await refresh(); openBrowser(tab.id) } catch (e) { error.value = `新建失败：${e.message}` } finally { busy.value = false } }
async function closePage(tab) { const id = props.sessionId; error.value = ''; try { await window.cs.agentApi('DELETE', `/agent/session-resources/pages/${encodeURIComponent(tab.id)}?runtime_session_id=${encodeURIComponent(id)}`); if (id !== props.sessionId) return; const wasSelected = selection.value?.kind === 'browser' && selection.value.id === tab.id; forgetBrowserPage(tab.id); if (wasSelected && tabs.value.length) await openBrowser(tabs.value[0].id); await refresh() } catch (e) { error.value = `关闭失败：${e.message}` } }
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

function syncSessionPanel() {
  const id = props.sessionId, phase = props.conversationPhase
  if (id === panelSessionId && phase === panelConversationPhase) return
  clearTabDrag(); stopSplitResize?.()
  saveState(panelSessionId)
  panelSessionId = id; panelConversationPhase = phase
  loadedOnce = false
  closedBrowserIds.clear()
  activeTabId.value = ''
  browserActivity.value = null
  generation++; artifacts.value = []; tabs.value = []; query.value = ''; searching.value = false; error.value = ''; unseen.value = 0; maximized.value = false
  const state = id ? readState(id) : null
  // DSH assigns IDs to blank sessions too. Only the rendered active phase
  // opens the card; blank/loading transitions must not overwrite user choices.
  const shouldOpen = Boolean(id) && phase === 'active' && (state?.opened ?? !smallViewport.value)
  opened.value = shouldOpen; selection.value = state?.selection || null; width.value = Math.max(320, Math.min(900, window.innerWidth * .7, state?.width || window.innerWidth * .45))
  splitRatio.value = Math.max(.3, Math.min(.7, Number(state?.splitRatio) || .5))
  const restored = restoreWorkspace(state)
  workTabs.value = restored.tabs.map(tab => {
    const cached = retainedTabs.value.find(t => t.scope === id && t.key === tab.key)
    if (cached) { Object.assign(cached, tab); return cached }
    const item = { ...tab, scope: id }; retainedTabs.value.push(item); return item
  }); maximized.value = Boolean(state?.maximized) && !smallViewport.value; activeIds.value = restored.active; split.value = restored.split; focusedPane.value = restored.focusedPane
  // Bound inactive renderer memory; metadata remains persisted for every session.
  retainedTabs.value = [...retainedTabs.value.filter(t => t.scope !== id).slice(-12), ...workTabs.value]
  selection.value = state?.selection ? workTabs.value.find(t => t.key === resourceId(state.selection)) || null : null
  void refresh()
}
watch([() => props.sessionId, () => props.conversationPhase], syncSessionPanel, { immediate: true })
watch([opened, selection, width, maximized, workTabs, activeIds, split, splitRatio, focusedPane], () => saveState(props.sessionId), { deep: true })
watch(() => props.revision, () => { clearTimeout(timer); timer = setTimeout(refresh, 150) })
const ageTimer = setInterval(() => { now.value = Date.now() }, 30000)
const polling = setInterval(refresh, 5000)
onUnmounted(() => { emit('viewing-change', false); window.removeEventListener('resize', onViewportResize); generation++; clearInterval(polling); clearInterval(ageTimer); clearTimeout(timer); stopResize?.(); stopSplitResize?.() })
</script>

<style scoped>
/* Match the embedded conversation header, including its bottom divider. */
.session-header-actions{position:absolute;right:0;top:0;height:44px;box-sizing:border-box;z-index:20;display:flex;align-items:center;justify-content:flex-end;gap:6px;padding:0 16px;border-bottom:1px solid transparent}
.session-header-actions.extends-divider{width:332px}
/* DSH header uses a half-pixel pseudo-element above its transparent border. */
.session-header-actions.extends-divider::after{content:"";position:absolute;left:0;right:0;bottom:1px;height:.5px;background:var(--agent-header-divider);pointer-events:none}
.session-header-actions .session-export-button,.session-header-actions .session-panel-toggle{position:relative;top:auto;right:auto;flex:none}
.session-panel-toggle{position:absolute;right:16px;top:14px;z-index:20;width:32px;height:32px;border:0;border-radius:7px;background:transparent;color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:6px}
.session-panel-toggle:hover{background:var(--bg2)}.unseen-count{position:absolute;right:-3px;top:-3px;min-width:14px;height:14px;border-radius:7px;background:var(--orange,#ff6b2b);color:white;font-size:9px;line-height:14px;text-align:center}
.session-resources{position:relative;flex-shrink:0;max-width:70%;min-width:280px;display:flex;flex-direction:column;background:var(--bg);border-left:1px solid var(--border);padding-top:0;min-height:0;color:var(--text);font-size:13px}
.session-resources.compact{position:absolute;right:16px;top:56px;bottom:auto;z-index:18;max-width:calc(100% - 32px);max-height:calc(100% - 80px);min-width:0;padding:0;border:0;background:transparent;gap:10px}
.resource-card{position:relative;display:contents}.compact .resource-card{position:relative;display:flex;flex-direction:column;min-height:0;flex:0 1 auto;border:1px solid var(--border);border-radius:14px;background:var(--bg2);box-shadow:0 4px 18px #0000000a;overflow:hidden}
.viewing header{height:38px;padding:0 10px}.viewing .browser-tabs{padding-top:4px}.viewing .browser-tab>[role=tab]{padding-top:8px;padding-bottom:8px}
.session-resources.maximized{position:absolute;inset:0 0 0 auto;width:calc(100% - 280px);max-width:100%;z-index:19}
.compact header{height:42px;border-bottom:0}.compact .resource-search{padding-top:0}.compact .resource-search input{background:var(--bg);font-size:12px}.compact .resource-list{flex:0 1 auto;min-height:0;max-height:calc(100vh - 330px)}.compact .resource-row{min-height:30px}.compact .resource-main{padding:5px 4px;gap:7px}.compact .type-icon{width:25px}.compact .resource-name{line-height:20px}.closed-label{flex:none;font-size:10px}
.browser-mini{position:relative;align-self:flex-end;width:230px;max-width:100%;flex:0 0 144px;height:144px;margin:0;border:1px solid var(--border);border-radius:9px;overflow:hidden;background:var(--bg)}
.browser-mini :deep(.agent-browser-window){height:119px}.mini-expand{position:absolute;inset:0 0 24px;z-index:2;border-radius:0;display:flex;align-items:center;justify-content:center}.mini-expand span{opacity:0;background:var(--bg2);padding:7px 10px;border-radius:8px;box-shadow:0 2px 8px #0002}.mini-expand:hover{background:#00000012}.mini-expand:hover span,.mini-expand:focus-visible span{opacity:1}.mini-caption{position:absolute;bottom:0;left:0;right:0;height:24px;padding:0 8px;display:flex;align-items:center;gap:6px;background:var(--bg);font-size:11px}.mini-caption>span{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.browser-tabs{scroll-padding-inline:8px 44px;display:flex;align-items:stretch;overflow-x:auto;flex-shrink:0;gap:3px;padding:8px 8px 0;background:var(--bg2);border-bottom:1px solid var(--border);scrollbar-width:thin}
.browser-tab{display:flex;align-items:center;flex:1 0 125px;min-width:100px;max-width:220px;border-radius:9px 9px 0 0;border:1px solid transparent;border-bottom:0;color:var(--text2)}.browser-tab.selected{background:var(--bg);border-color:var(--border);color:var(--text)}.browser-tab>[role=tab]{display:flex;align-items:center;gap:7px;min-width:0;flex:1;padding:10px 8px;text-align:left;border-radius:9px 9px 0 0}.tab-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tab-site-icon,.tab-closed{font-size:11px;color:var(--text3)}.tab-close{margin-right:4px;padding:2px 5px;font-size:16px}.tab-add{position:sticky;right:0;background:var(--bg2);align-self:center;flex:none;margin:0 4px 5px}.browser-content{flex:1;min-height:0;overflow:hidden}

/* Keep header tooltips above the positioned file workspace and its tabs. */
header{position:relative;z-index:10;height:48px;display:flex;align-items:center;padding:0 16px;border-bottom:1px solid var(--border);gap:8px;flex-shrink:0}.spacer{flex:1}
button,select,input{font:inherit;color:inherit}button{background:none;border:0;cursor:pointer;padding:6px;border-radius:6px}button:hover{background:var(--bg2)}button:disabled{opacity:.5;cursor:default}button:focus-visible,summary:focus-visible{outline:2px solid var(--accent,#ff6b2b)}small{color:var(--text3);font-size:11px}
.search-toggle{display:flex;align-items:center;justify-content:center}.resource-search{padding:0 12px 6px;display:flex;gap:4px;align-items:center}.resource-search input{min-width:0}.resource-search input:focus-visible{outline:2px solid var(--accent,#ff6b2b);outline-offset:-1px}.resource-search input{box-sizing:border-box;width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:7px;padding:8px 10px;outline:none}
.resource-list{display:flex;flex-direction:column;flex:1;overflow:hidden;padding:0 8px 6px}.resource-list section{display:flex;flex-direction:column;flex:0 1 auto;min-height:36px}.section-heading{flex-shrink:0}section+section{margin-top:6px}.section-items{flex:0 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-gutter:stable}.page-items{max-height:150px}.file-items{max-height:210px}.section-items:focus-visible{outline:1px solid var(--border);outline-offset:-1px}.section-heading{display:flex;justify-content:space-between;align-items:center;color:var(--text2);padding:4px 0}.section-heading small{margin-left:6px}
.resource-row{display:flex;align-items:center;border-radius:7px;min-width:0;position:relative}.resource-row:hover{background:var(--bg2)}.resource-main{display:flex;align-items:center;text-align:left;gap:10px;flex:1;min-width:0;padding:10px 6px}.resource-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;line-height:1.5}.resource-name small{display:block;overflow:hidden;text-overflow:ellipsis}.type-icon{width:30px;flex-shrink:0;color:var(--text3);font-size:10px}.activity-dot{width:6px;height:6px;background:#73b894;border-radius:50%}
.empty{margin:0;padding:8px 6px;color:var(--text3);font-size:12px;line-height:1.7}.resource-error{padding:8px 16px;color:#e18b74;font-size:12px;margin:0;overflow-wrap:anywhere}
.resource-toolbar{display:flex;gap:8px;align-items:center;padding:10px 14px;flex-shrink:0;border-bottom:1px solid var(--border)}.resource-toolbar strong{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.resource-toolbar select{width:100%;padding:8px;background:var(--bg2);border:1px solid var(--border);border-radius:6px}.resource-preview{overflow:auto;flex:1;padding:18px;min-height:0}.resource-preview img,.resource-preview video{display:block;max-width:100%;height:auto;margin:auto}.resource-preview pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.7 monospace}.resource-resizer{position:absolute;left:-4px;top:0;touch-action:none;bottom:0;width:8px;cursor:col-resize;z-index:25}
@media(max-width:1000px){.session-resources.viewing{position:absolute;right:0;top:0;bottom:0;max-width:calc(100% - 60px);z-index:15;box-shadow:-8px 0 30px #0003}.session-resources.maximized{width:calc(100% - 60px)}}
.artifact-age{flex:none;font-size:10px;white-space:nowrap;font-variant-numeric:tabular-nums}
.session-export-button{position:absolute;right:54px;top:14px;z-index:20;width:32px;height:32px;color:var(--text2)}
.export-log{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none}.session-export-button{position:absolute}
.export-log::after{content:attr(data-tooltip);position:absolute;right:0;top:calc(100% + 7px);z-index:40;white-space:nowrap;padding:6px 8px;border-radius:6px;background:var(--tooltip-bg,#292932);color:#f7f7fa;font-size:11px;line-height:1.4;box-shadow:0 4px 14px #0002;opacity:0;pointer-events:none;transition:opacity 120ms}
.export-log:hover::after,.export-log:focus-visible::after{opacity:1}
.resource-toolbar button{border:1px solid var(--border);padding:5px 9px;color:var(--text2);font-size:12px}.resource-toolbar button:hover{background:var(--bg2);color:var(--text)}
/* Localized feedback: the old hover used the same background as the compact card. */
.session-resources,.session-header-actions{--resource-hover:color-mix(in srgb,var(--text) 8%,transparent);--resource-pressed:color-mix(in srgb,var(--text) 12%,transparent);--resource-ease-out:cubic-bezier(.23,1,.32,1)}
.resource-row{isolation:isolate}.resource-row::before{content:"";position:absolute;inset:0;border-radius:7px;z-index:-1;background:var(--resource-hover);opacity:0;pointer-events:none;transition:opacity 120ms ease}
.resource-row:focus-within::before{opacity:1;transition:none}.resource-row:hover,.resource-main:hover{background:transparent}
.section-heading>button:first-child{flex:1;text-align:left;display:flex;align-items:center;gap:5px;min-height:30px}
.section-heading>button:first-child small{margin-left:2px}.section-chevron{display:inline-flex;align-items:center;justify-content:center;width:10px;font-size:16px;line-height:1;transform:rotate(0);transition:transform 160ms var(--resource-ease-out)}.section-chevron.expanded{transform:rotate(90deg)}
.section-heading button:focus-visible .section-chevron{transition:none}
.section-heading button,header button,.session-header-actions button,.resource-toolbar button{position:relative;isolation:isolate}
.section-heading button::before,header button::before,.session-header-actions button::before,.resource-toolbar button::before{content:"";position:absolute;inset:0;border-radius:inherit;background:var(--resource-hover);opacity:0;z-index:-1;pointer-events:none;transition:opacity 120ms ease}
.session-resources button:focus-visible,.session-header-actions button:focus-visible{outline:2px solid var(--orange,#ff6b2b);outline-offset:1px}
@media(hover:hover) and (pointer:fine){
  .resource-row:hover::before{opacity:1}
  .section-heading button:hover:not(:disabled),header button:hover:not(:disabled),.session-header-actions button:hover:not(:disabled),.resource-toolbar button:hover:not(:disabled){background:transparent}
  .section-heading button:hover:not(:disabled)::before,header button:hover:not(:disabled)::before,.session-header-actions button:hover:not(:disabled)::before,.resource-toolbar button:hover:not(:disabled)::before{opacity:1}
  .section-heading button,header button,.session-header-actions button,.resource-toolbar button{transition:transform 160ms var(--resource-ease-out)}
  .section-heading button:active:not(:disabled):not(:focus-visible),header button:active:not(:disabled):not(:focus-visible),.session-header-actions button:active:not(:disabled):not(:focus-visible),.resource-toolbar button:active:not(:disabled):not(:focus-visible){transform:scale(.97)}
  .resource-row:hover :deep(.menu-trigger){opacity:1}
}
@media(prefers-reduced-motion:reduce){
  .section-chevron,.section-heading button,header button,.session-header-actions button,.resource-toolbar button{transition:none!important}
  .section-heading button:active,header button:active,.session-header-actions button:active,.resource-toolbar button:active{transform:none!important}
}
.file-workspace.inactive{position:absolute;inset:48px 0 0;visibility:hidden;pointer-events:none}.workspace-content.inactive{visibility:hidden;pointer-events:none}.file-workspace{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:40px minmax(0,1fr);overflow:hidden}.file-workspace.split{grid-template-columns:repeat(2,minmax(0,1fr))}.workspace-tabbar{grid-row:1;display:flex;gap:3px;overflow-x:auto;scrollbar-width:thin;background:var(--bg2);border-bottom:1px solid var(--border);padding:4px 5px;min-width:0}.workspace-tab{display:flex;flex:none;max-width:210px;min-width:70px;border-radius:6px;color:var(--text3)}.workspace-tab.selected{background:var(--bg);color:var(--text);box-shadow:0 0 0 1px var(--border)}.workspace-tab [role=tab]{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;text-align:left;max-width:180px;font-size:12px}.workspace-content{grid-row:2;min-width:0;min-height:0;overflow:hidden;border-right:1px solid var(--border)}.resource-inventory{display:flex;flex-direction:column;min-height:0;flex:1}

.workspace-tabbar{scroll-padding-inline:8px 38px;align-items:center;gap:4px}.workspace-tab{flex:0 1 190px;min-width:94px;height:30px;transition:background-color 120ms ease,box-shadow 120ms ease,color 120ms ease}.workspace-tab:hover{background:var(--resource-hover,#8881)}.workspace-tab [role=tab]{display:flex;align-items:center;gap:7px;min-width:0;flex:1;padding:5px 7px}.workspace-tab-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.workspace-tab-close{flex:none;width:22px;padding:0!important;opacity:0;transition:opacity 120ms ease}.workspace-tab:is(.selected,:hover,:focus-within) .workspace-tab-close{opacity:1}.workspace-tab-add{position:sticky;right:0;flex:none;width:28px;height:28px;background:var(--bg2);margin-left:auto}.workspace-tab:focus-within{outline:1px solid var(--orange,#ff6b2b);outline-offset:-1px}@media(prefers-reduced-motion:reduce){.workspace-tab,.workspace-tab-close{transition:none}}
.file-workspace{position:relative}.workspace-divider{position:absolute;top:40px;bottom:0;width:7px;transform:translateX(-3px);z-index:5;cursor:col-resize;touch-action:none}.workspace-divider:hover,.workspace-divider:focus-visible{background:var(--orange,#ff6b2b);opacity:.4}.workspace-tab[draggable=true]{cursor:grab;user-select:none}
.workspace-empty{grid-row:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--text3);font-size:12px}.workspace-empty button{color:var(--text2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;background:var(--bg2)}
.workspace-tab{position:relative}.workspace-tab.dragging{opacity:.45}.workspace-tab.drop-before::after,.workspace-tab.drop-after::after{content:"";position:absolute;top:2px;bottom:2px;width:2px;border-radius:2px;background:var(--orange,#ff6b2b);pointer-events:none}.workspace-tab.drop-before::after{left:-3px}.workspace-tab.drop-after::after{right:-3px}.workspace-tabbar.drop-pane{box-shadow:inset -3px 0 var(--orange,#ff6b2b)}.workspace-empty.drop-pane{background:color-mix(in srgb,var(--orange,#ff6b2b) 8%,transparent);box-shadow:inset 0 0 0 2px var(--orange,#ff6b2b)}
@media(hover:none){.workspace-tab-close{opacity:1}}
/* All icon actions share the same hit area, glyph size and hover treatment. */
.resource-icon-button{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;min-width:28px;padding:0;border:0;border-radius:6px;font-size:18px;line-height:1;color:var(--text2)}.resource-icon-button svg{width:16px;height:16px;flex:none}.workspace-tab-close{width:28px!important}.resource-icon-button:hover{background:var(--resource-hover,#8881);color:var(--text)}

.resource-icon-button{position:relative}.resource-icon-button::after,header button[title]::after,.session-panel-toggle::after{content:attr(title);position:absolute;right:0;top:calc(100% + 6px);z-index:60;white-space:nowrap;padding:5px 8px;border-radius:6px;background:var(--tooltip-bg,#292932);color:#f7f7fa;font:11px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 3px 12px #0002;opacity:0;pointer-events:none;transition:opacity 100ms ease}.resource-icon-button:hover::after,.resource-icon-button:focus-visible::after,header button[title]:hover::after,header button[title]:focus-visible::after,.session-panel-toggle:hover::after,.session-panel-toggle:focus-visible::after{opacity:1}
.viewing header button:first-child::after{left:0;right:auto}
.workspace-tab{flex:0 0 160px;min-width:120px;max-width:190px}
</style>
