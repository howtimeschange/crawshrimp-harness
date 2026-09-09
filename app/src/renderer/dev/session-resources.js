// Development-only fixture: the real component with an in-memory bridge.
// No actual browser pages, files, or session records are created.
import { createApp, h, ref } from 'vue'
import SessionResources from '../components/agent/SessionResources.vue'
if (!import.meta.env.DEV) throw new Error('Development fixture only')

const tabs = Array.from({ length: 24 }, (_, i) => ({ id: `demo-${i + 1}`, title: `${String(i + 1).padStart(2, '0')} · ${['商品列表与价格带', '详情页与尺码信息', '销量趋势与来源核验'][i % 3]}`, url: `https://example.test/research/page-${i + 1}` }))
const artifacts = Array.from({ length: 120 }, (_, i) => ({ artifact_id: `demo-file-${i + 1}`, filename: `${String(i + 1).padStart(3, '0')}_${['类目价格带调研报告', '商品来源与统计口径', '超长名称_跨境儿童鞋服品类逐页核验结果与原始记录'][i % 3]}.${['md', 'csv', 'xlsx'][i % 3]}`, path: `/demo/research/batch-${Math.floor(i / 10) + 1}/result-${i + 1}.${['md', 'csv', 'xlsx'][i % 3]}`, size: 4096 * (i + 1) }))
const allTabs = [...tabs], allArtifacts = [...artifacts]
const frameListeners = new Set(), statusListeners = new Set()
function mockFrame(id) {
  const label = tabs.find(t => t.id === id)?.title || '模拟浏览器页面'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="500"><rect width="960" height="500" fill="#f6f7f9"/><rect width="960" height="58" fill="white"/><text x="32" y="38" font-family="sans-serif" font-size="22" fill="#343944">${label}</text>${Array.from({length:4},(_,i)=>`<rect x="${30+i*235}" y="88" width="205" height="255" rx="10" fill="${['#eaded5','#dce5e5','#e5e2ea','#e2e7da'][i]}"/><rect x="${30+i*235}" y="361" width="160" height="12" rx="6" fill="#c7ccd2"/><rect x="${30+i*235}" y="389" width="82" height="12" rx="6" fill="#d9dde2"/>`).join('')}<text x="32" y="466" font-family="sans-serif" font-size="16" fill="#7a8190">模拟页面 · 仅用于布局验证</text></svg>`
  return { targetId: id, dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, url: 'https://example.test/research', width:960, height:500 }
}
window.cs = {
  agentApi: async (method, path) => {
    if (method !== 'GET') throw new Error('演示页面不创建或关闭真实页面')
    return { tabs, artifacts, activeTabId: 'demo-1' }
  },
  listAgentBrowserTabs: async () => ({ ok:true, tabs }),
  startAgentBrowserStream: async id => { queueMicrotask(() => { frameListeners.forEach(fn => fn(mockFrame(id))); statusListeners.forEach(fn => fn({targetId:id, state:'connected'})) }); return {ok:true} },
  stopAgentBrowserStream: async () => ({ok:true}),
  onAgentBrowserFrame: fn => { frameListeners.add(fn); return () => frameListeners.delete(fn) },
  onAgentBrowserStatus: fn => { statusListeners.add(fn); return () => statusListeners.delete(fn) },
  agentMediaUrl: async path => `data:text/plain;charset=utf-8,${encodeURIComponent(`# 模拟产物预览\n\n${path}\n\n此内容只用于验证预览布局。`)}`,
  openFile: async () => ({ok:false, error:'模拟文件仅提供内置预览'}),
  revealFile: async () => ({ok:false, error:'模拟文件没有真实路径'}),
}
const style = document.createElement('style')
style.textContent = `:root{font:14px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;--bg:#f7f7f8;--bg2:#fff;--text:#303540;--text2:#656b78;--text3:#8b909b;--border:#dddfe6;--accent:#ff6b2b}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}.demo{position:relative;height:100vh;display:flex}.rail{width:220px;padding:24px;background:white;border-right:1px solid var(--border);flex:none}.rail p{font-size:12px;color:var(--text2)}.chat{flex:1;min-width:0;display:flex;flex-direction:column;padding:24px}.chat header{font-weight:600}.transcript{width:min(100%,760px);margin:auto;line-height:1.9}.transcript h1{font-size:25px;font-weight:600}.transcript p{color:var(--text2)}.composer{width:min(100%,760px);margin:20px auto 0;padding:20px;background:white;border:1px solid var(--border);border-radius:16px;color:var(--text3)}.badge{font-size:12px;background:#efeee9;border-radius:5px;padding:4px 8px}.rail button{display:block;margin-top:16px;padding:7px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text2);cursor:pointer}`
document.head.append(style)
createApp({ setup() {
  const compact = ref(false), revision = ref(0), count = ref(true)
  return () => h('div', {class:'demo'}, [
    h('aside', {class:'rail'}, [h('strong', '抓虾智能体'),h('p','会话资源布局演示'),h('span',{class:'badge'},count.value ? '24 个页面 · 120 个产物' : '1 个页面 · 3 个产物'),h('button',{onClick:()=>{ count.value = !count.value; tabs.splice(0, tabs.length, ...allTabs.slice(0, count.value ? 24 : 1)); artifacts.splice(0, artifacts.length, ...allArtifacts.slice(0, count.value ? 120 : 3)); revision.value++ }},'切换少量 / 大量数据'),h('p','所有数据均为模拟；点击资源可预览。搜索支持文件名、路径、页面标题和网址。')]),
    h('main',{class:'chat',style:{marginRight:compact.value?'332px':undefined}},[h('header','跨境品类调研'),h('article',{class:'transcript'},[h('h1','已整理页面与调研产物'),h('p','页面与产物分别在卡片内滚动，分组标题、搜索入口及日志下载保持可见。长文件名保持一行，悬停可查看完整名称和路径。'),h('p','浏览器画面位于卡片下方。点击小窗进入半屏，多个页面通过横向标签切换，左侧边界仍可拖动调整宽度。'),h('p','试试搜索「120」「page-24」或「csv」，再按 Esc 恢复全部列表。')]),h('div',{class:'composer'},'继续输入消息…')]),
    h(SessionResources,{sessionId:'layout-demo-v1',revision:revision.value,onCompactChange:v=>compact.value=v,onDownloadLog:()=>alert('演示模式：不导出真实会话日志')})
  ])
} }).mount('#app')
