<template>
  <div class="welcome-layout">
    <div class="welcome-pane">
      <header class="welcome-brand"><img :src="brandIcon" alt="" /><span>抓虾 <span class="brand-english">Crawshrimp</span></span></header>
      <Transition name="welcome-step" mode="out-in" @after-enter="$emit('ready')">
        <div v-if="step === 'ready'" key="ready" class="welcome-content setup-content">
          <p class="setup-progress">账号已连接</p>
          <h1 id="inline-llm-modal-title">准备好了，开始吧</h1>
          <p class="welcome-intro">{{ account.user?.name ? `${account.user.name}，欢迎来到抓虾。` : '欢迎来到抓虾。' }}</p>
          <p class="setup-summary">{{ ['plus','pro'].includes(account.plan) || account.paidModelAccess === true ? 'Gemini、GPT 和 DeepSeek 已解锁，使用时从账户额度扣费。' : 'Gemini 可免费使用；订阅 Plus / Pro 或充值永久额度（¥10 起）可解锁 GPT 和 DeepSeek。' }}</p>
          <button class="welcome-primary" type="button" @click="$emit('finish', 'desktop')">开始使用 <IconArrowRight :size="18" aria-hidden="true" /></button>
          <p class="setup-permission">需要使用电脑权限时，会先征得你的同意。</p>
        </div>
        <div v-else-if="step === 'choice'" key="choice" class="welcome-content choice-content">
          <h1 id="inline-llm-modal-title">欢迎使用抓虾</h1>
          <p class="welcome-intro">让想法开始，让事情完成。</p>
          <div class="welcome-actions">
            <button class="welcome-primary" type="button" :disabled="busy || Boolean(account.pending)" :aria-busy="busy || Boolean(account.pending)" @click="$emit('action', 'login')">
              <Transition name="action-swap" mode="out-in">
                <span :key="account.pending ? 'waiting' : busy ? 'opening' : 'idle'" class="button-content">
                  <span v-if="account.pending || busy" class="waiting-dots" aria-hidden="true"><i/><i/><i/></span>
                  <IconLogin2 v-else :size="19" :stroke-width="1.7" aria-hidden="true" />
                  {{ account.pending ? '等待浏览器授权' : busy ? '正在打开浏览器' : '登录账号' }}
                </span>
              </Transition>
              <IconArrowUpRight v-if="!account.pending && !busy" class="button-arrow" :size="18" aria-hidden="true" />
            </button>
            <Transition name="action-swap" mode="out-in" @after-enter="$emit('ready')">
              <div v-if="account.pending" key="pending" class="welcome-login-note" role="status">
                <p>在网页完成登录后，抓虾会自动连接。<br>未看到网页？可重新打开或复制链接到浏览器。</p>
                <div class="pending-actions"><button type="button" :disabled="busy" @click="$emit('action', 'reopen')">重新打开网页 <IconArrowUpRight :size="13" aria-hidden="true" /></button><span aria-hidden="true">·</span><button type="button" :disabled="busy" @click="$emit('action', 'copy-login-link')">复制登录链接</button><span aria-hidden="true">·</span><button type="button" :disabled="busy" @click="$emit('action', 'cancel')">取消登录</button></div>
              </div>
              <div v-else key="note" class="welcome-login-note"><p>一键使用大模型服务，无需配置。模型服务由 ModelJetty 提供</p></div>
            </Transition>
            <div class="welcome-account-links">
              <button type="button" :disabled="busy || Boolean(account.pending)" @click="$emit('action', 'register')">注册账号</button>
              <button type="button" @click="$emit('action', 'plans')">套餐与价格 <IconArrowUpRight :size="13" aria-hidden="true" /></button>
            </div>
            <div class="welcome-alternative">
              <button class="welcome-key" type="button" :disabled="busy || Boolean(account.pending)" @click="$emit('update:step', 'byok')"><IconKey :size="18" :stroke-width="1.6" aria-hidden="true" /><span>使用自己的 API Key</span><IconArrowRight :size="16" aria-hidden="true" /></button>
            </div>
          </div>
        </div>
        <div v-else key="byok" class="welcome-content byok-content">
          <button class="welcome-back" type="button" @click="$emit('update:step', 'choice')"><IconArrowLeft :size="16" aria-hidden="true" /> 返回</button>
          <span class="welcome-eyebrow">连接你熟悉的模型</span>
          <h1 id="inline-llm-modal-title">使用自己的 API Key</h1>
          <p class="welcome-intro">选择供应商，继续完成模型配置。</p>
          <div class="provider-options">
            <button type="button" @click="$emit('configure', 'deepseek')"><img :src="deepseekIcon" alt="" /><span><strong>DeepSeek</strong><small>使用 DeepSeek 官方 API</small></span><IconArrowRight :size="18" aria-hidden="true" /></button>
            <button type="button" @click="$emit('configure', 'semir')"><img :src="semirIcon" alt="" /><span><strong>森马 AI 网关</strong><small>连接公司提供的模型服务</small></span><IconArrowRight :size="18" aria-hidden="true" /></button>
            <button type="button" @click="$emit('configure', 'custom')"><span class="provider-symbol"><IconPlugConnected :size="22" :stroke-width="1.5" aria-hidden="true" /></span><span><strong>其他供应商</strong><small>OpenAI / Anthropic 兼容服务</small></span><IconArrowRight :size="18" aria-hidden="true" /></button>
          </div>
          <p class="provider-footnote"><IconKey :size="14" aria-hidden="true" /> Key 保存在本机，费用由供应商结算。</p>
          <button class="provider-help" type="button" @click="$emit('provider-help')">还没有 Key？前往 DeepSeek 平台 <IconArrowUpRight :size="13" aria-hidden="true" /></button>
        </div>
      </Transition>
      <p v-if="error" class="welcome-error" role="alert">{{ error }}</p>
      <footer class="welcome-footer"><button type="button" @click="$emit('close')">暂时跳过 <IconArrowRight :size="14" aria-hidden="true" /></button></footer>
    </div>
    <aside class="welcome-art" aria-label="绿色水面与橙色小舟的原创画作">
      <img :src="welcomeArt" alt="阳光落在绿色湖面上，一只橙色小舟停在涟漪之间。" />
      <div class="art-caption"><span>从容开始，自在创造。</span><small>Make room for what matters.</small></div>
    </aside>
  </div>
</template>

<script setup>
import { IconLogin2, IconArrowUpRight, IconArrowRight, IconArrowLeft, IconKey, IconPlugConnected } from '@tabler/icons-vue'
import welcomeArt from '../assets/onboarding/quiet-water.png'
import brandIcon from '../../../assets/branding/crawshrimp-avatar-C1.png'
import deepseekIcon from '../assets/llm-providers/deepseek-logo.png'
import semirIcon from '../assets/llm-providers/semir-logo.png'
defineProps({ step: {type:String,default:'choice'}, account: {type:Object,default:()=>({})}, busy:Boolean, error:String })
defineEmits(['update:step','action','configure','provider-help','close','ready','finish'])
</script>

<style scoped>
.setup-content{max-width:390px;padding:32px 0}.setup-content h1{font-size:30px;letter-spacing:-.025em}.setup-progress{font-size:12px;font-weight:550;color:#536b4d;margin:0 0 16px}.setup-summary{margin:28px 0 24px;font-size:13px;line-height:1.75;color:#536052}.setup-permission{margin:16px 0 0;text-align:center;font-size:12px;line-height:1.6;color:#5e685d}.setup-secondary{display:block;margin:12px auto 0;min-height:44px;padding:10px 16px;border:0;background:transparent;color:#405b38;font-size:13px}.setup-secondary:hover{text-decoration:underline}.setup-footnote{font-size:12px;color:#626b5d;line-height:1.7;text-align:center}.setup-paired{font-size:14px;color:#306340}.setup-relay{margin-top:24px;--text:#242925;--text2:#58634f;--text3:#626b5d;--bg:#fafbf8;--bg2:#f0f2ec;--border:#d7dfd1;--orange:#c7d5b9;--orange-text:#3d5d30;--red:#a33328}.setup-relay:deep(.pairing){grid-template-columns:1fr;padding:18px;gap:18px}.setup-relay:deep(.pairing-symbol){display:none}.setup-relay:deep(.qr-frame){width:160px}.setup-relay:deep(.privacy){margin-bottom:18px}

.welcome-layout{--welcome-ink:#242925;--welcome-muted:#777b74;--welcome-line:#e3e5df;display:grid;grid-template-columns:1fr 1fr;width:100%;height:100%;min-height:0;background:#fafbf8;color:var(--welcome-ink);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC","Microsoft YaHei",sans-serif;font-weight:400;overflow:hidden}
.welcome-layout ::selection{background:#c7d5b9;color:#242925}
.welcome-pane{position:relative;min-width:0;display:flex;flex-direction:column;padding:30px clamp(28px,5vw,84px) 28px;overflow:auto}
.welcome-brand{display:flex;align-items:center;gap:10px;font-size:17px;font-weight:650;letter-spacing:-.4px;flex-shrink:0}.welcome-brand img{height:29px;width:29px;border-radius:0;object-fit:contain}.brand-english{font-size:12px;font-weight:450;letter-spacing:-.1px;color:#8a8d86;margin-left:8px}
.welcome-content{width:100%;max-width:390px;margin:auto; padding:60px 0 50px;align-self:center}.welcome-eyebrow{display:block;font-size:12px;letter-spacing:.13em;color:#7e867b;margin-bottom:19px}.welcome-content h1{font-size:clamp(29px,3vw,42px);font-weight:620;line-height:1.22;letter-spacing:-1.4px;margin:0;text-wrap:balance}.welcome-intro{margin:18px 0 0;font-size:15px;color:#7b8076;line-height:1.8;letter-spacing:.015em}.welcome-actions{margin-top:38px}
.choice-content .welcome-intro{color:#596159}.choice-content .welcome-actions{margin-top:40px}
.welcome-layout button{font-family:inherit;cursor:pointer;-webkit-app-region:no-drag;transition:background .2s,color .2s,transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .2s}.welcome-layout button:focus-visible{outline:2px solid #789267;outline-offset:5px}.welcome-layout button:active:not(:disabled){transform:scale(.98)}.welcome-layout button:disabled{cursor:default}.welcome-primary{position:relative;display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:56px;padding:0 20px;border:1px solid #283b2e;background:#283b2e;border-radius:12px;color:#fff;font-size:15px;font-weight:550;box-shadow:0 3px 4px #223b2110}.welcome-primary:hover:not(:disabled){background:#354e3c;box-shadow:0 5px 15px #223b2120;transform:translateY(-1px)}.welcome-primary:disabled{background:#364c3b;border-color:#364c3b}.button-content{display:flex;align-items:center;gap:11px}.button-arrow{position:absolute;right:19px;opacity:.7}
.welcome-login-note{text-align:center;padding-top:12px;box-sizing:border-box}.welcome-login-note p{margin:0;font-size:12px;line-height:1.6;color:#5e685d}.welcome-login-note button,.pending-actions button{display:inline-flex;align-items:center;justify-content:center;gap:4px;border:0;background:none;font-size:12px;color:#496243;padding:4px}.welcome-login-note button:hover{text-decoration:underline;text-underline-offset:4px}.pending-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px;font-size:11px;color:#77816f;margin-top:5px}
.welcome-account-links{display:flex;justify-content:center;align-items:center;gap:24px;margin-top:20px}.welcome-account-links button{display:inline-flex;align-items:center;justify-content:center;gap:3px;min-height:36px;padding:4px 2px;border:0;background:transparent;color:#45623f;font-size:12px}.welcome-account-links button:hover:not(:disabled){text-decoration:underline;text-underline-offset:4px}.welcome-account-links button:disabled{opacity:.5}
.welcome-alternative{border-top:1px solid var(--welcome-line);margin-top:26px;padding-top:24px}.welcome-key{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:48px;border:1px solid #d8ded3;border-radius:12px;background:transparent;color:#405344;font-size:13px;font-weight:550}.welcome-key svg:last-child{margin-left:6px;opacity:.65}.welcome-key:hover:not(:disabled){background:#edf1e9;border-color:#bccbb7}.welcome-key:disabled{opacity:.5}
.welcome-footer{display:flex;align-items:center;justify-content:flex-end;gap:14px;font-size:10px;color:#979d91;flex-shrink:0}.welcome-footer button{display:flex;align-items:center;gap:8px;border:0;background:none;color:#596c54;font-size:12px;padding:10px 0}.welcome-footer button:hover{color:#283b2e}.welcome-art{position:relative;min-width:0;min-height:0;margin:12px 12px 12px 0;border-radius:14px;overflow:hidden;background:#315b42}.welcome-art>img{width:100%;height:100%;object-fit:cover;object-position:50% 55%;display:block}.welcome-art:after{content:'';position:absolute;inset:65% 0 0;background:linear-gradient(transparent,#122f2080);pointer-events:none}.art-caption{position:absolute;z-index:1;bottom:34px;left:34px;right:25px;color:#faf9e8;text-shadow:0 1px 10px #14351d40}.art-caption span{display:block;font-size:22px;font-weight:450;letter-spacing:.04em}.art-caption small{display:block;margin-top:10px;font-family:Georgia,serif;font-style:italic;font-size:14px;opacity:.8}
.welcome-back{display:flex;align-items:center;gap:6px;margin:-25px 0 31px;padding:0;border:0;background:none;color:#798473;font-size:12px}.byok-content h1{font-size:30px}.byok-content .welcome-eyebrow{font-size:11px;margin-bottom:13px}.byok-content .welcome-intro{font-size:13px;margin-top:13px}.provider-options{display:grid;gap:10px;margin-top:27px}.provider-options button{display:flex;align-items:center;gap:14px;text-align:left;width:100%;min-height:76px;padding:15px;border:1px solid var(--welcome-line);border-radius:12px;background:transparent;color:var(--welcome-ink)}.provider-options button:hover{background:#edf1e8;border-color:#cdd8c5}.provider-options button>img,.provider-symbol{width:32px;height:32px;object-fit:contain;border-radius:8px;flex-shrink:0}.provider-symbol{display:grid;place-items:center;background:#e7ece1;color:#607354}.provider-options button>span:nth-child(2){flex:1}.provider-options strong,.provider-options small{display:block}.provider-options strong{font-size:13px;font-weight:550}.provider-options small{font-size:11px;color:#969b92;margin-top:6px}.provider-options button>svg{color:#9ca792}.provider-footnote{display:flex;align-items:center;gap:7px;font-size:11px;color:#90978a;line-height:1.7;margin-top:19px}.provider-help{display:flex;align-items:center;gap:5px;border:0;background:none;padding:0;font-size:11px;color:#687c60}.provider-help:hover{text-decoration:underline;text-underline-offset:4px}.welcome-error{padding:12px 14px;border-radius:8px;background:#fff0e6;color:#a34b28;font-size:12px;line-height:1.7;max-width:390px;align-self:center;width:100%;box-sizing:border-box;margin:0 0 20px}
.waiting-dots{display:flex;gap:3px;align-items:center;height:18px}.waiting-dots i{width:4px;height:4px;border-radius:50%;background:currentColor;animation:welcome-wait 1.2s infinite}.waiting-dots i:nth-child(2){animation-delay:.15s}.waiting-dots i:nth-child(3){animation-delay:.3s}@keyframes welcome-wait{0%,70%,100%{opacity:.35;transform:translateY(0)}35%{opacity:1;transform:translateY(-3px)}}.welcome-step-enter-active,.welcome-step-leave-active{transition:opacity .18s,transform .22s}.welcome-step-enter-from{opacity:0;transform:translateY(8px)}.welcome-step-leave-to{opacity:0;transform:translateY(-5px)}.action-swap-enter-active,.action-swap-leave-active{transition:opacity .12s,transform .15s}.action-swap-enter-from{opacity:0;transform:translateY(4px)}.action-swap-leave-to{opacity:0;transform:translateY(-4px)}
@media(max-width:900px){.welcome-pane{padding:25px 32px}.welcome-content h1{font-size:30px}.brand-english{display:none}.art-caption{left:24px;bottom:27px}.art-caption span{font-size:19px}}
@media(max-width:650px){.welcome-layout{grid-template-columns:1fr}.welcome-art{display:none}.welcome-pane{padding:25px 30px 20px}.welcome-content{max-width:380px}}
@media(max-height:670px){.welcome-pane{padding-top:20px;padding-bottom:16px}.welcome-content{padding:30px 0}.welcome-actions,.choice-content .welcome-actions{margin-top:25px}.welcome-account-links{margin-top:12px}.welcome-alternative{margin-top:16px;padding-top:16px}.welcome-content h1{font-size:30px}.byok-content{padding-top:40px}.provider-options{gap:7px;margin-top:18px}.provider-options button{min-height:65px;padding:11px}.welcome-back{margin:-18px 0 20px}}
@media(prefers-reduced-motion:reduce){.welcome-layout *{animation:none!important;transition:none!important}}
</style>
