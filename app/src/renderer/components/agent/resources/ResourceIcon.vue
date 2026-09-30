<template>
  <svg class="resource-file-icon" :style="{ color: tone }" width="18" height="20" viewBox="0 0 20 22" aria-hidden="true">
    <template v-if="browser"><circle cx="10" cy="11" r="8" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 11h16M10 3c-5 4-5 12 0 16M10 3c5 4 5 12 0 16" fill="none" stroke="currentColor" stroke-width="1.2"/></template>
    <template v-else><path d="M4 1h8l5 5v13a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2Z" fill="currentColor"/><path d="M12 1v4a1 1 0 0 0 1 1h4" fill="#fff" opacity=".35"/>
      <template v-if="image"><circle cx="7" cy="9" r="1.4" fill="white"/><path d="m4 17 4-5 2 2 2-3 3 6Z" fill="white"/></template>
      <text v-else x="9.5" y="16" text-anchor="middle" fill="white" :font-size="label.length > 2 ? 5.5 : 7" font-family="system-ui,sans-serif" font-weight="750">{{ label }}</text>
    </template>
  </svg>
</template>
<script setup>
import { computed } from 'vue'
const props = defineProps({ item: { type: Object, required: true } })
const browser = computed(() => props.item.kind === 'browser')
const ext = computed(() => String(props.item.filename || props.item.path || '').split('.').pop().toLowerCase())
const image = computed(() => /^(png|jpg|jpeg|gif|svg|webp|bmp)$/.test(ext.value))
const family = computed(() => /^(csv|tsv|xls|xlsx|ods)$/.test(ext.value) ? 'sheet' : /^(ppt|pptx|odp)$/.test(ext.value) ? 'slides' : /^(zip|tar|gz|7z)$/.test(ext.value) ? 'archive' : /^(mp3|wav|ogg|m4a|mp4|webm|mov)$/.test(ext.value) ? 'media' : 'text')
const tone = computed(() => browser.value ? 'var(--text2)' : image.value ? '#9472dd' : ext.value === 'pdf' ? '#d76465' : ({sheet:'#4eaa70',slides:'#dd8c50',archive:'#a58b63',media:'#aa6bb6',text:'#6388d8'})[family.value])
const label = computed(() => ({sheet:'X',slides:'P',archive:'ZIP',media:'▶'})[family.value] || (ext.value === 'pdf' ? 'PDF' : /^(md|markdown)$/.test(ext.value) ? 'MD' : /^(doc|docx)$/.test(ext.value) ? 'W' : /^(js|ts|py|json|html|css|vue|sh)$/.test(ext.value) ? '</>' : 'TXT'))
</script>
<style scoped>.resource-file-icon{flex:none;vertical-align:middle}</style>
