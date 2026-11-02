<template>
  <section class="personal-activity" :aria-labelledby="headingId" :aria-busy="loading">
    <header><div><h3 :id="headingId">使用概览</h3><p>最近 14 天 · 此设备</p></div><button @click="load" :disabled="loading" aria-label="刷新使用统计"><IconRefresh :size="15" /><span>{{ loading ? '更新中' : '刷新' }}</span></button></header>
    <div v-if="loading && !summary" class="activity-placeholder" role="status">正在读取使用记录…</div>
    <div v-else-if="error && !summary" class="activity-unavailable" role="alert"><IconChartBar :size="24" :stroke-width="1.5" /><strong>暂时无法读取使用记录</strong><p>请确认核心服务已启动，然后点击刷新。</p></div>
    <template v-if="summary">
      <dl><div><dt><IconMessageCircle :size="15" />发起会话</dt><dd>{{ summary.sessions.toLocaleString() }}<span>次</span></dd></div><div><dt><IconCpu :size="15" />智能体运行</dt><dd>{{ summary.runs.toLocaleString() }}<span>次</span></dd></div><div><dt><IconCircleCheck :size="15" />完成运行</dt><dd>{{ summary.completed.toLocaleString() }}<span>次</span></dd></div></dl>
      <div class="activity-history"><div class="chart-caption"><span>每日运行</span><span>{{ summary.runs ? `峰值 ${maximum} 次 / 天` : '开始一次对话，记录你的第一次运行' }}</span></div>
      <div class="activity-bars" role="img" :aria-label="`近14天共运行${summary.runs}次，完成${summary.completed}次；按UTC日期统计`"><div v-for="day in summary.days" :key="day.day" class="activity-day" :title="`${day.day}：${day.runs} 次运行，完成 ${day.completed} 次`"><i :style="{height: `${day.runs ? Math.max(4, day.runs / maximum * 100) : 2}%`}" :class="{empty: !day.runs}"></i></div></div>
      <div class="chart-axis"><span>{{ summary.days[0]?.day.slice(5).replace('-', '/') }}</span><span>UTC · {{ summary.days.at(-1)?.day.slice(5).replace('-', '/') }}</span></div>
      </div>
      <p v-if="error" class="activity-note" role="alert">刷新失败，当前显示上次读取的数据。</p>
      <p class="activity-note">仅统计此设备的运行记录。消费与剩余额度见「套餐与用量」。</p>
    </template>
  </section>
</template>
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, useId } from 'vue'
import { IconRefresh, IconChartBar, IconMessageCircle, IconCpu, IconCircleCheck } from '@tabler/icons-vue'
const headingId = `activity-${useId()}`
const summary = ref(null), loading = ref(false), error = ref('')
let alive = true
const maximum = computed(() => Math.max(1, ...(summary.value?.days || []).map(day => day.runs)))
async function load() {
  if (loading.value) return
  loading.value = true; error.value = ''
  try { const data = await window.cs.agentApi('GET', '/agent/usage/activity'); if (alive) summary.value = data }
  catch { if (alive) error.value = '使用统计暂不可用' }
  finally { if (alive) loading.value = false }
}
onMounted(load)
onBeforeUnmount(() => { alive = false })
</script>
<style scoped>
.personal-activity { margin-top: 28px; color: var(--text); padding: 20px 24px; background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; container-type: inline-size; }
header { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
h3 { font-size: 14px; font-weight: 600; margin: 0 0 5px; }
p { margin: 0; font-size: 12px; color: var(--text2); line-height: 1.6; }
button { display: flex; align-items: center; gap: 6px; border: 0; border-radius: 8px; background: transparent; color: var(--text2); padding: 8px; cursor: pointer; font: inherit; font-size: 12px; }
button:hover { background: var(--bg3); }
button:disabled { opacity: .5; cursor: wait; }
button:focus-visible { outline: 2px solid var(--orange); outline-offset: 3px; }
dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 20px 0; gap: 20px; }
dl > div + div { border-left: 1px solid var(--border); padding-left: 24px; }
dt { font-size: 12px; color: var(--text2); }
dd { font-size: 22px; font-weight: 550; margin: 8px 0 0; font-variant-numeric: tabular-nums; }
dd span { font-size: 12px; font-weight: 400; color: var(--text2); margin-left: 6px; }
.activity-history { border-top: 1px solid var(--border); padding-top: 14px; }
.chart-caption, .chart-axis { display: flex; justify-content: space-between; gap: 16px; font-size: 12px; color: var(--text2); }
.chart-caption { margin: 0 0 14px; }
.activity-bars { height: 80px; display: flex; gap: 10px; align-items: end; border-bottom: 1px solid var(--border); }
.activity-day { height: 100%; flex: 1; display: flex; align-items: center; justify-content: end; flex-direction: column; }
.activity-day i { width: 100%; max-width: 24px; border-radius: 3px 3px 0 0; background: var(--orange-text); }
.activity-day i.empty { background: var(--border); }
.chart-axis { margin-top: 9px; font-variant-numeric: tabular-nums; }
.activity-note { margin-top: 14px; font-size: 12px; line-height: 1.7; }
.activity-placeholder, .activity-unavailable { min-height: 110px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; font-size: 13px; color: var(--text2); }
.activity-unavailable strong { font-size: 13px; font-weight: 500; color: var(--text); }
@container (max-width: 460px) {
  dl { gap: 12px; }
  dl > div + div { padding-left: 12px; }
  dd { font-size: 20px; }
  .activity-bars { gap: 6px; }
  .chart-caption { flex-wrap: wrap; }
}
</style>

<style scoped>
.personal-activity { padding: 24px 28px; border-radius: 14px; }
.personal-activity header h3 { font-size: 15px; font-weight: 650; }
.personal-activity dl { margin: 24px 0; }
.personal-activity dt { display: flex; align-items: center; gap: 7px; }
.personal-activity dt svg { color: var(--orange-text); }
.personal-activity dd { font-size: 28px; letter-spacing: -.5px; margin-top: 10px; }
.personal-activity .activity-bars { height: 96px; }
.personal-activity .activity-day i { max-width: 26px; }
@container (max-width: 460px) { .personal-activity dd { font-size: 24px; } .personal-activity dt { font-size: 11px; gap: 5px; } }
</style>
