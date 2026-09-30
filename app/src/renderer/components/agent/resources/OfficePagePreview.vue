<template>
  <section ref="host" class="office-page" :style="{ aspectRatio: `${item.width || 595} / ${item.height || 842}` }" :data-page="number" :aria-label="`文档第 ${number} 页`">
    <img v-if="url && visible && active" :src="url" :alt="`文档第 ${number} 页`" decoding="async" @error="error = '预览文件无法加载，请重新生成预览。'" />
    <p v-if="error" role="alert">{{ error }}</p><span v-else-if="!url">第 {{ number }} 页</span>
  </section>
</template>
<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
const props = defineProps({active:{type:Boolean,default:true},item:Object,number:Number,revision:[String,Number]})
const host = ref(null), visible = ref(false), url = ref(''), error = ref('')
let observer, generation = 0
watch([visible, () => props.active, () => props.item.path, () => props.revision], async () => {
  const token = ++generation; url.value = ''; error.value = ''
  if (!props.active || !visible.value) return
  try { const media = await window.cs.agentMediaUrl(props.item.path,null); if (token !== generation) return; const fresh = new URL(media);fresh.searchParams.set('_preview',String(props.revision || '0'));url.value=fresh.href }
  catch(e) { if (token === generation) error.value = `预览失败：${e.message}` }
})
onMounted(() => { observer = new IntersectionObserver(entries=>{visible.value=entries[0].isIntersecting},{root:host.value.closest('.preview-content'),rootMargin:'600px 0px'});observer.observe(host.value) })
onUnmounted(() => { generation++;observer?.disconnect() })
</script>
<style scoped>
.office-page{position:relative;width:100%;margin:12px auto;background:#fff;box-shadow:0 1px 8px #0002;overflow:hidden}.office-page img{display:block;width:100%;height:auto}.office-page>span,.office-page>p{position:absolute;top:20px;left:20px;color:#777;font-size:12px}.office-page>p{color:#b34e4e}
</style>
