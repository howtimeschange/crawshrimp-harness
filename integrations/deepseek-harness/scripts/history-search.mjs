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
  replace('query, remote, resultLimit, t }) {', 'query, remote, retrySearch, resultLimit, t }) {')
  replace('children: t("search.unavailable")', 'children: react_jsx_runtime.jsxs("span", { children: [t("search.unavailable"), " ", currentRemote.message, react_jsx_runtime.jsx("button", { type: "button", onClick: retrySearch, children: "重试内容搜索" })] })')
  replace('const [query, setQuery] = (0, react.useState)("");', '/* crawshrimp-search-retry-v1 */\nconst [searchAttempt, retrySearch] = react.useReducer(n => n + 1, 0);\nconst [query, setQuery] = (0, react.useState)("");')
  replace('}).catch(() => {\n\t\t\t\t\t\tif (controller.signal.aborted) return;', '}).catch((error) => {\n\t\t\t\t\t\tif (controller.signal.aborted) return;')
  replace('status: "error",\n\t\t\t\t\t\t\titems: [],', 'status: "error",\nmessage: String(error.message || "请求失败"),\n\t\t\t\t\t\t\titems: [],')
  replace('}, [normalizedQuery, searchSessions]);', '}, [normalizedQuery, searchSessions, searchAttempt]);')
  replace('remote: remoteSearch,', 'remote: remoteSearch,\nretrySearch,')
  writeFileSync(file, source)
}
