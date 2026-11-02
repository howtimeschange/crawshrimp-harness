// Product compatibility for rc.2. Fail closed when upstream anchors drift.
function replaceOnce(source, before, after, id) {
  if (source.includes(after)) return source
  if (source.split(before).length !== 2) throw new Error(`${id}: expected one upstream anchor`)
  return source.replace(before, after)
}
export function quotaClassification(source) {
  return replaceOnce(source,
    'if (/\\b(?:401|403)\\b/.test(message)) return "AUTH";\n\tif (isQuotaExceededError(message)) return QUOTA_EXCEEDED_CODE;',
    '// crawshrimp-quota-before-auth: gateways use 403 for exhausted upstream balances.\n\tif (isQuotaExceededError(message) || /\\binsufficient[\\s_-]+user[\\s_-]+quota\\b/i.test(message)) return QUOTA_EXCEEDED_CODE;\n\tif (/\\b(?:401|403)\\b/.test(message)) return "AUTH";', 'C04')
}
export function runningBrand(source) {
  let result = source
  for (const [before, after] of [
    ['"chat.deepDiving": "深度求索中"', '"chat.deepDiving": "抓虾中"'],
    ['"chat.deepDivingFor": "深度求索中，用时 {duration} ···"', '"chat.deepDivingFor": "抓虾中，用时 {duration} ···"'],
    ['"chat.deepDiving": "Deep diving"', '"chat.deepDiving": "Crawshrimp is working"'],
    ['"chat.deepDivingFor": "Deep diving for {duration} ···"', '"chat.deepDivingFor": "Crawshrimp is working · {duration} ···"'],
  ]) result = replaceOnce(result, before, after, 'C05')
  return result
}

export function embeddedSidebar(source) {
  let result = source
  for (const signature of [
    'function RightbarRoot({ usePanelInfo, useViews, ...props }) {',
    'function ExpandButton({ sessionId, useStore, actions, t, useShortcuts }) {',
  ]) result = replaceOnce(result, signature, signature + '\n            // crawshrimp-embedded-sidebar: shell owns resources; retain native services.\n            if (window.parent !== window) return null;', 'C06')
  return result
}

export function embeddedSessionMenu(source) {
  const signature = 'function SessionLogDownloadHeaderAction(props) {'
  return replaceOnce(source, signature, signature + '\n            // crawshrimp-embedded-export: shell owns the session export entry.\n            if (window.parent !== window) return null;', 'C07')
}

export function welcomeBrand(source) {
  return replaceOnce(source,
    '(0, react_jsx_runtime.jsx)("span", { children: t("hero.headline") })',
    '(0, react_jsx_runtime.jsxs)("span", { className: "cs-hero-title", children: [(0, react_jsx_runtime.jsx)("span", { children: "抓虾智能体" }), (0, react_jsx_runtime.jsx)("span", { className: "cs-hero-slogan", children: "· 抓住灵感，拿到结果" })] })', 'C08')
}

export function embeddedSettings(source) {
  const anchor = 'const { close, openSection } = actions;'
  return replaceOnce(source, anchor, anchor + '\n            (0, react.useEffect)(() => { if (new URLSearchParams(window.location.search).get("csImSettings") === "1") openSection("xmanrui-dsh-im"); }, [openSection]);', 'C09')
}

export function connectionWebServer(source) {
  return replaceOnce(source, 'const inject = ["credentials"];', 'const inject = ["credentials", "webServer"];', 'C10')
}

export function embeddedPanels(source) {
  let result = replaceOnce(source, 'const panels = usePanels((snapshot) => snapshot);', `const panels = usePanels((snapshot) => snapshot);
            (0, react.useEffect)(() => { if (window.parent !== window && new URLSearchParams(window.location.search).get('csPanel') === 'plugins') selectPanel('plugins'); }, []);`, 'C11')
  return replaceOnce(result, 'const active = usePanelInfo((info) => info.activePanelId === id);', `const active = usePanelInfo((info) => info.activePanelId === id);
            if (window.parent !== window && ['plugins', 'schedules'].includes(id)) return null;`, 'C11')
}

export function runningShrimp(source) {
  if (source.includes('function RunningStatusIcon()')) return source
  const previous = source.includes('function RunningShrimp()') ? 'RunningShrimp' : 'RunningWhaleTail'
  const start = source.indexOf(`function ${previous}() {`)
  const end = source.indexOf('\n\t\t//#endregion', start)
  if (start < 0 || end < 0) throw new Error('C12: running icon anchor changed')
  const next = source.slice(0, start) + `function RunningStatusIcon() {
            return null;
        }` + source.slice(end)
  return replaceOnce(next, `(0, react_jsx_runtime.jsx)(${previous}, {})`, '(0, react_jsx_runtime.jsx)(RunningStatusIcon, {})', 'C12')
}
