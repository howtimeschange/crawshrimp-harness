<template>
  <div ref="root" class="desktop-status-footer" :class="{ collapsed }" aria-label="个人账号与应用状态">
    <button ref="trigger" type="button" class="account-trigger" :class="{ active: open }"
      :title="`${identity.name} · ${serviceTitle}`" aria-haspopup="menu" :aria-expanded="open" :aria-controls="menuId"
      :aria-label="`${identity.name}，打开账号与应用菜单`" @click="toggleMenu" @keydown.down.prevent="showMenu" @keydown.up.prevent="showMenu">
      <span class="account-avatar" aria-hidden="true"><span v-if="identity.initial">{{ identity.initial }}</span><IconUser v-else :size="19" :stroke-width="1.7" /></span>
      <span v-if="!collapsed" class="account-copy"><strong>{{ identity.name }}</strong><small v-if="identity.detail">{{ identity.detail }}</small></span>
      <span v-if="collapsed && updateNoteworthy" class="collapsed-update-dot" :title="presentation.title"></span>
      <span class="health-pair" :aria-label="serviceTitle">
        <i :class="indicators.core.tone" :title="`核心服务：${indicators.core.label}`"></i>
        <i :class="indicators.browser.tone" :title="`浏览器：${indicators.browser.label}`"></i>
      </span>
      <IconSelector v-if="!collapsed" class="account-chevron" :size="14" :stroke-width="1.6" aria-hidden="true" />
    </button>
    <button v-if="updateNoteworthy && !collapsed" class="update-shortcut" type="button" :class="`tone-${presentation.tone}`"
      :title="presentation.title" :aria-label="presentation.title || '查看更新'" :disabled="busy" @click="select('update')">
      <UpdateProgressRing v-if="presentation.tone === 'downloading'" compact :percent="presentation.percent || 0" />
      <IconRefresh v-else-if="presentation.tone === 'ready'" :size="17" />
      <IconAlertCircle v-else-if="presentation.tone === 'error'" :size="17" />
      <IconDownload v-else :size="17" />
    </button>

    <!-- Native popover crosses the DSH iframe and narrow rail without raising the footer's stacking layer. -->
    <div :id="menuId" ref="menu" popover="auto" class="account-menu" role="menu" aria-label="账号与应用"
      @toggle="onToggle" @keydown="onMenuKeydown" @focusout="onFocusOut">
      <button type="button" role="menuitem" class="menu-identity" @click="select('account')">
        <span class="account-avatar large" aria-hidden="true"><span v-if="identity.initial">{{ identity.initial }}</span><IconUser v-else :size="16" :stroke-width="1.6" /></span>
        <span class="account-copy"><strong>{{ identity.name }}</strong><small v-if="identity.detail">{{ identity.detail }}</small></span>
        <IconChevronRight :size="16" aria-hidden="true" />
      </button>
      <div class="menu-divider" role="separator"></div>
      <button type="button" role="menuitem" class="menu-row" @click="select('settings')"><IconSettings :size="16" :stroke-width="1.6" /><span>设置</span><IconChevronRight class="row-tail" :size="15" /></button>
      <button type="button" role="menuitem" class="menu-row" :class="`tone-${presentation.tone}`" :disabled="busy" :title="presentation.title" @click="select('update-details')">
        <UpdateProgressRing v-if="presentation.tone === 'downloading'" compact :percent="presentation.percent || 0" />
        <IconDownload v-else :size="16" :stroke-width="1.6" />
        <span>应用更新</span><span class="row-tail update-label">{{ presentation.label || presentation.versionLabel || '查看版本' }}</span>
      </button>
      <div class="menu-divider" role="separator"></div>
      <button type="button" role="menuitem" class="menu-row service-row" @click="select('services')"><IconCpu :size="16" :stroke-width="1.6" /><span>核心服务</span><span class="row-tail service-value"><i :class="indicators.core.tone"></i>{{ indicators.core.label }}</span></button>
      <button type="button" role="menuitem" class="menu-row service-row" @click="select('services')"><IconBrowser :size="16" :stroke-width="1.6" /><span>浏览器</span><span class="row-tail service-value"><i :class="indicators.browser.tone"></i>{{ indicators.browser.label }}</span></button>
      <template v-if="identity.authenticated">
        <div class="menu-divider" role="separator"></div>
        <template v-if="confirmGuestLogout">
          <p class="logout-note">退出后可能无法找回访客身份，本地文件和会话会保留。</p>
          <button type="button" role="menuitem" class="menu-row" :disabled="signingOut" @click="logout"><IconLogout :size="19" /><span>确认退出访客身份</span></button>
          <button type="button" role="menuitem" class="menu-row" @click="confirmGuestLogout = false"><IconArrowLeft :size="19" /><span>暂不退出</span></button>
        </template>
        <button v-else type="button" role="menuitem" class="menu-row" :disabled="signingOut" @click="requestLogout"><IconLogout :size="16" :stroke-width="1.6" /><span>{{ signingOut ? '退出中…' : account.user?.anonymous ? '退出访客身份' : '退出登录' }}</span></button>
      </template>
      <p v-if="error" class="account-error" role="alert">{{ error }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, useId, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { IconUser, IconSelector, IconChevronRight, IconSettings, IconDownload, IconRefresh, IconAlertCircle, IconCpu, IconBrowser, IconLogout, IconArrowLeft } from '@tabler/icons-vue'
import UpdateProgressRing from './UpdateProgressRing.vue'
import { accountIdentity, runtimeIndicators } from '../utils/desktopAccountMenu.js'
const props = defineProps({ status: { type: Object, default: () => ({}) }, presentation: { type: Object, default: () => ({}) }, busy: Boolean, collapsed: Boolean, contextKey: String })
const emit = defineEmits(['account', 'settings', 'services', 'update', 'update-details'])
const root = ref(null)
const trigger = ref(null)
const menu = ref(null)
const menuId = `account-menu-${useId()}`
const open = ref(false)
const account = ref({ user: null })
const error = ref('')
const signingOut = ref(false)
const confirmGuestLogout = ref(false)
const identity = computed(() => accountIdentity(account.value, error.value))
const indicators = computed(() => runtimeIndicators(props.status))
const serviceTitle = computed(() => `核心服务：${indicators.value.core.label} · 浏览器：${indicators.value.browser.label}`)
const updateNoteworthy = computed(() => Boolean(props.presentation.action) || ['downloading', 'waiting', 'installing', 'error'].includes(props.presentation.tone))
let unsubscribe
let observer
let occlusionObserver
let occlusionFrame = 0
let mounted = true
let refreshSequence = 0
async function refreshAccount() {
  const sequence = ++refreshSequence
  if (typeof window.cs?.accountAction !== 'function') return
  try {
    const state = await window.cs.accountAction('status')
    if (mounted && sequence === refreshSequence) { account.value = state; error.value = '' }
  } catch {
    if (mounted && sequence === refreshSequence) error.value = '账号暂时无法连接，本地功能仍可使用。'
  }
}
function positionMenu() {
  if (!root.value || !menu.value) return
  const rect = root.value.getBoundingClientRect()
  const width = Math.min(props.collapsed ? 240 : rect.width - 16, 260, window.innerWidth - 16)
  menu.value.style.width = `${width}px`
  menu.value.style.left = `${Math.max(8, Math.min(rect.left + 8, window.innerWidth - width - 8))}px`
  menu.value.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 8)}px`
  menu.value.style.maxHeight = `${Math.max(80, rect.top - 16)}px`
}
async function showMenu(event) {
  positionMenu()
  if (!menu.value?.matches(':popover-open')) menu.value?.showPopover()
  await nextTick()
  menu.value?.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ focusVisible: event?.type === 'keydown' })
  refreshAccount()
}
function closeMenu() {
  if (menu.value?.matches(':popover-open')) menu.value.hidePopover()
  open.value = false
  occlusionObserver?.disconnect()
  cancelAnimationFrame(occlusionFrame)
  confirmGuestLogout.value = false
}
function toggleMenu(event) { if (open.value) closeMenu(); else showMenu(event) }
function onToggle(event) {
  open.value = event.newState === 'open'
  if (open.value) occlusionObserver?.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'open'] })
  else { confirmGuestLogout.value = false; occlusionObserver?.disconnect() }
}
function checkOcclusion() {
  cancelAnimationFrame(occlusionFrame)
  occlusionFrame = requestAnimationFrame(() => {
    if (!open.value || !root.value) return
    const rect = root.value.getBoundingClientRect()
    // A feature's fullscreen mask must dismiss this top-layer menu as soon as it covers the footer.
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    if (!root.value.contains(top)) closeMenu()
  })
}
function select(action) {
  closeMenu()
  if (action === 'update' && ['downloading', 'waiting', 'installing'].includes(props.presentation.tone)) emit('update-details')
  else if (action === 'account') emit('account', identity.value.authenticated)
  else emit(action)
}
function onMenuKeydown(event) {
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(); trigger.value?.focus(); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const items = [...menu.value.querySelectorAll('[role="menuitem"]:not(:disabled)')]
  const index = items.indexOf(document.activeElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  items[next]?.focus()
}
function onFocusOut(event) {
  // focusout fires before the next control receives focus. Inspect the destination
  // instead of transient document.activeElement, so pointer clicks reach menu items.
  const destination = event.relatedTarget
  if (destination && open.value && !menu.value?.contains(destination) && destination !== trigger.value) closeMenu()
}
function requestLogout() { if (account.value.user?.anonymous) confirmGuestLogout.value = true; else logout() }
async function logout() {
  if (signingOut.value) return
  signingOut.value = true
  try { account.value = await window.cs.accountAction('logout'); error.value = ''; closeMenu(); trigger.value?.focus() }
  catch { error.value = '退出失败，请在账号设置中重试。' }
  finally { signingOut.value = false }
}
watch(() => props.contextKey, closeMenu)
watch(() => props.collapsed, closeMenu)
onMounted(() => {
  refreshAccount()
  unsubscribe = window.cs?.onAccountChanged?.(refreshAccount)
  occlusionObserver = new MutationObserver(checkOcclusion)
  observer = new ResizeObserver(positionMenu)
  observer.observe(root.value)
  window.addEventListener('resize', positionMenu)
  window.addEventListener('blur', closeMenu)
})
onBeforeUnmount(() => {
  mounted = false
  closeMenu()
  unsubscribe?.()
  observer?.disconnect()
  window.removeEventListener('resize', positionMenu)
  window.removeEventListener('blur', closeMenu)
})
</script>

<style scoped>
.desktop-status-footer{height:44px;display:flex;align-items:center;gap:5px;padding:3px 8px;background:var(--bg2);color:var(--text);box-sizing:border-box;border-top:1px solid var(--border)}
button{font:inherit;color:inherit;border:0;cursor:pointer;background:transparent;min-width:0}button:focus-visible{outline:2px solid var(--orange);outline-offset:-2px}button:disabled{opacity:.55;cursor:default}
.account-trigger{display:flex;align-items:center;gap:8px;flex:1;height:36px;padding:3px 5px;border-radius:9px;text-align:left;transition:background .15s}
.account-trigger:hover,.account-trigger.active{background:var(--bg3)}
.account-avatar{width:28px;height:28px;flex:none;display:grid;place-items:center;border-radius:50%;background:var(--bg4);color:var(--text2);font-size:13px;font-weight:600;border:1px solid var(--border)}
.account-avatar.large{width:28px;height:28px;font-size:13px}.account-copy{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}.account-copy strong{font-size:12px;font-weight:550;color:var(--text);line-height:15px}.account-copy small{font-size:10px;color:var(--text3);line-height:13px}.account-copy strong,.account-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.account-chevron{color:var(--text3);flex:none}
.health-pair{display:flex;gap:4px;flex:none}i{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--text3);flex:none}i.on{background:var(--green)}i.error{background:var(--red)}i.pending{background:var(--yellow)}i.idle{background:var(--text3);opacity:.55}
.update-shortcut{width:28px;height:30px;border-radius:8px;display:grid;place-items:center;flex:none;background:var(--orange-bg);color:var(--orange-text)}.update-shortcut:hover{background:var(--bg4)}
.collapsed{padding:3px;gap:2px;flex-wrap:nowrap}.collapsed .account-trigger{justify-content:center;padding:3px;position:relative;min-width:32px}.collapsed .health-pair{position:absolute;bottom:2px;right:2px;border-radius:8px;background:var(--bg2);padding:2px;gap:2px}.collapsed .health-pair i{width:4px;height:4px}.collapsed .update-shortcut{width:23px}.collapsed-update-dot{position:absolute;top:1px;right:3px;width:5px;height:5px;border-radius:50%;background:var(--orange);border:1px solid var(--bg2)}
.account-menu{position:fixed;inset:auto;margin:0;box-sizing:border-box;padding:5px;border:1px solid color-mix(in srgb,var(--text) 12%,transparent);border-radius:12px;background:color-mix(in srgb,var(--bg2) 78%,transparent);color:var(--text);backdrop-filter:blur(24px) saturate(135%);-webkit-backdrop-filter:blur(24px) saturate(135%);box-shadow:0 12px 32px rgb(0 0 0 / .22),0 2px 6px rgb(0 0 0 / .12),inset 0 1px 0 color-mix(in srgb,var(--text) 5%,transparent);overflow-y:auto;overscroll-behavior:contain;font-family:inherit}
.account-menu:popover-open{animation:account-menu-in .14s ease-out}.account-menu::backdrop{background:transparent;pointer-events:none}
.menu-identity{display:flex;align-items:center;gap:8px;width:100%;padding:6px 7px;border-radius:7px;text-align:left}.menu-identity .account-copy strong{font-size:12px;line-height:16px}.menu-identity .account-copy small{font-size:10px;line-height:14px}.menu-identity>svg{color:var(--text3);flex:none}
.menu-divider{height:1px;background:var(--border);margin:4px 7px}.menu-row{display:flex;align-items:center;gap:8px;min-height:30px;width:100%;border-radius:6px;padding:5px 7px;text-align:left;font-size:12px;line-height:20px}.menu-row>svg{flex:none;color:var(--text2)}.menu-row:hover,.menu-identity:hover{background:var(--bg3)}.row-tail{margin-left:auto;color:var(--text3);font-size:11px;min-width:0}.update-label{max-width:110px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.service-value{display:flex;align-items:center;gap:6px}.service-value i{width:6px;height:6px}.tone-available .update-label,.tone-downloading .update-label{color:var(--orange-text)}.tone-ready .update-label{color:var(--green)}.tone-error .update-label{color:var(--red)}.logout-note,.account-error{font-size:12px;line-height:1.6;margin:8px 10px;color:var(--text2)}.account-error{color:var(--red)}
@keyframes account-menu-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
@media(prefers-reduced-motion:reduce){.account-menu:popover-open{animation:none}.account-trigger{transition:none}}
</style>
