<template>
  <section :class="['account-panel', { 'auth-panel': auth, 'profile-panel': !auth }]" :aria-labelledby="headingId">
    <div class="account-intro">
      <div v-if="auth" class="auth-brand"><CrawshrimpBrandMark :size="28" /> 抓虾</div>
      <h3 :id="headingId">{{ state.managed ? (auth ? '登录抓虾官方服务' : '个人账号') : auth ? state.recovery ? '设置新密码' : state.pending ? '验证你的邮箱' : mode === 'register' ? '创建账号' : mode === 'recovery' ? '找回密码' : '欢迎回来' : '个人账号' }}</h3>
      <p v-if="!auth" class="profile-subtitle">管理账号、此设备的使用记录与隐私偏好。</p>
      <p v-if="auth">{{ mode === 'register' ? '用邮箱创建你的抓虾账号' : mode === 'recovery' ? '通过注册邮箱验证码找回账号' : '登录你的抓虾账号' }}</p>
    </div>
    <div v-if="loading" :class="{'profile-loading': !auth}" role="status"><span>正在读取账号状态…</span></div>
    <template v-else>
      <p v-if="!available" class="account-note">请在抓虾桌面客户端中管理账号。</p>
      <div v-else-if="state.managed" :class="state.user ? 'managed-profile' : 'account-form'">
        <template v-if="state.user">
          <div class="member-identity">
            <span class="member-avatar" aria-hidden="true">{{ (state.user.name || state.user.email || '虾').slice(0, 1).toUpperCase() }}</span>
            <div class="member-name"><div><h4>{{ state.user.name || '抓虾账号' }}</h4><span class="member-tier"><CrawshrimpMembershipMark :plan="state.plan" :size="20" />{{ (state.plan || 'free').toUpperCase() }}</span></div><p>{{ state.user.email }}</p></div><span class="member-connected"><IconCircleCheck :size="15" />账号已连接</span>
          </div>
          <div class="member-plan"><div><span class="member-caption">当前权益</span><strong>{{ memberPlanName }} 权益</strong><p>{{ modelSummary }}</p></div><div class="member-plan-actions"><button class="member-link" type="button" @click="openModelAccess"><IconRobot :size="15" />模型权限</button><button class="member-link member-quota-action" type="button" :disabled="busy" @click="emit('navigate', 'account-usage')"><IconGauge :size="15" />查看额度</button><button class="member-link" type="button" :disabled="busy" @click="perform('plans')">管理套餐 <IconArrowUpRight :size="15" /></button></div></div>

        </template>
        <template v-else>
          <p>登录后使用抓虾提供的文字与图片模型。已有 API Key 可直接在模型设置中配置，无需登录。</p>
          <button v-if="!state.pending" class="primary" type="button" :disabled="busy" @click="perform('login')">在浏览器中登录</button>
          <template v-else><p role="status">请在系统浏览器中登录并授权此设备。</p><button type="button" @click="perform('cancel')">取消登录</button></template>
          <button type="button" @click="perform('plans')">查看会员套餐</button>
        </template>
      </div>
      <p v-else-if="!state.configured && !error" class="account-note">账号服务尚未配置，你可以继续使用全部本地功能。</p>
      <div v-else-if="!auth && !state.user && !state.recovery && !state.pending" class="account-signed-out">
        <p>尚未登录</p><button class="primary" type="button" @click="emit('login')">登录账号</button>
      </div>
      <template v-else>
        <div v-if="state.user && !state.recovery" class="account-identity">
          <div class="profile-hero">
            <span class="profile-avatar" aria-hidden="true">{{ profile.initial || '访' }}</span>
            <div class="profile-heading"><strong>{{ profile.name }}</strong><span>{{ state.user.anonymous ? '访客账号' : '个人账号' }}</span></div>
            <span class="profile-badge"><i></i>{{ state.user.anonymous ? '访客' : '已登录' }}</span>
          </div>
          <dl class="profile-details">
            <div class="profile-detail"><dt><IconMail :size="17" :stroke-width="1.6" />邮箱地址</dt><dd>{{ state.user.email || '尚未绑定邮箱' }}</dd></div>
            <div class="profile-detail"><dt><IconUser :size="17" :stroke-width="1.6" />账号类型</dt><dd>{{ state.user.anonymous ? '访客身份' : '个人账号' }}</dd></div>
          </dl>
          <div class="profile-signout">
            <div><strong>退出登录</strong><p>{{ state.user.anonymous ? '建议先绑定邮箱，保留当前访客身份。' : '退出当前设备上的账号，本地文件和会话会保留。' }}</p></div>
            <button class="signout-button" type="button" :disabled="busy" @click="logout"><IconLogout :size="16" :stroke-width="1.6" />{{ busy ? '处理中…' : '退出登录' }}</button>
          </div>
          <div v-if="confirmLogout" class="account-note">
            <p>退出后可能无法找回这个访客身份，本地文件和会话会保留。</p>
            <button type="button" :disabled="busy" @click="perform('logout'); confirmLogout = false">确认退出访客身份</button>
            <button type="button" @click="confirmLogout = false">暂不退出</button>
          </div>
        </div>
        <form v-if="state.recovery" @submit.prevent="perform('password')" class="account-form">
          <label>新密码<input v-model="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required /></label>
          <label>确认新密码<input v-model="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required /></label>
          <button class="primary" :disabled="busy">{{ busy ? '保存中…' : '重置密码并返回登录' }}</button>
        </form>
        <div v-else-if="state.pending" class="account-form">
          <p>{{ state.message || '请完成邮箱或浏览器验证' }}</p>
          <form v-if="state.pending !== 'oauth'" @submit.prevent="perform('verify')" class="account-form">
            <label>邮箱<input :value="state.pendingEmail || email" type="email" readonly autocomplete="email" /></label>
            <label>邮件验证码<input v-model="code" inputmode="numeric" pattern="[0-9]{6,10}" autocomplete="one-time-code" placeholder="输入邮件验证码" minlength="6" maxlength="10" required /></label>
            <button class="primary" :disabled="busy">{{ busy ? '验证中…' : state.pending === 'signup' ? '验证并完成注册' : '验证邮箱' }}</button>
            <small>未收到邮件？请检查垃圾邮件，或取消后重新发送。</small>
          </form>
          <button v-if="state.pending === 'recovery'" type="button" :disabled="busy || resendSeconds > 0" @click="perform('resend')">{{ resendSeconds > 0 ? `${resendSeconds} 秒后可重发` : '重新发送验证码' }}</button>
          <button type="button" :disabled="busy" @click="perform('cancel')">返回修改邮箱</button>
        </div>
        <template v-else-if="!state.user || state.user.anonymous">
          <form @submit.prevent="perform(state.user?.anonymous ? 'register' : mode)" class="account-form">
            <label>邮箱<input v-model="email" type="email" placeholder="name@example.com" autocomplete="email" maxlength="254" required /></label>
            <label v-if="mode !== 'recovery' && !state.user?.anonymous">密码<input v-model="password" type="password" placeholder="输入密码" :autocomplete="mode === 'login' && !state.user ? 'current-password' : 'new-password'" :minlength="mode === 'login' && !state.user ? 1 : 8" maxlength="128" required /></label>
            <button class="primary" :disabled="busy">{{ busy ? '处理中…' : state.user?.anonymous ? '绑定邮箱' : ['register', 'recovery'].includes(mode) ? '发送验证码' : modes.find(item => item.id === mode)?.label }}</button>
          </form>
          <div v-if="!state.user" class="auth-links">
            <button v-if="mode === 'login'" type="button" @click="switchMode('recovery')">忘记密码？</button>
            <span v-if="mode === 'login'">还没有账号？ <button type="button" @click="switchMode('register')">注册</button></span>
            <button v-else type="button" @click="switchMode('login')">返回登录</button>
          </div>
          <div v-if="state.providers?.length" class="account-providers">
            <button v-for="provider in state.providers || []" :key="provider" type="button" :disabled="busy" @click="perform('oauth', { provider })">{{ state.user?.anonymous ? '绑定' : '使用' }} {{ provider === 'google' ? 'Google' : provider }} {{ state.user?.anonymous ? '账号' : '登录' }}</button>
          </div>

        </template>
      </template>
    </template>
    <Teleport to="body">
      <dialog v-if="showModelAccess" ref="modelAccessDialog" class="model-access-dialog" :aria-labelledby="`${headingId}-models-title`" :aria-describedby="`${headingId}-models-note`" @cancel.prevent="showModelAccess = false" @click.self="showModelAccess = false">
        <header class="model-access-header"><div><h3 :id="`${headingId}-models-title`">官方模型使用权限</h3><p>当前账号 · {{ memberPlanName }}{{ ['plus', 'pro'].includes(state.plan) ? ' 会员' : '' }}</p></div><button type="button" aria-label="关闭模型权限" @click="showModelAccess = false"><IconX :size="18" /></button></header>
        <div class="model-access-body">
          <p :id="`${headingId}-models-note`" class="model-access-note"><IconInfoCircle :size="17" /><span>模型目录与使用权限由 ModelJetty 同步，调用费用从账号额度结算。</span></p>
          <div class="model-catalog-toolbar"><span>{{ catalogLoading ? '正在同步最新目录…' : catalogTimestamp ? '同步于 ' + catalogTimestamp : '以官方服务返回的权限为准' }}</span><button type="button" :disabled="catalogLoading" @click="refreshModelCatalog"><IconRefresh :size="14" />刷新目录</button></div>
          <p v-if="catalogError" class="model-catalog-error" role="alert">{{ catalogError }}<template v-if="state.models?.length">，以下为上次读取的目录。</template></p>
          <div class="model-access-labels"><span>模型</span><span>使用权限</span></div>
          <div v-for="model in state.models || []" :key="model.id" class="model-access-row">
            <span>{{ model.name || model.id }}</span><span :class="['model-access-status', modelAvailability(model)]">{{ modelAvailabilityLabel(model) }}</span>
          </div>
          <p v-if="!state.models?.length" class="model-access-empty">{{ catalogLoading ? '正在读取模型目录…' : '暂未读取到模型目录，请点击上方“刷新目录”重试。' }}</p>
        </div>
        <footer class="model-access-footer"><button type="button" :disabled="busy" @click="perform('plans')">了解会员与充值 <IconArrowUpRight :size="15" /></button><button type="button" @click="showModelAccess = false">完成</button></footer>
      </dialog>
    </Teleport>
    <PersonalActivity v-if="!auth" />
    <section v-if="!auth" class="privacy-section" aria-labelledby="privacy-title"><h4 id="privacy-title">隐私与数据</h4><div class="analytics-preference">
      <label class="analytics-preference-row">
        <span class="analytics-preference-title">分享使用统计，帮助改进抓虾</span>
        <input class="analytics-preference-switch" type="checkbox" role="switch" :aria-describedby="`${headingId}-analytics-description`" :checked="analyticsEnabled" @change="setAnalytics($event.target.checked)">
      </label>
      <p :id="`${headingId}-analytics-description`">登录后仅上报功能使用、任务结果、耗时、模型用量和版本信息。不上传聊天、文件内容或密钥；关闭后清除待上报记录。</p>
    </div>
    </section>
    <div v-if="!auth && state.managed && state.user" class="device-session"><div><strong>当前设备</strong><p>退出后，本地文件与会话仍会保留。</p></div><button type="button" class="signout-button" :disabled="busy" @click="perform('logout')"><IconLogout :size="16" />退出登录</button></div>
    <div v-if="error" role="alert">
      <p class="account-error">{{ error }}</p>
      <button v-if="available && !state.recovery && !state.pending" type="button" :disabled="busy" @click="error = ''; refresh()">重试</button>
      <button v-if="available && !auth && !state.recovery && !state.pending" type="button" :disabled="busy" @click="confirmReset = true">清除本机登录状态</button>
      <div v-if="confirmReset">
        <p>这会移除本机保存的登录凭证，未绑定的访客身份可能无法找回。本地文件和会话会保留。</p>
        <button type="button" :disabled="busy" @click="perform('logout'); confirmReset = false">确认清除</button>
        <button type="button" @click="confirmReset = false">取消</button>
      </div>
    </div>
    <p v-else-if="state.message && !state.pending && (auth || !state.user || state.recovery)" class="account-note" role="status">{{ state.message }}</p>
  </section>
</template>

<script setup>
import PersonalActivity from './PersonalActivity.vue'
import CrawshrimpBrandMark from './CrawshrimpBrandMark.vue'
import CrawshrimpMembershipMark from './CrawshrimpMembershipMark.vue'
import { computed, ref, useId, onMounted, onBeforeUnmount } from 'vue'
import { IconMail, IconUser, IconLogout, IconArrowUpRight, IconX, IconInfoCircle, IconCircleCheck, IconGauge, IconRobot, IconRefresh } from '@tabler/icons-vue'
import { useNativeDialog } from '../composables/useNativeDialog'
import { modelAvailability, modelAvailabilityLabel, catalogSummary } from '../utils/managedCatalogView.mjs'
import { accountIdentity } from '../utils/desktopAccountMenu.js'
function accountErrorMessage(error) {
  return String(error?.message || '账号操作失败，请稍后重试').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
const analyticsEnabled = ref(true)
onMounted(async () => { try { analyticsEnabled.value = (await window.cs?.analyticsPreferences?.()).enabled } catch {} })
async function setAnalytics(enabled) { try { analyticsEnabled.value = (await window.cs.analyticsPreferences(enabled)).enabled } catch { error.value = '统计设置保存失败，请重试' } }
const props = defineProps({ auth: Boolean })
const emit = defineEmits(['login', 'authenticated', 'navigate', 'catalog-updated'])
const headingId = `account-heading-${useId()}`
function switchMode(next) { mode.value = next; error.value = ''; password.value = '' }
function setState(value) {
  state.value = value
  if (!value.user) showModelAccess.value = false
  if (value.pendingEmail) email.value = value.pendingEmail
  if (props.auth && value.user && !value.user.anonymous && !value.pending && !value.recovery) emit('authenticated')
}
const showModelAccess = ref(false), modelAccessDialog = ref(null)
useNativeDialog(showModelAccess, modelAccessDialog)
const state = ref({ configured: false, user: null })
const profile = computed(() => accountIdentity(state.value))
const modelSummary = computed(() => catalogSummary(state.value.models))
const catalogLoading = ref(false), catalogError = ref('')
const catalogTimestamp = computed(() => state.value.modelsUpdatedAt ? new Date(state.value.modelsUpdatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
async function refreshModelCatalog() {
  if (catalogLoading.value) return
  const revision = ++stateRevision
  catalogLoading.value = true; catalogError.value = ''
  try { const value = await window.cs.accountAction('refresh-models'); if (mounted && revision === stateRevision) { setState(value); error.value = ''; emit('catalog-updated') } }
  catch (error) { if (mounted && revision === stateRevision) catalogError.value = accountErrorMessage(error) }
  finally { if (mounted) catalogLoading.value = false }
}
function openModelAccess() { showModelAccess.value = true; void refreshModelCatalog() }
const memberPlanName = computed(() => ({ free: 'Free', plus: 'Plus', pro: 'Pro' }[state.value.plan] || '官方服务'))
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const now = ref(Date.now())
const resendSeconds = computed(() => Math.max(0, Math.ceil(((state.value.resendAfter || 0) - now.value) / 1000)))
let clockTimer
const code = ref('')
const mode = ref('login')
const error = ref('')
const busy = ref(false)
const loading = ref(true)
const confirmLogout = ref(false)
const confirmReset = ref(false)
const available = typeof window.cs?.accountAction === 'function'
const modes = [{ id: 'login', label: '登录' }, { id: 'register', label: '注册' }, { id: 'recovery', label: '找回密码' }]
let unsubscribe
let mounted = true, stateRevision = 0
async function refresh() {
  const revision = ++stateRevision
  try { if (available) { const value = await window.cs.accountAction('status'); if (mounted && revision === stateRevision) { setState(value); error.value = '' } } }
  catch (e) { if (mounted && revision === stateRevision) error.value = accountErrorMessage(e) }
  finally { if (mounted && revision === stateRevision) loading.value = false }
}
async function perform(action, extra = {}) {
  if (busy.value) return
  error.value = ''
  if (action === 'password' && password.value !== confirmPassword.value) { error.value = '两次输入的密码不一致'; return }
  busy.value = true
  const revision = ++stateRevision
  try {
    const value = await window.cs.accountAction(action, { email: email.value, password: password.value, code: code.value, ...extra })
    if (mounted && revision === stateRevision) {
      if (action === 'password') mode.value = 'login'
      setState(value)
    }
  } catch (e) { if (mounted && revision === stateRevision) error.value = accountErrorMessage(e) }
  finally { password.value = ''; confirmPassword.value = ''; code.value = ''; busy.value = false }
}
function logout() {
  if (state.value.user?.anonymous) confirmLogout.value = true
  else perform('logout')
}
onMounted(() => {
  clockTimer = setInterval(() => { now.value = Date.now() }, 1000)
  refresh()
  unsubscribe = window.cs?.onAccountChanged?.(() => { if (!busy.value) refresh() })
})
onBeforeUnmount(() => { clearInterval(clockTimer); confirmPassword.value = ''; mounted = false; unsubscribe?.(); password.value = ''; code.value = '' })
</script>

<style scoped>
 .model-access-dialog { margin: auto; box-sizing: border-box; width: min(620px, calc(100vw - 40px)); max-width: calc(100vw - 40px); max-height: calc(100dvh - 64px); padding: 0; color: var(--text); background: var(--bg2); border: 1px solid var(--border-strong); border-radius: 12px; overflow: hidden; }
.model-access-dialog[open] { display: flex; flex-direction: column; }
.model-access-dialog::backdrop { background: var(--scrim, rgb(0 0 0 / .6)); }
.model-access-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 22px 24px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.model-access-header h3 { font-size: 19px; line-height: 1.4; margin: 0 0 5px; font-weight: 600; }
.model-access-header p { font-size: 12px; margin: 0; }
.model-access-header button { display: grid; place-items: center; padding: 7px; min-width: 34px; min-height: 34px; }
.model-access-body { padding: 20px 24px 10px; overflow-y: auto; min-height: 0; overscroll-behavior: contain; }
.model-access-note { display: flex; align-items: flex-start; gap: 9px; padding: 12px 14px; margin: 0 0 18px; border-radius: 8px; background: var(--bg3); color: var(--text2); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.model-access-note svg { flex-shrink: 0; margin-top: 2px; }
.model-access-labels, .model-access-row { display: flex; justify-content: space-between; align-items: center; gap: 20px; }
.model-access-labels { color: var(--text2); font-size: 11px; padding-bottom: 8px; }
.model-access-row { min-height: 48px; padding: 10px 0; border-top: 1px solid var(--border); font-size: 13px; }
.model-access-row > span:first-child { min-width: 0; overflow-wrap: anywhere; }
.model-access-status { flex-shrink: 0; font-size: 11px; border-radius: 5px; padding: 3px 7px; color: var(--text2); background: var(--bg3); }
.model-access-status.available { color: var(--green); background: color-mix(in srgb, var(--green) 10%, transparent); }
.model-access-empty { padding: 16px 0; margin: 0; }
.model-access-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 24px; border-top: 1px solid var(--border); flex-shrink: 0; }
@media (max-width: 480px) { .model-access-header { padding: 18px; } .model-access-body { padding: 16px 18px 8px; } .model-access-footer { padding: 14px 18px; } .model-access-row { gap: 12px; } }


.account-panel { width: min(100%, 660px); box-sizing: border-box; padding: 28px; color: var(--text, #ddd); background: var(--bg2, #17191d); border: 1px solid var(--border, #444); border-radius: 10px; }
.account-eyebrow { font-size: 12px; color: var(--text3, #999); }
h3 { font-size: 24px; margin: 10px 0; }
p { line-height: 1.7; font-size: 13px; color: var(--text2, #999); }
.account-intro { margin-bottom: 28px; }
.account-form { display: grid; gap: 16px; max-width: 380px; }
label { display: grid; gap: 8px; font-size: 13px; }
input { border: 1px solid var(--border, #555); border-radius: 8px; background: var(--bg, transparent); color: inherit; padding: 11px 12px; font: inherit; }
button { border: 1px solid var(--border, #555); border-radius: 8px; background: transparent; color: inherit; padding: 10px 16px; cursor: pointer; }
button.primary { background: var(--orange-strong, #c94d16); color: #fff; border-color: var(--orange-strong, #c94d16); }
button:disabled { opacity: .5; cursor: wait; }
button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid #e77836; outline-offset: 3px; }
.account-modes { display: flex; gap: 8px; margin-bottom: 24px; }
.account-modes .selected { border-color: var(--orange-text, #e77836); color: var(--orange-text, #e77836); }
.account-identity { margin-bottom: 24px; }
.account-providers { margin-top: 16px; display: flex; gap: 8px; }
.account-note { padding: 12px 0; }
.account-error { color: #e36565; }
.account-guest { margin-top: 28px; font-size: 13px; }
summary { cursor: pointer; }
small { color: var(--text2, #999); line-height: 1.6; }
.auth-panel { width:100%; padding:36px; border:0; border-radius:0; background:transparent; }
.auth-brand { display:flex; align-items:center; justify-content:center; gap:8px; font-size:14px; font-weight:600; margin-bottom:24px; }
.auth-panel .account-intro { text-align:center; margin-bottom:26px; }
.auth-panel h3 { font-size:25px; font-weight:600; letter-spacing:-.5px; margin:0 0 8px; }
.auth-panel .account-intro p { margin:0; font-size:12px; }
.auth-panel .account-form { max-width:none; gap:18px; }
.auth-panel input { box-sizing:border-box; width:100%; height:42px; border-radius:9px; }
.auth-panel button.primary { height:42px; border-radius:9px; font-weight:600; margin-top:4px; }
.auth-links { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-top:18px; font-size:12px; color:var(--text3); }
.auth-links button { border:0; padding:0; font-size:12px; color:var(--text2); }
.auth-links button:hover { color:var(--orange-text); }
@media(max-width:480px) { .auth-panel { padding:28px 22px; } }
.profile-panel { width: min(100%, var(--settings-page-width, 880px)); padding: 0; border: 0; background: transparent; border-radius: 0; container-type: inline-size; }
.profile-panel .account-intro { margin-bottom: 28px; }
.profile-panel .account-intro h3 { font-size: 24px; line-height: 1.3; letter-spacing: -.5px; font-weight: 600; margin: 0 0 9px; }
.profile-panel .profile-subtitle { font-size: 13px; color: var(--text2); margin: 0; }
.managed-profile, .profile-panel .account-identity { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--bg2); }
.member-identity, .profile-hero { display: flex; align-items: center; gap: 14px; padding: 22px 24px; }
.member-avatar, .profile-avatar { display: grid; place-items: center; flex: none; width: 44px; height: 44px; border-radius: 10px; background: var(--orange-bg); color: var(--orange-text); font-size: 21px; font-weight: 550; }
.member-name, .profile-heading { min-width: 0; }
.member-name > div { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.member-name h4, .profile-heading strong { font-size: 17px; font-weight: 600; letter-spacing: -.2px; margin: 0; overflow-wrap: anywhere; }
.member-name p { font-size: 12px; margin: 5px 0 0; overflow-wrap: anywhere; }
.member-tier { display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; border-radius: 5px; font-size: 10px; font-weight: 600; color: var(--orange-text); background: var(--orange-bg); }
.member-plan { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 18px 24px; border-top: 1px solid var(--border); }
.member-caption { display: block; font-size: 12px; color: var(--text2); margin-bottom: 5px; }
.member-plan strong { font-size: 14px; font-weight: 550; }
.member-plan p { font-size: 12px; margin: 5px 0 0; }
.member-plan-actions { display: flex; flex-wrap: wrap; gap: 8px; flex-shrink: 0; }
.profile-panel button { display: inline-flex; justify-content: center; align-items: center; gap: 6px; min-height: 36px; padding: 8px 12px; font: inherit; font-size: 12px; font-weight: 500; line-height: 1.5; background: var(--bg3); transition: background-color 160ms ease-out, color 160ms ease-out; }
.profile-panel button:hover:not(:disabled) { background: var(--bg4); }
.profile-panel button:focus-visible, .profile-panel input:focus-visible { outline: 2px solid var(--orange); outline-offset: 3px; }
.profile-panel .signout-button { background: transparent; }
.profile-panel .signout-button:hover:not(:disabled) { background: var(--bg3); color: var(--text); }
.profile-heading { display: flex; flex-direction: column; gap: 5px; }
.profile-heading > span { color: var(--text2); font-size: 12px; }
.profile-badge { margin-left: auto; font-size: 12px; color: var(--text2); }
.profile-details { margin: 0; padding: 0 24px; }
.profile-detail { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 16px 0; border-top: 1px solid var(--border); font-size: 13px; }
.profile-detail dt { display: inline-flex; gap: 8px; align-items: center; color: var(--text2); }
.profile-detail dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
.profile-signout, .device-session { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 20px 0; border-top: 1px solid var(--border); }
.profile-signout { padding: 20px 24px; }
.profile-signout strong, .device-session strong { font-size: 13px; font-weight: 550; }
.profile-signout p, .device-session p { font-size: 12px; margin: 5px 0 0; }
.profile-panel .account-note { padding: 16px 0; }
.privacy-section { margin-top: 28px; }
.privacy-section h4 { font-size: 14px; font-weight: 600; margin: 0 0 12px; }
.analytics-preference { padding: 16px 0 20px; border-top: 1px solid var(--border); }
.analytics-preference-row { display: flex; justify-content: space-between; align-items: center; gap: 20px; min-height: 32px; cursor: pointer; }
.analytics-preference-title { font-size: 13px; font-weight: 500; line-height: 1.6; color: var(--text); }
.analytics-preference-switch { appearance: none; -webkit-appearance: none; position: relative; flex: 0 0 36px; width: 36px; height: 20px; min-height: 0; padding: 0; margin: 0; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--bg3); cursor: pointer; transition: background-color 160ms ease-out, border-color 160ms ease-out; }
.analytics-preference-switch::before { content: ''; position: absolute; top: 3px; left: 3px; width: 12px; height: 12px; border-radius: 50%; background: var(--text2); transition: transform 160ms ease-out; }
.analytics-preference-switch:checked { background: var(--orange); border-color: var(--orange); }
.analytics-preference-switch:checked::before { transform: translateX(16px); background: var(--on-orange); }
.analytics-preference p { margin: 6px 0 0; max-width: 70ch; font-size: 12px; line-height: 1.7; }
.profile-panel [role=alert] { padding: 14px 16px; margin-top: 16px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg2); font-size: 12px; }
.profile-panel [role=alert] button { margin: 8px 8px 0 0; }
@container (max-width: 620px) {
  .member-identity, .profile-hero { padding: 18px; }
  .member-plan { flex-wrap: wrap; padding: 18px; gap: 14px; }
  .member-plan-actions { flex-shrink: 1; }
  .profile-detail, .profile-signout, .device-session { flex-wrap: wrap; gap: 14px; }
}
@media (prefers-reduced-motion: reduce) {
  .profile-panel button, .analytics-preference-switch, .analytics-preference-switch::before { transition: none; }
}

</style>

<style scoped>
.profile-panel .managed-profile { background: var(--bg2); border-radius: 14px; }
.member-identity { padding: 26px 28px; background: color-mix(in srgb, var(--orange) 6%, var(--bg2)); }
.member-avatar { width: 54px; height: 54px; border-radius: 12px; font-size: 25px; background: var(--orange); color: var(--on-orange); }
.member-name h4 { font-size: 20px; letter-spacing: -.3px; }
.member-tier { display: inline-flex; align-items: center; gap: 4px; padding: 4px 7px; }
.member-connected { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--green); white-space: nowrap; }
.member-plan { padding: 22px 28px; align-items: center; flex-wrap: wrap; }
.member-plan > div:first-child { flex: 1 1 220px; min-width: 0; }
.member-plan-actions { max-width: 100%; }
.member-plan strong { font-size: 16px; font-weight: 650; }
.member-plan p { margin-top: 7px; font-size: 12px; }
.member-caption { font-size: 11px; margin-bottom: 7px; }
.profile-panel .member-plan-actions .member-quota-action { background: var(--orange-bg); border-color: transparent; color: var(--orange-text); }
.profile-panel .member-plan-actions .member-quota-action:hover { background: color-mix(in srgb, var(--orange) 20%, var(--bg2)); }
.profile-panel .privacy-section { padding: 20px 24px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg2); }
.privacy-section h4 { display: flex; align-items: center; }
.analytics-preference { padding-bottom: 0; border-top: 0; }
.profile-panel .device-session { border-top: 0; padding: 24px 0 8px; }
.model-catalog-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 0 0 14px; color: var(--text2); font-size: 11px; }
.model-catalog-toolbar button { display: flex; gap: 5px; align-items: center; padding: 6px 8px; min-height: 30px; font-size: 11px; }
.model-catalog-error { color: var(--red); font-size: 12px; line-height: 1.7; margin: 0 0 15px; }
.model-access-status.unknown { color: var(--text2); }
@container (max-width: 640px) { .member-identity { padding: 20px; flex-wrap: wrap; gap: 12px; } .member-connected { margin-left: 0; } .member-plan { padding: 20px; } .member-plan-actions { width: 100%; } }
</style>
