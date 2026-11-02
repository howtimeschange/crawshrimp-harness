<template>
  <div class="image-provider-settings model-provider-settings">
    <div class="provider-toolbar model-provider-toolbar">
      <p>按服务商管理连接与模型，配置后可在生图和工作流中选择。</p>
      <button class="primary" type="button" @click="openEditor()">添加服务商</button>
    </div>
    <div class="provider-list model-provider-list" aria-label="图片模型服务商列表">
      <article v-for="provider in providers" :key="provider.id" class="provider-card model-provider-row">
        <div class="model-provider-content">
        <div :class="['provider-logo', 'model-provider-logo', provider.id, { 'modeljetty-logo': provider.preset, 'crawshrimp-logo': provider.id.startsWith('custom-managed-') }]"><img v-if="provider.id.startsWith('custom-managed-')" :src="crawshrimpLogoUrl" alt="抓虾" /><img v-else-if="provider.preset" :src="modeljettyLogoUrl" alt="ModelJetty" /><span v-else>{{ provider.logo }}</span></div>
        <div class="provider-main model-provider-main">
          <div class="provider-heading model-provider-heading">
            <h4>{{ provider.name }}</h4>
            <span :class="['status', 'model-provider-status', provider.configured ? 'ready' : '']">{{ provider.id.startsWith('custom-managed-') ? '账号已连接' : provider.configured ? '已配 Key' : '未配 Key' }}</span>
            <span class="tag model-provider-tag">{{ provider.protocolLabel }}</span>
            <span v-if="provider.custom && !provider.preset && !provider.id.startsWith('custom-managed-')" class="tag model-provider-tag">自定义</span>
          </div>
          <p class="endpoint model-provider-endpoint">{{ provider.id.startsWith('custom-managed-') ? '网页登录后使用，无需 API Key' : provider.baseUrl || '尚未填写接口地址' }}</p>
          <div class="model-tags model-provider-models"><span v-for="model in provider.previewModels" :key="model">{{ model }}</span><span v-if="provider.more">+{{ provider.more }}</span></div>
        </div>
        </div>
        <div class="provider-actions model-provider-actions">
          <small>{{ provider.modelCount }} 个模型</small>
          <button v-if="!provider.id.startsWith('custom-managed-')" type="button" :aria-label="`编辑${provider.name}`" @click="openEditor(provider)">编辑</button>
        </div>
      </article>
    </div>
    <p class="provider-footnote model-provider-note">密钥保存在本机。</p>
    <p v-if="savedMessage" class="saved-message" role="status">{{ savedMessage }}</p>


    <Teleport to="body">
      <div v-if="editor.open" class="image-provider-backdrop model-config-backdrop" @click.self="closeEditor" @keydown.esc="closeEditor">
        <section ref="dialog" class="image-provider-dialog model-config-dialog" role="dialog" aria-modal="true" aria-labelledby="image-provider-title" tabindex="-1" @keydown.tab="trapFocus">
          <header class="model-config-header">
            <div><p>{{ editor.isNew ? '图片模型 · 新增服务商' : '图片模型 · 连接配置' }}</p><h3 id="image-provider-title">{{ draft.name || '自定义服务商' }}</h3></div>
            <button type="button" aria-label="关闭服务商编辑" :disabled="editor.saving" @click="closeEditor">×</button>
          </header>
          <form @submit.prevent="saveEditor">
            <div class="editor-body model-config-body">
              <template v-if="draft.custom">
                <div class="editor-grid">
                  <label>服务商名称<input v-model="draft.name" required placeholder="例如：团队生图网关" /></label>
                  <label>接口协议<select v-model="draft.protocol"><option value="openai">OpenAI Images</option><option value="gemini">Gemini 原生</option><option v-if="draft.protocol === 'one_xm'" value="one_xm">异步任务（旧配置）</option></select></label>
                </div>
                <label>Base URL<input v-model="draft.baseUrl" required type="url" :placeholder="draft.protocol === 'gemini' ? 'https://api.example.com/v1beta' : 'https://api.example.com/v1'" /></label>
                <label>API Key<input v-model="draft.apiKey" type="password" autocomplete="off" placeholder="填写服务商密钥" /></label>
                <label>模型 ID<textarea v-model="draft.modelsText" rows="4" required placeholder="每行一个模型 ID，例如 gpt-image-2" /></label>
                <p class="help">模型 ID 使用服务商的原始名称。保存后，各生图入口会显示“服务商 · 模型”。</p>
              </template>
              <template v-else>
                <div v-for="group in draft.groups" :key="group.title" class="connection-group">
                  <h4>{{ group.title }}</h4><p v-if="group.description" class="help">{{ group.description }}</p>
                  <label v-for="field in group.fields" :key="field.id">{{ field.label }}
                    <input v-model="draft.values[field.id]" :type="field.secret ? 'password' : 'url'" :placeholder="field.placeholder || ''" autocomplete="off" />
                  </label>
                </div>
                <div class="supported-models"><h4>可选模型</h4><div class="model-tags model-provider-models"><span v-for="model in draft.models" :key="model">{{ model }}</span></div></div>
              </template>
              <p v-if="editor.error" class="editor-error" role="alert">{{ editor.error }}</p>
            </div>
            <footer class="model-config-footer">
              <button v-if="draft.custom && !draft.preset && !editor.isNew" type="button" class="danger" :disabled="editor.saving" @click="removeProvider">移除服务商</button>
              <span class="spacer" />
              <button type="button" :disabled="editor.saving" @click="closeEditor">取消</button>
              <button class="primary" type="submit" :disabled="editor.saving">{{ editor.saving ? '保存中…' : '保存服务商' }}</button>
            </footer>
          </form>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import modeljettyLogoUrl from '../assets/modeljetty-mark.svg'
import crawshrimpLogoUrl from '../../../assets/branding/crawshrimp-avatar-C1.png'
import { MODELJETTY_IMAGE_PRESETS } from '../utils/modeljettyPresets.mjs'
import { computed, nextTick, reactive, ref } from 'vue'
import { AI_IMAGE_MODELS, CUSTOM_IMAGE_PROVIDERS_FIELD, customImageProviders } from '../utils/aiImageModels.js'
const props = defineProps({ config: { type: Object, required: true }, save: { type: Function, required: true } })
const builtin = [
  { id: 'woka', name: '沃卡', logo: 'WOKA', protocolLabel: 'OpenAI / Gemini', groups: [
    { title: '身份验证', description: 'GPT Image 与 Nano Banana 共用此密钥。', fields: [{ id: 'ai.woka.api_key', label: 'API Key', secret: true }] },
    { title: '接口地址', fields: [{ id: 'ai.woka.base_url', label: 'GPT Image · OpenAI Base URL' }, { id: 'ai.woka.gemini_base_url', label: 'Nano Banana · Gemini Base URL' }] },
  ] },
  { id: 'semir', name: '森马网关', logo: 'Semir', protocolLabel: 'OpenAI / Gemini', groups: [
    { title: 'GPT Image', fields: [{ id: 'ai.semir.base_url', label: 'OpenAI Base URL' }, { id: 'ai.semir.gpt_api_key', label: 'GPT API Key', secret: true }] },
    { title: 'Nano Banana', fields: [{ id: 'ai.semir.gemini_base_url', label: 'Gemini Base URL' }, { id: 'ai.semir.gemini_api_key', label: 'Google API Key', secret: true }] },
  ] },
]
const providers = computed(() => [
  ...MODELJETTY_IMAGE_PRESETS.map(preset => {
    const saved = customImageProviders(props.config).find(item => item.id === preset.id)
    const item = saved || preset
    return { ...item, preset: true, custom: true, baseUrl: item.base_url,
      protocolLabel: item.protocol === 'gemini' ? 'Gemini 原生' : 'OpenAI Images',
      configured: Boolean(item.api_key || item.configured), previewModels: item.models, modelCount: item.models.length }
  }),
  ...builtin.map(item => {
    const models = AI_IMAGE_MODELS.filter(model => model.provider === item.id)
    return { ...item, baseUrl: props.config[`ai.${item.id}.base_url`], configured: item.groups.some(group => group.fields.some(field => field.secret && props.config[field.id])), previewModels: ['GPT Image 2', 'Nano Banana 2', 'Nano Banana Pro'], modelCount: models.length, models: models.map(model => model.label.replace(/^.* · /, '')) }
  }),
  ...customImageProviders(props.config).filter(item => !MODELJETTY_IMAGE_PRESETS.some(preset => preset.id === item.id)).map(item => ({ ...item, custom: true, logo: item.name?.slice(0, 2).toUpperCase() || 'API', baseUrl: item.base_url, protocolLabel: { openai: 'OpenAI Images', gemini: 'Gemini 原生', one_xm: '异步任务' }[item.protocol], configured: Boolean(item.api_key || item.configured), previewModels: (item.models || []).slice(0, 3), modelCount: item.models?.length || 0, more: Math.max(0, (item.models?.length || 0) - 3) })),
].sort((left, right) => Number(right.id.startsWith('custom-managed-')) - Number(left.id.startsWith('custom-managed-'))))
const editor = reactive({ open: false, isNew: false, saving: false, error: '' })
const draft = reactive({ id: '', name: '', custom: false, protocol: 'openai', baseUrl: '', apiKey: '', modelsText: '', groups: [], models: [], values: {} })
const dialog = ref(null)
const savedMessage = ref('')
let restoreFocus = null
async function openEditor(provider) {
  restoreFocus = document.activeElement
  editor.isNew = !provider
  editor.error = ''
  Object.assign(draft, { preset: Boolean(provider?.preset), id: provider?.id || `custom-${crypto.randomUUID()}`, name: provider?.name || '', custom: !provider || Boolean(provider.custom), protocol: provider?.protocol || 'openai', baseUrl: provider?.baseUrl || '', apiKey: provider?.api_key || '', modelsText: (provider?.models || []).join('\n'), groups: provider?.groups || [], models: provider?.models || [], values: { ...props.config } })
  editor.open = true
  await nextTick()
  dialog.value?.focus()
}
function closeEditor() { if (editor.saving) return; editor.open = false; restoreFocus?.focus() }
function trapFocus(event) {
  const elements = [...dialog.value.querySelectorAll('button:not(:disabled), input, select, textarea')]
  const first = elements[0], last = elements.at(-1)
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
function validUrl(value) { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash } catch { return false } }
async function commit(patch, message) {
  editor.saving = true; editor.error = ''
  try { await props.save(patch); savedMessage.value = message; editor.saving = false; closeEditor() }
  catch (error) { editor.error = error?.message || '保存失败' }
  finally { editor.saving = false }
}
async function saveEditor() {
  const patch = {}
  if (draft.custom) {
    const models = [...new Set(draft.modelsText.split(/[\n,，]+/).map(value => value.trim()).filter(Boolean))]
    if (!draft.name.trim() || !validUrl(draft.baseUrl) || !models.length) { editor.error = '请填写服务商名称、有效接口地址和至少一个模型 ID。'; return }
    if (models.some(model => /\s/.test(model))) { editor.error = '模型 ID 不能包含空格。'; return }
    const next = { id: draft.id, name: draft.name.trim(), protocol: draft.protocol, base_url: draft.baseUrl.trim().replace(/\/$/, ''), api_key: draft.apiKey.trim(), models }
    patch[CUSTOM_IMAGE_PROVIDERS_FIELD] = [...customImageProviders(props.config).filter(item => item.id !== draft.id && !item.id.startsWith('custom-managed-')), next]
  } else {
    for (const group of draft.groups) for (const field of group.fields) {
      const value = String(draft.values[field.id] || '').trim()
      if (!field.secret && !validUrl(value)) { editor.error = '请填写有效的接口地址。'; return }
      patch[field.id] = value
    }
  }
  await commit(patch, `${draft.name} 已保存`)
}
async function removeProvider() {
  await commit({ [CUSTOM_IMAGE_PROVIDERS_FIELD]: customImageProviders(props.config).filter(item => item.id !== draft.id && !item.id.startsWith('custom-managed-')) }, '自定义服务商已移除')
}
</script>

<style scoped>
.connection-history { padding: 18px; display: grid; gap: 14px; border: 1px solid var(--border); border-radius: 10px; }
.connection-history summary { cursor: pointer; font-weight: 600; }
.history-scroll { overflow: auto; max-height: 420px; }
table { border-collapse: collapse; width: 100%; font-size: 12px; } th, td { text-align: left; padding: 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
td small { display: block; color: var(--text3); margin-top: 4px; overflow-wrap: anywhere; }

.image-provider-settings { display: grid; gap: 16px; }
.provider-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 16px; border: 1px solid var(--border, #34343e); border-radius: 10px; background: var(--bg3, #25252d); }
.provider-toolbar p, .provider-footnote { margin: 0; color: var(--text3, #9292a6); font-size: 13px; line-height: 1.6; }
button { cursor: pointer; border: 1px solid var(--border, #3b3b47); border-radius: 7px; background: transparent; color: var(--text, #ededf3); padding: 8px 13px; font: inherit; font-size: 13px; white-space: nowrap; }
button:hover { background: var(--bg3, #30303b); }
button.primary { background: #ff7026; color: #191411; border-color: #ff7026; font-weight: 600; }
:global(:root[data-theme-preference="lake"]) button.primary { background: var(--orange-strong); border-color: var(--orange-strong); color: var(--on-orange); }
:global(:root[data-theme-preference="lake"]) button.primary:hover:not(:disabled) { background: var(--orange-hover); border-color: var(--orange-hover); }
:global(:root[data-theme-preference="lake"]) :is(button,input,select,textarea):focus-visible { outline-color: var(--orange); }
:global(:root[data-theme-preference="lake"]) .image-provider-dialog header p { color: var(--orange-text); }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid #ff8d56; outline-offset: 3px; }
.provider-list { display: grid; gap: 12px; }
.provider-card { display: flex; align-items: flex-start; gap: 16px; padding: 20px; border: 1px solid var(--border, #34343e); border-radius: 11px; background: var(--bg3, #252531); }
.provider-logo { display: grid; place-items: center; width: 76px; flex: 0 0 76px; height: 36px; border-radius: 8px; background: #32323d; color: #fff; font-weight: 750; font-size: 19px; letter-spacing: -.6px; }
.provider-logo.woka { background: #583f91; }.provider-logo.semir { background: #008e50; }.provider-logo.\31 xm { background: #355da9; }
.provider-main { flex: 1; min-width: 0; }
.provider-heading { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
h4 { margin: 0; color: var(--text, #ededf3); font-size: 15px; }
.status, .tag { font-size: 11px; line-height: 1.5; border-radius: 5px; padding: 2px 6px; background: #85859519; color: var(--text3, #a5a5b7); }
.status.ready { background: #3eba8020; color: #4fce95; }
.endpoint { margin: 8px 0; font-size: 12px; color: var(--text3, #9292a6); overflow-wrap: anywhere; }
.model-tags { display: flex; gap: 6px; flex-wrap: wrap; }
.model-tags span { border-radius: 5px; padding: 3px 8px; background: #85859513; color: var(--text3, #aaaabb); font-size: 11px; }
.provider-actions { display: grid; gap: 10px; justify-items: end; flex-shrink: 0; }
.provider-actions small { font-size: 11px; color: var(--text3, #9292a6); }
.saved-message { color: #4fce95; font-size: 13px; margin: 0; }
.image-provider-backdrop { position: fixed; inset: 0; z-index: 2000; display: flex; justify-content: center; align-items: center; padding: 24px; background: #0009; }
.image-provider-dialog { width: 620px; max-width: 100%; max-height: calc(100vh - 48px); overflow: auto; background: var(--bg2, #1e1e27); border: 1px solid var(--border, #3b3b47); border-radius: 14px; box-shadow: 0 24px 80px #0006; color: var(--text, #ededf3); }
.image-provider-dialog header { padding: 22px 24px 18px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border, #34343e); }
.image-provider-dialog header p { font-size: 11px; color: #ff925c; margin: 0 0 7px; }.image-provider-dialog h3 { margin: 0; font-size: 20px; }
.editor-body { padding: 22px 24px; display: grid; gap: 20px; }
.connection-group { display: grid; gap: 14px; }.connection-group + .connection-group, .supported-models { border-top: 1px solid var(--border, #34343e); padding-top: 18px; }
.supported-models h4 { margin-bottom: 10px; }
label { display: grid; gap: 8px; color: var(--text3, #b5b5c4); font-size: 12px; }
input, select, textarea { box-sizing: border-box; width: 100%; min-width: 0; border-radius: 7px; border: 1px solid var(--border, #3b3b47); background: var(--bg, #14141c); color: var(--text, #ededf3); font: inherit; font-size: 13px; padding: 11px 12px; }
textarea { resize: vertical; }.editor-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.help { font-size: 12px; line-height: 1.6; margin: 0; color: var(--text3, #9696aa); }.editor-error { color: #fa8c8c; font-size: 13px; margin: 0; }
footer { position: sticky; bottom: 0; display: flex; gap: 10px; padding: 16px 24px; border-top: 1px solid var(--border, #34343e); background: var(--bg2, #1e1e27); }.spacer { flex: 1; }.danger { color: #f08c8c; }
@media (max-width: 820px) { .provider-toolbar { align-items: flex-start; flex-direction: column; }.provider-card { padding: 15px; gap: 12px; }.provider-logo { flex-basis: 76px; font-size: 15px; }.provider-heading { gap: 5px; }.editor-grid { grid-template-columns: 1fr; } }
</style>

<style scoped>
.provider-logo.modeljetty-logo { background: #fff; border: 1px solid #ddd; }
.modeljetty-logo img, .crawshrimp-logo img { width: 28px; height: 28px; object-fit: contain; }
.crawshrimp-logo img { border-radius: 0; }
</style>

<style scoped src="../styles/modelProviders.css"></style>
