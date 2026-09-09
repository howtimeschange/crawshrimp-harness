<template>
  <div class="desktop-status-footer" :class="{ collapsed }" aria-label="服务状态与更新">
    <button class="settings-entry" :title="collapsed ? `设置 · ${serviceTitle}` : '设置'" aria-label="设置" @click="$emit('settings')"><IconSettings :size="16" :stroke-width="1.7"/><span v-if="!collapsed">设置</span><i v-else class="collapsed-health" :class="status.api ? 'on' : 'error'"></i></button>
    <button v-if="!collapsed" class="service-status" :title="serviceTitle" :aria-label="serviceTitle" @click="$emit('services')">
      <span class="service"><i :class="status.api ? 'on' : 'error'"></i><span v-if="!collapsed">核心</span></span>
      <span class="service"><i :class="status.chrome ? 'on' : browserError ? 'error' : 'idle'"></i><span v-if="!collapsed">{{ status.chrome ? '浏览器' : browserError ? '浏览器异常' : '按需启动' }}</span></span>
    </button>
    <button v-if="!collapsed || presentation.action || presentation.tone === 'downloading'" class="update-status" :class="`tone-${presentation.tone}`" :title="presentation.title" :aria-label="presentation.title" :disabled="busy || presentation.tone === 'downloading' || presentation.tone === 'installing'" @click="$emit('update')">
      <UpdateProgressRing v-if="presentation.tone === 'downloading'" compact :percent="presentation.percent || 0" />
      <span v-else-if="collapsed">{{ presentation.icon }}</span>
      <span v-if="!collapsed">{{ presentation.action || presentation.tone === 'downloading' ? presentation.label : presentation.versionLabel }}</span>
    </button>
  </div>
</template>
<script setup>
import { computed } from 'vue'
import { IconSettings } from '@tabler/icons-vue'
import UpdateProgressRing from './UpdateProgressRing.vue'
const props = defineProps({ status: { type: Object, default: () => ({}) }, presentation: { type: Object, default: () => ({}) }, busy: Boolean, collapsed: Boolean })
defineEmits(['settings', 'services', 'update'])
const browserError = computed(() => !props.status.chrome && ['occupied-non-cdp', 'invalid-cdp'].includes(props.status.chromeDiagnostic?.kind))
const serviceTitle = computed(() => `核心${props.status.api ? '运行中' : '未连接'} · 浏览器${props.status.chrome ? '已连接' : browserError.value ? '连接异常' : '按需启动'}，点击查看服务状态`)
</script>
<style scoped>
.desktop-status-footer{height:44px;display:flex;align-items:center;justify-content:space-between;gap:4px;padding:0 12px;border-top:1px solid var(--border);background:var(--bg2);color:var(--text3);font-size:10px;box-sizing:border-box}
button{font:inherit;color:inherit;background:none;border:0;border-radius:4px;padding:4px 2px;cursor:pointer;min-width:0}button:hover{color:var(--text);background:var(--bg3)}button:focus-visible{outline:2px solid var(--orange)}button:disabled{cursor:default}
.settings-entry{display:flex;align-items:center;gap:6px;position:relative;font-size:12px;color:var(--text2);flex:none}.service-status,.service{display:flex;align-items:center;gap:5px}.service-status{gap:7px;flex:none}.service i{width:5px;height:5px;border-radius:50%;background:var(--text3)}.service i.on{background:var(--green)}.service i.error{background:var(--red)}.service i.idle{background:var(--text3);opacity:.65}
.update-status{display:flex;align-items:center;gap:3px;overflow:hidden}.update-status>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tone-available,.tone-downloading{color:var(--orange-text)}.tone-ready{color:var(--green)}.tone-error{color:var(--red)}
.collapsed{padding:0 5px;justify-content:center;gap:4px}.collapsed .settings-entry{padding:5px}.collapsed-health{position:absolute;right:1px;bottom:2px;width:4px;height:4px;border-radius:50%}.collapsed-health.on{background:var(--green)}.collapsed-health.error{background:var(--red)}
</style>
