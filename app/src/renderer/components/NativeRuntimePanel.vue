<template>
  <section class="native-runtime-panel" aria-labelledby="runtime-panel-title">
    <header class="runtime-header"><h3 id="runtime-panel-title">插件</h3><p>查看已安装插件，管理智能体的扩展能力。</p></header>
    <div v-if="error" class="runtime-state" role="alert"><IconPuzzle :size="28" :stroke="1.5" /><h4>暂时无法加载插件</h4><p>{{ error }}</p><button type="button" @click="load">重新加载</button></div>
    <div v-else-if="!url" class="runtime-state" role="status"><p>正在加载插件…</p></div>
    <iframe v-if="url" :src="url" title="插件管理" @load="syncTheme" ref="frame" />
  </section>
</template>
<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { IconPuzzle } from '@tabler/icons-vue'
const props = defineProps({ panel: { type: String, required: true }, theme: { type: String, default: 'dark' }, themePreference: { type: String, default: 'system' } })
const url = ref(''), error = ref(''), frame = ref(null)
let alive = true
async function load() { error.value = ''; try { const runtime = await window.cs.agentApi('GET', '/agent/runtime'); if (!alive) return; if (!runtime.web_origin || runtime.state !== 'ready') throw Error('请先启动智能体运行时。'); const target = new URL(runtime.web_origin); target.searchParams.set('csPanel', props.panel); target.searchParams.set('csRuntimeGeneration', runtime.generation); url.value = target.href } catch (e) { if (alive) error.value = e.message || '加载失败' } }
function syncTheme() { if (url.value) frame.value?.contentWindow?.postMessage({ __crawshrimp: 'theme', theme: props.theme, skin: props.themePreference === 'lake' ? 'lake' : 'default' }, new URL(url.value).origin) }
function onMessage(event) { if (url.value && event.source === frame.value?.contentWindow && event.origin === new URL(url.value).origin && event.data?.__crawshrimp === 'workspace-ready') syncTheme() }
watch(() => [props.theme, props.themePreference], syncTheme)
onMounted(() => { window.addEventListener('message', onMessage); void load() }); onBeforeUnmount(() => { alive = false; window.removeEventListener('message', onMessage) })
</script>
<style scoped>
.native-runtime-panel { width: 100%; height: calc(100dvh - 160px); min-height: 0; display: flex; flex-direction: column; color: var(--text); }
.runtime-header { margin-bottom: 28px; }
h3 { margin: 0; font-size: 24px; line-height: 1.3; font-weight: 600; }
p { color: var(--text2); font-size: 13px; line-height: 1.65; margin: 8px 0 0; }
iframe { display: block; border: 1px solid var(--border); border-radius: 10px; width: 100%; height: 100%; min-height: 0; flex: 1; background: var(--bg); }
.runtime-state { display: flex; align-items: center; justify-content: center; flex-direction: column; padding: 40px 24px; min-height: 280px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg2); text-align: center; }
.runtime-state > svg { color: var(--text2); margin-bottom: 16px; }
h4 { font-size: 14px; font-weight: 550; margin: 0; }
button { margin-top: 20px; min-height: 36px; padding: 8px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg3); color: var(--text); font: inherit; font-size: 12px; cursor: pointer; }
button:hover { background: var(--bg4); }
button:focus-visible { outline: 2px solid var(--orange); outline-offset: 3px; }
</style>
