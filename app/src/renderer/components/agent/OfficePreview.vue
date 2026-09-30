<template>
  <div class="office-preview">
    <p class="office-status" role="status">{{ status }}</p>
    <OfficePagePreview :active="active" v-for="(item, index) in pages" :key="`${item.path}:${office.revision || ''}:${revision || 0}`" :item="item" :number="index + 1" :revision="`${office.revision || ''}:${revision || 0}`" />
    <p v-if="!pages.length">文档正在制作，尚未生成逐页预览。这不代表文件为空，可点击上方按钮打开原件。</p>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import OfficePagePreview from './resources/OfficePagePreview.vue'
const props = defineProps({ active: {type:Boolean,default:true}, office: { type: Object, required: true }, path: { type: String, default: '' }, revision: Number })
const pages = computed(() => props.office.pages || [])
const status = computed(() => {
  const visual = props.office.visual
  const count = visual?.reviewed?.length || 0
  if (visual?.status === 'passed') return `已完成 ${count} 页视觉检查`
  if (visual?.status === 'issues') return '视觉检查发现问题，请查看会话中的检查结果'
  if (visual?.status === 'partial') return `已检查 ${count} / ${pages.value.length} 页，部分页面待检查`
  return pages.value.length ? '已生成预览，视觉检查尚未完成' : '等待生成预览'
})
</script>

<style scoped>
.office-status{font-size:12px;color:var(--text3);line-height:1.6;margin:10px 2px}img{display:block;max-width:100%;height:auto;margin:12px auto;box-shadow:0 1px 8px #0002}
</style>
