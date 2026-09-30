// Development-only desktop acceptance of production components against real isolated files/tools.
import { createApp, h, ref } from 'vue'
import SessionResources from '../components/agent/SessionResources.vue'
import AgentProductLayer from '../components/agent/AgentProductLayer.vue'
if (!import.meta.env.DEV) throw new Error('Development acceptance only')
const origin = `http://127.0.0.1:${new URLSearchParams(location.search).get('qaPort') || '5189'}`
const nativeBridge = window.qaNative
const listeners = new Set()
window.cs = {
  agentApi: async (method,path,body) => { const response = await fetch(origin + path,{ method, headers: body ? {'Content-Type':'application/json'} : {}, body: body ? JSON.stringify(body) : undefined }); if (!response.ok) throw new Error(await response.text()); return response.json() },
  agentMediaUrl: async path => `${origin}/qa/media?path=${encodeURIComponent(path)}`,
  listAgentBrowserTabs: nativeBridge.listTabs,
  startAgentBrowserStream: nativeBridge.startStream,
  stopAgentBrowserStream: nativeBridge.stopStream,
  onAgentBrowserFrame: nativeBridge.onFrame,
  onAgentBrowserStatus: nativeBridge.onStatus,
  streamGlobalAgentEvents: fn => { listeners.add(fn); return () => listeners.delete(fn) },
  onAgentEvent: fn => { listeners.add(fn); return () => listeners.delete(fn) },
  openFile: async () => ({ok:false,error:'验收界面仅检查内置预览'}),
  revealFile: async () => ({ok:false,error:'测试文件位于独立临时目录'}),
}
const style = document.createElement('style')
style.textContent = `:root{font:14px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;--bg:#f7f7f8;--bg2:#fff;--bg3:#eeeef1;--text:#303540;--text2:#656b78;--text3:#8b909b;--text-muted:#7c8491;--border:#dddfe6;--orange:#ff6b2b;--green:#548974;--red:#ce6353;--accent:#ff6b2b}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}.qa-desktop{height:100vh;display:flex;position:relative}.qa-rail{width:220px;flex:none;background:var(--bg2);padding:24px 18px;border-right:1px solid var(--border)}.qa-rail button{display:block;margin:12px 0;padding:8px;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--text);cursor:pointer}.qa-rail small{color:var(--text3);display:block}.qa-chat{min-width:0;flex:1;padding:24px;display:flex;flex-direction:column}.qa-chat article{margin:auto;max-width:580px}.qa-chat h1{font-size:25px;font-weight:600}.qa-chat p{color:var(--text2)}.qa-composer{padding:20px;background:var(--bg2);border:1px solid var(--border);border-radius:14px;margin-top:auto;color:var(--text3)}.qa-outcome{font-size:11px;overflow-wrap:anywhere;color:var(--text3)}`
document.head.append(style)
createApp({setup(){
  const session = ref('qa-a'), panel = ref(null), revision = ref(0), result = ref(''), compact=ref(false)
  const open = event => { if (!event.detail.runtimeSessionId || event.detail.runtimeSessionId === session.value) panel.value?.openResource(event.detail) }
  const follow = event => panel.value?.followBrowserActivity(event.detail)
  window.addEventListener('cs-open-resource',open); window.addEventListener('cs-browser-activity',follow)
  async function browser(operation) {
    const value = await window.cs.agentApi('POST', `/qa/browser/${operation}`)
    result.value = JSON.stringify(value.result)
    if (value.activity) panel.value?.followBrowserActivity(value.activity)
    revision.value++
  }
  return () => h('div',{class:'qa-desktop'},[
    h('aside',{class:'qa-rail'},[h('strong','抓虾智能体'),h('small','P1 源码组件桌面验收'),h('button',{onClick:()=>session.value='qa-a'},'销售验收会话'),h('button',{onClick:()=>session.value='qa-b'},'独立空白会话'),h('button',{onClick:()=>browser('navigate')},'Agent 打开 example.com'),h('button',{onClick:()=>browser('click')},'Agent 点击 Learn more'),h('button',{onClick:()=>browser('verify')},'Agent 回读 URL / 标题'),h('p',{class:'qa-outcome'},result.value),h('small','真实文件 / 原 Office 作业 / 原 CDP 工具。会话外壳为独立验收夹具，未调用模型。')]),
    h('main',{class:'qa-chat',style:{marginRight:compact.value?'332px':undefined}},[h('header',session.value === 'qa-a' ? '童装销售交付' : '独立空白会话'),h('article',[h('h1','童装销售 · 3015 元'),h('p','销售 CSV、摘要、图表和 Office 文件已写入独立测试目录。从资源列表进入文件预览面板。'),h('p','可并排核对摘要与销售表，返回会话后继续查看。')]),h('div',{class:'qa-composer'},'继续输入消息…')]),
    h(SessionResources,{ref:panel,sessionId:session.value,conversationPhase:'active',revision:revision.value,onCompactChange:v=>compact.value=v}),
    h(AgentProductLayer,{resourceCompact:compact.value,activeRuntimeSessionId:session.value,onResourcesChanged:()=>revision.value++})
  ])
}}).mount('#app')
