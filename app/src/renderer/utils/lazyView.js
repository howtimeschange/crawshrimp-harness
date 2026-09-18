import { defineAsyncComponent, h } from 'vue'
const loadingComponent = { render: () => h('div', { role: 'status', style: 'padding:24px;color:var(--text-muted)' }, '正在加载…') }
const errorComponent = { render: () => h('div', { role: 'alert', style: 'padding:24px' }, '页面加载失败，请切换页面后重试。') }
export function lazyView(loader) {
  return defineAsyncComponent({ loader, loadingComponent, errorComponent, delay: 150, timeout: 30000,
    onError(error, retry, fail, attempts) { if (attempts < 2) retry(); else fail() },
  })
}
