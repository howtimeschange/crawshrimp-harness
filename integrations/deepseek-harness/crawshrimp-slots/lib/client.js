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
    let lastPublishedConversationPhase = ''
    let shellRequiresLlmConfig = false
    let shellAccountMenuOpen = false
    let shellAccountMenuStyle = null
    let crawshrimpContext = null
    let attachmentBridgeDisposed = false

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
        return origin && origin !== 'null' && origin !== window.location.origin ? origin : '*'
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
      if (shellRequiresLlmConfig) return true
      try {
        return new URLSearchParams(window.location.search || '').get('csNeedsModelKey') === '1'
      } catch (error) {
        return false
      }
    }

    function updateRuntimeModelConfiguration(data) {
      shellRequiresLlmConfig = data?.apiKeyConfigured === false
      if (typeof document === 'undefined' || !document.documentElement) return
      if (!shellRequiresLlmConfig) {
        delete document.documentElement.dataset.csLlmConfigRequired
        return
      }
      installLlmConfigGate()
    }

    function updateShellAccountMenuState(data) {
      if (typeof data?.open !== 'boolean') return
      shellAccountMenuOpen = data.open
      if (!shellAccountMenuOpen) { shellAccountMenuStyle?.remove(); shellAccountMenuStyle = null; return }
      if (shellAccountMenuStyle) return
      // Own one temporary focus rule; never change another modal's inert
      // attribute or inline styles. Removing this restores their exact state.
      shellAccountMenuStyle = document.createElement('style')
      shellAccountMenuStyle.setAttribute('data-crawshrimp-menu-focus-lock', '')
      shellAccountMenuStyle.textContent = 'body { interactivity: inert !important; }'
      document.head.appendChild(shellAccountMenuStyle)
    }

    function dismissShellAccountMenu(event) {
      if (!shellAccountMenuOpen) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      postToShell({ __crawshrimp: 'shell-account-menu-dismiss' })
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
      '[data-cs-im-surface-root="1"] > :not([data-cs-im-surface-path="1"]), [data-cs-im-surface-path="1"]:not(.dim-page) > :not([data-cs-im-surface-path="1"]):not(.dim-page) { display: none !important; }',
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
      // dsh-im 4.11 may render .dim-page directly below the registered
      // settings root.  Mark the page itself as part of the allow-listed
      // path; otherwise the root sibling-hiding rule hides that direct child
      // and the embedded surface becomes an opaque black frame.
      let node = page
      while (node && node !== root) {
        node.dataset.csImSurfacePath = '1'
        node = node.parentElement
      }
      return node === root
    }

    let crawshrimpImSettingsReadyPublished = false

    function isCurrentSettingsNav(button) {
      if (!button) return false
      return button.getAttribute('aria-current') === 'true'
        || button.getAttribute('aria-selected') === 'true'
        || button.classList?.contains('VOzbGW_active')
    }

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

      // rc.8 exposed the plugin section as an ARIA tab. rc.1's settings
      // navigator uses labelled VOzbGW nav cells and aria-current instead.
      // Prefer the product IM section directly.  Clicking "插件" first on
      // every periodic reconciliation races React's asynchronous navigation
      // and keeps the iframe oscillating between the generic plugin page and
      // dsh-im.  Retain it only as a fallback for an older shell that has not
      // exposed the IM item yet.
      const imTab = [...overlay.querySelectorAll('[role="tab"], .VOzbGW_navCell')]
        .find((button) => /^IM\s*(?:机器人|bots?)$/i.test(String(button.textContent || '').trim()))
      if (!imTab) {
        const pluginNav = [...overlay.querySelectorAll('.VOzbGW_navCell')]
          .find((button) => /^(plugins|插件)$/i.test(String(button.textContent || '').trim()))
        if (pluginNav && !isCurrentSettingsNav(pluginNav)) pluginNav.click()
        return false
      }
      if (!isCurrentSettingsNav(imTab)) {
        imTab.click()
        return false
      }
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

    // The optional Lake skin changes only the light palette. The original
    // token layer remains available for an immediate, reversible switch.
    const LAKE_LIGHT = {
      '--dsw-alias-bg-base': '#ffffff', '--dsw-alias-bg-layer-1': '#ffffff',
      '--dsw-alias-bg-layer-2': '#f5f6f5', '--dsw-alias-bg-overlay': '#eceeec',
      '--dsw-alias-border-l1': '#dfe4df', '--dsw-alias-border-l2': '#a8b9a6',
      '--dsw-alias-brand-primary': '#315c43', '--dsw-alias-brand-primary-invert': '#ffffff',
      '--dsw-alias-brand-text': '#315c43', '--dsw-alias-label-primary': '#202b23',
      '--dsw-alias-label-secondary': '#505b52', '--dsw-alias-state-business-primary': '#315c43',
      '--dsw-alias-state-business-tertiary': '#e5eee3', '--dsw-specific-sidebar-fill': '#ffffff',
    }
    const LAKE_STEPS = { 50: '#f0f5ef', '50p': 'rgba(49,92,67,.08)', 75: '#e9f1e8', 100: '#dfeadd', 200: '#c7dac5', 300: '#9cba9c', 400: '#719875', 450: '#547c5d', 500: '#315c43', 600: '#294d37', 800: '#24432f', 900: '#1e3928', 950: '#182f21' }
    for (const step of Object.keys(LAKE_STEPS)) {
      LAKE_LIGHT[`--dsw-static-deepseek-${step}`] = LAKE_STEPS[step]
      LAKE_LIGHT[`--dsw-static-blue-${step}`] = LAKE_STEPS[step]
    }
    LAKE_LIGHT['--dsw-static-deepseek-700-delete'] = '#294d37'
    const LAKE_TOKENS = Object.fromEntries(Object.entries(CRAWSHRIMP_TOKENS).map(([name, pair]) => [name, { ...pair, light: LAKE_LIGHT[name] || pair.light }]))

    const CRAWSHRIMP_BRAND_NAME = '抓虾智能体'
    // C1 transparent avatar, offline 128px export; shared with the desktop brand assets.
    const CRAWSHRIMP_BRAND_MARK_URL = "data:image/png;base64,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"

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
      return react.createElement('img', {
        className: ['cs-brand-mark', className].filter(Boolean).join(' '),
        src: CRAWSHRIMP_BRAND_MARK_URL,
        alt: '',
        'aria-hidden': 'true',
        draggable: false,
        width: px,
        height: px,
        style: { width: `${px}px`, height: `${px}px`, objectFit: 'contain' },
      })
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

    // Original brand SVGs: @lobehub/icons-static-svg 1.100.0 (MIT).
    // See PROVIDER_LOGOS.md for provenance and SHA-256. Embedded here because
    // the DSH client loader ships this factory as one self-contained bundle.
    const MODEL_PROVIDER_LOGOS = {
      openai: "<svg fill=\"currentColor\" fill-rule=\"evenodd\" height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>OpenAI</title><path d=\"M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z\"></path></svg>",
      gemini: "<svg height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Gemini</title><path d=\"M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z\" fill=\"#3186FF\"></path><path d=\"M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z\" fill=\"url(#lobe-icons-gemini-0-_R_0_)\"></path><path d=\"M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z\" fill=\"url(#lobe-icons-gemini-1-_R_0_)\"></path><path d=\"M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z\" fill=\"url(#lobe-icons-gemini-2-_R_0_)\"></path><defs><linearGradient gradientUnits=\"userSpaceOnUse\" id=\"lobe-icons-gemini-0-_R_0_\" x1=\"7\" x2=\"11\" y1=\"15.5\" y2=\"12\"><stop stop-color=\"#08B962\"></stop><stop offset=\"1\" stop-color=\"#08B962\" stop-opacity=\"0\"></stop></linearGradient><linearGradient gradientUnits=\"userSpaceOnUse\" id=\"lobe-icons-gemini-1-_R_0_\" x1=\"8\" x2=\"11.5\" y1=\"5.5\" y2=\"11\"><stop stop-color=\"#F94543\"></stop><stop offset=\"1\" stop-color=\"#F94543\" stop-opacity=\"0\"></stop></linearGradient><linearGradient gradientUnits=\"userSpaceOnUse\" id=\"lobe-icons-gemini-2-_R_0_\" x1=\"3.5\" x2=\"17.5\" y1=\"13.5\" y2=\"12\"><stop stop-color=\"#FABC12\"></stop><stop offset=\".46\" stop-color=\"#FABC12\" stop-opacity=\"0\"></stop></linearGradient></defs></svg>",
      deepseek: "<svg height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>DeepSeek</title><path d=\"M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 01-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 00-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 01-.465.137 9.597 9.597 0 00-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 001.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 011.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 01.415-.287.302.302 0 01.2.288.306.306 0 01-.31.307.303.303 0 01-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 01-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 01.016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 01-.254-.078c-.11-.054-.2-.19-.114-.358.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z\" fill=\"#4D6BFE\"></path></svg>",
      claude: "<svg height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Claude</title><path d=\"M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z\" fill=\"#D97757\" fill-rule=\"nonzero\"></path></svg>",
      qwen: "<svg height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Qwen</title><path d=\"M19.713 2.825h-5.907c0-.251-.066-.503-.196-.728L12.819.728A1.46 1.46 0 0 0 11.559 0h-1.58c-.52 0-1 .275-1.26.728l-2.42 4.19a1.45 1.45 0 0 0 0 1.453l.791 1.37c.26.448.74.727 1.26.727h11.36c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451l-.79-1.37a1.46 1.46 0 0 0-1.26-.728zM.195 9.905l2.951 5.115a1.46 1.46 0 0 0-.531.531l-.791 1.37a1.45 1.45 0 0 0 0 1.452l.79 1.37c.26.448.74.727 1.26.727h4.84c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451L5.086 7.083a1.46 1.46 0 0 0-1.26-.728h-1.58c-.52 0-1 .276-1.26.728l-.79 1.37a1.45 1.45 0 0 0 0 1.452m15.888 13.367 2.951-5.115c.217.125.469.196.728.196h1.582c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451l-2.42-4.191a1.46 1.46 0 0 0-1.259-.728h-1.582c-.52 0-1 .276-1.259.728l-5.678 9.838a1.45 1.45 0 0 0 0 1.452l.79 1.37c.26.448.74.727 1.26.727h1.582c.52 0 1-.275 1.26-.728z\" fill=\"#082dff\"></path></svg>",
      zai: "<svg fill=\"currentColor\" fill-rule=\"evenodd\" height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Z.ai</title><path d=\"M12.105 2L9.927 4.953H.653L2.83 2h9.276zM23.254 19.048L21.078 22h-9.242l2.174-2.952h9.244zM24 2L9.264 22H0L14.736 2H24z\"></path></svg>",
      kimi: "<svg height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Kimi</title><path d=\"M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z\" fill=\"#1783FF\"></path><path d=\"M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z\" fill=\"currentColor\"></path></svg>",
      grok: "<svg fill=\"currentColor\" fill-rule=\"evenodd\" height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Grok</title><path d=\"M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815\"></path></svg>",
      mistral: "<svg height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Mistral</title><path d=\"M3.428 3.4h3.429v3.428H3.428V3.4zm13.714 0h3.43v3.428h-3.43V3.4z\" fill=\"gold\"></path><path d=\"M3.428 6.828h6.857v3.429H3.429V6.828zm10.286 0h6.857v3.429h-6.857V6.828z\" fill=\"#FFAF00\"></path><path d=\"M3.428 10.258h17.144v3.428H3.428v-3.428z\" fill=\"#FF8205\"></path><path d=\"M3.428 13.686h3.429v3.428H3.428v-3.428zm6.858 0h3.429v3.428h-3.429v-3.428zm6.856 0h3.43v3.428h-3.43v-3.428z\" fill=\"#FA500F\"></path><path d=\"M0 17.114h10.286v3.429H0v-3.429zm13.714 0H24v3.429H13.714v-3.429z\" fill=\"#E10500\"></path></svg>",
      minimax: "<svg height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Minimax</title><defs><linearGradient id=\"lobe-icons-minimax-_R_0_\" x1=\"0%\" x2=\"100.182%\" y1=\"50.057%\" y2=\"50.057%\"><stop offset=\"0%\" stop-color=\"#E2167E\"></stop><stop offset=\"100%\" stop-color=\"#FE603C\"></stop></linearGradient></defs><path d=\"M16.278 2c1.156 0 2.093.927 2.093 2.07v12.501a.74.74 0 00.744.709.74.74 0 00.743-.709V9.099a2.06 2.06 0 012.071-2.049A2.06 2.06 0 0124 9.1v6.561a.649.649 0 01-.652.645.649.649 0 01-.653-.645V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v7.472a2.037 2.037 0 01-2.048 2.026 2.037 2.037 0 01-2.048-2.026v-12.5a.785.785 0 00-.788-.753.785.785 0 00-.789.752l-.001 15.904A2.037 2.037 0 0113.441 22a2.037 2.037 0 01-2.048-2.026V18.04c0-.356.292-.645.652-.645.36 0 .652.289.652.645v1.934c0 .263.142.506.372.638.23.131.514.131.744 0a.734.734 0 00.372-.638V4.07c0-1.143.937-2.07 2.093-2.07zm-5.674 0c1.156 0 2.093.927 2.093 2.07v11.523a.648.648 0 01-.652.645.648.648 0 01-.652-.645V4.07a.785.785 0 00-.789-.78.785.785 0 00-.789.78v14.013a2.06 2.06 0 01-2.07 2.048 2.06 2.06 0 01-2.071-2.048V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v3.8a2.06 2.06 0 01-2.071 2.049A2.06 2.06 0 010 12.9v-1.378c0-.357.292-.646.652-.646.36 0 .653.29.653.646V12.9c0 .418.343.757.766.757s.766-.339.766-.757V9.099a2.06 2.06 0 012.07-2.048 2.06 2.06 0 012.071 2.048v8.984c0 .419.343.758.767.758.423 0 .766-.339.766-.758V4.07c0-1.143.937-2.07 2.093-2.07z\" fill=\"url(#lobe-icons-minimax-_R_0_)\" fill-rule=\"nonzero\"></path></svg>",
      doubao: "<svg height=\"1em\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"1em\" xmlns=\"http://www.w3.org/2000/svg\"><title>Doubao</title><path d=\"M5.31 15.756c.172-3.75 1.883-5.999 2.549-6.739-3.26 2.058-5.425 5.658-6.358 8.308v1.12C1.501 21.513 4.226 24 7.59 24a6.59 6.59 0 002.2-.375c.353-.12.7-.248 1.039-.378.913-.899 1.65-1.91 2.243-2.992-4.877 2.431-7.974.072-7.763-4.5l.002.001z\" fill=\"#1E37FC\"></path><path d=\"M22.57 10.283c-1.212-.901-4.109-2.404-7.397-2.8.295 3.792.093 8.766-2.1 12.773a12.782 12.782 0 01-2.244 2.992c3.764-1.448 6.746-3.457 8.596-5.219 2.82-2.683 3.353-5.178 3.361-6.66a2.737 2.737 0 00-.216-1.084v-.002z\" fill=\"#37E1BE\"></path><path d=\"M14.303 1.867C12.955.7 11.248 0 9.39 0 7.532 0 5.883.677 4.545 1.807 2.791 3.29 1.627 5.557 1.5 8.125v9.201c.932-2.65 3.097-6.25 6.357-8.307.5-.318 1.025-.595 1.569-.829 1.883-.801 3.878-.932 5.746-.706-.222-2.83-.718-5.002-.87-5.617h.001z\" fill=\"#A569FF\"></path><path d=\"M17.305 4.961a199.47 199.47 0 01-1.08-1.094c-.202-.213-.398-.419-.586-.622l-1.333-1.378c.151.615.648 2.786.869 5.617 3.288.395 6.185 1.898 7.396 2.8-1.306-1.275-3.475-3.487-5.266-5.323z\" fill=\"#1E37FC\"></path></svg>",
    }

    function modelLogoFamily(model) {
      // Resolve model identity first: an OpenAI-compatible transport can serve
      // Gemini, DeepSeek, Qwen, etc. Provider protocol is not brand identity.
      const id = String(model.id || '').toLowerCase().split(/[/:]/).pop().replace(/^managed-/, '')
      if (/^(?:gpt(?:[-.\d]|$)|chatgpt(?:-|$)|o[1-9](?:[-.]|$)|codex(?:-|$))/.test(id)) return 'openai'
      if (/^gemini(?:[-.\d]|$)/.test(id)) return 'gemini'
      if (/^deepseek(?:[-.\d]|$)/.test(id)) return 'deepseek'
      if (/^claude(?:[-.\d]|$)/.test(id)) return 'claude'
      if (/^qwen(?:[-.\d]|$)|^qwq(?:-|$)/.test(id)) return 'qwen'
      if (/^glm(?:[-.\d]|$)|^z[.-]?ai(?:[-/]|$)/.test(id)) return 'zai'
      if (/^kimi(?:[-.\d]|$)|^moonshot(?:-|$)/.test(id)) return 'kimi'
      if (/^grok(?:[-.\d]|$)/.test(id)) return 'grok'
      if (/^(?:mistral|mixtral|codestral|magistral|ministral|devstral)(?:[-.\d]|$)/.test(id)) return 'mistral'
      if (/^minimax(?:[-.\d]|$)/.test(id)) return 'minimax'
      if (/^(?:doubao|seed)(?:[-.\d]|$)/.test(id)) return 'doubao'
      return 'generic'
    }

    function CrawshrimpModelLabel({ model }) {
      const id = String(model.id || '').replace(/^managed-/, '')
      const family = modelLogoFamily(model)
      const logo = MODEL_PROVIDER_LOGOS[family]
      const label = String(model.name || id).replace(/^managed-/, '').replace(/ · 抓虾官方$/, '')
      return react.createElement('span', { className: 'cs-model-label' },
        logo ? react.createElement('span', {
          className: 'cs-model-icon', 'data-model-logo': family, 'aria-hidden': true,
          // Trusted, pinned local assets only; never model/provider supplied SVG.
          dangerouslySetInnerHTML: { __html: logo },
        }) : react.createElement('span', { className: 'cs-model-icon', 'data-model-logo': 'generic', 'aria-hidden': true },
          react.createElement('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, focusable: false },
            react.createElement('rect', { x: 4, y: 4, width: 16, height: 16, rx: 4 }),
            react.createElement('path', { d: 'M8 9h8M8 15h8M9 8v8M15 8v8' }))),
        react.createElement('span', { className: 'cs-model-name' }, label))
    }

    function registerCrawshrimpBrandSlots(ctx) {
      if (!ctx.slots?.inject || !ctx.slots?.register) return
      ctx.slots.inject('conversation.input.model.label', () => ctx.slots.register({ name: 'conversation.input.model.label' }, CrawshrimpModelLabel))
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
          // The official native picker occupies priority 0. Lower values win.
          priority: -10,
          inject: injected,
        }, CrawshrimpShellDirectoryFlow)
        yield ctx.slots.register({
          name: 'sidebar.workspaces.directoryFlow',
          priority: -10,
          inject: injected,
        }, CrawshrimpShellDirectoryFlow)
      }))
    }

    // 去品牌 + 抓虾化样式
    const BRAND_CSS = [
      // Hide legacy non-image cards; native links, produced-file chips and resources remain.
      '.cs-artifact-block:not(:has(img)) { display: none !important; }',
      '.wSkVaW_header { height: 44px; min-height: 44px; box-sizing: border-box; padding-top: 6px; padding-bottom: 6px; }',
      '.cs-tool-group { min-width: 0; }',
      '.cs-tool-group-latest { display: flex; align-items: flex-start; gap: 6px; min-width: 0; }',
      '.cs-tool-group-latest > [data-chat-flow-key] { flex: 1; min-width: 0; }',
      '.cs-tool-group:has(.cs-tool-group-latest > [hidden]) { display: none; }',
      '.cs-tool-group-toggle { flex: none; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; min-width: 36px; min-height: 26px; cursor: pointer; }',
      '.cs-tool-group-toggle:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
      '.cs-tool-group-toggle:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }',
      '.cs-tool-group-history:not([hidden]) { max-height: 280px; overflow-y: auto; overscroll-behavior: contain; margin-top: 4px; padding-left: 10px; border-left: 1px solid var(--dsw-alias-border-l3); }',
      '.cs-tool-group-history > [data-chat-flow-key] + [data-chat-flow-key] { margin-top: 4px; }',
      // Hide internal context disclosures in both live and replayed chat.
      // Only presentation changes: durable context and model input stay intact.
      '[data-chat-flow-kind="context"], [data-chat-flow-kind="system-prompt"] { display: none !important; }',
      // Hide the conversation scrollbar while preserving wheel/trackpad scrolling.
      '.wSkVaW_scrollBody { scrollbar-width: none; scrollbar-gutter: auto; }',
      '.wSkVaW_scrollBody::-webkit-scrollbar { display: none; width: 0; height: 0; }',
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
      // 3a) 产品只有一个固定的 Agent 预设。rc.1 的预设客户端仍会将这个
      // CSS-module 座位渲染到新会话 Hero；隐藏座位本身，保留工作区和模型选择。
      '.cubgiG_seat { display: none !important; }',
      // 4) 只替换由 rc.1 的实时 turn-status 标记确认的运行态；不能用已废弃
      // 的哈希 class，也不能误伤错误、重试等其他 role=status 提示。
      // Keep rc.1's active-turn shimmer.  Only the underlying localized text
      // is hidden; the Crawshrimp replacement owns the same animated
      // background-clip treatment and honors reduced-motion preferences.
      '[data-cs-running-status="1"] { font-size: 0 !important; }',
      '[data-cs-running-status="1"]::before { content: "抓虾中..."; display: inline-block; font: var(--dsw-font-s-strong-14); font-size: var(--dsh-content-font-size, 14px); line-height: calc(22px + var(--dsh-content-font-delta, 0px)); background: linear-gradient(90deg, var(--dsw-alias-state-business-primary) 0%, var(--dsw-alias-state-business-primary) 40%, color-mix(in srgb, var(--dsw-alias-state-business-primary) 26%, white) 50%, var(--dsw-alias-state-business-primary) 60%, var(--dsw-alias-state-business-primary) 100%); color: #0000; -webkit-text-fill-color: transparent; background-position: 100% 0; background-size: 250% 100%; -webkit-background-clip: text; background-clip: text; animation: 1.8s linear infinite cs-running-status-shimmer; }',
      '[data-cs-running-status-clock="1"] { font-size: var(--dsh-content-font-size-secondary, 13px) !important; color: var(--dsw-alias-label-caption) !important; -webkit-text-fill-color: var(--dsw-alias-label-caption) !important; }',
      '@keyframes cs-running-status-shimmer { to { background-position: 0 0; } }',
      '@media (prefers-reduced-motion: reduce) { [data-cs-running-status="1"]::before { background-position: 0 0; background-size: 100% 100%; animation: none; } }',
      // 5) 新会话空状态 hero:去 DeepSeek 鱼 logo 与文案,替换为抓虾
      // rc.1 移除了 HeroGlow；保留旧版椭圆、8% 蓝灰色和 50px 模糊参数。
      // 装饰层随新会话 composer 挂载，不接收点击；旧版已有光晕时不重复叠加。
      '.wSkVaW_composerHero { position: relative; }',
      '.wSkVaW_composerHero:not(:has(> .wSkVaW_heroGlow))::before { content: ""; position: absolute; z-index: -1; pointer-events: none; width: 135.438%; aspect-ratio: 1051 / 468; bottom: 92px; left: 50%; transform: translate(-50%, 50%); background: url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 1051 468%27 fill=%27none%27%3E%3Cdefs%3E%3Cfilter id=%27glow%27 x=%270%27 y=%270%27 width=%271051%27 height=%27468%27 filterUnits=%27userSpaceOnUse%27 color-interpolation-filters=%27sRGB%27%3E%3CfeGaussianBlur stdDeviation=%2750%27/%3E%3C/filter%3E%3C/defs%3E%3Cellipse cx=%27525.5%27 cy=%27234%27 rx=%27425.5%27 ry=%27134%27 fill=%27%236187D8%27 fill-opacity=%270.08%27 filter=%27url(%23glow)%27/%3E%3C/svg%3E") center / contain no-repeat; }',
      'svg[viewBox="0 0 23.16 17.04"] { display: none !important; }',
      '.cs-running-shrimp, span:has(> .cs-running-shrimp) { display:none !important; }',
      '.cs-model-label { display:inline-flex; align-items:center; gap:9px; min-width:0; max-width:100%; vertical-align:middle; }',
      '.cs-model-icon { display:inline-flex; align-items:center; justify-content:center; width:23px; height:23px; flex:none; color:var(--dsw-alias-label-primary); line-height:0; }',
      '.cs-model-icon > svg { display:block; width:21px; height:21px; flex:none; } .cs-model-icon[data-model-logo="deepseek"] > svg { width:23px; height:23px; }',
      '.cs-model-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
      '.cs-hero-title { display: inline-flex !important; align-items: baseline; justify-content: center; gap: 0; font-size: 0 !important; line-height: 1.3; white-space: nowrap; }',
      '.cs-hero-title > span:first-child { font-size: 24px; font-weight: 750; color: var(--dsw-alias-label-primary); }',
      '.cs-hero-slogan { margin-left: 8px; font-size: 22px; font-weight: 400; color: transparent; background-image: linear-gradient(100deg, var(--dsw-alias-label-secondary) 0%, var(--dsw-alias-label-secondary) 32%, color-mix(in srgb, var(--dsw-alias-label-primary) 42%, #7C8AA5) 43%, #D9E6F2 49%, color-mix(in srgb, var(--dsw-alias-label-primary) 34%, #AFC3DA) 55%, var(--dsw-alias-label-secondary) 68%, var(--dsw-alias-label-secondary) 100%); background-size: 230% 100%; background-position: 120% 50%; -webkit-background-clip: text; background-clip: text; animation: cs-slogan-wave 2.8s cubic-bezier(0.4, 0, 0.2, 1) infinite; }',
      '.pXSMma_previewBadge { display: none !important; }',
      '@keyframes cs-slogan-wave { 0% { background-position: 120% 50%; } 52% { background-position: -24% 50%; } 100% { background-position: -24% 50%; } }',
      '@media (prefers-reduced-motion: reduce) { .cs-hero-slogan { animation: none; background-image: none; color: var(--dsw-alias-label-secondary); } }',
      '@supports not ((background-clip: text) or (-webkit-background-clip: text)) { .cs-hero-slogan { background-image: none; color: var(--dsw-alias-label-secondary); } }',
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
      '.cs-nav-toggle .cs-nav-icon { width: 20px; height: 20px; color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary)); font-size: 0; transition: transform 150ms cubic-bezier(0.4, 0, 0.2, 1); }',
      '.cs-nav-toggle .cs-nav-icon::before { content: ""; width: 0; height: 0; border-left: 3.5px solid transparent; border-right: 3.5px solid transparent; border-top: 4.5px solid currentColor; transform: translateY(1px); }',
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

    // rc.1 renders an active turn as `<div class="EvIC1a_turnStatus"
    // role="status">深度求索中...</div>`.  The class hash may change on a
    // later compatible build, so require both the live-region semantics and
    // the stable class suffix/text contract.  Other `role=status` rows are
    // terminal errors/retries and must retain their original wording.
    function isRunningStatusNode(node) {
      if (!node || node.getAttribute?.('role') !== 'status') return false
      const className = typeof node.className === 'string' ? node.className : ''
      if (!/(?:^|\s)(?:EvIC1a_turnStatus|[^\s]*turnStatus)(?:\s|$)/.test(className)) return false
      const text = String(node.textContent || '').replace(/\s+/g, ' ').trim()
      return /(?:深度求索中|Deep diving|抓虾中)\.\.\./iu.test(text)
    }

    function runningStatusCandidates(root = document) {
      if (!root) return []
      const nodes = []
      if (typeof root.matches === 'function' && root.matches('[role="status"]')) nodes.push(root)
      if (typeof root.querySelectorAll === 'function') nodes.push(...root.querySelectorAll('[role="status"]'))
      return nodes
    }

    function normalizeRunningStatus(root = document) {
      for (const node of runningStatusCandidates(root)) {
        if (!isRunningStatusNode(node)) {
          delete node.dataset.csRunningStatus
          for (const clock of node.querySelectorAll?.('[class*="turnStatusClock"]') || []) {
            delete clock.dataset.csRunningStatusClock
          }
          continue
        }
        node.dataset.csRunningStatus = '1'
        // The visual replacement is CSS-based.  Keep assistive technology in
        // sync with it instead of announcing the upstream brand string.
        node.setAttribute('aria-label', '抓虾中...')
        for (const clock of node.querySelectorAll?.('[class*="turnStatusClock"]') || []) {
          clock.dataset.csRunningStatusClock = '1'
        }
      }
    }

    // ---- 抓虾菜单注入 DSH 侧边栏(主菜单 + 底部菜单) ----
    const MAIN_NAV_IDS = ['scripts', 'market', 'ai_image', 'task_center', 'ai_video_generation', 'local_prompt_library', 'files']
    const BOTTOM_NAV_IDS = ['settings']
    const MAIN_VISIBLE_DEFAULT = 3

    let lastRailMetricsSignature = ''
    let railMetricsQueued = false
    let railMetricsForceQueued = false
    let railResizeObserver = null
    let railResizeTarget = null
    let lastNavItems = []
    let lastNavActiveId = ''
    const expandedNavGroupIds = new Set()

    function currentRailTarget() {
      const rail = document.querySelector('.hHd-Xa_root')
      if (!rail) return null
      return rail.closest('[class*="sidebarCol"]') || rail.parentElement || rail
    }

    function currentRailWidth() {
      const target = currentRailTarget()
      if (!target) return 0
      const width = Math.round(target.getBoundingClientRect().width)
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
        // 点击时使用当前实际宽度；历史展开宽度不能覆盖已折叠的导航。
        const width = currentRailWidth()
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
        icon.setAttribute('aria-hidden', 'true')
        toggle.appendChild(icon)
      }
      if (icon.textContent !== '') icon.textContent = ''
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
      '.cs-generation-group { position: relative; flex: none; width: min(100%, 220px); margin: 2px 0; align-self: flex-start; }',
      '.cs-generation-group[hidden], .cs-image-card[hidden], .cs-image-turn-gallery[hidden] { display: none !important; }',
      '.cs-generation-preview { position: relative; width: 100%; aspect-ratio: 1; overflow: hidden; border-radius: 12px; background: #000; border: 1px solid #39302b; }',
      '.cs-generation-effect, .cs-generation-effect > *, .cs-generation-effect .aiw-image-generation-effect, .cs-generation-effect .aiw-image-generation-surface, .cs-generation-effect .aiw-image-generation-fallback { width: 100%; height: 100%; position: absolute; inset: 0; }',
      '.cs-generation-caption { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; pointer-events: none; color: #eee; font-size: 14px; font-weight: 600; text-shadow: 0 1px 8px #000; }',
      '.cs-generation-caption-text { display: inline-block; background: linear-gradient(90deg, #ddd 0%, #ddd 40%, #fff 50%, #ddd 60%, #ddd 100%); color: transparent; -webkit-text-fill-color: transparent; background-position: 100% 0; background-size: 250% 100%; -webkit-background-clip: text; background-clip: text; animation: 1.8s linear infinite cs-running-status-shimmer; }',
      '@media (prefers-reduced-motion: reduce) { .cs-generation-caption-text { animation: none; background: none; color: #eee; -webkit-text-fill-color: #eee; } }',
      '.cs-artifact-block { margin: 10px 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); padding: 10px 12px; max-width: 560px; align-self: flex-start; }',
      '.cs-artifact-block.cs-image-card { position: relative; width: fit-content; max-width: 100%; padding: 0; border: 0; background: transparent; margin: 0; border-radius: 16px; overflow: hidden; }',
      '.cs-image-preview { display: block; border: 0; padding: 0; background: transparent; cursor: zoom-in; border-radius: inherit; overflow: hidden; max-width: 100%; }',
      '.cs-image-preview img { display: block; width: auto; height: auto; max-width: 100%; max-height: 480px; object-fit: contain; }',
      '.cs-image-actions { position: absolute; right: 10px; bottom: 10px; display: flex; gap: 6px; opacity: 0; transition: opacity 120ms ease; }',
      '.cs-image-card:hover .cs-image-actions, .cs-image-card:focus-within .cs-image-actions { opacity: 1; }',
      '.cs-image-action { display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid #ffffff30; border-radius: 9px; background: #202124dd; color: white; cursor: pointer; }',
      '.cs-image-action svg, .cs-image-process summary svg { width: 16px; height: 16px; flex: none; }',
      '.cs-image-action:focus-visible, .cs-image-preview:focus-visible, .cs-image-process summary:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
      '.cs-image-process { color: var(--dsw-alias-label-secondary); font-size: 13px; margin: 2px 0; }',
      '.cs-image-process summary { display: flex; align-items: center; gap: 7px; cursor: pointer; list-style: none; width: fit-content; padding: 4px 0; }',
      '.cs-image-process summary::-webkit-details-marker { display: none; }',
      '.cs-image-process summary::after { content: "›"; margin-left: 2px; transition: transform 120ms ease; }',
      '.cs-image-process[open] summary::after { transform: rotate(90deg); }',
      '.cs-image-process-items, .cs-image-delivery { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px; max-width: 100%; }',
      '.cs-image-process-items .cs-image-preview img { width: 220px; max-width: 100%; height: auto; object-fit: contain; }',
      '.cs-image-process-items .cs-image-card { border-radius: 10px; }',
      '.cs-image-process-items .cs-image-actions { display: none; }',
      'p:has(> button[class*="_imageButton"] ~ button[class*="_imageButton"]) { display:flex; flex-wrap:wrap; gap:10px; align-items:flex-start; }',
      'p:has(> button[class*="_imageButton"] ~ button[class*="_imageButton"]) > button[class*="_imageButton"] { display:block; flex:0 1 220px; width:220px; max-width:100%; }',
      'p:has(> button[class*="_imageButton"] ~ button[class*="_imageButton"]) > button[class*="_imageButton"] img { width:100%; max-height:220px; object-fit:contain; }',
      '[data-cs-image-grouped="true"] { display:none !important; }',
      '.cs-image-turn-gallery.cs-collection-mode .cs-image-delivery { display:none; }',
      '.cs-image-collection { display:flex; gap:10px; width:min(100%, 620px); align-items:flex-start; }',
      '.cs-image-collection-main { flex:1; min-width:0; border-radius:14px; overflow:hidden; background:var(--dsw-alias-bg-layer-1); }',
      '.cs-image-collection-main .cs-image-card, .cs-image-collection-main .cs-image-preview { width:100%; height:auto; }',
      '.cs-image-collection-main .cs-image-preview img { width:100%; height:auto; max-height:620px; object-fit:contain; }',
      '.cs-image-collection-list { flex:none; display:flex; flex-direction:column; gap:8px; width:76px; max-height:min(520px,70vw); overflow-y:auto; padding:3px; }',
      '.cs-image-collection-thumb { flex:none; padding:0; border:2px solid transparent; border-radius:9px; overflow:hidden; background:transparent; width:68px; aspect-ratio:1; cursor:pointer; }',
      '.cs-image-collection-thumb[aria-pressed="true"] { border-color:var(--dsw-alias-state-business-primary, #315c43); }',
      '.cs-image-collection-thumb img { width:100%; height:100%; object-fit:cover; display:block; }',
      '.cs-image-collection-thumb:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary, #315c43); outline-offset:2px; }',
      '.cs-image-turn-gallery { display:flex; flex-wrap:wrap; gap:10px; margin:12px 0; }',
      '.cs-image-delivery { display:contents; }',
      '.cs-image-delivery .cs-image-card { width: min(100%, 220px); max-width: 100%; }',
      '.cs-image-delivery .cs-image-preview img { width:100%; max-height:220px; object-fit:cover; }',
      '@media (hover: none) { .cs-image-actions { opacity: 1; } }',
      '@media (prefers-reduced-motion: reduce) { .cs-image-actions, .cs-image-process summary::after { transition: none; } }',
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
      '.cs-artifact-image-dialog { width: fit-content; max-width: 90vw; max-height: 90vh; padding: 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }',
      '.cs-artifact-image-close { display: grid; place-items: center; width: 32px; height: 32px; margin-left: auto; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }',
      '.cs-artifact-image-close svg { width: 18px; height: 18px; }',
      '.cs-artifact-image-close:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
      '.cs-artifact-image-close:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }',
      '.cs-artifact-image-dialog::backdrop { background: #000b; }',
      '.cs-artifact-image-dialog > img { display: block; max-width: 85vw; max-height: 78vh; object-fit: contain; margin-top: 12px; }',
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
      if (mediaKind === 'image') return 'IMG'
      if (mediaKind === 'video') return '🎬'
      if (mediaKind === 'audio') return '🎧'
      if (mediaKind === 'zip') return '📦'
      const lower = String(filename || '').toLowerCase()
      if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) return '📊'
      return '📄'
    }

    function previewArchiveImage(url, filename) {
      const dialog = document.createElement('dialog')
      dialog.className = 'cs-artifact-image-dialog'
      dialog.setAttribute('aria-label', filename || '图片预览')
      const close = document.createElement('button')
      close.type = 'button'
      close.className = 'cs-artifact-image-close'
      close.setAttribute('aria-label', '关闭图片预览')
      close.title = '关闭'
      close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>'
      close.addEventListener('click', () => dialog.close())
      const img = document.createElement('img')
      img.src = url
      img.alt = filename || '图片预览'
      dialog.append(close, img)
      dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close() })
      dialog.addEventListener('close', () => dialog.remove(), { once: true })
      document.body.appendChild(dialog)
      dialog.showModal()
    }

    function makeArtifactBlock(artifact, urls) {
      const block = document.createElement('div')
      block.className = 'cs-artifact-block'
      block.dataset.artifactPath = String(artifact.path || '')
      block.dataset.artifactCallId = String(artifact.toolCallId || '')
      const isZip = artifact.mediaKind === 'zip' || /\.zip$/i.test(artifact.path || artifact.filename || '')
      const open = () => {
        if (artifact.path) postToShell({ __crawshrimp: isZip ? 'reveal-file' : 'open-file', path: artifact.path })
      }

      if (artifact.mediaKind === 'image' && urls.file) {
        block.className += ' cs-image-card'
        const preview = document.createElement('button')
        preview.type = 'button'
        preview.className = 'cs-image-preview'
        preview.setAttribute('aria-label', '查看大图：' + (artifact.filename || '生成图片'))
        const img = document.createElement('img')
        img.src = urls.file
        img.alt = artifact.filename || '生成图片'
        img.decoding = 'async'
        preview.appendChild(img)
        preview.addEventListener('click', open)
        const actions = document.createElement('div')
        actions.className = 'cs-image-actions'
        for (const [label, glyph, action] of [
          ['打开原图', '<path d="M14 3h7v7M21 3l-9 9"/><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>', open],
          ['在文件夹中显示', '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>', () => postToShell({ __crawshrimp: 'reveal-file', path: artifact.path })],
        ]) {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'cs-image-action'
          button.title = label
          button.setAttribute('aria-label', label)
          button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + glyph + '</svg>'
          button.addEventListener('click', action)
          actions.appendChild(button)
        }
        block.append(preview, actions)
        return block
      }

      const head = document.createElement('div')
      head.className = 'cs-artifact-head'
      head.title = isZip ? '在文件夹中显示压缩包' : '点击打开文件'
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
      openBtn.textContent = isZip ? '显示文件' : '打开'
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
          img.tabIndex = 0
          img.setAttribute('role', 'button')
          const preview = () => previewArchiveImage(entryUrl, entries[index])
          img.addEventListener('click', preview)
          img.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); preview() }
          })
          grid.appendChild(img)
        })
        block.appendChild(grid)
        const hint = document.createElement('div')
        hint.className = 'cs-artifact-zip-hint'
        hint.textContent = `${Math.min(entries.length, 20)} 张预览图 · 点击图片放大预览，「显示文件」定位压缩包`
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

    const generationGroups = new Map()
    const imageTurnGalleries = new Map()
    function answerContainsArtifact(answer, path) {
      if (!path) return false
      return [...answer.querySelectorAll('img')].some(img => {
        try {
          const url = new URL(img.currentSrc || img.src, document.baseURI)
          return url.searchParams.get('path') === path
        } catch { return false }
      })
    }
    function reconcileImageCollection(gallery, answer, items) {
      const large = items.length > 3
      for (const button of answer.querySelectorAll('[data-cs-image-grouped="true"]')) button.removeAttribute('data-cs-image-grouped')
      gallery.classList.toggle('cs-collection-mode', large)
      if (!large) {
        gallery.collection?.view.remove()
        gallery.collection = null
        return
      }
      const paths = new Set(items.map(item => item.sourcePath || item.path))
      for (const img of answer.querySelectorAll('img')) {
        try {
          const path = new URL(img.currentSrc || img.src, document.baseURI).searchParams.get('path')
          const button = img.closest('button')
          if (paths.has(path) && button) button.setAttribute('data-cs-image-grouped', 'true')
        } catch { /* unrelated image */ }
      }
      if (gallery.collection && gallery.collection.items.length === items.length &&
          items.every((item, i) => gallery.collection.items[i] === item)) return
      const oldIndex = gallery.collection?.selected || 0
      gallery.collection?.view.remove()
      const view = document.createElement('section'); view.className = 'cs-image-collection'
      view.setAttribute('aria-label', '本轮生成的图片')
      const main = document.createElement('div'); main.className = 'cs-image-collection-main'
      const list = document.createElement('div'); list.className = 'cs-image-collection-list'
      const state = { view, items, selected: Math.min(oldIndex, items.length - 1) }
      const thumbs = items.map((item, index) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'cs-image-collection-thumb'
        button.setAttribute('aria-label', '选择图片：' + (item.artifact.filename || String(index + 1)))
        const img = document.createElement('img'); img.src = item.urls.file; img.alt = ''; button.appendChild(img)
        button.addEventListener('click', () => select(index))
        list.appendChild(button); return button
      })
      function select(index) {
        state.selected = index
        while (main.firstChild) main.firstChild.remove()
        main.appendChild(makeArtifactBlock(items[index].artifact, items[index].urls))
        thumbs.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)))
      }
      view.append(main, list); gallery.appendChild(view); gallery.collection = state; select(state.selected)
    }
    let imageEffectPromise
    function imageEffectReady() {
      if (window.crawshrimpMountImageLoader) return Promise.resolve()
      if (!imageEffectPromise) imageEffectPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = '/api/crawshrimp/image-generation-effect.js'
        script.onload = resolve
        script.onerror = reject
        document.head.appendChild(script)
      })
      return imageEffectPromise
    }

    function messageColumn() {
      return document.querySelector('[data-chat-flow]') || document.querySelector('.EvIC1a_column') || document.querySelector('.Md3f7G_column')
    }

    function placeGenerationGroup(entry) {
      if (entry.sessionId && entry.sessionId !== activeRuntimeSessionId()) {
        stopGenerationLoader(entry)
        entry.block.remove()
        entry.delivery?.remove()
        if (entry.gallery && !entry.gallery.querySelectorAll('.cs-image-delivery').length) {
          entry.gallery.collection?.view.remove(); entry.gallery.collection = null; entry.gallery.remove()
        }
        return
      }
      const column = messageColumn()
      if (!column) return
      const rows = [...column.querySelectorAll('[data-chat-anchor-key]')]
      let anchor = rows.find(row => entry.callId && row.dataset.chatCallId === entry.callId)
        || rows.find(row => entry.anchorKey && row.dataset.chatAnchorKey === entry.anchorKey)
      if (!anchor && !entry.callId && !entry.anchorKey) {
        anchor = rows.filter(row => !row.hidden && entry.turn != null && row.dataset.chatTurn === String(entry.turn)).at(-1)
      }
      if (anchor) entry.anchorKey = anchor.dataset.chatAnchorKey
      if (!anchor) { entry.block.remove(); entry.delivery?.remove(); return } // History not mounted yet; observer retries without pinning to the bottom.
      // Image results are independent flow items, never children of tool/history disclosures.
      let flowAnchor = anchor
      while (flowAnchor.parentNode && flowAnchor.parentNode !== column) flowAnchor = flowAnchor.parentNode
      if (flowAnchor.parentNode !== column) return
      entry.flowAnchor = flowAnchor
      const turn = anchor.dataset.chatTurn
      const answer = rows.find(row => row.dataset.chatTurn === turn && row.dataset.chatFinalAnswer === 'true')
      entry.block.hidden = Boolean(answer && entry.finished)
      if (entry.block.hidden) {
        // Do not insert hidden process rows next to the final answer. Competing
        // insertions with the gallery can cause observers to continually move
        // nodes, starving the renderer's input event loop.
        entry.block.remove()
      } else {
        let processPreceding = flowAnchor
        for (const other of generationGroups.values()) {
          if (other === entry) break
          if (other.sessionId === entry.sessionId && other.flowAnchor === flowAnchor && other.block.isConnected) processPreceding = other.block
        }
        if (processPreceding.nextSibling !== entry.block) processPreceding.after(entry.block)
      }
      if (!entry.delivery) return
      if (!answer || !entry.delivery.childElementCount) {
        entry.delivery.remove()
        if (entry.gallery && !entry.gallery.querySelectorAll('.cs-image-delivery').length) {
          entry.gallery.collection?.view.remove(); entry.gallery.collection = null; entry.gallery.remove()
        }
        return
      }
      const galleryKey = entry.sessionId + ':' + turn
      let gallery = imageTurnGalleries.get(galleryKey)
      if (!gallery) {
        gallery = document.createElement('section')
        gallery.className = 'cs-image-turn-gallery'
        gallery.setAttribute('aria-label', '本轮生成的图片')
        imageTurnGalleries.set(galleryKey, gallery)
      }
      entry.gallery = gallery
      if (entry.delivery.parentNode !== gallery) gallery.appendChild(entry.delivery)
      const items = [...generationGroups.values()]
        .filter(group => group.gallery === gallery && group.delivery?.parentNode === gallery)
        .flatMap(group => [...(group.images || new Map()).values()])
      const large = items.length > 3
      for (const image of items) image.final.hidden = !large && answerContainsArtifact(answer, image.sourcePath || image.path)
      reconcileImageCollection(gallery, answer, items)
      gallery.hidden = !large && items.every(image => image.final.hidden)
      if (answer.nextSibling !== gallery) answer.after(gallery)
    }

    function stopGenerationLoader(entry) {
      if (entry.captionTimer) clearInterval(entry.captionTimer)
      entry.captionTimer = null
      entry.dispose?.()
      entry.dispose = null
      entry.preview?.remove()
      entry.preview = null
    }

    function renderImageGeneration(data) {
      const sessionId = String(data.runtimeSessionId || '')
      if (sessionId && sessionId !== activeRuntimeSessionId()) return
      const key = String(data.tool_call_id || '')
      if (!key) return
      injectArtifactCss()
      let entry = generationGroups.get(key)
      if (!entry) {
        const block = document.createElement('section')
        block.className = 'cs-generation-group'
        block.dataset.generationId = key
        block.setAttribute('aria-label', 'AI 生图任务')
        entry = { block, sessionId, callId: String(data.dsh_call_id || ''), turn: data.turn, anchorKey: '', finished: false }
        generationGroups.set(key, entry)
      }
      if (data.state !== 'loading') {
        entry.finished = true
        stopGenerationLoader(entry)
      } else if (!entry.finished && !entry.preview) {
        const preview = document.createElement('div')
        preview.className = 'cs-generation-preview'
        preview.setAttribute('role', 'status')
        const host = document.createElement('div')
        host.className = 'cs-generation-effect'
        const label = document.createElement('div')
        label.className = 'cs-generation-caption'
        const caption = document.createElement('span')
        caption.className = 'cs-generation-caption-text'
        const messages = ['正在描摹画面', '正在铺陈光影', '正在勾勒细节', '让灵感慢慢成像']
        let captionIndex = 0
        caption.textContent = messages[captionIndex]
        label.appendChild(caption)
        entry.captionTimer = setInterval(() => {
          captionIndex = (captionIndex + 1) % messages.length
          caption.textContent = messages[captionIndex]
        }, 6000)
        preview.append(host, label)
        entry.block.appendChild(preview)
        entry.preview = preview
        imageEffectReady().then(() => {
          if (entry.preview === preview && !entry.finished) entry.dispose = window.crawshrimpMountImageLoader(host)
        }).catch(() => { label.textContent = '正在生成图片…' })
      }
      placeGenerationGroup(entry)
    }

    // React may insert subsequent messages before foreign DOM nodes. Keep each
    // task next to its stable message anchor, never in the composer or tail slot.
    const generationObservation = { childList: true, subtree: true, attributes: true, attributeFilter: ['data-chat-final-answer', 'data-chat-turn', 'data-chat-call-id'] }
    const generationObserver = new MutationObserver(() => {
      // Our own insertions must not recursively schedule another reconciliation.
      generationObserver.disconnect()
      try { for (const entry of generationGroups.values()) placeGenerationGroup(entry) }
      finally { generationObserver.observe(document.body, generationObservation) }
    })
    generationObserver.observe(document.body, generationObservation)

    function renderArtifactShow(data) {
      if (data.runtimeSessionId && data.runtimeSessionId !== activeRuntimeSessionId()) return
      const artifact = data && data.artifact
      if (!artifact || !artifact.path) return
      const hasImages = artifact.mediaKind === 'image'
        || (artifact.mediaKind === 'zip' && Array.isArray(data.urls?.entries) && data.urls.entries.some(Boolean))
      if (!hasImages) return
      injectArtifactCss()
      const generationKey = String(artifact.toolCallId || '')
      const generation = generationGroups.get(generationKey)
      if (generation && artifact.mediaKind === 'image') {
        stopGenerationLoader(generation)
        generation.finished = true
        if (!generation.images) generation.images = new Map()
        // Replay refreshes signed URLs without adding a second copy.
        const previous = generation.images.get(artifact.path)
        if (previous?.url === data.urls?.file) { placeGenerationGroup(generation); return }
        previous?.process.remove()
        previous?.final.remove()
        if (!generation.process) {
          const details = document.createElement('details')
          details.className = 'cs-image-process'
          details.open = true
          const summary = document.createElement('summary')
          summary.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></svg>'
          generation.countLabel = document.createElement('span')
          summary.appendChild(generation.countLabel)
          generation.process = document.createElement('div')
          generation.process.className = 'cs-image-process-items'
          details.append(summary, generation.process)
          generation.block.appendChild(details)
          generation.delivery = document.createElement('section')
          generation.delivery.className = 'cs-image-delivery'
          generation.delivery.setAttribute('aria-label', '本轮生成的图片')
        }
        const process = makeArtifactBlock(artifact, data.urls || {})
        const final = makeArtifactBlock(artifact, data.urls || {})
        generation.process.appendChild(process)
        generation.delivery.appendChild(final)
        generation.images.set(artifact.path, { process, final, url: data.urls?.file, path: artifact.path, sourcePath: artifact.sourcePath, artifact, urls: data.urls || {} })
        generation.countLabel.textContent = '已生成 ' + generation.images.size + ' 张图片'
        placeGenerationGroup(generation)
      } else {
        // Non-generation archives retain their existing inline placement.
        if ([...document.querySelectorAll('.cs-artifact-block')].some(b => b.dataset.artifactPath === String(artifact.path))) return
        const column = messageColumn()
        if (!column || (artifact.imageGeneration && generationKey && !generation)) {
          const retries = Number(data.__retries || 0)
          if (retries < 6) setTimeout(() => renderArtifactShow({ ...data, __retries: retries + 1 }), 2500)
          return
        }
        const block = makeArtifactBlock(artifact, data.urls || {})
        const rows = column.querySelectorAll('[data-chat-anchor-key]')
        const anchor = rows[rows.length - 1]
        if (anchor) anchor.after(block)
      }
      // 滚动到底,让新「消息」立即可见
      const scrollEl = document.querySelector('.wSkVaW_scrollBody')
      if (scrollEl && scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 160) {
        try {
          scrollEl.scrollTop = scrollEl.scrollHeight
        } catch (error) {
          // 忽略
        }
      }
    }

    // ---- 会话附件上传:📎 按钮 + 拖入 + 粘贴 ----
    const ATTACH_CSS = [
      '.cs-attachment-rail { display:flex; align-items:center; gap:8px; flex-wrap:nowrap; overflow-x:auto; overflow-y:hidden; min-width:0; padding:2px 14px 4px; scrollbar-width:none; scroll-padding:14px; overscroll-behavior-x:contain; }',
      '.cs-unified-attachments > .cs-attachment-rail { margin-bottom:-10px; }',
      '.cs-attachment-rail::-webkit-scrollbar { display:none; }',
      '.cs-attachment-card { display:flex; flex:0 0 180px; align-items:center; gap:8px; height:52px; box-sizing:border-box; padding:8px 9px; border:1px solid var(--dsw-alias-border-l1); border-radius:10px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); position:relative; }',
      '.cs-attachment-icon { display:grid; place-items:center; width:26px; flex-shrink:0; color:var(--dsw-alias-label-secondary); } .cs-attachment-icon svg { width:22px; height:22px; }',
      '.cs-attachment-label { min-width:0; flex:1; } .cs-attachment-label strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:500; line-height:17px; } .cs-attachment-label small { display:block; margin-top:1px; color:var(--dsw-alias-label-secondary); font-size:10px; line-height:14px; }',
      '.cs-attachment-card button, .cs-attachment-image .cs-attachment-remove { display:grid; place-items:center; width:18px; height:18px; padding:0; flex-shrink:0; border:0; border-radius:50%; cursor:pointer; color:var(--dsw-alias-label-secondary); background:transparent; font-size:17px; line-height:1; }',
      '.cs-attachment-card button:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }',
      '.cs-attachment-image { position:relative; flex:0 0 52px; width:52px; height:52px; } .cs-attachment-image .cs-image-preview { display:block; width:52px; height:52px; border:1px solid var(--dsw-alias-border-l1); border-radius:10px; padding:0; overflow:hidden; cursor:pointer; background:transparent; } .cs-image-preview img { width:100%; height:100%; object-fit:cover; }',
      '.cs-attachment-image .cs-attachment-remove { position:absolute; top:2px; right:2px; color:white; background:rgba(0,0,0,.65); }',
      '.cs-unified-attachments .JVDQca_root { display:contents; } .cs-unified-attachments .JVDQca_rail { display:none; }',
      '.cs-sent-attachments { display:flex; flex-wrap:nowrap; gap:6px; max-width:100%; min-width:0; overflow-x:auto; padding:2px; } .cs-sent-attachments .cs-attachment-card { flex:0 0 180px; } .cs-has-sent-attachments [data-slot="conversation.message.images"] { display:none !important; } .cs-sent-image { flex:0 0 52px; width:52px; height:52px; padding:0; border:0; border-radius:8px; overflow:hidden; cursor:pointer; } .cs-sent-image img { width:100%; height:100%; object-fit:cover; } .cs-has-sent-attachments > .Sixlwa_bubble:not(.cs-sent-text) { display:none; } .cs-sent-text { white-space:pre-wrap; }',
      '[data-composer-chip="crawshrimp-attachment"] { display:none; }',
      '[data-cs-upload-button="1"] > svg { display:none; }',
      '[data-cs-upload-button="1"]::before { content:"📎"; font-size:15px; line-height:1; }',
      '.cs-attach-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; margin: 0 8px 8px 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 12.5px; cursor: pointer; transition: background-color 120ms cubic-bezier(0.4, 0, 0.2, 1); }',
      '.cs-attach-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
      '.cs-attach-btn:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }',
      '.uV2eYG_add[data-cs-tooltip] { position: relative; overflow: visible; }',
      '.uV2eYG_add[data-cs-tooltip]::after { content: attr(data-cs-tooltip); z-index: 80; position: absolute; left: 50%; bottom: calc(100% + 8px); transform: translate(-50%, 2px); opacity: 0; pointer-events: none; white-space: nowrap; border-radius: 8px; padding: 5px 9px; background: var(--dsw-alias-tooltip-bg, #2c2c2e); color: #f7f7fa; font-size: 12px; font-weight: 500; line-height: 18px; box-shadow: var(--dsw-shadow-lv2, 0 4px 14px rgba(0,0,0,.22)); transition: opacity 120ms ease, transform 120ms ease; }',
      '.uV2eYG_add[data-cs-tooltip]:hover::after, .uV2eYG_add[data-cs-tooltip]:focus-visible::after { opacity: 1; transform: translate(-50%, 0); }',
      '[data-cs-composer-tooltip-shield="1"] [role="tooltip"] { display: none !important; }',
      '[role="tooltip"][data-cs-suppressed-tooltip="1"] { display: none !important; }',
      '[data-cs-llm-config-required="1"] :is([data-composer-seat], [data-composer-card], .wSkVaW_composerSeat) { cursor: pointer; }',
      '[data-cs-llm-config-required="1"] :is([data-composer-seat], [data-composer-card], .wSkVaW_composerSeat) textarea, [data-cs-llm-config-required="1"] :is([data-composer-seat], [data-composer-card], .wSkVaW_composerSeat) [contenteditable="true"] { cursor: pointer; }',
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
        const composer = document.querySelector(':is([data-composer-seat], [data-composer-card], .wSkVaW_composerSeat)')
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
      return !!(target && typeof target.closest === 'function' && target.closest(':is([data-composer-seat], [data-composer-card], .wSkVaW_composerSeat)'))
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

    const NATIVE_DRAFT_IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

    // This calls DSH's public conversation API, rather than sneaking a data
    // URL into a prompt.  As a result, the native composer owns preview,
    // removal, validation and final model serialization just like an image
    // selected through DSH's original image rail.
    function resolveImageDrafts(conversation, state) {
      if (conversation.resolveDraftAttachments) return conversation.resolveDraftAttachments(state.attachmentIds || []).filter(item => item.file?.type?.startsWith('image/'))
      return conversation.draftImages?.(state.imageIds || []) || []
    }
    function createImageDrafts(conversation, sessionId, files) {
      return conversation.createDrafts ? conversation.createDrafts(sessionId, files) : conversation.createDraftImages(files)
    }
    function addImageDrafts(input, drafts) {
      return (input.addAttachments || input.addImages).call(input, drafts.map(item => item.id))
    }
    function releaseImageDrafts(conversation, drafts) {
      return (conversation.releaseDraftAttachments || conversation.releaseDraftImages).call(conversation, drafts)
    }

    function removeImageDraft(input, conversation, image) {
      if (!input || !conversation || !image?.id) return false
      const remove = input.removeAttachment || input.removeImage
      if (typeof remove !== 'function') return false
      try {
        const state = input.state?.getSnapshot?.()
        if (!state || !['plain', 'claimed'].includes(state.phase)) return false
        if (!(state.attachmentIds || state.imageIds || []).includes(image.id)) return false
        remove.call(input, image.id)
        const after = input.state.getSnapshot()
        if ((after.attachmentIds || after.imageIds || []).includes(image.id)) return false
        try {
          if (typeof conversation.releaseDraftAttachment === 'function') conversation.releaseDraftAttachment(image.id)
          else releaseImageDrafts(conversation, [image])
        } catch (_) { /* The draft was removed; cleanup must not reverse it. */ }
        return true
      } catch (_) { return false }
    }

    function installNativeImageDraft(ctx, data) {
      const sessionId = String(data?.runtimeSessionId || '').trim()
      const mime = String(data?.mime || '').toLowerCase()
      if (!ctx?.sessions || typeof ctx.sessions.scope !== 'function' || !sessionId || !NATIVE_DRAFT_IMAGE_MEDIA_TYPES.has(mime)) return false
      if (sessionId !== activeRuntimeSessionId() || typeof File !== 'function' || data?.bytes == null) return false

      let conversation
      let drafts = []
      try {
        const image = new File([data.bytes], data.name, { type: data.mime })
        const scoped = ctx.sessions.scope(sessionId)
        if (!scoped || typeof scoped.get !== 'function') return false
        conversation = scoped.get('conversation')
        if (!conversation || typeof conversation.createDrafts !== 'function' && typeof conversation.createDraftImages !== 'function' || typeof conversation.input?.for !== 'function') return false
        drafts = Array.from(createImageDrafts(conversation, sessionId, [image]) || [])
        if (!drafts.length) return false
        const inserted = addImageDrafts(conversation.input.for(scoped), drafts)
        if (inserted) return true
      } catch (error) {
        // The exact failure is already surfaced by DSH when the composer can
        // accept the file itself.  Never synthesize a text-only replacement.
      }
      if (drafts.length && conversation) {
        try { releaseImageDrafts(conversation, drafts) } catch (error) { /* best-effort object URL cleanup */ }
      }
      return false
    }

    const pendingAttachmentUploads = new Map()
    let attachmentUploadSequence = 0
    const forwardedImageEvents = new WeakSet()

    function postAttachmentFiles(files) {
      for (const file of nonImageFiles(files)) {
        const runtimeSessionId = activeRuntimeSessionId()
        const requestId = `drop-${Date.now()}-${++attachmentUploadSequence}`
        pendingAttachmentUploads.set(requestId, { sessionId: runtimeSessionId, name: file.name })
        sessionInput(runtimeSessionId)
        renderAttachmentCards()
        postToShell({ __crawshrimp: 'upload-attachment', file, runtimeSessionId, requestId })
      }
    }

    function routeAttachmentFiles(event, files, ctx) {
      if (forwardedImageEvents.has(event)) return false
      const attachments = nonImageFiles(files)
      const images = Array.from(files || []).filter(isImageFile)
      const pendingImages = images.filter((file) => !installNativeImageDraft(ctx, {
        runtimeSessionId: activeRuntimeSessionId(), name: file.name, mime: file.type, bytes: file,
      }))
      // Leave text and unclaimed image-only events to DSH. Ordinary files
      // must never reach its image-only validator, even when no image was added.
      if (!attachments.length && pendingImages.length === images.length) return false
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      postAttachmentFiles(attachments)
      if (pendingImages.length) {
        // A mixed transfer can contain unsupported images or a failed draft.
        // Forward only those images; never replay already installed drafts/files.
        const transfer = new DataTransfer()
        for (const file of pendingImages) transfer.items.add(file)
        const forwarded = event.type === 'paste'
          ? new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
          : new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
        forwardedImageEvents.add(forwarded)
        event.target.dispatchEvent(forwarded)
      }
      return true
    }

    function handlePasteAttachments(event, ctx = crawshrimpContext) {
      if (forwardedImageEvents.has(event) || !inComposer(event.target)) return
      const items = (event.clipboardData || {}).items || []
      const files = []
      for (const item of items) {
        if (item.kind !== 'file') continue
        const file = item.getAsFile()
        if (file) files.push(file)
      }
      routeAttachmentFiles(event, files, ctx)
    }

    function handleDropAttachments(event, ctx = crawshrimpContext) {
      const files = (event.dataTransfer || {}).files
      if (!files || !files.length || forwardedImageEvents.has(event)) return
      try {
        routeAttachmentFiles(event, files, ctx)
      } finally {
        resetNativeDropOverlay()
      }
    }

    const DROP_TITLE_ZH = '图片/文件拖动到此处即可添加'
    const DROP_TITLE_EN = 'Drag images or files here to add them'
    const FILE_LIMIT_ZH = '文件最大 200MB'
    const FILE_LIMIT_EN = 'files up to 200MB'
    let dropOverlayCopyQueued = false
    let lastDropOverlayState = null

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
      // The resource sidebar lives outside this iframe. Mirror the native mask
      // lifecycle, including removal, so the shell can cover that area too.
      const mask = root.querySelectorAll('.BInVoG_mask')[0]
      const background = mask ? window.getComputedStyle(mask).backgroundColor : ''
      const state = JSON.stringify([!!mask, background])
      if (state !== lastDropOverlayState) {
        lastDropOverlayState = state
        window.parent.postMessage({ __crawshrimp: 'file-drop-overlay', active: !!mask, background }, '*')
      }
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
      for (const node of [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])]) {
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

    const ATTACHMENT_SOURCE = 'crawshrimp-attachment'

    function attachmentText(data) {
      return data.kind === 'directory'
        ? `[文件夹路径: ${JSON.stringify(data.path)}]`
        : `[附件: ${data.name} (attachment_id: ${data.attachmentId})]`
    }

    const draftAttachmentsBySession = new Map()
    const watchedAttachmentInputs = new WeakSet()

    function attachmentIdentity(data) {
      return data.attachmentId || `directory:${data.path}`
    }

    function attachmentDraft(sessionId) {
      if (!draftAttachmentsBySession.has(sessionId)) draftAttachmentsBySession.set(sessionId, new Map())
      return draftAttachmentsBySession.get(sessionId)
    }

    let imageDraftDatabase
    function imageDraftStore(mode, action) {
      if (!window.indexedDB) return Promise.resolve(undefined)
      if (!imageDraftDatabase) imageDraftDatabase = new Promise((resolve, reject) => {
        const request = window.indexedDB.open('crawshrimp-image-drafts', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('sessions')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      return imageDraftDatabase.then(db => new Promise((resolve, reject) => {
        const transaction = db.transaction('sessions', mode)
        const request = action(transaction.objectStore('sessions'))
        transaction.oncomplete = () => resolve(request.result)
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      }))
    }

    function watchAttachmentInput(sessionId, scoped, input) {
      if (attachmentBridgeDisposed || !input?.state?.subscribe || !input.submit || watchedAttachmentInputs.has(input)) return
      watchedAttachmentInputs.add(input)
      let queued = false, submitting = false, disposed = false, restoringImages = !!window.indexedDB
      let savedImageIds = null
      const sync = () => {
        queued = false
        if (disposed || submitting) return
        const state = input.state.getSnapshot()
        if (!restoringImages) {
          const ids = JSON.stringify(state.attachmentIds || state.imageIds || [])
          if (ids !== savedImageIds) {
            savedImageIds = ids
            const conversation = scoped.get('conversation')
            const files = resolveImageDrafts(conversation, state).map(image => image.file)
            imageDraftStore('readwrite', store => files.length ? store.put(files, sessionId) : store.delete(sessionId))
              .catch(() => input.notify('error', '图片草稿暂时无法保存，刷新前请先发送'))
          }
        }
        if (!['plain', 'claimed'].includes(state.phase)) return
        const draft = attachmentDraft(sessionId)
        // Failed sends restore native references. Adopt them back into the
        // independent attachment draft; editing/selecting all text cannot
        // accidentally delete attached files.
        for (const item of state.occurrences || []) {
          if (item.source !== ATTACHMENT_SOURCE) continue
          const data = JSON.parse(item.ref)
          draft.set(attachmentIdentity(data), data)
        }
        flushAttachmentHints(sessionId)
        if (sessionId === activeRuntimeSessionId()) renderAttachmentCards()
      }
      const schedule = () => {
        if (queued || disposed) return
        queued = true
        Promise.resolve().then(sync)
      }
      const originalSubmit = input.submit
      const wrappedSubmit = function (...args) {
        if (restoringImages) {
          input.notify('error', '正在恢复图片附件，请稍候再发送')
          return
        }
        if ([...pendingAttachmentUploads.values()].some(item => item.sessionId === sessionId)) {
          input.notify('error', '附件正在添加，请稍候再发送')
          return
        }
        flushAttachmentHints(sessionId)
        const state = input.state.getSnapshot()
        if (!['plain', 'claimed'].includes(state.phase)) return originalSubmit.apply(input, args)
        const draft = attachmentDraft(sessionId)
        // Hand this exact batch to DSH's native serializer/transaction. Its
        // optimistic commit clears cards; a rejected send restores references.
        for (const item of state.occurrences || []) {
          if (item.source === ATTACHMENT_SOURCE) draft.delete(attachmentIdentity(JSON.parse(item.ref)))
        }
        submitting = true
        try { return originalSubmit.apply(input, args) }
        finally { submitting = false; schedule() }
      }
      input.submit = wrappedSubmit
      const unsubscribe = input.state.subscribe(schedule)
      crawshrimpContext?.effect?.(() => () => {
        disposed = true
        unsubscribe()
        if (input.submit === wrappedSubmit) input.submit = originalSubmit
      })
      if (restoringImages) {
        imageDraftStore('readonly', store => store.get(sessionId)).then(files => {
          if (disposed || !files?.length) return
          const conversation = scoped.get('conversation')
          const fingerprint = file => JSON.stringify([file.name, file.size, file.type, file.lastModified])
          const existing = new Set(resolveImageDrafts(conversation, input.state.getSnapshot()).map(image => fingerprint(image.file)))
          const missing = files.filter(file => !existing.has(fingerprint(file)))
          if (!missing.length) return
          const drafts = createImageDrafts(conversation, sessionId, missing)
          if (!addImageDrafts(input, drafts)) {
            releaseImageDrafts(conversation, drafts)
            input.notify('error', '图片草稿恢复失败，请重新添加图片')
          }
        }).catch(() => {
          if (!disposed) input.notify('error', '图片草稿恢复失败，请检查附件后再发送')
        }).finally(() => { restoringImages = false; schedule() })
      }
      schedule()
    }

    function sessionInput(sessionId, ctx = crawshrimpContext) {
      const scoped = ctx?.sessions?.scope(sessionId)
      const conversation = scoped?.get('conversation')
      const input = conversation?.input?.for(scoped)
      watchAttachmentInput(sessionId, scoped, input)
      return { scoped, input, conversation }
    }

    function attachmentNotice(sessionId, message) {
      try { sessionInput(sessionId).input?.notify('error', message) } catch (_) { /* scope not ready */ }
    }

    function insertAttachmentHint(name, attachmentId, sessionId = activeRuntimeSessionId(), details = {}) {
      try {
        const { input } = sessionInput(sessionId)
        const state = input?.state?.getSnapshot()
        if (!state || !input.insertReference) return false
        const data = { ...details, name, attachmentId }
        // Token spans use detect coordinates: every existing reference is one
        // character, even though the clipboard projection expands its text.
        const at = state.draft.length - (state.occurrences || []).reduce((n, item) => n + item.length - 1, 0)
        return input.insertReference({
          source: ATTACHMENT_SOURCE, ref: JSON.stringify(data), label: name,
          appearance: data.kind === 'directory' ? 'folder' : 'file',
          clipboardText: attachmentText(data),
        }, { start: at, end: at, draftRev: state.draftRev })
      } catch (_) { return false }
    }

    function queueAttachmentHint(sessionId, name, attachmentId, details = {}) {
      if (!sessionId) return
      const data = { ...details, name, attachmentId }
      attachmentDraft(sessionId).set(attachmentIdentity(data), data)
      flushAttachmentHints(sessionId)
    }

    function flushAttachmentHints(sessionId) {
      if (attachmentBridgeDisposed) return
      const draft = draftAttachmentsBySession.get(sessionId)
      if (!draft?.size) return
      let input
      try { input = sessionInput(sessionId).input } catch (_) { return }
      if (!input) return
      const existing = new Set((input.state.getSnapshot().occurrences || [])
        .filter(item => item.source === ATTACHMENT_SOURCE)
        .map(item => attachmentIdentity(JSON.parse(item.ref))))
      for (const [id, data] of draft) {
        if (!existing.has(id)) insertAttachmentHint(data.name, data.attachmentId, sessionId, data)
      }
    }

    function removeAttachmentReference(sessionId, occurrenceId) {
      const { scoped, input } = sessionInput(sessionId)
      const state = input.state.getSnapshot()
      const occurrences = state.occurrences || []
      const item = occurrences.find(item => item.occurrenceId === occurrenceId)
      if (!item) return
      attachmentDraft(sessionId).delete(attachmentIdentity(JSON.parse(item.ref)))
      const start = item.offset - occurrences.filter(other => other.offset < item.offset).reduce((n, other) => n + other.length - 1, 0)
      scoped.bail('slash/input-consume-token', { guard: { kind: 'span', span: {
        start, end: start + 1, draftRev: state.draftRev,
      } } })
    }

    function parseAttachmentText(text) {
      const pattern = /\[文件夹路径: ("(?:[^"\\]|\\.)*")\]|\[附件: ([^\n]*?) \(attachment_id: (att-[a-f0-9]+)\)\]/g
      const result = []
      for (const match of String(text || '').matchAll(pattern)) {
        let data
        if (match[1]) {
          try {
            const path = JSON.parse(match[1])
            const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
            data = { kind: 'directory', path, name }
          } catch (_) { continue }
        } else data = { name: match[2], attachmentId: match[3] }
        result.push({ index: match.index, length: match[0].length, data })
      }
      return result
    }

    function restoreAttachmentReferences(input) {
      // DSH persists the clipboard projection. Rehydrate receipts after reload.
      const original = input.state.getSnapshot()
      for (const match of parseAttachmentText(original.draft).reverse()) {
        const state = input.state.getSnapshot()
        const occurrences = state.occurrences || []
        if (occurrences.some(item => item.offset < match.index + match.length && item.offset + item.length > match.index)) continue
        const data = match.data
        const start = match.index - occurrences.filter(item => item.offset < match.index).reduce((n, item) => n + item.length - 1, 0)
        input.insertReference({ source: ATTACHMENT_SOURCE, ref: JSON.stringify(data), label: data.name,
          appearance: data.kind === 'directory' ? 'folder' : 'file', clipboardText: attachmentText(data),
        }, { start, end: start + match.length, draftRev: state.draftRev })
      }
    }

    function renderSentAttachmentCards() {
      if (attachmentBridgeDisposed) return
      for (const row of document.querySelectorAll('[data-chat-flow-kind="user"]')) {
        const bubble = row.querySelector('.Sixlwa_bubble:not(.cs-sent-text)')
        const stack = row.querySelector('.Sixlwa_userStack')
        if (!bubble || !stack) continue
        const text = bubble.textContent || ''
        const imageButtons = [...stack.querySelectorAll('.R_Yw7q_frame')]
        const signature = JSON.stringify([text, imageButtons.map(button => button.querySelector('img')?.src)])
        if (stack.dataset.csAttachmentText === signature) continue
        const attachments = parseAttachmentText(text)
        if (!attachments.length) continue
        stack.dataset.csAttachmentText = signature
        stack.classList.add('cs-has-sent-attachments')
        stack.querySelector('.cs-sent-attachments')?.remove()
        stack.querySelector('.cs-sent-text')?.remove()
        const rail = document.createElement('div')
        rail.className = 'cs-sent-attachments'
        rail.setAttribute('aria-label', '此消息附带的图片、文件和文件夹')
        rail.tabIndex = 0
        rail.addEventListener('wheel', event => {
          if (event.ctrlKey || event.deltaX || rail.scrollWidth <= rail.clientWidth) return
          rail.scrollLeft += event.deltaY
          event.preventDefault()
        }, { passive: false })
        for (const original of imageButtons) {
          const image = original.querySelector('img')
          if (!image) continue
          const preview = document.createElement('button')
          preview.type = 'button'
          preview.className = 'cs-sent-image'
          preview.setAttribute('aria-label', original.getAttribute('aria-label') || '查看原图')
          preview.append(image.cloneNode())
          preview.onclick = () => original.click()
          rail.append(preview)
        }
        let visibleText = text
        for (const item of [...attachments].reverse()) visibleText = visibleText.slice(0, item.index) + visibleText.slice(item.index + item.length)
        for (const { data } of attachments) {
          const card = document.createElement('div')
          card.className = 'cs-attachment-card'
          card.title = data.path || data.name
          const icon = document.createElement('span')
          icon.className = 'cs-attachment-icon'
          icon.innerHTML = data.kind === 'directory'
          ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>'
          : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg>'
          const label = document.createElement('div')
          label.className = 'cs-attachment-label'
          const name = document.createElement('strong')
          name.textContent = data.name
          const type = document.createElement('small')
          type.textContent = data.kind === 'directory' ? '文件夹' : `${data.name.split('.').pop().toUpperCase()} 文件`
          label.append(name, type)
          card.append(icon, label)
          rail.append(card)
        }
        stack.insertBefore(rail, bubble)
        if (visibleText.trim()) {
          const message = document.createElement('div')
          message.className = 'Sixlwa_bubble cs-sent-text'
          message.textContent = visibleText.trim()
          stack.insertBefore(message, bubble)
        }
      }
    }

    function renderAttachmentCards() {
      if (attachmentBridgeDisposed) return
      const sessionId = activeRuntimeSessionId()
      if (!sessionId) return
      let state, conversation, input
      try {
        const resolved = sessionInput(sessionId)
        input = resolved.input
        if (resolved.input) restoreAttachmentReferences(resolved.input)
        state = resolved.input?.state?.getSnapshot()
        conversation = resolved.conversation
      } catch (_) { return }
      const composer = document.querySelector('[data-composer-input]')?.closest('[data-composer-card], .uV2eYG_card')
      if (!composer || !state) return
      const items = (state.occurrences || []).filter(item => item.source === ATTACHMENT_SOURCE)
      const images = resolveImageDrafts(conversation, state)
      const pending = [...pendingAttachmentUploads.values()].filter(item => item.sessionId === sessionId)
      let rail = composer.querySelector('.cs-attachment-rail')
      if (!items.length && !images.length && !pending.length) {
        rail?.remove()
        composer.classList.remove('cs-unified-attachments')
        return
      }
      composer.classList.add('cs-unified-attachments')
      const signature = JSON.stringify([sessionId, items, images.map(image => image.id), pending])
      if (rail?.dataset.signature === signature) return
      if (!rail) {
        rail = document.createElement('div')
        rail.className = 'cs-attachment-rail'
        rail.setAttribute('aria-label', '待发送的图片、文件和文件夹')
        rail.tabIndex = 0
        rail.addEventListener('wheel', event => {
          if (event.ctrlKey || event.deltaX || rail.scrollWidth <= rail.clientWidth) return
          rail.scrollLeft += event.deltaY
          event.preventDefault()
        }, { passive: false })
        composer.prepend(rail)
      }
      rail.dataset.signature = signature
      const scrollLeft = rail.scrollLeft
      rail.replaceChildren()
      for (const [index, image] of images.entries()) {
        const tile = document.createElement('div')
        tile.className = 'cs-attachment-image'
        const preview = document.createElement('button')
        preview.type = 'button'
        preview.className = 'cs-image-preview'
        preview.title = image.file.name
        preview.setAttribute('aria-label', `预览 ${image.file.name}`)
        const img = document.createElement('img')
        img.src = image.previewUrl
        img.alt = image.file.name
        preview.append(img)
        preview.onclick = () => composer.querySelectorAll('.JVDQca_thumbnail')[index]?.click()
        const remove = document.createElement('button')
        remove.type = 'button'
        remove.className = 'cs-attachment-remove'
        remove.textContent = '×'
        remove.setAttribute('aria-label', `移除图片 ${image.file.name}`)
        remove.onclick = () => {
          if (!removeImageDraft(input, conversation, image)) {
            input?.notify?.('error', '暂时无法移除图片，请稍后重试')
          }
          renderAttachmentCards()
        }
        tile.append(preview, remove)
        rail.append(tile)
      }
      for (const item of items) {
        const data = JSON.parse(item.ref)
        const card = document.createElement('div')
        card.className = 'cs-attachment-card'
        card.title = data.path || data.name
        const icon = document.createElement('span')
        icon.className = 'cs-attachment-icon'
        icon.innerHTML = data.kind === 'directory'
          ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>'
          : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg>'
        const label = document.createElement('div')
        label.className = 'cs-attachment-label'
        const name = document.createElement('strong')
        name.textContent = data.name
        const type = document.createElement('small')
        type.textContent = data.kind === 'directory' ? '文件夹' : ((data.name.split('.').pop() || '文件').toUpperCase() + ' 文件')
        label.append(name, type)
        const remove = document.createElement('button')
        remove.type = 'button'
        remove.textContent = '×'
        remove.setAttribute('aria-label', `移除 ${data.name}`)
        remove.onclick = () => { removeAttachmentReference(sessionId, item.occurrenceId); renderAttachmentCards() }
        card.append(icon, label, remove)
        rail.append(card)
      }
      for (const item of pending) {
        const card = document.createElement('div')
        card.className = 'cs-attachment-card'
        card.setAttribute('aria-busy', 'true')
        const label = document.createElement('div')
        label.className = 'cs-attachment-label'
        const name = document.createElement('strong')
        name.textContent = item.name
        const status = document.createElement('small')
        status.textContent = '正在添加…'
        label.append(name, status)
        card.append(label)
        rail.append(card)
      }
      rail.scrollLeft = scrollLeft
    }

    function registerAttachmentSource(ctx) {
      ctx.effect(() => ctx.inputTriggers.registerSource({
        trigger: '@', name: ATTACHMENT_SOURCE,
        candidates: async () => [], onPick: () => undefined,
        codec: {
          clipboardText: ref => attachmentText(JSON.parse(ref)),
          serialize: async ref => attachmentText(JSON.parse(ref)),
        },
      }))
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
        // DSH now calls the native command entry「指令」; older runtimes used「命令」.
        const label = String(tooltip.textContent || '').trim()
        if (![COMMAND_BUTTON_LABEL, '指令', '添加文件或调用指令', 'Add files or invoke commands', 'Add files or run commands'].includes(label)) continue
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
      // Keep React-owned children intact across hero/session reconciliation.
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
            const currentAdd = document.querySelector(':is([data-composer-seat], [data-composer-card], .wSkVaW_composerSeat) .uV2eYG_add:not(.cs-cmd-at-btn)')
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
      if (node.matches?.('.hHd-Xa_root, :is([data-composer-seat], [data-composer-card], .wSkVaW_composerSeat), .uV2eYG_add')) return true
      return !!node.querySelector?.('.hHd-Xa_root, :is([data-composer-seat], [data-composer-card], .wSkVaW_composerSeat), .uV2eYG_add')
    }

    function mutationTouchesShellMountPoint(mutation) {
      const target = mutation.target
      if (target?.nodeType === 1) {
        if (target.matches?.('.hHd-Xa_root, :is([data-composer-seat], [data-composer-card], .wSkVaW_composerSeat), .uV2eYG_add')) return true
        if (target.closest?.('.hHd-Xa_root, :is([data-composer-seat], [data-composer-card], .wSkVaW_composerSeat)')) return true
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
        const composer = document.querySelector(':is([data-composer-seat], [data-composer-card], .wSkVaW_composerSeat)')
        if (!composer) return
        const addBtn = composer.querySelector('.uV2eYG_add')
        if (!addBtn) return
        injectAttachCss()
        installComposerTooltipShield()
        installNativeCommandTooltipSuppressor()
        syncUploadButton(addBtn)
        // 旁边单开 @ 命令按钮(克隆原生加号按钮的结构与样式)
        let at = composer.querySelector('.cs-cmd-at-btn')
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
        // The picker controls live inside rc.1's composer seat.  A no-model
        // guard must not claim those clicks: users still need to inspect or
        // select a workspace, Agent mode, access mode, attachment command, or
        // model before configuring a provider.  The text-entry canvas remains
        // the intentional entry point for the Crawshrimp model dialog.
        '.cs-attach-btn, .uV2eYG_add[data-cs-upload-button="1"], .uV2eYG_add.cs-cmd-at-btn, button, [role="button"], a, [aria-haspopup]',
      ))
    }

    function isComposerActivationTarget(target) {
      if (!target || typeof target.closest !== 'function') return false
      const composer = target.closest(':is([data-composer-seat], [data-composer-card], .wSkVaW_composerSeat)')
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
      // pointerdown claims mouse, touch, and pen activation before the native
      // editor focuses.  Listening to click as well would emit the same
      // configuration request twice for one physical gesture.
      for (const type of ['pointerdown', 'keydown', 'beforeinput', 'paste']) {
        document.addEventListener(type, requestLlmConfigFromComposer, true)
      }
      document.addEventListener('focusin', (event) => {
        if (!llmConfigRequired() || !isComposerActivationTarget(event.target)) return
        postToShell({ __crawshrimp: 'llm-config-request', source: 'composer', trigger: 'focusin' })
      }, true)
    }

    function mountAttachmentCapture() {
      if (typeof document === 'undefined' || !document.documentElement?.dataset) return
      injectAttachCss()
      installNativeDropOverlayFixups()
      if (document.documentElement.dataset.csAttachCapture === '1') return
      document.documentElement.dataset.csAttachCapture = '1'
      document.addEventListener('paste', handlePasteAttachments, true)
      document.addEventListener('dragover', (e) => e.preventDefault())
      window.addEventListener('drop', handleDropAttachments, true)
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
      for (const unsubscribe of run.unsubscribes || []) unsubscribe()
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

    function defaultWorkspaceBaselinesReady(ctx, workspaceSnapshot) {
      // rc.1 replaced the rc.8 `baselinesReady` flag with independent
      // `phase: 'ready'` snapshots. Waiting on only the removed rc.8 flag
      // leaves first-run workspaces permanently unbound.
      const workspaceReady = workspaceSnapshot?.phase === 'ready' || workspaceSnapshot?.baselinesReady === true
      const sessionSnapshot = ctx.sessions?.list?.getSnapshot?.() || {}
      const sessionReady = sessionSnapshot.phase === undefined || sessionSnapshot.phase === 'ready'
      return { ready: workspaceReady && sessionReady, sessionSnapshot }
    }

    function selectedSessionId(ctx) {
      const snapshot = ctx.sessions?.list?.getSnapshot?.() || {}
      return snapshot.current || Object.entries(snapshot.byId || {}).find(([, row]) => (row.retainedBy?.mainView || 0) > 0)?.[0]
    }
    function openRuntimeSession(ctx, id) {
      if (ctx.uiWorkspace?.openSession) return ctx.uiWorkspace.openSession(id)
      return ctx.sessions.open(id)
    }

    function defaultWorkspaceNavigator(ctx) {
      if (typeof ctx?.uiWorkspace?.connectWorkspace === 'function') return ctx.uiWorkspace
      try {
        const navigation = ctx?.get?.('uiWorkspace')
        if (typeof navigation?.connectWorkspace === 'function') return navigation
      } catch (error) {
        // 插件依赖图尚未完成时交给下一次 baseline 订阅重试。
      }
      // Compatibility with the pre-rc.1 client contract. rc.1 exposes this
      // method through uiWorkspace, not the raw workspaces controller.
      if (typeof ctx?.workspaces?.connectWorkspace === 'function') return ctx.workspaces
      return null
    }

    async function reconcileDefaultWorkspace(ctx, run) {
      if (run.done || run.inFlight || defaultWorkspaceRuns.get(ctx) !== run) return
      if (run.nextAttemptAt && Date.now() < run.nextAttemptAt) return

      const snap = ctx.workspaces.list?.getSnapshot?.() || {}
      const items = Array.isArray(snap.items) ? snap.items : []
      const existingProductWorkspace = !run.workspaceId
        ? items.find((item) => String(item?.path || '').trim() === run.root)
        : null
      if (!run.workspaceId && items.length > 0 && !existingProductWorkspace) {
        finishDefaultWorkspaceRun(ctx, run, { status: 'existing', workspaceId: items[0]?.workspaceId || '' })
        return
      }
      if (existingProductWorkspace?.workspaceId) {
        run.workspaceId = existingProductWorkspace.workspaceId
        run.workspaceExisted = true
      }
      const { ready: baselinesReady, sessionSnapshot } = defaultWorkspaceBaselinesReady(ctx, snap)
      if (!baselinesReady) return

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

        let sessionId = selectedSessionId(ctx)
        const navigation = defaultWorkspaceNavigator(ctx)
        if (!sessionId && !navigation) {
          // The slots client can receive the Shell workspace message while
          // the rc.1 uiWorkspace service is still being wired.  A workspace
          // may already have been created at this point; treating the missing
          // navigation service as success leaves that workspace permanently
          // selected nowhere.  Retry through the existing bounded backoff.
          throw new Error('workspace navigation is not ready')
        }
        if (!sessionId && navigation && ctx.sessions) {
          sessionId = await navigation.connectWorkspace(projected.workspaceId)
          if (run.done || defaultWorkspaceRuns.get(ctx) !== run) {
            run.inFlight = false
            return
          }
          if (!selectedSessionId(ctx)) openRuntimeSession(ctx, sessionId)
          const selected = selectedSessionId(ctx)
          if (selected !== sessionId) throw new Error('default workspace session was not selected')
        }

        run.inFlight = false
        finishDefaultWorkspaceRun(ctx, run, {
          status: run.workspaceExisted ? 'existing' : 'created',
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
        workspaceExisted: false,
        inFlight: false,
        done: false,
        result: null,
        lastError: '',
        retryTimer: null,
        deadlineTimer: null,
        unsubscribes: [],
        nextAttemptAt: 0,
        resolve: (result) => resolveRun(result),
        promise: null,
      }
      run.promise = new Promise((resolve) => { resolveRun = resolve })
      defaultWorkspaceRuns.set(ctx, run)
      if (typeof ctx.workspaces.list.subscribe === 'function') {
        run.unsubscribes.push(ctx.workspaces.list.subscribe(() => reconcileDefaultWorkspace(ctx, run)))
      }
      if (typeof ctx.sessions?.list?.subscribe === 'function') {
        run.unsubscribes.push(ctx.sessions.list.subscribe(() => reconcileDefaultWorkspace(ctx, run)))
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

    // The Web app initializes this plugin after the iframe load event. Keep
    // the Shell bridge as a single, testable unit so that the ready signal is
    // emitted only after the listener which consumes the replay is active.
    function applyShellTheme(ctx, theme, skin = 'default') {
      if (theme !== 'light' && theme !== 'dark') return
      try {
        ctx.theme.overrideTokens('crawshrimp', skin === 'lake' && theme === 'light' ? LAKE_TOKENS : CRAWSHRIMP_TOKENS)
        ctx.theme.setTheme(theme)
      } catch (error) {
        // 已是当前主题或不可写,忽略
      }
    }

    const sessionLogDownloads = new Set()
    async function downloadSessionLog(sessionId) {
      if (!sessionId || sessionLogDownloads.has(sessionId)) return
      sessionLogDownloads.add(sessionId)
      try {
        const url = new URL('/api/session.export', window.location.origin)
        url.searchParams.set('sessionId', sessionId)
        url.searchParams.set('includeDescendants', 'true')
        const response = await fetch(url, { method: 'HEAD' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const anchor = document.createElement('a')
        anchor.href = url.toString()
        anchor.download = `dsh-session-${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.zip`
        anchor.click()
      } catch (error) {
        postToShell({ __crawshrimp: 'session-log-error', runtimeSessionId: sessionId, message: `会话日志导出失败：${error.message}` })
      } finally { sessionLogDownloads.delete(sessionId) }
    }

    async function handleArchivedSessionsRequest(ctx, data) {
      const reply = { __crawshrimp: 'archived-sessions-response', requestId: data.requestId }
      try {
        if (!['list', 'restore'].includes(data.action)) throw new Error('不支持的会话操作')
        const state = ctx.workspaces.list.getSnapshot()
        const sessions = ctx.sessions.list.getSnapshot()
        if (state.phase !== 'ready' || sessions.phase !== 'ready') throw new Error('会话服务正在加载，请稍后刷新。')
        if (data.action === 'restore') {
          if (typeof data.sessionId !== 'string' || !data.sessionId) throw new Error('会话标识无效')
          await ctx.workspaces.unarchiveSession(data.sessionId)
          if (ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(data.sessionId)) {
            throw new Error('会话仍处于归档状态，请刷新后重试。')
          }
          // The workspace controller already updates the archive projection.
          // A full session refresh tears down the session scope and resets layout.
          const restored = ctx.sessions.list.getSnapshot().byId[data.sessionId]
          if (!restored) {
            throw new Error('已取消归档，但会话信息尚未加载，请重新进入设置后查看。')
          }
          if (restored.origin === 'subagent') throw new Error('已取消归档；这是一条子会话，请从所属主会话查看。')
          // Blank sessions are hidden unless selected. Select the restored session
          // through the controller rather than merely removing its archive flag.
          if (restored.blank) openRuntimeSession(ctx, data.sessionId)
          if (restored.blank && selectedSessionId(ctx) !== data.sessionId) {
            throw new Error('已取消归档，但未能定位会话，请刷新后重试。')
          }
        }
        const current = ctx.workspaces.list.getSnapshot()
        reply.items = current.archivedSessionIds.map(id => ({
          id, title: sessions.byId[id]?.displayTitle || '未命名会话',
          updatedAt: sessions.byId[id]?.updatedAt ?? null,
        }))
      } catch (error) { reply.error = String(error.message || error) }
      postToShell(reply)
    }

    function installShellMessageBridge(ctx) {
      // The shell exports through the same host endpoint without a success modal.
      const resourceStyle = document.createElement?.('style')
      if (resourceStyle && window.parent !== window) {
        resourceStyle.textContent = 'button[class*="sessionLogButton"] { display: none !important; } .hHd-Xa_root { padding-bottom: 44px !important; box-sizing: border-box; } [data-crawshrimp-nav-bottom] { display: none !important; }'
        document.head.appendChild(resourceStyle)
      }
      const onMessage = (event) => {
        const expectedOrigin = shellOrigin()
        if (event.source !== window.parent || (expectedOrigin !== '*' && event.origin !== expectedOrigin)) return
        const data = event && event.data
        if (data && data.__crawshrimp === 'download-session-log' && String(data.runtimeSessionId || '') === String(currentRuntimeSessionId || '')) {
          void downloadSessionLog(String(data.runtimeSessionId || ''))
        }
        if (data && data.__crawshrimp === 'archived-sessions-request') void handleArchivedSessionsRequest(ctx, data)
        if (data && data.__crawshrimp === 'theme') applyShellTheme(ctx, data.theme, data.skin)
        if (data && data.__crawshrimp === 'nav') renderNav(data.items, data.active)
        if (data && data.__crawshrimp === 'app-version') publishCrawshrimpAppVersion(data.version)
        if (data && data.__crawshrimp === 'workspace') ensureDefaultWorkspace(ctx, data.root)
        if (data && data.__crawshrimp === 'runtime-model-configuration') updateRuntimeModelConfiguration(data)
        if (data && data.__crawshrimp === 'shell-account-menu-state') updateShellAccountMenuState(data)
        if (data && data.__crawshrimp === 'workspace-directory-picked') handleWorkspaceDirectoryPicked(data)
        if (data && data.__crawshrimp === 'image-generation') renderImageGeneration(data)
        if (data && data.__crawshrimp === 'artifact-show') renderArtifactShow(data)
        if (data && data.__crawshrimp === 'native-image-attachment') {
          installNativeImageDraft(ctx, data)
        }
        if (data && data.__crawshrimp === 'attachment-upload-started') {
          pendingAttachmentUploads.set(data.requestId, { sessionId: data.runtimeSessionId, name: data.name })
          sessionInput(data.runtimeSessionId)
          renderAttachmentCards()
        }
        if (data && data.__crawshrimp === 'attachment-upload-finished') {
          pendingAttachmentUploads.delete(data.requestId)
          renderAttachmentCards()
        }
        if (data && data.__crawshrimp === 'attachment-error') attachmentNotice(data.runtimeSessionId, data.message)
        if (data && data.__crawshrimp === 'attachment-added') {
          const sessionId = String(data.runtimeSessionId || currentRuntimeSessionId || '')
          queueAttachmentHint(sessionId, data.name, data.attachmentId, data)
          renderAttachmentCards()
        }
        if (data && data.__crawshrimp === 'open-runtime-session' && data.runtimeSessionId) {
          try { openRuntimeSession(ctx, String(data.runtimeSessionId)) } catch (error) { /* 会话已删除 */ }
        }
      }
      window.addEventListener('message', onMessage)
      document.addEventListener('pointerdown', dismissShellAccountMenu, true)
      postToShell({ __crawshrimp: 'workspace-ready' })
      return () => { window.removeEventListener('message', onMessage); document.removeEventListener('pointerdown', dismissShellAccountMenu, true); updateShellAccountMenuState({ open: false }); resourceStyle?.remove() }
    }

    function publishCurrentSession(ctx) {
      try {
        const snap = ctx.sessions?.list?.getSnapshot?.() || {}
        const current = String(persistedRuntimeSessionId() || snap.current || '')
        const phase = document.querySelector('.wSkVaW_root[data-phase]')?.getAttribute('data-phase') || 'settling'
        if (current === lastPublishedRuntimeSessionId && phase === lastPublishedConversationPhase) return
        const sessionChanged = current !== lastPublishedRuntimeSessionId
        currentRuntimeSessionId = current
        lastPublishedRuntimeSessionId = current
        lastPublishedConversationPhase = phase
        if (sessionChanged && current) {
          for (const entry of generationGroups.values()) placeGenerationGroup(entry)
          postToShell({ __crawshrimp: 'artifact-replay', runtimeSessionId: current })
          flushAttachmentHints(current)
        }
        postToShell({ __crawshrimp: 'active-runtime-session', runtimeSessionId: current, conversationPhase: phase })
      } catch (error) {
        // 会话列表尚未就绪，下一轮轮询重试。
      }
    }

    function apply(ctx) {
      crawshrimpContext = ctx
      const openResource = (path, runtimeSessionId) => postToShell({ __crawshrimp: 'open-file', path, runtimeSessionId })
      window.__crawshrimpOpenResource = openResource
      ctx.on('dispose', () => { if (window.__crawshrimpOpenResource === openResource) delete window.__crawshrimpOpenResource })
      attachmentBridgeDisposed = false
      ctx.on('dispose', () => {
        attachmentBridgeDisposed = true
        draftAttachmentsBySession.clear()
        window.removeEventListener('drop', handleDropAttachments, true)
        document.removeEventListener('paste', handlePasteAttachments, true)
        delete document.documentElement.dataset.csAttachCapture
      })
      registerAttachmentSource(ctx)
      registerCrawshrimpBrandSlots(ctx)
      registerCrawshrimpDirectoryFlow(ctx)
      ctx.theme.overrideTokens('crawshrimp', CRAWSHRIMP_TOKENS)
      injectBrandCss()
      if (window.parent !== window && new URLSearchParams(window.location.search).get('csPanel') === 'plugins') {
        const style = document.createElement('style')
        style.textContent = '.hHd-Xa_root, [data-sidebar-left], .cs-nav { display:none !important; }'
        document.head.appendChild(style)
      }
      openCrawshrimpImSettings()
      // 浏览器标题:去 DeepSeek(DocumentTitle 组件会在会话切换后重新拼后缀,需持续兜底)
      normalizeDocumentTitle()
      normalizeRunningStatus()
      setInterval(() => { if (!document.hidden) normalizeDocumentTitle() }, 5000)
      try {
        const query = new URLSearchParams(window.location.search).get('theme')
        if (query) applyShellTheme(ctx, query)
      } catch (error) {
        // 无 URL 参数,交给 shell 的 postMessage
      }
      ctx.effect(() => installShellMessageBridge(ctx))
      mountAttachmentCapture()
      // apply 时 DOM 可能尚未就绪:轮询挂载(幂等),保证附件入口一定出现
      setInterval(() => {
        if (document.hidden) return
        mountAttachmentCapture()
        mountUnifiedButtons()
        installLlmConfigGate()
        publishCurrentSession(ctx)
        flushAttachmentHints(activeRuntimeSessionId())
        renderAttachmentCards()
        renderSentAttachmentCards()
        openCrawshrimpImSettings()
        normalizeRunningStatus()
      }, 5000)
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
        if (region && !target.closest('.bhn1Oq_sectionHeader, .qDHVXG_sectionHeader')) {
          postToShell({ __crawshrimp: 'session-nav', kind: 'session' })
        }
      })
      // 侧边栏/输入区重渲染后兜底重插。属性/尺寸变化由 ResizeObserver + 周期兜底处理。
      const observer = new MutationObserver((mutations) => {
        // The first message changes hero -> active without changing the session ID.
        publishCurrentSession(ctx)
        flushAttachmentHints(activeRuntimeSessionId())
        renderAttachmentCards()
        renderSentAttachmentCards()
        const runningStatusChanged = Array.from(mutations || []).some((mutation) => {
          const target = mutation.target?.nodeType === 3 ? mutation.target.parentElement : mutation.target
          if (target?.closest?.('[role="status"]')) return true
          return Array.from(mutation.addedNodes || []).some((node) => (
            node?.nodeType === 1 && (node.matches?.('[role="status"]') || node.querySelector?.('[role="status"]'))
          ))
        })
        if (runningStatusChanged) normalizeRunningStatus()
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
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-phase'] })
      setTimeout(() => {
        installRailResizeObserver()
        pushRailMetrics({ force: true })
      }, 0)
      setTimeout(() => scheduleRailMetricsPush(), 800)
      // 周期同步兜底:侧栏拖拽宽度只改 AppFrame 的 grid 列宽时,没有 DOM 子节点变化。
      setInterval(() => {
        if (document.hidden) return
        installRailResizeObserver()
        scheduleRailMetricsPush()
      }, 5000)
    }

    exports.apply = apply
    // 可执行契约测试直接调用真实实现，避免退化为源码字符串匹配。
    exports.ensureDefaultWorkspace = ensureDefaultWorkspace
    exports.registerCrawshrimpDirectoryFlow = registerCrawshrimpDirectoryFlow
    exports.installShellMessageBridge = installShellMessageBridge
    exports.publishCurrentSession = publishCurrentSession
    exports.requestLlmConfigFromComposer = requestLlmConfigFromComposer
    exports.removeImageDraft = removeImageDraft
    exports.handleDropAttachments = handleDropAttachments
    exports.insertAttachmentHint = insertAttachmentHint
    exports.queueAttachmentHint = queueAttachmentHint
    exports.flushAttachmentHints = flushAttachmentHints
    exports.removeAttachmentReference = removeAttachmentReference
    exports.registerAttachmentSource = registerAttachmentSource
    exports.restoreAttachmentReferences = restoreAttachmentReferences
    exports.watchAttachmentInput = watchAttachmentInput
    exports.parseAttachmentText = parseAttachmentText
    exports.setAttachmentContext = ctx => { crawshrimpContext = ctx }
    exports.handlePasteAttachments = handlePasteAttachments
    exports.insertAttachmentHint = insertAttachmentHint
    // kernel 服务依赖声明:rc.1 的会话创建在 uiWorkspace，不在原始 workspaces controller。
    exports.inject = ['theme', 'workspaces', 'sessions', 'slots', 'uiWorkspace', 'inputTriggers']
    return module.exports
  },
})
