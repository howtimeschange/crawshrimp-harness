<template>
  <button ref="trigger" class="menu-trigger" type="button" :aria-label="label" :title="label" aria-haspopup="menu" :aria-expanded="opened" @click="toggle" @keydown.down.prevent="show">⋯</button>
  <div ref="menu" class="resource-menu" popover="auto" role="menu" :aria-label="label" @toggle="onToggle" @click="onAction" @keydown="onKeydown">
    <slot />
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
defineProps({ label: { type: String, required: true } })
const trigger = ref(null), menu = ref(null), opened = ref(false)
function hide() { menu.value?.hidePopover() }
function show() {
  const rect = trigger.value.getBoundingClientRect()
  menu.value.showPopover()
  const box = menu.value.getBoundingClientRect()
  const left = Math.max(8, Math.min(window.innerWidth - box.width - 8, rect.right - box.width))
  const top = rect.bottom + box.height + 8 > window.innerHeight ? Math.max(8, rect.top - box.height - 4) : rect.bottom + 4
  Object.assign(menu.value.style, { left: `${left}px`, top: `${top}px` })
  menu.value.querySelector('button')?.focus()
}
function toggle() { if (opened.value) hide(); else show() }
function onToggle(event) { opened.value = event.newState === 'open' }
function onAction(event) { if (event.target.closest('button')) { hide(); trigger.value?.focus() } }
function onKeydown(event) {
  if (event.key === 'Escape') { hide(); trigger.value?.focus(); return }
  if (event.key === 'Tab') { hide(); return }
  const buttons = [...menu.value.querySelectorAll('button:not(:disabled)')]
  const index = buttons.indexOf(document.activeElement)
  const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length
    : event.key === 'ArrowUp' ? (index - 1 + buttons.length) % buttons.length
    : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1
  if (next >= 0) { event.preventDefault(); buttons[next]?.focus() }
}
function onScroll(event) { if (!menu.value?.contains(event.target)) hide() }
onMounted(() => { window.addEventListener('resize', hide); window.addEventListener('scroll', onScroll, true) })
onUnmounted(() => { window.removeEventListener('resize', hide); window.removeEventListener('scroll', onScroll, true) })
</script>

<style scoped>
.menu-trigger{flex:none;width:26px;height:26px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--text3);font-family:inherit;font-size:16px;line-height:1;cursor:pointer}
.menu-trigger:hover,.menu-trigger[aria-expanded=true]{background:color-mix(in srgb,var(--text3) 12%,transparent);color:var(--text)}
.menu-trigger:focus-visible{outline:2px solid var(--orange,#ff6b2b);outline-offset:1px}
.resource-menu{position:fixed;inset:auto;margin:0;min-width:160px;max-width:calc(100vw - 16px);padding:5px;border:1px solid var(--border);border-radius:9px;background:var(--bg2);color:var(--text);box-shadow:0 8px 24px #0002;font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.resource-menu::backdrop{background:transparent}
.resource-menu :slotted(button){display:block;width:100%;padding:8px 10px;border:0;border-radius:5px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}
.resource-menu :slotted(button:hover),.resource-menu :slotted(button:focus-visible){background:var(--bg);outline:none}
.menu-trigger{position:relative;isolation:isolate;opacity:.65;transition:opacity 120ms ease,transform 160ms cubic-bezier(.23,1,.32,1)}
.menu-trigger::before{content:"";position:absolute;inset:0;border-radius:inherit;z-index:-1;background:color-mix(in srgb,var(--text) 12%,transparent);opacity:0;transition:opacity 120ms ease;pointer-events:none}
.menu-trigger[aria-expanded=true],.menu-trigger:focus-visible{opacity:1}.menu-trigger[aria-expanded=true]::before,.menu-trigger:focus-visible::before{opacity:1}
.menu-trigger:hover,.menu-trigger[aria-expanded=true]{background:transparent}
@media(hover:hover) and (pointer:fine){.menu-trigger:hover{opacity:1}.menu-trigger:hover::before{opacity:1}.menu-trigger:active:not(:focus-visible){transform:scale(.97)}}
@media(prefers-reduced-motion:reduce){.menu-trigger{transition:opacity 120ms ease}.menu-trigger:active{transform:none}}
</style>
