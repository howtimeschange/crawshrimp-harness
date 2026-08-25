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

    function shellDirectoryPickerEnabled() {
      try {
        return new URLSearchParams(window.location.search || '').get('csDirectoryPicker') === 'shell'
      } catch (error) {
        return false
      }
    }

    function llmConfigRequired() {
      try {
        return new URLSearchParams(window.location.search || '').get('csNeedsModelKey') === '1'
      } catch (error) {
        return false
      }
    }

    function crawshrimpImSettingsEnabled() {
      try {
        return new URLSearchParams(window.location.search || '').get('csImSettings') === '1'
      } catch (error) {
        return false
      }
    }

    const IM_SETTINGS_EMBED_CSS = [
      'html, body { overflow: hidden !important; background: var(--dsw-alias-bg-base, #f7f7f8) !important; }',
      '.hHd-Xa_settingsArea { display: contents !important; }',
      '.VOzbGW_overlay { align-items: stretch !important; justify-content: stretch !important; }',
      '.VOzbGW_mask, .VOzbGW_nav, .VOzbGW_header { display: none !important; }',
      '.VOzbGW_panel { width: 100vw !important; max-width: none !important; height: 100vh !important; max-height: none !important; border: 0 !important; border-radius: 0 !important; background: var(--dsw-alias-bg-base, #f7f7f8) !important; box-shadow: none !important; }',
      '.VOzbGW_content { width: 100% !important; min-width: 0 !important; background: var(--dsw-alias-bg-base, #f7f7f8) !important; }',
      '.VOzbGW_options { width: 100% !important; min-width: 0 !important; height: 100% !important; padding: 0 !important; overflow: hidden !important; background: var(--dsw-alias-bg-base, #f7f7f8) !important; }',
      '[data-cs-im-surface-root="1"], [data-cs-im-surface-path="1"] { display: block !important; width: 100% !important; height: 100% !important; min-height: 0 !important; }',
      '[data-cs-im-surface-root="1"] > :not([data-cs-im-surface-path="1"]), [data-cs-im-surface-path="1"] > :not([data-cs-im-surface-path="1"]):not(.dim-page) { display: none !important; }',
      '.dim-page { --dim-crawshrimp-accent: var(--dsw-alias-state-business-primary, #FF5000); --dim-crawshrimp-accent-soft: color-mix(in srgb, var(--dim-crawshrimp-accent) 11%, transparent); --dim-blue: var(--dim-crawshrimp-accent) !important; width: 100% !important; max-width: none !important; height: 100% !important; min-height: 0 !important; padding: 0 !important; }',
      '.dim-title { display: none !important; }',
      '.dim-layout { grid-template-columns: 174px 1px minmax(0, 1fr) !important; align-items: stretch !important; gap: 22px !important; width: 100% !important; height: 100% !important; min-height: 0 !important; padding: 20px !important; }',
      '.dim-rail { grid-template-columns: minmax(0, 1fr) !important; align-content: start !important; max-height: none !important; min-height: 0 !important; padding: 1px 4px 1px 1px !important; overflow-y: auto !important; }',
      '.dim-divider { display: block !important; min-height: 100% !important; }',
      '.dim-panel { min-height: 0 !important; padding-right: 4px !important; overflow-y: auto !important; }',
      '.dim-channel:hover { border-color: color-mix(in srgb, var(--dim-crawshrimp-accent) 28%, var(--dsw-alias-border-l2, #eef0f3)) !important; background: color-mix(in srgb, var(--dim-crawshrimp-accent) 3%, var(--dsw-alias-bg-layer-3, #fff)) !important; }',
      '.dim-channel[aria-selected="true"] { border-color: color-mix(in srgb, var(--dim-crawshrimp-accent) 48%, var(--dsw-alias-border-l2, #dfe1e5)) !important; color: var(--dim-crawshrimp-accent) !important; background: var(--dim-crawshrimp-accent-soft) !important; box-shadow: 0 3px 12px color-mix(in srgb, var(--dim-crawshrimp-accent) 9%, transparent) !important; }',
      '.dim-page button[data-kind="primary"], .dim-page a[data-kind="primary"], .dim-page .dim-scanButton, .dim-page .dim-loopbackRecoveryAction, .dim-page .dim-directoryPickerPrimary { border-color: var(--dim-crawshrimp-accent) !important; color: var(--dsw-alias-brand-primary-invert, #fff) !important; background: var(--dim-crawshrimp-accent) !important; box-shadow: none !important; }',
      '.dim-page button[data-kind="primary"]:hover:not(:disabled), .dim-page a[data-kind="primary"]:hover, .dim-page .dim-scanButton:hover:not(:disabled), .dim-page .dim-loopbackRecoveryAction:hover, .dim-page .dim-directoryPickerPrimary:hover:not(:disabled) { border-color: var(--dim-crawshrimp-accent) !important; background: var(--dim-crawshrimp-accent) !important; filter: brightness(.92); }',
      '.dim-page button[data-kind="primary"]:focus-visible, .dim-page a[data-kind="primary"]:focus-visible, .dim-page .dim-scanButton:focus-visible, .dim-page .dim-loopbackRecoveryAction:focus-visible, .dim-page .dim-directoryPickerPrimary:focus-visible { outline: 2px solid color-mix(in srgb, var(--dim-crawshrimp-accent) 62%, white) !important; outline-offset: 2px !important; }',
      '.dim-workspaceEdit { display: none !important; }',
      '@media (max-width: 560px) { .dim-layout { grid-template-columns: minmax(0, 1fr) !important; height: auto !important; min-height: 100% !important; } .dim-rail { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; max-height: 240px !important; } .dim-divider { display: none !important; } .dim-panel { overflow: visible !important; } }',
    ].join('\n')

    function injectImSettingsEmbedCss() {
      const tagId = 'crawshrimp-slots/im-settings-embed'
      if (document.querySelector(`style[data-plugin-css="${tagId}"]`)) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'crawshrimp-slots'
      tag.dataset.pluginCss = tagId
      tag.textContent = IM_SETTINGS_EMBED_CSS
      document.head.appendChild(tag)
    }

    function isolateCrawshrimpImSurface(overlay) {
      const page = overlay?.querySelector?.('.dim-page')
      const root = page?.closest?.('[data-slot="settings.section"]')
      if (!page || !root) return false

      root.querySelectorAll('[data-cs-im-surface-path="1"]').forEach((node) => {
        delete node.dataset.csImSurfacePath
      })
      root.dataset.csImSurfaceRoot = '1'
      let node = page.parentElement
      while (node && node !== root) {
        node.dataset.csImSurfacePath = '1'
        node = node.parentElement
      }
      return node === root
    }

    let crawshrimpImSettingsReadyPublished = false

    function openCrawshrimpImSettings() {
      if (!crawshrimpImSettingsEnabled() || typeof document === 'undefined') return false
      injectImSettingsEmbedCss()

      let overlay = document.querySelector('.VOzbGW_overlay')
      if (!overlay) {
        const trigger = document.querySelector('.VOzbGW_trigger')
        trigger?.click?.()
        overlay = document.querySelector('.VOzbGW_overlay')
      }
      if (!overlay) return false

      const pluginNav = [...overlay.querySelectorAll('.VOzbGW_navCell')]
        .find((button) => /^(plugins|插件)$/i.test(String(button.textContent || '').trim()))
      if (pluginNav && pluginNav.getAttribute('aria-current') !== 'true') pluginNav.click()

      const imTab = [...overlay.querySelectorAll('[role="tab"]')]
        .find((button) => /^IM\s*(?:机器人|bots?)$/i.test(String(button.textContent || '').trim()))
      if (imTab && imTab.getAttribute('aria-selected') !== 'true') imTab.click()
      const surfaceReady = isolateCrawshrimpImSurface(overlay)
      if (surfaceReady && !crawshrimpImSettingsReadyPublished) {
        crawshrimpImSettingsReadyPublished = true
        postToShell({ __crawshrimp: 'im-settings-ready' })
      }
      document.documentElement.dataset.csImSettings = '1'
      return Boolean(imTab && surfaceReady)
    }

    let workspaceDirectoryPickSeq = 0
    const pendingWorkspaceDirectoryPicks = new Map()

    function pickWorkspaceDirectoryViaShell() {
      return new Promise((resolve, reject) => {
        const requestId = `workspace-directory-${Date.now()}-${++workspaceDirectoryPickSeq}`
        pendingWorkspaceDirectoryPicks.set(requestId, { resolve, reject })
        postToShell({
          __crawshrimp: 'workspace-directory-pick',
          requestId,
          title: '选择工作区目录',
        })
      })
    }

    function handleWorkspaceDirectoryPicked(data) {
      const requestId = String(data?.requestId || '')
      if (!requestId || !pendingWorkspaceDirectoryPicks.has(requestId)) return
      const pending = pendingWorkspaceDirectoryPicks.get(requestId)
      pendingWorkspaceDirectoryPicks.delete(requestId)
      if (data.error) {
        pending.reject(new Error(String(data.error)))
        return
      }
      if (data.canceled || !data.path) {
        pending.resolve(null)
        return
      }
      pending.resolve(String(data.path))
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
    let currentCrawshrimpAppVersion = ''

    function normalizeCrawshrimpAppVersion(value) {
      const version = String(value || '').trim().replace(/^v(?=\d)/i, '')
      return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version) ? `v${version}` : ''
    }

    function readCrawshrimpAppVersion() {
      try {
        const queryVersion = normalizeCrawshrimpAppVersion(new URLSearchParams(window.location.search || '').get('csAppVersion'))
        if (queryVersion) return queryVersion
      } catch (error) {
        // 交给 shell 的 postMessage
      }
      return currentCrawshrimpAppVersion
    }

    function publishCrawshrimpAppVersion(value) {
      const version = normalizeCrawshrimpAppVersion(value)
      if (!version || version === currentCrawshrimpAppVersion) return
      currentCrawshrimpAppVersion = version
      try {
        window.dispatchEvent(new CustomEvent('crawshrimp:app-version', { detail: { version } }))
      } catch (error) {
        // 旧环境没有 CustomEvent 时忽略,下一次组件挂载会读取内存值。
      }
    }

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
      const [version, setVersion] = react.useState(() => readCrawshrimpAppVersion())
      react.useEffect(() => {
        const updateVersion = (event) => {
          const next = normalizeCrawshrimpAppVersion(event?.detail?.version || readCrawshrimpAppVersion())
          if (next) setVersion(next)
        }
        window.addEventListener('crawshrimp:app-version', updateVersion)
        updateVersion()
        return () => window.removeEventListener('crawshrimp:app-version', updateVersion)
      }, [])
      return react.createElement('span', { className: 'cs-brand-lockup' },
        react.createElement('span', { className: 'cs-brand-name' }, CRAWSHRIMP_BRAND_NAME),
        version ? react.createElement('span', { className: 'cs-brand-version' }, version) : null,
      )
    }

    function registerCrawshrimpBrandSlots(ctx) {
      if (!ctx.slots?.inject || !ctx.slots?.register) return
      ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.inject('sidebar.brand.name', () => ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, CrawshrimpBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, CrawshrimpBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, CrawshrimpBrandMark)
      })))
    }

    function CrawshrimpShellDirectoryFlow(props) {
      const { open, pick } = props
      const armed = react.useRef(false)
      const outcome = react.useRef(props)
      outcome.current = props
      const alive = react.useRef(true)
      react.useEffect(() => {
        alive.current = true
        return () => {
          alive.current = false
        }
      }, [])
      react.useEffect(() => {
        if (!open) {
          armed.current = false
          return
        }
        if (armed.current) return
        armed.current = true
        pick().then((selectedPath) => {
          if (!alive.current) return
          if (selectedPath === null) outcome.current.onCancel()
          else outcome.current.onPicked(selectedPath)
        }, (reason) => {
          if (!alive.current) return
          outcome.current.onError(reason instanceof Error ? reason.message : String(reason))
        })
      }, [open, pick])
      return null
    }

    function registerCrawshrimpDirectoryFlow(ctx) {
      if (!shellDirectoryPickerEnabled()) return
      if (!ctx.slots?.inject || !ctx.slots?.register) return
      const injected = () => ({ pick: () => pickWorkspaceDirectoryViaShell() })
      ctx.slots.inject('conversation.hero.workspace.directoryFlow', () => ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
        yield ctx.slots.register({
          name: 'conversation.hero.workspace.directoryFlow',
          inject: injected,
        }, CrawshrimpShellDirectoryFlow)
        yield ctx.slots.register({
          name: 'sidebar.workspaces.directoryFlow',
          inject: injected,
        }, CrawshrimpShellDirectoryFlow)
      }))
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
      '.cs-brand-lockup {',
      '  display: inline-flex;',
      '  align-items: baseline;',
      '  gap: 7px;',
      '  min-width: 0;',
      '}',
      '.cs-brand-name {',
      '  font-size: 17px;',
      '  font-weight: 750;',
      '  letter-spacing: 0;',
      '  color: var(--dsw-alias-label-primary);',
      '  white-space: nowrap;',
      '  overflow: hidden;',
      '}',
      '.cs-brand-version {',
      '  flex: none;',
      '  color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary));',
      '  font-size: 11px;',
      '  font-weight: 600;',
      '  letter-spacing: 0;',
      '  line-height: 1;',
      '  white-space: nowrap;',
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
      '.pXSMma_headlineText { display: inline-flex !important; align-items: baseline; justify-content: center; gap: 0; font-size: 0 !important; line-height: 1.3; white-space: nowrap; }',
      '.pXSMma_headlineText::before { content: "抓虾智能体"; font-size: 24px; font-weight: 750; color: var(--dsw-alias-label-primary); }',
      '.pXSMma_headlineText::after { content: "· 抓住灵感，拿到结果"; margin-left: 8px; font-size: 22px; font-weight: 400; color: transparent; background-image: linear-gradient(100deg, var(--dsw-alias-label-secondary) 0%, var(--dsw-alias-label-secondary) 32%, color-mix(in srgb, var(--dsw-alias-label-primary) 42%, #7C8AA5) 43%, #D9E6F2 49%, color-mix(in srgb, var(--dsw-alias-label-primary) 34%, #AFC3DA) 55%, var(--dsw-alias-label-secondary) 68%, var(--dsw-alias-label-secondary) 100%); background-size: 230% 100%; background-position: 120% 50%; -webkit-background-clip: text; background-clip: text; animation: cs-slogan-wave 2.8s cubic-bezier(0.4, 0, 0.2, 1) infinite; }',
      '.pXSMma_previewBadge { display: none !important; }',
      '@keyframes cs-slogan-wave { 0% { background-position: 120% 50%; } 52% { background-position: -24% 50%; } 100% { background-position: -24% 50%; } }',
      '@media (prefers-reduced-motion: reduce) { .pXSMma_headlineText::after { animation: none; background-image: none; color: var(--dsw-alias-label-secondary); } }',
      '@supports not ((background-clip: text) or (-webkit-background-clip: text)) { .pXSMma_headlineText::after { background-image: none; color: var(--dsw-alias-label-secondary); } }',
      // 6) 抓虾菜单注入侧边栏(主菜单:新会话下/工作区上;底部菜单:设置)
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
      '.cs-nav-parent.cs-nav-active { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); font-weight: 600; }',
      '.cs-nav-child { padding-left: 24px; font-size: 13px; }',
      '.cs-nav-chevron { margin-left: auto; color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary)); line-height: 1; transition: transform 150ms cubic-bezier(0.4, 0, 0.2, 1); }',
      '.cs-nav-parent[aria-expanded="true"] .cs-nav-chevron { transform: rotate(90deg); }',
      '.hHd-Xa_collapsed [data-crawshrimp-nav-main] .cs-nav-label, .hHd-Xa_collapsed [data-crawshrimp-nav-bottom] .cs-nav-label { display: none; }',
      '.hHd-Xa_collapsed .cs-nav-item { justify-content: center; padding: 7px 0; }',
      '.hHd-Xa_collapsed .cs-nav-icon { font-size: 17px; }',
      '.hHd-Xa_collapsed .cs-nav-chevron { display: none; }',
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
    const MAIN_NAV_IDS = ['scripts', 'agent_script_review', 'ai_image', 'task_center', 'ai_video_generation', 'ai_workflows', 'local_prompt_library', 'files']
    const BOTTOM_NAV_IDS = ['settings']
    const MAIN_VISIBLE_DEFAULT = 3

    let lastMaxRailWidth = 0
    let lastRailMetricsSignature = ''
    let railMetricsQueued = false
    let railMetricsForceQueued = false
    let railResizeObserver = null
    let railResizeTarget = null
    let lastNavItems = []
    let lastNavActiveId = ''
    const expandedNavGroupIds = new Set(['ai_workflows'])

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

    function navChildren(item) {
      return Array.isArray(item && item.children) ? item.children.filter((child) => child && child.id) : []
    }

    function navItemActive(item, activeId) {
      return item && (item.id === activeId || navChildren(item).some((child) => child.id === activeId))
    }

    function updateNavButton(btn, item, activeId) {
      if (!btn || !item) return
      if (btn.dataset.csNavItemId !== item.id) btn.dataset.csNavItemId = item.id
      const children = navChildren(item)
      const isGroup = children.length > 0
      const isChild = Boolean(item.__parentId)
      btn.classList.toggle('cs-nav-parent', isGroup)
      btn.classList.toggle('cs-nav-child', isChild)
      btn.classList.toggle('cs-nav-active', navItemActive(item, activeId))
      if (isGroup) {
        btn.dataset.csNavGroup = '1'
        btn.setAttribute('aria-expanded', String(expandedNavGroupIds.has(item.id)))
      } else {
        delete btn.dataset.csNavGroup
        btn.removeAttribute('aria-expanded')
      }
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
      let chevron = btn.querySelector(':scope > .cs-nav-chevron')
      if (isGroup && !chevron) {
        chevron = document.createElement('span')
        chevron.className = 'cs-nav-chevron'
        chevron.setAttribute('aria-hidden', 'true')
        btn.appendChild(chevron)
      }
      if (isGroup && chevron && chevron.textContent !== '›') chevron.textContent = '›'
      if (!isGroup && chevron) chevron.remove()
    }

    function makeNavButton(item, activeId) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'cs-nav-item'
      updateNavButton(btn, item, activeId)
      btn.addEventListener('click', () => {
        if (btn.dataset.csNavGroup === '1') {
          const id = btn.dataset.csNavItemId
          if (expandedNavGroupIds.has(id)) expandedNavGroupIds.delete(id)
          else expandedNavGroupIds.add(id)
          renderNav(lastNavItems, lastNavActiveId)
          return
        }
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
      const baseVisible = collapsible && !expanded ? items.slice(0, MAIN_VISIBLE_DEFAULT) : items
      const visible = []
      for (const item of baseVisible) {
        visible.push(item)
        if (!navChildren(item).length || !expandedNavGroupIds.has(item.id)) continue
        for (const child of navChildren(item)) visible.push({ ...child, __parentId: item.id })
      }
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
      lastNavItems = items || []
      lastNavActiveId = activeId || ''
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
      '[data-cs-llm-config-required="1"] .wSkVaW_composerSeat { cursor: pointer; }',
      '[data-cs-llm-config-required="1"] .wSkVaW_composerSeat textarea, [data-cs-llm-config-required="1"] .wSkVaW_composerSeat [contenteditable="true"] { cursor: pointer; }',
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

    function hasFileTransfer(event) {
      const types = event?.dataTransfer?.types
      if (!types) return false
      if (typeof types.includes === 'function') return types.includes('Files')
      return Array.from(types).includes('Files')
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
      const files = (event.dataTransfer || {}).files
      if (!files || !files.length) return
      const attachments = nonImageFiles(files)
      if (!attachments.length) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      try {
        postAttachmentFiles(attachments)
      } finally {
        resetNativeDropOverlay()
      }
    }

    const DROP_TITLE_ZH = '图片/文件拖动到此处即可添加'
    const DROP_TITLE_EN = 'Drag images or files here to add them'
    const FILE_LIMIT_ZH = '文件最大 200MB'
    const FILE_LIMIT_EN = 'files up to 200MB'
    let dropOverlayCopyQueued = false

    function resetNativeDropOverlay() {
      if (typeof window === 'undefined') return
      const reset = () => {
        try {
          let event
          if (typeof Event === 'function') {
            event = new Event('dragend')
          } else if (typeof document !== 'undefined' && typeof document.createEvent === 'function') {
            event = document.createEvent('Event')
            event.initEvent('dragend', true, true)
          }
          if (event) window.dispatchEvent(event)
        } catch (error) {
          // 忽略:仅用于唤醒 DSH 原生 DropOverlay 的复位监听。
        }
      }
      reset()
      setTimeout(reset, 0)
      setTimeout(reset, 120)
    }

    function updateNativeDropOverlayCopy(root = document) {
      if (!root?.querySelectorAll) return
      for (const title of root.querySelectorAll('.BInVoG_title')) {
        const text = String(title.textContent || '').trim()
        if (text === '图片拖动到此处即可添加') title.textContent = DROP_TITLE_ZH
        if (text === 'Drag images here to add them') title.textContent = DROP_TITLE_EN
      }
      for (const desc of root.querySelectorAll('.BInVoG_desc')) {
        const text = String(desc.textContent || '').trim()
        if (!text || text.includes(FILE_LIMIT_ZH) || text.includes(FILE_LIMIT_EN)) continue
        let next = text.replace(/^最多\s+(.+?)\s*张，每张\s+(.+)$/, `图片最多 $1 张，每张 $2；${FILE_LIMIT_ZH}`)
        next = next.replace(/^Up to\s+(.+?)\s+images,\s+(.+?)\s+each$/i, `Images: up to $1, $2 each; ${FILE_LIMIT_EN}`)
        if (next !== text) desc.textContent = next
      }
    }

    function scheduleNativeDropOverlayCopy() {
      if (dropOverlayCopyQueued) return
      dropOverlayCopyQueued = true
      const run = () => {
        dropOverlayCopyQueued = false
        updateNativeDropOverlayCopy()
      }
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(run)
      } else {
        setTimeout(run, 16)
      }
    }

    function mutationTouchesDropOverlay(mutation) {
      const target = mutation.target
      if (target?.nodeType === 3) {
        const parent = target.parentElement
        if (parent?.closest?.('.BInVoG_mask')) return true
        const text = String(target.textContent || '')
        return text.includes('图片拖动到此处') || text.includes('Drag images here')
      }
      if (target?.nodeType === 1 && target.closest?.('.BInVoG_mask, .BInVoG_title, .BInVoG_desc')) return true
      for (const node of mutation.addedNodes || []) {
        if (node?.nodeType !== 1) continue
        if (node.matches?.('.BInVoG_mask, .BInVoG_title, .BInVoG_desc')) return true
        if (node.querySelector?.('.BInVoG_mask, .BInVoG_title, .BInVoG_desc')) return true
      }
      return false
    }

    function installNativeDropOverlayFixups() {
      if (typeof document === 'undefined' || !document.documentElement) return
      if (document.__csNativeDropOverlayFixups) return
      document.__csNativeDropOverlayFixups = true
      updateNativeDropOverlayCopy()
      const observer = new MutationObserver((mutations) => {
        if (Array.from(mutations || []).some(mutationTouchesDropOverlay)) scheduleNativeDropOverlayCopy()
      })
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
      document.addEventListener('drop', (event) => {
        if (hasFileTransfer(event)) resetNativeDropOverlay()
      }, true)
      window.addEventListener('blur', resetNativeDropOverlay)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') resetNativeDropOverlay()
      })
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') resetNativeDropOverlay()
      }, true)
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

    function isAllowedNoKeyComposerControl(target) {
      return !!(target && typeof target.closest === 'function' && target.closest(
        '.cs-attach-btn, .uV2eYG_add[data-cs-upload-button="1"], .uV2eYG_add.cs-cmd-at-btn',
      ))
    }

    function isComposerActivationTarget(target) {
      if (!target || typeof target.closest !== 'function') return false
      const composer = target.closest('.wSkVaW_composerSeat')
      if (!composer) return false
      if (isAllowedNoKeyComposerControl(target)) return false
      return true
    }

    function requestLlmConfigFromComposer(event) {
      if (!llmConfigRequired()) return
      if (!isComposerActivationTarget(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      postToShell({ __crawshrimp: 'llm-config-request', source: 'composer' })
    }

    function installLlmConfigGate() {
      if (typeof document === 'undefined' || !document.documentElement) return
      if (!llmConfigRequired()) return
      document.documentElement.dataset.csLlmConfigRequired = '1'
      injectAttachCss()
      if (document.__csLlmConfigGate) return
      document.__csLlmConfigGate = true
      for (const type of ['pointerdown', 'click', 'keydown', 'beforeinput', 'paste']) {
        document.addEventListener(type, requestLlmConfigFromComposer, true)
      }
      document.addEventListener('focusin', (event) => {
        if (!llmConfigRequired() || !isComposerActivationTarget(event.target)) return
        postToShell({ __crawshrimp: 'llm-config-request', source: 'composer' })
      }, true)
    }

    function mountAttachmentCapture() {
      if (typeof document === 'undefined' || !document.documentElement?.dataset) return
      installNativeDropOverlayFixups()
      if (document.documentElement.dataset.csAttachCapture === '1') return
      document.documentElement.dataset.csAttachCapture = '1'
      document.addEventListener('paste', handlePasteAttachments, true)
      document.addEventListener('dragover', (e) => e.preventDefault())
      document.addEventListener('drop', handleDropAttachments, true)
    }

    // ---- 默认工作区:自动采用抓虾运行时目录,不需要用户指定 ----
    // workspace 消息通常早于 DSH 的 workspace/session baseline。这里订阅真实
    // baseline，创建后再回读 workspace + session 投影；瞬时失败做有界退避，
    // 避免把用户赶到手动 picker，也避免静默吞掉永久故障。
    const DEFAULT_WORKSPACE_RETRY_DELAYS_MS = [250, 1000, 3000, 8000, 12000]
    const DEFAULT_WORKSPACE_TIMEOUT_MS = 60000
    const defaultWorkspaceRuns = new WeakMap()

    function workspaceFailureMessage(error) {
      const message = error && typeof error === 'object' && typeof error.message === 'string'
        ? error.message
        : String(error)
      return message.length > 300 ? `${message.slice(0, 300)}…` : message
    }

    function finishDefaultWorkspaceRun(ctx, run, result) {
      if (run.done) return
      run.done = true
      run.result = result
      if (run.retryTimer) clearTimeout(run.retryTimer)
      if (run.deadlineTimer) clearTimeout(run.deadlineTimer)
      if (run.unsubscribe) run.unsubscribe()
      run.resolve(result)
    }

    function scheduleDefaultWorkspaceAttempt(ctx, run, delayMs) {
      if (run.done || defaultWorkspaceRuns.get(ctx) !== run) return
      if (run.retryTimer) clearTimeout(run.retryTimer)
      run.nextAttemptAt = Date.now() + delayMs
      run.retryTimer = setTimeout(() => {
        run.retryTimer = null
        run.nextAttemptAt = 0
        reconcileDefaultWorkspace(ctx, run)
      }, delayMs)
    }

    async function reconcileDefaultWorkspace(ctx, run) {
      if (run.done || run.inFlight || defaultWorkspaceRuns.get(ctx) !== run) return
      if (run.nextAttemptAt && Date.now() < run.nextAttemptAt) return

      const snap = ctx.workspaces.list?.getSnapshot?.() || {}
      const items = Array.isArray(snap.items) ? snap.items : []
      if (!run.workspaceId && items.length > 0) {
        finishDefaultWorkspaceRun(ctx, run, { status: 'existing', workspaceId: items[0]?.workspaceId || '' })
        return
      }
      if (!snap.baselinesReady) return

      run.inFlight = true
      run.attempts += 1
      try {
        let workspace = run.workspaceId
          ? items.find((item) => item.workspaceId === run.workspaceId)
          : null
        if (!run.workspaceId) {
          // DSH rc.8 的契约是 create({ path })，不是 create(path)。传字符串会在
          // Workspace 构造阶段抛错，旧实现又把该异常吞掉，导致默认工作区永远缺失。
          workspace = await ctx.workspaces.create({ path: run.root })
          if (run.done || defaultWorkspaceRuns.get(ctx) !== run) {
            run.inFlight = false
            return
          }
          if (!workspace?.workspaceId) throw new Error('workspace create returned no workspace id')
          run.workspaceId = workspace.workspaceId
        }

        // create() 按契约会同步投影到 list；这里仍显式回读，防止“RPC 成功但 UI
        // 状态没有落地”被误报成完成。若通知稍晚到，下一轮订阅/退避会继续核对。
        const projected = (ctx.workspaces.list?.getSnapshot?.().items || [])
          .find((item) => item.workspaceId === run.workspaceId)
        if (!projected) throw new Error('workspace create succeeded without list projection')

        let sessionId = ctx.sessions?.list?.getSnapshot?.().current
        if (!sessionId && typeof ctx.workspaces.connectWorkspace === 'function' && ctx.sessions) {
          sessionId = await ctx.workspaces.connectWorkspace(projected.workspaceId)
          if (run.done || defaultWorkspaceRuns.get(ctx) !== run) {
            run.inFlight = false
            return
          }
          if (!ctx.sessions.list?.getSnapshot?.().current) ctx.sessions.open(sessionId)
          const selected = ctx.sessions.list?.getSnapshot?.().current
          if (selected !== sessionId) throw new Error('default workspace session was not selected')
        }

        run.inFlight = false
        finishDefaultWorkspaceRun(ctx, run, {
          status: 'created',
          workspaceId: projected.workspaceId,
          sessionId: sessionId || '',
        })
      } catch (error) {
        run.inFlight = false
        run.lastError = workspaceFailureMessage(error)
        const maxAttempts = run.retryDelaysMs.length + 1
        console.warn(
          `[crawshrimp] default workspace initialization attempt ${run.attempts}/${maxAttempts} failed: ${run.lastError}`,
        )
        if (run.attempts >= maxAttempts) {
          console.error(`[crawshrimp] default workspace initialization failed after ${run.attempts} attempts`)
          finishDefaultWorkspaceRun(ctx, run, { status: 'failed', error: run.lastError })
          return
        }
        const retryDelay = run.retryDelaysMs[Math.min(run.attempts - 1, run.retryDelaysMs.length - 1)]
        scheduleDefaultWorkspaceAttempt(ctx, run, retryDelay)
      }
    }

    function ensureDefaultWorkspace(ctx, root, options = {}) {
      const normalizedRoot = String(root || '').trim()
      if (!normalizedRoot || !ctx?.workspaces?.list) return Promise.resolve({ status: 'skipped' })

      const previous = defaultWorkspaceRuns.get(ctx)
      if (previous && previous.root === normalizedRoot && !previous.done) return previous.promise
      if (previous && previous.root === normalizedRoot && previous.result?.status !== 'failed') {
        return Promise.resolve(previous.result)
      }
      if (previous && !previous.done) {
        finishDefaultWorkspaceRun(ctx, previous, { status: 'superseded' })
      }

      let resolveRun
      const retryDelaysMs = Array.isArray(options.retryDelaysMs)
        ? options.retryDelaysMs.map((value) => Math.max(0, Number(value) || 0))
        : DEFAULT_WORKSPACE_RETRY_DELAYS_MS
      const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_WORKSPACE_TIMEOUT_MS)
      const run = {
        root: normalizedRoot,
        retryDelaysMs,
        attempts: 0,
        workspaceId: '',
        inFlight: false,
        done: false,
        result: null,
        lastError: '',
        retryTimer: null,
        deadlineTimer: null,
        unsubscribe: null,
        nextAttemptAt: 0,
        resolve: (result) => resolveRun(result),
        promise: null,
      }
      run.promise = new Promise((resolve) => { resolveRun = resolve })
      defaultWorkspaceRuns.set(ctx, run)
      if (typeof ctx.workspaces.list.subscribe === 'function') {
        run.unsubscribe = ctx.workspaces.list.subscribe(() => reconcileDefaultWorkspace(ctx, run))
      }
      run.deadlineTimer = setTimeout(() => {
        if (run.done) return
        console.error('[crawshrimp] default workspace initialization timed out')
        finishDefaultWorkspaceRun(ctx, run, {
          status: 'failed',
          error: run.lastError || 'workspace initialization did not complete before timeout',
        })
      }, timeoutMs)
      reconcileDefaultWorkspace(ctx, run)
      return run.promise
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
      registerCrawshrimpDirectoryFlow(ctx)
      ctx.theme.overrideTokens('crawshrimp', CRAWSHRIMP_TOKENS)
      injectBrandCss()
      openCrawshrimpImSettings()
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
        if (data && data.__crawshrimp === 'app-version') publishCrawshrimpAppVersion(data.version)
        if (data && data.__crawshrimp === 'workspace') ensureDefaultWorkspace(ctx, data.root)
        if (data && data.__crawshrimp === 'workspace-directory-picked') handleWorkspaceDirectoryPicked(data)
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
        installLlmConfigGate()
        publishCurrentSession(ctx)
        openCrawshrimpImSettings()
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
    // 可执行契约测试直接调用真实实现，避免退化为源码字符串匹配。
    exports.ensureDefaultWorkspace = ensureDefaultWorkspace
    // kernel 服务依赖声明:apply 内访问 ctx.theme/ctx.workspaces/ctx.sessions/ctx.slots 必须显式 inject
    exports.inject = ['theme', 'workspaces', 'sessions', 'slots']
    return module.exports
  },
})
