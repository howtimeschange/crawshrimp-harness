<template>
  <section class="usage-panel" aria-labelledby="usage-title">
    <header><div><h2 id="usage-title">套餐与用量</h2><p>查看官方模型服务的额度与使用情况。</p></div><button :disabled="loading" @click="refresh">{{ loading ? '更新中…' : '刷新' }}</button></header>
    <p v-if="error" class="error" role="alert">{{ error }} <button @click="refresh">重试</button></p>
    <div v-if="loading && !state" class="empty" role="status">正在读取套餐与用量…</div>
    <div v-else-if="!state?.user" class="empty"><h3>登录后查看官方服务用量</h3><p>自带 API Key 的用量，请前往对应模型服务商查看。</p><button @click="action('login')">登录账号</button></div>
    <template v-else>
      <section class="usage-section"><h3>当前套餐</h3><div class="plan-card"><div><span class="eyebrow">抓虾官方服务</span><strong>{{ planName }}</strong><span>{{ state.user.name || state.user.email }}</span></div><button @click="action('plans')">查看套餐 ↗</button></div></section>
      <section class="usage-section"><div class="section-heading"><h3>官方服务额度</h3><span v-if="view.asOf">更新于 {{ view.asOf }}</span></div><p>文字与图片模型共享此服务额度，按实际调用结算。</p>
        <div class="quota-card"><div class="quota-heading"><div><span>可用额度</span><strong>{{ view.remaining }}</strong></div><span v-if="view.percent !== null" class="remaining">剩余 {{ Math.round(view.percent) }}%</span></div>
          <div v-if="view.percent !== null" class="meter" role="progressbar" aria-label="官方服务剩余额度" :aria-valuenow="Math.round(view.percent)" aria-valuemin="0" aria-valuemax="100"><i :style="{width:view.percent+'%'}" :class="{low:view.percent<20}"></i></div>
          <p class="quota-note">{{ view.expires ? '额度有效期至 '+view.expires : '当前未提供额度到期或重置时间' }}</p>
          <div class="metrics"><div><span>累计已用</span><strong>{{ view.used }}</strong></div><div><span>服务额度上限</span><strong>{{ view.total }}</strong></div></div>
        </div>
        <p class="footnote">此处展示官方服务 Key 的额度，不等同于账户总余额。未设 Key 上限时，仍受账户余额及套餐规则限制。</p>
      </section>
      <section class="usage-section details"><h3>用量说明</h3><div><strong>官方模型</strong><p>生文、生图共用额度；不同模型的单价以套餐与价格页面为准。</p></div><div><strong>自带 API Key</strong><p>由你配置的服务商独立计费，不计入此看板。</p></div><div><strong>用量历史</strong><p>当前接口提供累计用量，暂未提供按日明细和周期重置数据。</p></div></section>
    </template>
  </section>
</template>
<script setup>
import {ref,computed,onMounted,onBeforeUnmount} from 'vue'
import {usageView} from '../utils/managedUsage.mjs'
const state=ref(null),usage=ref(null),loading=ref(false),error=ref('')
const view=computed(()=>usageView(usage.value))
const planName=computed(()=>({free:'Free',plus:'Plus',pro:'Pro'}[state.value?.plan]||'官方服务'))
let epoch=0,unsubscribe
async function refresh(){const current=++epoch;loading.value=true;error.value='';usage.value=null;try{if(!window.cs?.accountAction)throw Error('请在抓虾桌面客户端中查看用量');const next=await window.cs.accountAction('status');if(current!==epoch)return;state.value=next;if(next.user){const result=await window.cs.accountAction('usage');if(current===epoch)usage.value=result}}catch(e){if(current===epoch)error.value=String(e.message||'读取用量失败').replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'')}finally{if(current===epoch)loading.value=false}}
async function action(name){try{await window.cs.accountAction(name);if(name==='login')await refresh()}catch(e){error.value=e.message||'操作失败，请重试'}}
onMounted(()=>{refresh();unsubscribe=window.cs?.onAccountChanged?.(()=>{state.value=null;refresh()})})
onBeforeUnmount(()=>{epoch++;unsubscribe?.()})
</script>
<style scoped>
.usage-panel{width:min(100%,780px);padding:8px 0 40px;color:var(--text)}header,.section-heading,.plan-card,.quota-heading{display:flex;align-items:center;justify-content:space-between;gap:20px}h2{font-size:26px;letter-spacing:-.6px;margin:0 0 8px;font-weight:600}p{font-size:13px;line-height:1.7;color:var(--text3);margin:7px 0}button{font:inherit;font-size:12px;border:1px solid var(--border);border-radius:8px;background:var(--bg3);color:var(--text);padding:9px 13px;cursor:pointer;white-space:nowrap}button:hover{background:var(--bg4)}button:disabled{opacity:.5}button:focus-visible{outline:2px solid var(--orange);outline-offset:3px}.usage-section{margin-top:36px}h3{font-size:14px;font-weight:600;margin:0 0 12px}.plan-card,.quota-card{border:1px solid var(--border);background:var(--bg2);border-radius:14px;padding:22px}.plan-card>div{display:grid;gap:7px}.plan-card strong{font-size:22px;font-weight:550}.plan-card span,.section-heading>span{font-size:12px;color:var(--text3)}.plan-card .eyebrow{font-size:11px}.section-heading h3{margin-bottom:0}.quota-card{margin-top:16px}.quota-heading>div{display:grid;gap:8px}.quota-heading span{font-size:12px;color:var(--text2)}.quota-heading strong{font-size:30px;font-weight:550;letter-spacing:-.8px;font-variant-numeric:tabular-nums}.quota-heading .remaining{font-size:13px}.meter{height:6px;background:var(--bg4);border-radius:6px;overflow:hidden;margin:22px 0 12px}.meter i{display:block;height:100%;background:var(--text);border-radius:6px}.meter i.low{background:var(--orange)}.quota-note{font-size:12px}.metrics{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--border);margin-top:20px;padding-top:20px;gap:20px}.metrics>div{display:grid;gap:9px}.metrics span{font-size:12px;color:var(--text3)}.metrics strong{font-size:18px;font-weight:500;font-variant-numeric:tabular-nums}.footnote{font-size:11px;margin-top:12px}.details>div{padding:15px 0;border-bottom:1px solid var(--border)}.details strong{font-size:13px;font-weight:500}.details p{margin-bottom:0}.error{color:var(--red);padding:14px;background:var(--bg2);border-radius:10px}.empty{padding:48px 20px;text-align:center;border:1px solid var(--border);border-radius:14px;margin-top:32px}.empty button{margin-top:14px}@media(max-width:560px){h2{font-size:22px}.plan-card,.quota-card{padding:18px}.quota-heading strong{font-size:25px}.section-heading{align-items:flex-start;gap:8px;flex-direction:column}.usage-section{margin-top:28px}}
</style>
