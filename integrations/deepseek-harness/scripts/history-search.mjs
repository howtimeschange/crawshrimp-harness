import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export function patchHistorySearch(root) {
  const file = join(root, 'node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js')
  let source = readFileSync(file, 'utf8')
  if (source.includes('crawshrimp-search-retry-v1')) return
  const replace = (anchor, value) => {
    if (source.split(anchor).length !== 2) throw new Error('History search patch anchor changed: ' + anchor)
    source = source.replace(anchor, value)
  }
  const signature = source.includes('query, remote, resultLimit, usePanelInfo, t }) {') ? 'query, remote, resultLimit, usePanelInfo, t }) {' : 'query, remote, resultLimit, t }) {'
  replace(signature, signature.replace('remote,', 'remote, retrySearch,'))
  if (source.includes('children: t("search.unavailable")')) {
  replace('children: t("search.unavailable")', 'children: react_jsx_runtime.jsxs("span", { children: [t("search.unavailable"), " ", currentRemote.message, react_jsx_runtime.jsx("button", { type: "button", onClick: retrySearch, children: "重试内容搜索" })] })')
  } else {
    replace('!pending && results.items.length === 0 &&', 'currentRemote.status === "error" && react_jsx_runtime.jsxs("div", { role: "alert", children: ["内容搜索失败：", currentRemote.message, react_jsx_runtime.jsx("button", { type: "button", onClick: retrySearch, children: "重试内容搜索" })] }),\n                        !pending && currentRemote.status !== "error" && results.items.length === 0 &&')
  }
  replace('const [query, setQuery] = (0, react.useState)("");', '/* crawshrimp-search-retry-v1 */\nconst [searchAttempt, retrySearch] = react.useReducer(n => n + 1, 0);\nconst [query, setQuery] = (0, react.useState)("");')
  replace('}).catch(() => {\n\t\t\t\t\t\tif (controller.signal.aborted) return;', '}).catch((error) => {\n\t\t\t\t\t\tif (controller.signal.aborted) return;')
  replace('status: "error",\n\t\t\t\t\t\t\titems: [],', 'status: "error",\nmessage: String(error.message || "请求失败"),\n\t\t\t\t\t\t\titems: [],')
  replace('}, [normalizedQuery, searchSessions]);', '}, [normalizedQuery, searchSessions, searchAttempt]);')
  replace('remote: remoteSearch,', 'remote: remoteSearch,\nretrySearch,')
  writeFileSync(file, source)
}
