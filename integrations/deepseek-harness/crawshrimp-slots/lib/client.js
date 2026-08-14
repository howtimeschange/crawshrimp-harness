// 抓虾品牌适配(client bundle,__ModuleLoader__ 工厂格式,与 tsdown 产物同构)。
// 职责(方案 §12.7 的 crawshrimp-slots + 去 DeepSeek 品牌化):
// 1. 用抓虾品牌 token 覆盖 DSH 的 alias 主题层(亮/暗双套),DSH UI 与抓虾 App 同色;
// 2. 跟随 shell 主题:读取 URL ?theme= 并监听 postMessage({__crawshrimp:'theme'});
// 3. 去 DeepSeek 品牌:替换 wordmark 为「🦐 抓虾智能体」、隐藏 DSH 侧边栏设置入口
//    (模型/外观由抓虾原生 UI 负责),浏览器标题改为抓虾。
// 注:下面的类名 hash(hHd-Xa_*)由锁版 @deepseek-ai/*@0.1.0-rc.6 构建产物固定;
// 升级 DSH 版本时需同步核对。
window.__ModuleLoader__.load({
  id: 'crawshrimp-slots',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    // 抓虾主题色(app/src/renderer/App.vue 的 :root 变量)→ DSH alias tokens
    const CRAWSHRIMP_TOKENS = {
      '--dsw-alias-bg-base': { light: '#f7f7f8', dark: '#141418' },
      '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#1c1c22' },
      '--dsw-alias-bg-layer-2': { light: '#efeff1', dark: '#242430' },
      '--dsw-alias-bg-overlay': { light: '#e6e6e9', dark: '#292932' },
      '--dsw-alias-border-l1': { light: '#d8d8de', dark: '#2e2e3a' },
      '--dsw-alias-border-l2': { light: '#b9bac3', dark: '#484858' },
      '--dsw-alias-brand-primary': { light: '#FF5000', dark: '#FF6B2B' },
      '--dsw-alias-brand-primary-invert': { light: '#ffffff', dark: '#17131A' },
      '--dsw-alias-brand-text': { light: '#FF5000', dark: '#FF6B2B' },
      '--dsw-alias-label-primary': { light: '#24242b', dark: '#e2e0f0' },
      '--dsw-alias-label-secondary': { light: '#565866', dark: '#aaa8bd' },
      '--dsw-alias-state-error-primary': { light: '#d02020', dark: '#f87171' },
      '--dsw-alias-state-success-primary': { light: '#14783a', dark: '#4ade80' },
      '--dsw-alias-state-warn-primary': { light: '#985c06', dark: '#fbbf24' },
      // 业务主色(按钮主色/焦点/高亮):DeepSeek 蓝 → 抓虾橙
      '--dsw-alias-state-business-primary': { light: '#FF5000', dark: '#FF6B2B' },
      '--dsw-alias-state-business-tertiary': { light: '#FFE8DD', dark: 'rgba(255, 107, 43, 0.16)' },
      '--dsw-specific-sidebar-fill': { light: '#ffffff', dark: '#1c1c22' },
    }

    // DeepSeek 蓝阶 / 通用蓝阶 → 抓虾橙阶(light 用 #FF5000 系,dark 用 #FF6B2B 系)
    const ORANGE_STEPS = {
      light: {
        50: '#FFF0E9', '50p': 'rgba(255, 80, 0, 0.08)', 75: '#FFEFE6', 100: '#FFE3D5',
        200: '#FFC9AD', 300: '#FFAB80', 400: '#FF6B2B', 450: '#FF5A12',
        500: '#FF5000', 600: '#CC4000', 800: '#A63600', 900: '#8A2D00', 950: '#662200',
      },
      dark: {
        50: 'rgba(255, 107, 43, 0.08)', '50p': 'rgba(255, 107, 43, 0.06)', 75: 'rgba(255, 107, 43, 0.12)',
        100: 'rgba(255, 107, 43, 0.14)', 200: 'rgba(255, 107, 43, 0.24)', 300: '#FF8B5F',
        400: '#FF8B5F', 450: '#FF7A3E', 500: '#FF6B2B', 600: '#E94700',
        800: '#FF9A66', 900: '#FFB08C', 950: '#FFC9AD',
      },
    }
    for (const step of Object.keys(ORANGE_STEPS.light)) {
      CRAWSHRIMP_TOKENS[`--dsw-static-deepseek-${step}`] = { light: ORANGE_STEPS.light[step], dark: ORANGE_STEPS.dark[step] }
      CRAWSHRIMP_TOKENS[`--dsw-static-blue-${step}`] = { light: ORANGE_STEPS.light[step], dark: ORANGE_STEPS.dark[step] }
    }
    // deepseek-700 已废弃(700-delete),也覆盖,防引用
    CRAWSHRIMP_TOKENS['--dsw-static-deepseek-700-delete'] = { light: '#D94300', dark: '#F05615' }

    // 去品牌 + 抓虾化样式
    const BRAND_CSS = [
      // 1) 替换 DeepSeek wordmark(182:24 的 "DeepSeek" 文字 svg)为抓虾品牌
      'svg[viewBox="0 0 182 24"] { display: none !important; }',
      '.hHd-Xa_brand::after {',
      '  content: "🦐 抓虾智能体";',
      '  font-size: 14px;',
      '  font-weight: 700;',
      '  letter-spacing: 0.01em;',
      '  color: var(--dsw-alias-label-primary);',
      '  white-space: nowrap;',
      '  overflow: hidden;',
      '}',
      // 2) 折叠态的 DSH 装饰鱼标
      '.hHd-Xa_railFish { display: none !important; }',
      // 3) 隐藏 DSH 设置入口(模型/外观由抓虾原生 UI 负责)
      '.hHd-Xa_settingsArea { display: none !important; }',
      // 4) 运行中状态文案 "Deep diving..." → 「抓虾中...」(硬编码字符串,CSS 替换)
      '.Md3f7G_turnStatus { font-size: 0 !important; }',
      '.Md3f7G_turnStatus::before { content: "抓虾中..."; font-size: 12px; }',
      '.Md3f7G_turnStatus .Md3f7G_turnStatusClock { font-size: 12px; }',
      // 5) 选中/强调色随抓虾橙
      '::selection { background: rgba(255, 107, 43, 0.25); }',
    ].join('\n')

    function injectBrandCss() {
      const tagId = 'crawshrimp-slots/brand'
      if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'crawshrimp-slots'
        tag.dataset.pluginCss = tagId
        tag.textContent = BRAND_CSS
        document.head.appendChild(tag)
      }
    }

    function apply(ctx) {
      ctx.theme.overrideTokens('crawshrimp', CRAWSHRIMP_TOKENS)
      injectBrandCss()
      // 浏览器标题:去 DeepSeek(DocumentTitle 组件以 title 原文为后缀拼接)
      try {
        document.title = '抓虾智能体'
      } catch (error) {
        // 忽略
      }
      const adopt = (theme) => {
        if (theme !== 'light' && theme !== 'dark') return
        try {
          ctx.theme.setTheme(theme)
        } catch (error) {
          // 已是当前主题或不可写,忽略
        }
      }
      try {
        const query = new URLSearchParams(window.location.search).get('theme')
        if (query) adopt(query)
      } catch (error) {
        // 无 URL 参数,交给 shell 的 postMessage
      }
      window.addEventListener('message', (event) => {
        const data = event && event.data
        if (data && data.__crawshrimp === 'theme') adopt(data.theme)
      })
    }

    exports.apply = apply
    // kernel 服务依赖声明:apply 内访问 ctx.theme 必须显式 inject
    exports.inject = ['theme']
    return module.exports
  },
})
