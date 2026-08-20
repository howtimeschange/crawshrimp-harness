// 抓虾品牌适配(client bundle,__ModuleLoader__ 工厂格式,与 tsdown 产物同构)。
// 职责(方案 §12.7 的 crawshrimp-slots + 去 DeepSeek 品牌化):
// 1. 用抓虾品牌 token 覆盖 DSH 的 alias 主题层(亮/暗双套),DSH UI 与抓虾 App 同色;
// 2. 跟随 shell 主题:读取 URL ?theme= 并监听 postMessage({__crawshrimp:'theme'});
// 3. 去 DeepSeek 品牌:注册抓虾 brand slots、隐藏 DSH 侧边栏设置入口
//    (模型/外观由抓虾原生 UI 负责),浏览器标题改为抓虾。
// 注:下面的类名 hash(hHd-Xa_*)由锁版 @deepseek-ai/*@0.1.0-rc.8 构建产物固定;
// 升级 DSH 版本时需同步核对。
window.__ModuleLoader__.load({
  id: 'crawshrimp-slots',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    let react = require('react')

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

    let currentRuntimeSessionId = ''
    let lastPublishedRuntimeSessionId = ''
    const pendingAttachmentHintsBySession = new Map()

    function persistedRuntimeSessionId() {
      // 新建会话在发送首条消息前，sessions.list 的 current 仍可能为空；
      // 锁版 DSH 已把预分配 sessionId 写入该持久化键。附件入口必须能在
      // 空会话直接使用，不能要求用户先发一条纯文本来“激活”会话。
      try {
        const raw = window.localStorage?.getItem?.('dsh.sessions.current') || ''
        const value = raw ? JSON.parse(raw) : null
        return String(value?.sessionId || '')
      } catch (error) {
        return ''
      }
    }

    function activeRuntimeSessionId() {
      const persisted = persistedRuntimeSessionId()
      if (persisted && persisted !== currentRuntimeSessionId) currentRuntimeSessionId = persisted
      return persisted || currentRuntimeSessionId
    }

    function shellOrigin() {
      try {
        const origin = new URL(document.referrer).origin
        return origin && origin !== 'null' ? origin : '*'
      } catch (error) {
        return '*'
      }
    }
    function postToShell(message) {
      window.parent.postMessage(message, shellOrigin())
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

    const CRAWSHRIMP_BRAND_NAME = '抓虾智能体'

    function CrawshrimpBrandMark({ size = 24, className } = {}) {
      const px = Number(size) || 24
      return react.createElement('span', {
        className: ['cs-brand-mark', className].filter(Boolean).join(' '),
        'aria-hidden': 'true',
        style: {
          width: `${px}px`,
          height: `${px}px`,
          fontSize: `${Math.max(16, Math.round(px * 0.76))}px`,
          lineHeight: `${px}px`,
        },
      }, '🦐')
    }

    function CrawshrimpBrandName() {
      return react.createElement('span', { className: 'cs-brand-name' }, CRAWSHRIMP_BRAND_NAME)
    }

    function registerCrawshrimpBrandSlots(ctx) {
      if (!ctx.slots?.inject || !ctx.slots?.register) return
      ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.inject('sidebar.brand.name', () => ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, CrawshrimpBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, CrawshrimpBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, CrawshrimpBrandMark)
      })))
    }

    // 去品牌 + 抓虾化样式
    const BRAND_CSS = [
      // 1) 抓虾 brand slots:左上角只保留抓虾 logo +「抓虾智能体」
      'svg[viewBox="0 0 182 24"] { display: none !important; }',
      '.cs-brand-mark {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  flex: none;',
      '}',
      '.cs-brand-name {',
      '  font-size: 17px;',
      '  font-weight: 750;',
      '  letter-spacing: 0;',
      '  color: var(--dsw-alias-label-primary);',
      '  white-space: nowrap;',
      '  overflow: hidden;',
      '}',
      // 2) 折叠态的 DSH 装饰鱼标
      '.hHd-Xa_railFish { display: none !important; }',
      // 2b) 侧栏折叠/展开按钮放大(28px→32px,图标 16px,清晰可点)
      '.hHd-Xa_toggle, .hHd-Xa_iconButton { width: 32px !important; height: 32px !important; font-size: 16px !important; }',
      '.hHd-Xa_collapsed .hHd-Xa_toggle, .hHd-Xa_collapsed .hHd-Xa_iconButton { width: 32px !important; height: 32px !important; }',
      // 3) 隐藏 DSH 设置入口(模型/外观由抓虾原生 UI 负责)
      '.hHd-Xa_settingsArea { display: none !important; }',
      // 4) 运行中状态文案 "Deep diving..." → 「抓虾中...」(硬编码字符串,CSS 替换)
      '.Md3f7G_turnStatus { font-size: 0 !important; }',
      '.Md3f7G_turnStatus::before { content: "抓虾中..."; font-size: 12px; }',
      '.Md3f7G_turnStatus .Md3f7G_turnStatusClock { font-size: 12px; }',
      // 5) 新会话空状态 hero:去 DeepSeek 鱼 logo 与文案,替换为抓虾
      'svg[viewBox="0 0 23.16 17.04"] { display: none !important; }',
      '.pXSMma_headlineText { font-size: 0 !important; }',
      '.pXSMma_headlineText::before { content: "抓虾智能体"; font-size: 24px; font-weight: 750; color: var(--dsw-alias-label-primary); }',
      '.pXSMma_previewBadge { display: none !important; }',
      // 6) 抓虾菜单注入侧边栏(主菜单:新会话下/工作区上;底部菜单:云端审批/设置)
      //    按 DESIGN.md 规范:13.5px 字号、4px 网格间距、完整 hover/active/focus 状态
      '[data-crawshrimp-nav-main], [data-crawshrimp-nav-bottom] { display: flex; flex-direction: column; gap: 2px; padding: 10px 6px; margin: 2px 2px 0; }',
      '[data-crawshrimp-nav-main] { border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 12px; }',
      '[data-crawshrimp-nav-bottom] { border-top: 1px solid var(--dsw-alias-border-l1); margin-top: auto; padding-bottom: 10px; }',
      '.cs-nav-item { display: flex; align-items: center; gap: 8px; width: 100%; border: none; background: transparent; color: var(--dsw-alias-label-secondary); padding: 7px 10px; border-radius: 8px; cursor: pointer; font-size: 13.5px; line-height: 1.45; text-align: left; font-family: inherit; transition: background-color 120ms cubic-bezier(0.4, 0, 0.2, 1), color 120ms cubic-bezier(0.4, 0, 0.2, 1); }',
      '.cs-nav-item:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
      '.cs-nav-item:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }',
      '.cs-nav-item:active { background: var(--dsw-alias-interactive-bg-active, rgba(255, 107, 43, 0.18)); }',
      '.cs-nav-active { background: var(--dsw-alias-state-business-tertiary); color: var(--dsw-alias-state-business-primary); font-weight: 600; }',
      '.cs-nav-icon { width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; flex: none; font-size: 15px; }',
      '.cs-nav-toggle { color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary)); font-size: 12.5px; }',
      '.cs-nav-toggle .cs-nav-icon { font-size: 16px; transition: transform 150ms cubic-bezier(0.4, 0, 0.2, 1); }',
      '.cs-nav-toggle[aria-expanded="true"] .cs-nav-icon { transform: rotate(180deg); }',
      '.hHd-Xa_collapsed [data-crawshrimp-nav-main] .cs-nav-label, .hHd-Xa_collapsed [data-crawshrimp-nav-bottom] .cs-nav-label { display: none; }',
      '.hHd-Xa_collapsed .cs-nav-item { justify-content: center; padding: 7px 0; }',
      '.hHd-Xa_collapsed .cs-nav-icon { font-size: 17px; }',
      '@media (prefers-reduced-motion: reduce) { .cs-nav-item, .cs-nav-toggle .cs-nav-icon { transition: none; } }',
      // 7) 选中/强调色随抓虾橙
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

    function normalizeDocumentTitle() {
      try {
        if (document.title !== CRAWSHRIMP_BRAND_NAME) document.title = CRAWSHRIMP_BRAND_NAME
      } catch (error) {
        // 忽略
      }
    }

    // ---- 抓虾菜单注入 DSH 侧边栏(主菜单 + 底部菜单) ----
    const MAIN_NAV_IDS = ['scripts', 'agent_script_review', 'ai_image', 'task_center', 'ai_video_generation', 'ai_video', 'local_prompt_library', 'files']
    const BOTTOM_NAV_IDS = ['cloud_approval', 'settings']
    const MAIN_VISIBLE_DEFAULT = 3

    let lastMaxRailWidth = 0
    let lastRailMetricsSignature = ''
    let railMetricsQueued = false
    let railMetricsForceQueued = false
    let railResizeObserver = null
    let railResizeTarget = null

    function currentRailTarget() {
      const rail = document.querySelector('.hHd-Xa_root')
      if (!rail) return null
      return rail.closest('[class*="sidebarCol"]') || rail.parentElement || rail
    }

    function currentRailWidth() {
      const target = currentRailTarget()
      if (!target) return 0
      const width = Math.round(target.getBoundingClientRect().width)
      if (width > lastMaxRailWidth) lastMaxRailWidth = width
      return width
    }

    function updateNavButton(btn, item, activeId) {
      if (!btn || !item) return
      if (btn.dataset.csNavItemId !== item.id) btn.dataset.csNavItemId = item.id
      btn.classList.toggle('cs-nav-active', item.id === activeId)
      if (btn.title !== (item.label || '')) btn.title = item.label || ''
      let icon = btn.querySelector(':scope > .cs-nav-icon')
      if (!icon) {
        icon = document.createElement('span')
        icon.className = 'cs-nav-icon'
        btn.prepend(icon)
      }
      if (icon.textContent !== (item.icon || '')) icon.textContent = item.icon || ''
      let label = btn.querySelector(':scope > .cs-nav-label')
      if (!label) {
        label = document.createElement('span')
        label.className = 'cs-nav-label'
        btn.appendChild(label)
      }
      const labelText = item.label || item.id
      if (label.textContent !== labelText) label.textContent = labelText
    }

    function makeNavButton(item, activeId) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'cs-nav-item'
      updateNavButton(btn, item, activeId)
      btn.addEventListener('click', () => {
        // 携带 max(当前宽, 历史最大宽):折叠动画中点菜单也不会压到菜单栏
        const width = Math.max(currentRailWidth(), lastMaxRailWidth)
        postToShell({ __crawshrimp: 'nav-click', id: btn.dataset.csNavItemId, railWidth: width })
      })
      return btn
    }

    function findNavButton(host, id) {
      return [...host.querySelectorAll(':scope > .cs-nav-item:not(.cs-nav-toggle)')]
        .find((btn) => btn.dataset.csNavItemId === id)
    }

    function updateNavToggle(toggle, host, items, activeId, collapsible) {
      const expanded = host.dataset.expanded === '1'
      toggle.type = 'button'
      toggle.className = 'cs-nav-item cs-nav-toggle'
      toggle.setAttribute('aria-expanded', String(expanded))
      toggle.title = expanded ? '收起菜单' : '展开全部菜单'
      let icon = toggle.querySelector(':scope > .cs-nav-icon')
      if (!icon) {
        icon = document.createElement('span')
        icon.className = 'cs-nav-icon'
        toggle.appendChild(icon)
      }
      if (icon.textContent !== '▾') icon.textContent = '▾'
      let label = toggle.querySelector(':scope > .cs-nav-label')
      if (!label) {
        label = document.createElement('span')
        label.className = 'cs-nav-label'
        toggle.appendChild(label)
      }
      const labelText = expanded ? '收起' : `展开全部(${items.length - MAIN_VISIBLE_DEFAULT})`
      if (label.textContent !== labelText) label.textContent = labelText
      toggle.onclick = () => {
        host.dataset.expanded = host.dataset.expanded === '1' ? '0' : '1'
        renderGroup(host, items, activeId, collapsible)
      }
    }

    function renderGroup(host, items, activeId, collapsible) {
      const expanded = host.dataset.expanded === '1'
      const visible = collapsible && !expanded ? items.slice(0, MAIN_VISIBLE_DEFAULT) : items
      const visibleIds = new Set(visible.map((item) => item.id))
      let toggle = host.querySelector(':scope > .cs-nav-toggle')
      for (const item of visible) {
        const btn = findNavButton(host, item.id) || makeNavButton(item, activeId)
        updateNavButton(btn, item, activeId)
        host.insertBefore(btn, toggle || null)
      }
      for (const btn of [...host.querySelectorAll(':scope > .cs-nav-item:not(.cs-nav-toggle)')]) {
        if (!visibleIds.has(btn.dataset.csNavItemId)) btn.remove()
      }
      if (collapsible && items.length > MAIN_VISIBLE_DEFAULT) {
        if (!toggle) toggle = document.createElement('button')
        updateNavToggle(toggle, host, items, activeId, collapsible)
        host.appendChild(toggle)
      } else if (toggle) {
        toggle.remove()
      }
      host.dataset.signature = visible.map((item) => item.id).join(',') + '|' + (collapsible ? host.dataset.expanded || '0' : '')
    }

    function renderNav(items, activeId) {
      const rail = document.querySelector('.hHd-Xa_root')
      if (!rail) return
      const byId = new Map((items || []).map((item) => [item.id, item]))
      const mainItems = MAIN_NAV_IDS.map((id) => byId.get(id)).filter(Boolean)
      const bottomItems = BOTTOM_NAV_IDS.map((id) => byId.get(id)).filter(Boolean)

      let main = rail.querySelector('[data-crawshrimp-nav-main]')
      if (!main) {
        main = document.createElement('div')
        main.dataset.crawshrimpNavMain = '1'
        const region = rail.querySelector('.hHd-Xa_regionArea')
        if (region) rail.insertBefore(main, region)
        else rail.appendChild(main)
      }
      let bottom = rail.querySelector('[data-crawshrimp-nav-bottom]')
      if (!bottom) {
        bottom = document.createElement('div')
        bottom.dataset.crawshrimpNavBottom = '1'
        const foot = rail.querySelector('.hHd-Xa_footArea')
        if (foot) rail.insertBefore(bottom, foot)
        else rail.appendChild(bottom)
      }
      renderGroup(main, mainItems, activeId, true)
      renderGroup(bottom, bottomItems, activeId, false)
    }

    // ---- 侧边栏宽度/折叠状态推送(shell 内容区覆盖层偏移用) ----
    function pushRailMetrics(options = {}) {
      const width = currentRailWidth()
      if (!width) return
      const rail = document.querySelector('.hHd-Xa_root')
      const collapsed = rail ? rail.classList.contains('hHd-Xa_collapsed') : false
      const signature = `${width}|${collapsed ? '1' : '0'}`
      if (!options.force && signature === lastRailMetricsSignature) return
      lastRailMetricsSignature = signature
      postToShell({ __crawshrimp: 'rail-metrics', width, collapsed })
    }

    function scheduleRailMetricsPush(force = false) {
      railMetricsForceQueued = railMetricsForceQueued || force
      if (railMetricsQueued) return
      railMetricsQueued = true
      const run = () => {
        railMetricsQueued = false
        const forceNow = railMetricsForceQueued
        railMetricsForceQueued = false
        pushRailMetrics({ force: forceNow })
      }
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(run)
      } else {
        setTimeout(run, 50)
      }
    }

    function installRailResizeObserver() {
      if (typeof ResizeObserver === 'undefined') return
      const target = currentRailTarget()
      if (!target || target === railResizeTarget) return
      if (railResizeObserver) railResizeObserver.disconnect()
      railResizeTarget = target
      railResizeObserver = new ResizeObserver(() => scheduleRailMetricsPush())
      railResizeObserver.observe(target)
    }

    // ---- 产物媒体注入:会话消息流内直接显示图片(多图)/视频(可播放)/附件(可点击) ----
    const ARTIFACT_CSS = [
      '.cs-artifact-block { margin: 10px 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); padding: 10px 12px; max-width: 560px; align-self: flex-start; }',
      '.cs-artifact-head { display: flex; align-items: center; gap: 8px; cursor: pointer; }',
      '.cs-artifact-icon { width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 16px; flex: none; background: var(--dsw-alias-state-business-tertiary); }',
      '.cs-artifact-name { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 600; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.cs-artifact-size { font-size: 12px; color: var(--dsw-alias-label-secondary); flex: none; }',
      '.cs-artifact-open { flex: none; border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-primary); border-radius: 7px; padding: 5px 12px; font-size: 12.5px; cursor: pointer; transition: background-color 120ms cubic-bezier(0.4, 0, 0.2, 1); }',
      '.cs-artifact-open:hover { background: var(--dsw-alias-interactive-bg-hover); }',
      '.cs-artifact-open:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }',
      '.cs-artifact-img { display: block; max-width: 100%; max-height: 320px; border-radius: 8px; cursor: pointer; margin-top: 8px; border: 1px solid var(--dsw-alias-border-l1); }',
      '.cs-artifact-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin-top: 8px; }',
      '.cs-artifact-grid img { width: 100%; height: 150px; object-fit: cover; border-radius: 8px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l1); transition: transform 120ms cubic-bezier(0.4, 0, 0.2, 1), border-color 120ms cubic-bezier(0.4, 0, 0.2, 1); }',
      '.cs-artifact-grid img:hover { border-color: var(--dsw-alias-state-business-primary); transform: scale(1.01); }',
      '.cs-artifact-video { display: block; width: 100%; max-width: 480px; max-height: 340px; border-radius: 8px; margin-top: 8px; background: #000; }',
      '.cs-artifact-audio { display: block; width: 100%; margin-top: 8px; }',
      '.cs-artifact-zip-hint { margin-top: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); }',
      '@media (prefers-reduced-motion: reduce) { .cs-artifact-grid img { transition: none; } }',
    ].join('\n')

    function injectArtifactCss() {
      const tagId = 'crawshrimp-slots/artifacts'
      if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'crawshrimp-slots'
        tag.dataset.pluginCss = tagId
        tag.textContent = ARTIFACT_CSS
        document.head.appendChild(tag)
      }
    }

    function artifactSizeText(size) {
      const n = Number(size) || 0
      if (!n) return ''
      if (n < 1024) return `${n} B`
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
      return `${(n / 1024 / 1024).toFixed(1)} MB`
    }

    function artifactIconFor(mediaKind, filename) {
      if (mediaKind === 'image') return '🖼️'
      if (mediaKind === 'video') return '🎬'
      if (mediaKind === 'audio') return '🎧'
      if (mediaKind === 'zip') return '📦'
      const lower = String(filename || '').toLowerCase()
      if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) return '📊'
      return '📄'
    }

    function makeArtifactBlock(artifact, urls) {
      const block = document.createElement('div')
      block.className = 'cs-artifact-block'
      block.dataset.artifactPath = String(artifact.path || '')
      const open = () => {
        if (artifact.path) postToShell({ __crawshrimp: 'open-file', path: artifact.path })
      }

      const head = document.createElement('div')
      head.className = 'cs-artifact-head'
      head.title = '点击打开文件'
      const icon = document.createElement('span')
      icon.className = 'cs-artifact-icon'
      icon.textContent = artifactIconFor(artifact.mediaKind, artifact.filename)
      const name = document.createElement('span')
      name.className = 'cs-artifact-name'
      name.textContent = artifact.filename || '产物文件'
      const size = document.createElement('span')
      size.className = 'cs-artifact-size'
      size.textContent = artifactSizeText(artifact.size)
      const openBtn = document.createElement('button')
      openBtn.type = 'button'
      openBtn.className = 'cs-artifact-open'
      openBtn.textContent = '打开'
      openBtn.addEventListener('click', (event) => {
        event.stopPropagation()
        open()
      })
      head.appendChild(icon)
      head.appendChild(name)
      head.appendChild(size)
      head.appendChild(openBtn)
      head.addEventListener('click', open)
      block.appendChild(head)

      const fileUrl = urls.file || ''
      if (artifact.mediaKind === 'image' && fileUrl) {
        const img = document.createElement('img')
        img.className = 'cs-artifact-img'
        img.src = fileUrl
        img.alt = artifact.filename || ''
        img.decoding = 'async'
        img.addEventListener('click', open)
        block.appendChild(img)
      } else if (artifact.mediaKind === 'video' && fileUrl) {
        const video = document.createElement('video')
        video.className = 'cs-artifact-video'
        video.controls = true
        video.preload = 'metadata'
        video.src = fileUrl
        block.appendChild(video)
      } else if (artifact.mediaKind === 'audio' && fileUrl) {
        const audio = document.createElement('audio')
        audio.className = 'cs-artifact-audio'
        audio.controls = true
        audio.preload = 'metadata'
        audio.src = fileUrl
        block.appendChild(audio)
      } else if (artifact.mediaKind === 'zip' && Array.isArray(urls.entries) && urls.entries.length) {
        const grid = document.createElement('div')
        grid.className = 'cs-artifact-grid'
        const entries = artifact.zipImages || []
        urls.entries.slice(0, 20).forEach((entryUrl, index) => {
          const img = document.createElement('img')
          img.src = entryUrl
          img.alt = entries[index] || ''
          img.title = entries[index] || ''
          img.decoding = 'async'
          img.addEventListener('click', open)
          grid.appendChild(img)
        })
        block.appendChild(grid)
        const hint = document.createElement('div')
        hint.className = 'cs-artifact-zip-hint'
        hint.textContent = `${Math.min(entries.length, 20)} 张预览图 · 点击图片或「打开」查看完整压缩包`
        block.appendChild(hint)
      } else if (fileUrl && artifact.mediaKind !== 'file') {
        const link = document.createElement('a')
        link.className = 'cs-artifact-zip-hint'
        link.href = fileUrl
        link.target = '_blank'
        link.rel = 'noopener'
        link.textContent = '在新标签页打开'
        block.appendChild(link)
      }
      return block
    }

    function renderArtifactShow(data) {
      const artifact = data && data.artifact
      if (!artifact || !artifact.path) return
      injectArtifactCss()
      // 去重以 DOM 为准(页面重载后内存 set 失效会造成「有记忆无块」)
      const existing = [...document.querySelectorAll('.cs-artifact-block')]
        .some((b) => b.dataset.artifactPath === String(artifact.path))
      if (existing) return
      // 插入消息列表内(最后一条消息之后),像一条消息出现在信息流里;
      // 不能挂 scrollBody 末尾——那是输入框(composerSeat)之后,会挤压对话框。
      const column = document.querySelector('.Md3f7G_column')
      if (!column) {
        // 有限重试:最多 6 次,避免定时器无限累积
        const retries = Number(data.__retries || 0)
        if (retries < 6) {
          setTimeout(() => renderArtifactShow({ ...data, __retries: retries + 1 }), 2500)
        }
        return
      }
      const block = makeArtifactBlock(artifact, data.urls || {})
      column.appendChild(block)
      // 滚动到底,让新「消息」立即可见
      const scrollEl = document.querySelector('.wSkVaW_scrollBody')
      if (scrollEl) {
        try {
          scrollEl.scrollTop = scrollEl.scrollHeight
        } catch (error) {
          // 忽略
        }
      }
    }

    // ---- 会话附件上传:📎 按钮 + 拖入 + 粘贴 ----
    const ATTACH_CSS = [
      '.cs-attach-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; margin: 0 8px 8px 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 12.5px; cursor: pointer; transition: background-color 120ms cubic-bezier(0.4, 0, 0.2, 1); }',
      '.cs-attach-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
      '.cs-attach-btn:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }',
      '.uV2eYG_add[data-cs-tooltip] { position: relative; overflow: visible; }',
      '.uV2eYG_add[data-cs-tooltip]::after { content: attr(data-cs-tooltip); z-index: 80; position: absolute; left: 50%; bottom: calc(100% + 8px); transform: translate(-50%, 2px); opacity: 0; pointer-events: none; white-space: nowrap; border-radius: 8px; padding: 5px 9px; background: var(--dsw-alias-tooltip-bg, #2c2c2e); color: #f7f7fa; font-size: 12px; font-weight: 500; line-height: 18px; box-shadow: var(--dsw-shadow-lv2, 0 4px 14px rgba(0,0,0,.22)); transition: opacity 120ms ease, transform 120ms ease; }',
      '.uV2eYG_add[data-cs-tooltip]:hover::after, .uV2eYG_add[data-cs-tooltip]:focus-visible::after { opacity: 1; transform: translate(-50%, 0); }',
      '[data-cs-composer-tooltip-shield="1"] [role="tooltip"] { display: none !important; }',
      '[role="tooltip"][data-cs-suppressed-tooltip="1"] { display: none !important; }',
      '@media (prefers-reduced-motion: reduce) { .cs-attach-btn { transition: none; } }',
      '@media (prefers-reduced-motion: reduce) { .uV2eYG_add[data-cs-tooltip]::after { transition: none; } }',
    ].join('\n')

    function injectAttachCss() {
      const tagId = 'crawshrimp-slots/attach'
      if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'crawshrimp-slots'
        tag.dataset.pluginCss = tagId
        tag.textContent = ATTACH_CSS
        document.head.appendChild(tag)
      }
    }

    function mountAttachButton() {
      if (typeof document === 'undefined' || !document.documentElement?.dataset) return
      try {
        const composer = document.querySelector('.wSkVaW_composerSeat')
        if (!composer) return
        if (document.querySelector('.cs-attach-btn')) return
        injectAttachCss()
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'cs-attach-btn'
        btn.textContent = '📎 附件'
        btn.title = '上传附件(表格/文本/数据文件)'
        btn.addEventListener('click', () => {
          postToShell({ __crawshrimp: 'upload-attachment-pick', runtimeSessionId: activeRuntimeSessionId() })
        })
        // 插到 composer 最前(输入框上方);不能用内部 stack 作锚点(slot 结构中非直接子节点会抛 HierarchyRequestError)
        composer.insertBefore(btn, composer.firstElementChild)
      } catch (error) {
        // DOM 未就绪/结构变化:忽略,下一轮 mutation 再试
      }
    }

    function inComposer(target) {
      return !!(target && typeof target.closest === 'function' && target.closest('.wSkVaW_composerSeat'))
    }

    function isImageFile(file) {
      return String(file?.type || '').toLowerCase().startsWith('image/')
    }

    function nonImageFiles(files) {
      return Array.from(files || []).filter((file) => file && !isImageFile(file))
    }

    function postAttachmentFiles(files) {
      for (const file of nonImageFiles(files)) {
        postToShell({ __crawshrimp: 'upload-attachment', file, runtimeSessionId: activeRuntimeSessionId() })
      }
    }

    function handlePasteAttachments(event) {
      if (!inComposer(event.target)) return
      const items = (event.clipboardData || {}).items || []
      const files = []
      for (const item of items) {
        if (item.kind !== 'file') continue
        const file = item.getAsFile()
        if (file) files.push(file)
      }
      const attachments = nonImageFiles(files)
      if (!attachments.length) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      postAttachmentFiles(attachments)
    }

    function handleDropAttachments(event) {
      if (!inComposer(event.target)) return
      const files = (event.dataTransfer || {}).files
      if (!files || !files.length) return
      const attachments = nonImageFiles(files)
      if (!attachments.length) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      postAttachmentFiles(attachments)
    }

    function insertAttachmentHint(name, attachmentId) {
      const ta = document.querySelector('textarea')
      if (!ta) return
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      const hint = `[附件: ${name} (attachment_id: ${attachmentId})]`
      const current = ta.value || ''
      setter.call(ta, current ? current + '\n' + hint : hint)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      ta.focus()
    }

    function queueAttachmentHint(sessionId, name, attachmentId) {
      if (!sessionId) return
      if (sessionId === activeRuntimeSessionId()) {
        insertAttachmentHint(name, attachmentId)
        return
      }
      const hints = pendingAttachmentHintsBySession.get(sessionId) || []
      hints.push({ name, attachmentId })
      pendingAttachmentHintsBySession.set(sessionId, hints.slice(-20))
    }

    function flushAttachmentHints(sessionId) {
      const hints = pendingAttachmentHintsBySession.get(sessionId) || []
      if (!hints.length) return
      pendingAttachmentHintsBySession.delete(sessionId)
      for (const hint of hints) insertAttachmentHint(hint.name, hint.attachmentId)
    }

    // 与 DSH 原生 UI 统一:原「加号」按钮改造为上传附件;旁边单开「@」命令按钮。
    const UPLOAD_BUTTON_TOOLTIP = '上传附件'
    const UPLOAD_BUTTON_ARIA = '上传附件(表格/文本/数据文件)'
    const COMMAND_BUTTON_LABEL = '命令'
    let composerButtonMountQueued = false

    function setComposerButtonTooltip(button, tooltip, ariaLabel) {
      if (!button) return
      if (button.hasAttribute('title')) button.removeAttribute('title')
      if (tooltip) {
        if (button.dataset.csTooltip !== tooltip) button.dataset.csTooltip = tooltip
      } else if (button.dataset.csTooltip !== undefined) {
        delete button.dataset.csTooltip
      }
      const label = ariaLabel || tooltip
      if (label && button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label)
    }

    function composerTooltipButtonFromEvent(event) {
      const target = event && event.target
      const btn = target && typeof target.closest === 'function'
        ? target.closest('.uV2eYG_add[data-cs-upload-button="1"], .uV2eYG_add.cs-cmd-at-btn')
        : null
      if (!btn) return null
      if (btn.dataset.csUploadButton === '1') return btn
      return btn.dataset.csCommandButton === '1' || btn.classList.contains('cs-cmd-at-btn') ? btn : null
    }

    function isComposerTooltipButton(target) {
      return !!(target && typeof target.closest === 'function'
        && target.closest('.uV2eYG_add[data-cs-upload-button="1"], .uV2eYG_add.cs-cmd-at-btn'))
    }

    function installComposerTooltipShield() {
      if (document.__csComposerTooltipShield) return
      document.__csComposerTooltipShield = true
      const showComposerTooltip = (event) => {
        const btn = composerTooltipButtonFromEvent(event)
        if (!btn) return
        document.documentElement.dataset.csComposerTooltipShield = '1'
        event.stopPropagation()
      }
      const clearComposerTooltip = (event) => {
        const btn = composerTooltipButtonFromEvent(event)
        if (!btn) return
        const next = event.relatedTarget
        if (next && (btn.contains(next) || isComposerTooltipButton(next))) return
        delete document.documentElement.dataset.csComposerTooltipShield
        event.stopPropagation()
      }
      for (const type of ['mouseover', 'pointerover', 'focusin']) {
        document.addEventListener(type, showComposerTooltip, true)
      }
      for (const type of ['mouseout', 'pointerout', 'focusout']) {
        document.addEventListener(type, clearComposerTooltip, true)
      }
    }

    function suppressNativeCommandTooltips() {
      for (const tooltip of document.querySelectorAll('[role="tooltip"]')) {
        if (String(tooltip.textContent || '').trim() !== COMMAND_BUTTON_LABEL) continue
        if (tooltip.dataset.csSuppressedTooltip !== '1') tooltip.dataset.csSuppressedTooltip = '1'
        if (tooltip.getAttribute('aria-hidden') !== 'true') tooltip.setAttribute('aria-hidden', 'true')
      }
    }

    function installNativeCommandTooltipSuppressor() {
      if (document.__csNativeCommandTooltipSuppressor) return
      document.__csNativeCommandTooltipSuppressor = true
      suppressNativeCommandTooltips()
      const observer = new MutationObserver(suppressNativeCommandTooltips)
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
    }

    function syncUploadButton(addBtn) {
      if (addBtn.dataset.csUnified !== '1') addBtn.dataset.csUnified = '1'
      if (addBtn.dataset.csUploadButton !== '1') addBtn.dataset.csUploadButton = '1'
      if (addBtn.dataset.csCommandButton !== undefined) delete addBtn.dataset.csCommandButton
      setComposerButtonTooltip(addBtn, UPLOAD_BUTTON_TOOLTIP, UPLOAD_BUTTON_ARIA)
      if (addBtn.hasAttribute('aria-haspopup')) addBtn.removeAttribute('aria-haspopup')
      if (addBtn.hasAttribute('aria-expanded')) addBtn.removeAttribute('aria-expanded')
      if (!addBtn.querySelector('.cs-upload-glyph')) {
        addBtn.innerHTML = ''
        const glyph = document.createElement('span')
        glyph.className = 'cs-upload-glyph'
        glyph.textContent = '📎'
        glyph.style.cssText = 'font-size:15px;line-height:1;'
        addBtn.appendChild(glyph)
      }
    }

    function syncCommandButton(at, addBtn) {
      at.type = 'button'
      const wantedClass = (addBtn.className || '').replace(/\bcs-cmd-at-btn\b/g, '').trim() + ' cs-cmd-at-btn'
      if (at.className !== wantedClass) at.className = wantedClass
      if (at.dataset.csUnified !== undefined) delete at.dataset.csUnified
      if (at.dataset.csUploadButton !== undefined) delete at.dataset.csUploadButton
      if (at.dataset.csCommandButton !== '1') at.dataset.csCommandButton = '1'
      setComposerButtonTooltip(at, COMMAND_BUTTON_LABEL, COMMAND_BUTTON_LABEL)
      if (at.getAttribute('aria-haspopup') !== 'listbox') at.setAttribute('aria-haspopup', 'listbox')
      const disabled = !!addBtn.disabled
      if (at.disabled !== disabled) at.disabled = disabled
      const glyph = at.querySelector('.cs-upload-glyph')
      if (!glyph || glyph.textContent !== '@') {
        at.replaceChildren()
        const nextGlyph = document.createElement('span')
        nextGlyph.className = 'cs-upload-glyph'
        nextGlyph.textContent = '@'
        nextGlyph.style.cssText = 'font-size:15px;font-weight:700;line-height:1;'
        at.appendChild(nextGlyph)
      }
      if (at.dataset.csCommandClick !== '1') {
        at.dataset.csCommandClick = '1'
        at.addEventListener('click', (e) => {
          e.stopPropagation()
          window.__csForwardCmd = true
          try {
            const currentAdd = document.querySelector('.wSkVaW_composerSeat .uV2eYG_add:not(.cs-cmd-at-btn)')
            const commandSource = currentAdd || addBtn
            commandSource.click()
          } finally {
            setTimeout(() => { window.__csForwardCmd = false }, 60)
          }
        })
      }
    }

    function scheduleComposerButtonMount() {
      if (composerButtonMountQueued) return
      composerButtonMountQueued = true
      const run = () => {
        composerButtonMountQueued = false
        mountUnifiedButtons()
      }
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(run)
      } else {
        setTimeout(run, 50)
      }
    }

    function nodeContainsShellMountPoint(node) {
      if (!node || node.nodeType !== 1) return false
      if (node.matches?.('.hHd-Xa_root, .wSkVaW_composerSeat, .uV2eYG_add')) return true
      return !!node.querySelector?.('.hHd-Xa_root, .wSkVaW_composerSeat, .uV2eYG_add')
    }

    function mutationTouchesShellMountPoint(mutation) {
      const target = mutation.target
      if (target?.nodeType === 1) {
        if (target.matches?.('.hHd-Xa_root, .wSkVaW_composerSeat, .uV2eYG_add')) return true
        if (target.closest?.('.hHd-Xa_root, .wSkVaW_composerSeat')) return true
      }
      for (const node of mutation.addedNodes || []) {
        if (nodeContainsShellMountPoint(node)) return true
      }
      for (const node of mutation.removedNodes || []) {
        if (nodeContainsShellMountPoint(node)) return true
      }
      return false
    }

    function mutationsTouchShellMountPoints(mutations) {
      return Array.from(mutations || []).some((mutation) => mutation.type === 'childList' && mutationTouchesShellMountPoint(mutation))
    }

    function mountUnifiedButtons() {
      if (typeof document === 'undefined' || !document.documentElement) return
      try {
        const composer = document.querySelector('.wSkVaW_composerSeat')
        if (!composer) return
        const addBtn = composer.querySelector('.uV2eYG_add')
        if (!addBtn) return
        injectAttachCss()
        installComposerTooltipShield()
        installNativeCommandTooltipSuppressor()
        syncUploadButton(addBtn)
        // 旁边单开 @ 命令按钮(克隆原生加号按钮的结构与样式)
        let at = document.querySelector('.cs-cmd-at-btn')
        if (!at) {
          at = document.createElement('button')
          addBtn.parentElement.insertBefore(at, addBtn.nextSibling)
        }
        syncCommandButton(at, addBtn)
        // 拦截加号点击(捕获阶段)→ 改为触发上传;@ 转发时放行原命令行为
        if (!document.__csUploadIntercept) {
          document.__csUploadIntercept = true
          document.addEventListener('click', (e) => {
            if (window.__csForwardCmd) return
            const target = e.target
            const btn = target && typeof target.closest === 'function' ? target.closest('.uV2eYG_add') : null
            if (!btn || btn.classList.contains('cs-cmd-at-btn')) return
            e.stopPropagation()
            e.preventDefault()
            postToShell({ __crawshrimp: 'upload-attachment-pick', runtimeSessionId: activeRuntimeSessionId() })
          }, true)
        }
      } catch (error) {
        // DOM 未就绪/结构变化:下一轮轮询再试
      }
    }

    function mountAttachmentCapture() {
      if (typeof document === 'undefined' || !document.documentElement?.dataset) return
      if (document.documentElement.dataset.csAttachCapture === '1') return
      document.documentElement.dataset.csAttachCapture = '1'
      document.addEventListener('paste', handlePasteAttachments, true)
      document.addEventListener('dragover', (e) => e.preventDefault())
      document.addEventListener('drop', handleDropAttachments, true)
    }

    // ---- 默认工作区:自动采用抓虾运行时目录,不需要用户指定 ----
    async function ensureDefaultWorkspace(ctx, root) {      if (!root || !ctx.workspaces) return
      try {
        const snap = ctx.workspaces.list?.getSnapshot?.() || {}
        const existing = snap.items || []
        if (existing.length > 0) return
        // create 幂等:同一路径重复调用返回同一工作区
        await ctx.workspaces.create(root)
      } catch (error) {
        // 已存在/暂不可用:下一轮消息再试
      }
    }

    function publishCurrentSession(ctx) {
      try {
        const snap = ctx.sessions?.list?.getSnapshot?.() || {}
        const current = String(persistedRuntimeSessionId() || snap.current || '')
        if (!current || current === lastPublishedRuntimeSessionId) return
        currentRuntimeSessionId = current
        lastPublishedRuntimeSessionId = current
        flushAttachmentHints(current)
        postToShell({ __crawshrimp: 'active-runtime-session', runtimeSessionId: current })
      } catch (error) {
        // 会话列表尚未就绪，下一轮轮询重试。
      }
    }

    function apply(ctx) {
      registerCrawshrimpBrandSlots(ctx)
      ctx.theme.overrideTokens('crawshrimp', CRAWSHRIMP_TOKENS)
      injectBrandCss()
      // 浏览器标题:去 DeepSeek(DocumentTitle 组件会在会话切换后重新拼后缀,需持续兜底)
      normalizeDocumentTitle()
      setInterval(normalizeDocumentTitle, 1000)
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
        const expectedOrigin = shellOrigin()
        if (event.source !== window.parent || (expectedOrigin !== '*' && event.origin !== expectedOrigin)) return
        const data = event && event.data
        if (data && data.__crawshrimp === 'theme') adopt(data.theme)
        if (data && data.__crawshrimp === 'nav') renderNav(data.items, data.active)
        if (data && data.__crawshrimp === 'workspace') ensureDefaultWorkspace(ctx, data.root)
        if (data && data.__crawshrimp === 'artifact-show') renderArtifactShow(data)
        if (data && data.__crawshrimp === 'attachment-added') {
          const sessionId = String(data.runtimeSessionId || currentRuntimeSessionId || '')
          queueAttachmentHint(sessionId, data.name, data.attachmentId)
        }
        if (data && data.__crawshrimp === 'open-runtime-session' && data.runtimeSessionId) {
          try { ctx.sessions.open(String(data.runtimeSessionId)) } catch (error) { /* 会话已删除 */ }
        }
      })
      // apply 时 DOM 可能尚未就绪:轮询挂载(幂等),保证附件入口一定出现
      setInterval(() => {
        mountAttachmentCapture()
        mountUnifiedButtons()
        publishCurrentSession(ctx)
      }, 1000)
      // 页面/会话重载后向 shell 请求重放产物媒体(iframe 重载期间到达的事件会丢失)
      try {
        postToShell({ __crawshrimp: 'artifact-replay', runtimeSessionId: activeRuntimeSessionId() })
      } catch (error) {
        // 忽略
      }
      // 会话导航:点击「新会话」或会话列表项 → shell 切回会话主界面
      document.addEventListener('click', (event) => {
        const target = event.target
        if (!target || !(target instanceof Element)) return
        if (target.closest('.hHd-Xa_newSession')) {
          postToShell({ __crawshrimp: 'session-nav', kind: 'new' })
          return
        }
        const region = target.closest('.hHd-Xa_regionArea')
        if (region && !target.closest('.qDHVXG_sectionHeader')) {
          postToShell({ __crawshrimp: 'session-nav', kind: 'session' })
        }
      })
      // 侧边栏/输入区重渲染后兜底重插。属性/尺寸变化由 ResizeObserver + 周期兜底处理。
      const observer = new MutationObserver((mutations) => {
        if (!mutationsTouchShellMountPoints(mutations)) return
        const rail = document.querySelector('.hHd-Xa_root')
        const region = rail && rail.querySelector('.hHd-Xa_regionArea')
        const foot = rail && rail.querySelector('.hHd-Xa_footArea')
        const main = document.querySelector('[data-crawshrimp-nav-main]')
        const bottom = document.querySelector('[data-crawshrimp-nav-bottom]')
        if (rail && main && !rail.contains(main)) {
          if (region) rail.insertBefore(main, region)
          else rail.appendChild(main)
        }
        if (rail && bottom && !rail.contains(bottom)) {
          if (foot) rail.insertBefore(bottom, foot)
          else rail.appendChild(bottom)
        }
        scheduleComposerButtonMount()
        installRailResizeObserver()
        scheduleRailMetricsPush()
      })
      observer.observe(document.documentElement, { childList: true, subtree: true })
      setTimeout(() => {
        installRailResizeObserver()
        pushRailMetrics({ force: true })
      }, 0)
      setTimeout(() => scheduleRailMetricsPush(), 800)
      // 周期同步兜底:侧栏拖拽宽度只改 AppFrame 的 grid 列宽时,没有 DOM 子节点变化。
      setInterval(() => {
        installRailResizeObserver()
        scheduleRailMetricsPush()
      }, 800)
    }

    exports.apply = apply
    // kernel 服务依赖声明:apply 内访问 ctx.theme/ctx.workspaces/ctx.sessions/ctx.slots 必须显式 inject
    exports.inject = ['theme', 'workspaces', 'sessions', 'slots']
    return module.exports
  },
})
