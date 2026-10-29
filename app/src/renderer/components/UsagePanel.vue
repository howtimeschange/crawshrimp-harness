<template>
  <section class="usage-panel" aria-labelledby="usage-title" :aria-busy="loading">
    <header class="usage-header">
      <div><h2 id="usage-title">套餐与用量</h2><p>查看官方模型额度与订阅账期。</p></div>
      <button class="refresh-button" :disabled="loading" @click="refresh" aria-label="刷新套餐与用量"><IconRefresh :size="16" :stroke="1.6" :class="{ refreshing: loading }" /><span>{{ loading ? '更新中' : '刷新' }}</span></button>
    </header>
    <div v-if="error" class="usage-error" role="alert">
      <IconAlertCircle :size="17" /><div>{{ error }}<small v-if="view.available && readError">更新失败，显示上次读取的额度<span v-if="view.asOf"> · {{ view.asOf }}</span></small></div>
      <button :disabled="loading" @click="refresh">重试</button>
    </div>
    <div v-if="!state && loading" class="usage-loading" role="status"><span>正在读取套餐与用量…</span><div class="loading-line"></div><div class="loading-line short"></div></div>
    <div v-else-if="!state && error" class="usage-empty"><IconAlertCircle :size="24" :stroke="1.5" /><h3>暂时无法读取账号信息</h3><p>请检查连接后，重新刷新。</p></div>
    <div v-else-if="!state?.user" class="usage-empty">
      <IconUser :size="24" :stroke="1.5" /><h3>{{ state?.pending ? '在浏览器中完成登录' : '登录后查看额度' }}</h3>
      <p>订阅额度与永久额度，在手机和电脑间共用。<br>自带 API Key 由对应服务商独立计费。</p>
      <button class="primary-button" :disabled="actionBusy" @click="action(state?.pending ? 'reopen' : 'login')">{{ state?.pending ? '打开登录页' : '登录账号' }}<IconArrowUpRight :size="15" /></button>
      <button v-if="state?.pending" :disabled="actionBusy" @click="action('cancel')">取消登录</button>
    </div>
    <template v-else>
      <section class="usage-section" aria-labelledby="membership-title">
        <h3 id="membership-title">当前会员</h3>
        <div class="plan-row">
          <span class="plan-mark" aria-hidden="true"><CrawshrimpMembershipMark :plan="view.plan" :size="44" /></span><div class="plan-identity"><strong>抓虾 {{ planName }}</strong><p>{{ state.user.name || state.user.email || '当前账号' }}</p></div>
          <div class="plan-status"><span>{{ view.membership }}</span><p v-if="view.membershipStatus">{{ view.membershipStatus }}</p></div>
          <button :disabled="actionBusy" @click="action('plans')">查看或管理套餐<IconArrowUpRight :size="15" :stroke="1.6" /></button>
        </div>
        <p v-if="view.membershipNote" class="subscription-note">{{ view.membershipNote }}</p>
        <p v-if="subscriptionError" class="subscription-note" role="status">{{ subscriptionError }}</p>
      </section>
      <section class="usage-section" aria-labelledby="allowance-title">
        <div class="section-heading"><h3 id="allowance-title">额度使用</h3><span v-if="loading" role="status">正在刷新额度…</span><span v-else-if="view.asOf">更新于 {{ view.asOf }}</span></div>
        <div class="wallet">
          <div class="wallet-total"><span class="wallet-mark" aria-hidden="true"><IconWallet :size="23" /></span><div><span>{{ view.available && (readError || loading) ? '上次读取总额' : view.monthly.historical ? '待确认总额' : '当前可用总额' }}</span><p>订阅额度 + 永久额度</p></div><strong>{{ view.totalAvailable }}</strong></div>
          <div class="wallet-pools">
          <div v-for="pool in pools" :key="pool.id" class="pool" :class="{ 'pool-unavailable': !view.available }">
            <div class="pool-heading"><span :class="['pool-mark', pool.id]" aria-hidden="true"><IconClock v-if="pool.id === 'monthly'" :size="18" /><IconInfinity v-else :size="19" /></span><h4 :id="pool.id + '-title'">{{ pool.title }}</h4><div class="pool-amount"><span>{{ pool.historical ? '记录剩余' : '剩余' }}</span><strong>{{ pool.remaining }}</strong><span v-if="pool.id === 'monthly' && pool.hasTotal" class="pool-total">/ {{ pool.total }}</span></div></div>
            <div class="pool-caption"><span>{{ pool.id === 'monthly' ? pool.historical ? '上期记录 · 待刷新确认' : '按月更新 · 优先使用' : 'ModelJetty 充值、赠金与增量包' }}</span><span :class="{ 'expiry-warning': pool.expired }"><IconClock v-if="pool.id === 'monthly'" :size="14" :stroke="1.6" /><IconInfinity v-else :size="15" :stroke="1.6" /><template v-if="pool.id === 'monthly'"><span v-if="pool.expiresISO">{{ pool.expiryPrefix }} <time :datetime="pool.expiresISO">{{ pool.expiryText }}</time>{{ pool.expired ? ' 到期' : '' }}</span><span v-else>{{ pool.expiryText }}</span></template><span v-else>不会过期</span></span></div>
            <template v-if="pool.id === 'monthly'">
              <div v-if="pool.percent !== null" class="meter" role="progressbar" :aria-labelledby="pool.id + '-title'" :aria-valuenow="pool.percent" aria-valuemin="0" aria-valuemax="100" :aria-valuetext="pool.remaining + '，' + (pool.hasTotal ? '共 ' + pool.total : '暂无已发放额度')"><i class="subscription-fill" :class="{ historical: pool.historical }" :style="{ transform: 'scaleX(' + pool.percent / 100 + ')' }"></i></div>
              <div v-else class="meter meter-unknown" aria-hidden="true"></div>
              <div class="pool-detail"><p>{{ pool.detail }}</p><span v-if="view.available && pool.hasTotal">{{ pool.historical ? '上期' : '本期' }}已用 {{ pool.used }}</span></div>
            </template>
          </div>
          </div>
          <p v-if="view.hasReserved" class="reserved-note"><IconInfoCircle :size="15" :stroke="1.6" /><span>另有 {{ view.reserved }} 正在结算，已从可用额度中预留。</span></p>
          <p v-if="!view.available" class="unavailable-note" role="status">{{ loading ? '正在读取额度…' : '暂时无法读取额度，请刷新重试。' }}</p>
        </div>
        <p class="quota-footnote"><IconInfoCircle :size="15" :stroke="1.6" /><span>优先使用订阅额度，用完后使用永久额度。永久额度只显示当前剩余金额。</span></p>
      </section>
      <section class="usage-section billing-details" aria-labelledby="billing-title">
        <h3 id="billing-title">计费说明</h3>
        <dl><div><dt>官方模型</dt><dd>文字与图片共用以上额度，按实际调用结算。</dd></div><div><dt>订阅额度</dt><dd>按实际月订阅账期更新，到期后未用额度不结转。</dd></div><div><dt>永久额度</dt><dd>ModelJetty 充值金额及赠金、增量包余额，不会过期。</dd></div><div><dt>自带 API Key</dt><dd>由你配置的服务商独立结算，不计入这里的用量。</dd></div></dl>
      </section>
      <ManagedTextReceipts :key="state.user.id" />
    </template>
  </section>
</template>
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import CrawshrimpMembershipMark from './CrawshrimpMembershipMark.vue'
import ManagedTextReceipts from './ManagedTextReceipts.vue'
import { IconRefresh, IconArrowUpRight, IconInfoCircle, IconAlertCircle, IconUser, IconClock, IconInfinity, IconWallet } from '@tabler/icons-vue'
import { usageView, validateAllowance, validateSubscription } from '../utils/managedUsage.mjs'
const props = defineProps({ active: { type: Boolean, default: true } })
const state = ref(null), usage = ref(null), subscription = ref(null)
const loading = ref(false), error = ref(''), subscriptionError = ref(''), readError = ref(false), actionBusy = ref(false), now = ref(Date.now())
const view = computed(() => usageView(usage.value, { subscription: subscription.value, plan: state.value?.plan, now: now.value }))
const pools = computed(() => [
  { id: 'monthly', title: '订阅额度', ...view.value.monthly },
  { id: 'permanent', title: '永久额度', ...view.value.permanent },
])
const planName = computed(() => ({ free: 'Free', plus: 'Plus', pro: 'Pro' }[view.value.plan] || '官方服务'))
let epoch = 0, unsubscribe, clockTimer, lastLoaded = 0
const errorMessage = e => String(e?.message || '读取额度失败，请稍后重试').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
async function refresh() {
  if (loading.value) return
  const current = ++epoch
  loading.value = true; error.value = ''; readError.value = false; subscriptionError.value = ''; now.value = Date.now()
  try {
    if (!window.cs?.accountAction) throw Error('请在抓虾桌面客户端中查看用量')
    const next = await window.cs.accountAction('status')
    if (current !== epoch) return
    if (state.value?.user?.id !== next.user?.id || !next.user) { usage.value = null; subscription.value = null }
    state.value = next
    if (next.user) {
      const [walletResult, subscriptionResult] = await Promise.allSettled([
        window.cs.accountAction('allowance').then(validateAllowance),
        window.cs.accountAction('subscription').then(validateSubscription),
      ])
      if (current !== epoch) return
      // An unavailable subscription response is unknown, never an inactive subscription.
      subscription.value = subscriptionResult.status === 'fulfilled' ? subscriptionResult.value : null
      if (subscriptionResult.status === 'rejected') subscriptionError.value = '订阅状态暂不可用，账期以额度记录为准。'
      if (walletResult.status === 'rejected') throw walletResult.reason
      usage.value = walletResult.value
    }
    lastLoaded = Date.now()
  } catch (e) {
    if (current === epoch) { error.value = errorMessage(e); readError.value = true }
  } finally { if (current === epoch) loading.value = false }
}
async function action(name) {
  if (actionBusy.value) return
  actionBusy.value = true
  try { await window.cs.accountAction(name); if (['login', 'cancel'].includes(name)) await refresh() }
  catch (e) { error.value = errorMessage(e); readError.value = false }
  finally { actionBusy.value = false }
}
function invalidateAccount() {
  epoch++; loading.value = false; state.value = null; usage.value = null; subscription.value = null
  error.value = ''; readError.value = false; subscriptionError.value = ''; lastLoaded = 0
  if (props.active) void refresh()
}
onMounted(() => {
  if (props.active) void refresh()
  unsubscribe = window.cs?.onAccountChanged?.(invalidateAccount)
  clockTimer = setInterval(() => { if (props.active) now.value = Date.now() }, 30000)
})
watch(() => props.active, active => { if (active) { now.value = Date.now(); if (Date.now() - lastLoaded > 60000) void refresh() } })
onBeforeUnmount(() => { epoch++; unsubscribe?.(); clearInterval(clockTimer) })
</script>
<style scoped>
.usage-panel { container-type: inline-size; width: min(100%, var(--settings-page-width, 880px)); color: var(--text); padding-bottom: 24px; }
.usage-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 32px; }
h2 { font-size: 24px; line-height: 1.3; letter-spacing: -.5px; font-weight: 600; margin: 0 0 10px; }
p { font-size: 13px; line-height: 1.65; color: var(--text2); margin: 0; text-wrap: pretty; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 34px; border: 1px solid var(--border); border-radius: 8px; padding: 7px 12px; background: var(--bg3); color: var(--text); font: inherit; font-size: 12px; line-height: 18px; white-space: nowrap; cursor: pointer; transition: background-color 160ms ease-out, color 160ms ease-out; }
button:hover { background: var(--bg4); }
button:focus-visible { outline: 2px solid var(--orange); outline-offset: 3px; }
button:disabled { opacity: .5; cursor: default; }
.refresh-button { background: transparent; color: var(--text2); border-color: transparent; padding: 6px 8px; }
.refreshing { animation: spin 1.2s linear infinite; }
.usage-section + .usage-section { margin-top: 28px; }
h3 { font-size: 14px; font-weight: 600; line-height: 1.5; margin: 0 0 12px; }
.plan-row { display: flex; align-items: center; gap: 24px; padding: 18px 20px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg2); }
.plan-identity { flex: 1; min-width: 0; }
.plan-identity strong { font-size: 15px; font-weight: 600; }
.plan-identity p { font-size: 12px; margin-top: 5px; overflow-wrap: anywhere; }
.plan-status { text-align: right; font-size: 13px; }
.plan-status p, .subscription-note { margin-top: 5px; font-size: 12px; }
.section-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 12px; }
.section-heading h3 { margin: 0; }
.section-heading > span { font-size: 12px; color: var(--text2); font-variant-numeric: tabular-nums; }
.wallet { border: 1px solid var(--border); background: var(--bg2); border-radius: 10px; padding: 0 22px; }
.wallet-total { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 0; }
.wallet-total > div > span { font-size: 13px; font-weight: 550; }
.wallet-total p { margin-top: 4px; font-size: 12px; }
.wallet-total > strong { font-size: 24px; font-weight: 600; line-height: 1.3; font-variant-numeric: tabular-nums; letter-spacing: -.4px; }
.pool { border-top: 1px solid var(--border); padding: 20px 0; }
.pool-heading, .pool-caption, .pool-detail { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
h4 { font-size: 14px; font-weight: 550; margin: 0; }
.pool-amount { display: flex; align-items: baseline; gap: 7px; font-variant-numeric: tabular-nums; }
.pool-amount > span { font-size: 12px; color: var(--text2); }
.pool-amount > strong { font-size: 19px; font-weight: 550; line-height: 1.4; }
.pool-caption { margin-top: 8px; font-size: 12px; line-height: 1.6; color: var(--text2); flex-wrap: wrap; gap: 4px 12px; }
.pool-caption > span:last-child { display: inline-flex; align-items: center; gap: 5px; }
.pool-caption svg { flex-shrink: 0; }
.pool-caption .expiry-warning { color: var(--orange-text); }
.meter { height: 6px; margin: 12px 0 10px; border-radius: 3px; background: var(--bg4); overflow: hidden; }
.meter i { display: block; width: 100%; height: 100%; background: var(--text2); border-radius: inherit; transform-origin: left; transition: transform 200ms ease-out; }
.meter i.subscription-fill { background: var(--orange-text); }
.meter i.historical { background: var(--text3); }
.meter-unknown { background: var(--bg3); }
.pool-detail { font-size: 12px; line-height: 1.65; color: var(--text2); flex-wrap: wrap; gap: 4px 12px; }
.pool-detail p { font-size: inherit; flex: 1; }
.pool-detail > span { font-variant-numeric: tabular-nums; white-space: nowrap; }
.reserved-note, .unavailable-note { padding: 12px 0 16px; border-top: 1px solid var(--border); font-size: 12px; }
.reserved-note, .quota-footnote { display: flex; align-items: flex-start; gap: 7px; }
.reserved-note svg, .quota-footnote svg { flex-shrink: 0; margin-top: 2px; }
.quota-footnote { margin-top: 12px; font-size: 12px; }
.billing-details dl { margin: 0; }
.billing-details dl > div { display: grid; grid-template-columns: 100px 1fr; gap: 20px; padding: 12px 0; border-bottom: 1px solid var(--border); font-size: 12px; line-height: 1.65; }
.billing-details dl > div:last-child { border-bottom: 0; }
.billing-details dt { color: var(--text2); }
.billing-details dd { margin: 0; color: var(--text2); }
.usage-error { display: flex; align-items: flex-start; gap: 10px; padding: 14px 16px; background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; font-size: 12px; line-height: 1.7; margin: 0 0 24px; }
.usage-error > svg { color: var(--red); flex-shrink: 0; margin-top: 2px; }
.usage-error > div { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.usage-error small { display: block; color: var(--text2); font-size: 12px; }
.usage-error button { border: 0; background: transparent; padding: 0; min-height: 24px; }
.usage-empty { padding: 40px 24px; text-align: center; border: 1px solid var(--border); border-radius: 10px; }
.usage-empty > svg { margin-bottom: 16px; color: var(--text2); }
.usage-empty button { margin-top: 22px; }
.primary-button { background: var(--text); color: var(--bg); border-color: transparent; }
.primary-button:hover { background: var(--text2); }
.usage-loading { padding: 24px; background: var(--bg2); border-radius: 10px; color: var(--text2); font-size: 12px; }
.loading-line { height: 26px; max-width: 280px; background: var(--bg3); margin-top: 18px; border-radius: 4px; }
.loading-line.short { width: 160px; height: 14px; }
@keyframes spin { to { transform: rotate(360deg); } }
@container (max-width: 640px) {
  .usage-header { margin-bottom: 28px; }
  h2 { font-size: 21px; }
  .plan-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; padding: 16px; }
  .plan-row > button { grid-column: 1 / -1; justify-self: start; }
  .plan-status { text-align: right; }
  .wallet { padding: 0 16px; }
  .pool-heading { flex-wrap: wrap; gap: 6px 12px; }
  .pool-amount { margin-left: auto; }
  .pool-amount > strong { font-size: 17px; }
  .section-heading { flex-wrap: wrap; gap: 4px; }
  .billing-details dl > div { grid-template-columns: 84px 1fr; gap: 12px; }
}
@container (max-width: 480px) {
  .pool-detail { display: block; }
  .pool-detail > span { display: block; margin-top: 4px; }
}
@media (prefers-reduced-motion: reduce) {
  button, .meter i { transition: none; }
  .refreshing { animation: none; }
}
</style>

<style scoped>
.plan-row { padding: 20px 24px; border-radius: 12px; gap: 16px; background: color-mix(in srgb, var(--orange) 5%, var(--bg2)); }
.plan-mark, .wallet-mark { width: 44px; height: 44px; display: grid; place-items: center; flex-shrink: 0; border-radius: 11px; background: var(--orange-bg); color: var(--orange-text); }
.plan-mark { background: transparent; }
.plan-identity strong { font-size: 17px; }
.plan-status > span { font-weight: 550; }
.usage-section > h3, .section-heading h3 { font-size: 15px; font-weight: 650; }
.wallet { padding: 0; overflow: hidden; border-radius: 14px; }
.wallet-total { padding: 24px 26px; gap: 14px; background: color-mix(in srgb, var(--orange) 4%, var(--bg2)); }
.wallet-total > div { flex: 1; }
.wallet-total > div > span { font-size: 14px; font-weight: 650; }
.wallet-total > strong { font-size: 32px; letter-spacing: -.6px; }
.wallet-mark { background: transparent; }
.wallet-pools { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--border); }
.pool { padding: 24px 26px; border-top: 0; min-width: 0; }
.pool + .pool { border-left: 1px solid var(--border); }
.pool-heading { flex-wrap: wrap; gap: 10px; justify-content: flex-start; }
.pool-mark { width: 30px; height: 30px; display: grid; place-items: center; flex-shrink: 0; color: var(--orange-text); border-radius: 8px; background: var(--orange-bg); }
.pool-mark.permanent { color: var(--green); background: color-mix(in srgb, var(--green) 10%, transparent); }
.pool-amount { flex: 1 0 100%; margin-top: 10px; }
.pool-amount > strong { font-size: 24px; }
.pool-caption { margin-top: 11px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.pool-caption > span:last-child { border-radius: 5px; padding: 3px 6px; background: var(--bg3); font-size: 11px; }
.pool .meter { height: 7px; margin-top: 16px; }
.pool:last-child .meter i { background: var(--green); }
.pool-detail { margin-top: 10px; flex-direction: column; align-items: flex-start; }
.reserved-note, .unavailable-note { margin: 0 26px; }
.billing-details { padding: 22px 24px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg2); }
.billing-details dl > div:last-child { padding-bottom: 0; }
@container (max-width: 700px) { .wallet-pools { grid-template-columns: 1fr; } .pool + .pool { border-left: 0; border-top: 1px solid var(--border); } .pool-caption { flex-direction: row; justify-content: space-between; } .pool-amount { flex: initial; margin-top: 0; margin-left: auto; } .wallet-total { padding: 20px; } .pool { padding: 20px; } .plan-row { grid-template-columns: 44px minmax(0,1fr); } .plan-status { grid-column: 2; text-align: left; } .plan-row > button { grid-column: 2; } }
@container (max-width: 480px) { .wallet-total { gap: 9px; flex-wrap: wrap; } .wallet-total > strong { width: 100%; padding-left: 53px; font-size: 30px; } .pool-amount { flex: 1 0 100%; margin-top: 6px; } .pool-caption { flex-direction: column; } .pool-mark { width: 28px; height: 28px; } }
</style>
