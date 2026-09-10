import DOMPurify from 'dompurify'
import * as cssTree from 'css-tree'
const origin = 'https://preview.invalid/'
const MAX_TOTAL = 24 * 1024 * 1024
// No credential-bearing file URLs enter document HTML/CSS: approved bytes become data URLs.
export function resourceLoader(document, signal) {
  const cache = new Map()
  let total = 0
  return async function load(raw, base = '') {
    signal.throwIfAborted()
    if (!raw || /^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(raw.trim())) throw new Error('已阻止外部或绝对资源')
    const parts = base.split('/').slice(0, -1)
    for (const part of decodeURIComponent(raw.split(/[?#]/)[0]).split('/')) {
      if (part === '..') { if (!parts.length) throw new Error('资源超出文档目录'); parts.pop() }
      else if (part && part !== '.') parts.push(part)
    }
    const url = new URL(raw, origin + base)
    if (url.origin !== new URL(origin).origin) throw new Error('资源不在文档目录')
    const relative = url.pathname.slice(1)
    // Keep encoded traversal for the server to check; do not authorize another document root.
    if (!cache.has(relative)) {
      if (cache.size >= 64) throw new Error('预览最多加载 64 个资源')
      cache.set(relative, window.cs.agentApi('POST', '/agent/artifacts/preview-resource', { document, relative }).then(result => {
        signal.throwIfAborted()
        total += result.bytes
        if (total > MAX_TOTAL) throw new Error('预览资源总量超过 24 MB')
        return { ...result, relative, url: `data:${result.mime};base64,${result.data}` }
      }))
    }
    return cache.get(relative)
  }
}
async function safeCss(text, load, base, warnings) {
  let ast
  try { ast = cssTree.parse(text, { parseValue: true, parseCustomProperty: true }) } catch { warnings.add('部分样式无法解析'); return '' }
  const urls = []
  cssTree.walk(ast, { enter(node, item, list) {
    if (node.type === 'Atrule' && !['media', 'supports', 'font-face', 'keyframes', '-webkit-keyframes', 'layer'].includes(node.name.toLowerCase())) { list?.remove(item); return cssTree.walk.skip }
    if (node.type === 'Raw') { node.value = ''; warnings.add('部分样式已省略') }
    if (node.type === 'Url') urls.push(node)
  } })
  for (const node of urls) {
    try { const resource = await load(node.value, base); if (resource.mime === 'text/css') throw new Error(); node.value = resource.url }
    catch { node.value = 'data:,'; warnings.add('部分相对资源缺失或被阻止') }
  }
  return cssTree.generate(ast)
}
export async function prepareStaticHtml(text, load, signal, options = {}) {
  const warnings = new Set()
  // Parse in a detached inert template; DOMPurify removes all active HTML first.
  const fragment = DOMPurify.sanitize(text, { RETURN_DOM_FRAGMENT: true, FORCE_BODY: true, ADD_TAGS: ['link'], ADD_ATTR: ['rel'], FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'base', 'meta', 'video', 'audio', 'source', 'svg', 'math'], FORBID_ATTR: ['srcset', 'action', 'formaction', 'ping', 'target', 'download'] })
  for (const el of fragment.querySelectorAll('*')) {
    signal.throwIfAborted()
    if (el.tagName === 'LINK') {
      try {
        if (el.getAttribute('rel')?.toLowerCase() !== 'stylesheet') throw new Error()
        const resource = await load(el.getAttribute('href'))
        if (resource.mime !== 'text/css') throw new Error()
        const style = document.createElement('style')
        const bytes = Uint8Array.from(atob(resource.data), char => char.charCodeAt(0))
        style.textContent = await safeCss(new TextDecoder().decode(bytes), load, resource.relative, warnings)
        el.replaceWith(style)
      } catch { el.remove(); warnings.add('部分样式缺失或被阻止') }
      continue
    }
    if (el.tagName === 'STYLE') el.textContent = await safeCss(el.textContent, load, '', warnings)
    if (el.hasAttribute('style')) el.setAttribute('style', await safeCss(`x{${el.getAttribute('style')}}`, load, '', warnings).replace(/^x\{|\}$/g, ''))
    if (el.tagName === 'IMG') {
      try { const resource = await load(el.getAttribute('src')); if (!resource.mime.startsWith('image/')) throw new Error(); el.setAttribute('src', resource.url) }
      catch { el.removeAttribute('src'); warnings.add('部分图片缺失或被阻止') }
    }
    // Static preview has no navigation or executable resource attributes.
    for (const attr of [...el.attributes]) if (['href', 'xlink:href', 'background', 'srcdoc'].includes(attr.name) || attr.name === 'src' && el.tagName !== 'IMG') el.removeAttribute(attr.name)
  }
  signal.throwIfAborted()
  const container = document.createElement('div'); container.append(fragment)
  const csp = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"
  const markdownTheme = options.kind === 'markdown' ? `
:root{color-scheme:light dark;--paper:#fff;--ink:#24242b;--muted:#686874;--code:#f5f5f7;--line:#dedee5;--link:#386dcc}
@media(prefers-color-scheme:dark){:root{--paper:#1c1c24;--ink:#e7e7ef;--muted:#a1a1b1;--code:#242430;--line:#353541;--link:#90b5ff}}
html,body{background:var(--paper);color:var(--ink)}pre,code{background:var(--code);border-radius:6px}pre{border:1px solid var(--line)}:not(pre)>code{padding:2px 5px}td,th{border-color:var(--line)}th{background:var(--code)}a{color:var(--link)}blockquote{margin:16px 0;padding-left:14px;border-left:3px solid var(--line);color:var(--muted)}hr{border:0;border-top:1px solid var(--line)}
` : ''
  return { srcdoc: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>body{margin:20px;overflow-wrap:anywhere;font:14px/1.65 system-ui;color:#222;background:#fff}img{max-width:100%;height:auto}pre{overflow:auto;background:#f5f5f5;padding:12px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px}a{color:#5265ae}${markdownTheme}</style></head><body>${container.innerHTML}</body></html>`, warnings: [...warnings] }
}
