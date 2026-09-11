<template>
  <section :class="['account-panel', { 'auth-panel': auth, 'profile-panel': !auth }]" :aria-labelledby="headingId">
    <div class="account-intro">
      <div v-if="auth" class="auth-brand"><span aria-hidden="true">🦐</span> 抓虾</div>
      <h3 :id="headingId">{{ auth ? state.recovery ? '设置新密码' : state.pending ? '验证你的邮箱' : mode === 'register' ? '创建账号' : mode === 'recovery' ? '找回密码' : '欢迎回来' : '个人账号' }}</h3>
      <p v-if="!auth" class="profile-subtitle">查看个人身份与管理登录状态</p>
      <p v-if="auth">{{ mode === 'register' ? '用邮箱创建你的抓虾账号' : mode === 'recovery' ? '通过注册邮箱验证码找回账号' : '登录你的抓虾账号' }}</p>
    </div>
    <p v-if="loading" role="status">正在读取账号状态…</p>
    <template v-else>
      <p v-if="!available" class="account-note">请在抓虾桌面客户端中管理账号。</p>
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
import { computed, ref, useId, onMounted, onBeforeUnmount } from 'vue'
import { IconMail, IconUser, IconLogout } from '@tabler/icons-vue'
import { accountIdentity } from '../utils/desktopAccountMenu.js'
function accountErrorMessage(error) {
  return String(error?.message || '账号操作失败，请稍后重试').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
const props = defineProps({ auth: Boolean })
const emit = defineEmits(['login', 'authenticated'])
const headingId = `account-heading-${useId()}`
function switchMode(next) { mode.value = next; error.value = ''; password.value = '' }
function setState(value) {
  state.value = value
  if (value.pendingEmail) email.value = value.pendingEmail
  if (props.auth && value.user && !value.user.anonymous && !value.pending && !value.recovery) emit('authenticated')
}
const state = ref({ configured: false, user: null })
const profile = computed(() => accountIdentity(state.value))
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
let mounted = true
async function refresh() {
  try { if (available) { const value = await window.cs.accountAction('status'); if (mounted) setState(value) } }
  catch (e) { if (mounted) error.value = e?.message || '读取账号状态失败' }
  finally { if (mounted) loading.value = false }
}
async function perform(action, extra = {}) {
  if (busy.value) return
  error.value = ''
  if (action === 'password' && password.value !== confirmPassword.value) { error.value = '两次输入的密码不一致'; return }
  busy.value = true
  try {
    const value = await window.cs.accountAction(action, { email: email.value, password: password.value, code: code.value, ...extra })
    if (mounted) {
      if (action === 'password') mode.value = 'login'
      setState(value)
    }
  } catch (e) { if (mounted) error.value = accountErrorMessage(e) }
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
.auth-brand span { font-size:28px; }
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
.profile-panel { width:min(100%,680px); padding:0; background:transparent; border:0; border-radius:0; }
.profile-panel .account-intro { margin-bottom:24px; }
.profile-panel h3 { font-size:20px; line-height:28px; font-weight:600; margin:0 0 5px; }
.profile-panel .profile-subtitle { margin:0; font-size:12px; color:var(--text3); }
.profile-panel .account-identity { margin:0; border:1px solid var(--border); border-radius:14px; background:var(--bg2); overflow:hidden; }
.profile-hero { display:flex; align-items:center; gap:16px; padding:24px; }
.profile-avatar { width:52px; height:52px; display:grid; place-items:center; flex:none; border-radius:50%; background:var(--orange-bg); border:1px solid color-mix(in srgb,var(--orange) 22%,transparent); color:var(--orange-text); font-size:22px; font-weight:550; }
.profile-heading { display:flex; flex-direction:column; gap:5px; min-width:0; }
.profile-heading strong { font-size:17px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.profile-heading>span { color:var(--text3); font-size:12px; }
.profile-badge { display:flex; align-items:center; gap:6px; margin-left:auto; white-space:nowrap; font-size:11px; color:var(--text2); background:var(--bg3); border-radius:20px; padding:5px 9px; }
.profile-badge i { width:5px; height:5px; border-radius:50%; background:var(--green); }
.profile-details { margin:0; padding:0 24px; }
.profile-detail { display:flex; align-items:center; justify-content:space-between; gap:20px; min-height:54px; border-top:1px solid var(--border); font-size:12px; }
.profile-detail dt { display:flex; align-items:center; gap:9px; flex:none; color:var(--text2); }
.profile-detail dt svg { color:var(--text3); }
.profile-detail dd { margin:0; text-align:right; overflow-wrap:anywhere; color:var(--text); }
.profile-signout { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:20px 24px; margin-top:8px; border-top:1px solid var(--border); }
.profile-signout strong { font-size:12px; font-weight:500; }
.profile-signout p { margin:5px 0 0; font-size:11px; color:var(--text3); line-height:1.6; }
.profile-signout .signout-button { display:flex; align-items:center; justify-content:center; gap:6px; padding:8px 11px; flex:none; font-size:12px; border-radius:8px; }
.signout-button:hover { background:color-mix(in srgb,var(--red) 8%,transparent); color:var(--red); border-color:color-mix(in srgb,var(--red) 35%,transparent); }
.profile-panel .account-note { padding:0 24px 16px; }
@media(max-width:600px) { .profile-hero { padding:18px; gap:12px; }.profile-details { padding:0 18px; }.profile-signout { padding:18px; flex-wrap:wrap; }.profile-detail { gap:12px; }.profile-avatar { width:42px; height:42px; }.profile-heading strong { font-size:15px; } }
</style>
