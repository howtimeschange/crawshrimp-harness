import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const COMPACT_CHAT_MARKER = 'crawshrimp-compact-chat-v1'

// Group only consecutive calls within a turn. All visible non-tool nodes are boundaries.
export function groupToolCalls(order, nodes) {
  const groups = []
  let previous
  for (const key of order) {
    const node = nodes.get(key)
    const turn = node?.location?.turn?.turn
    if (node?.kind === 'tool-call') {
      if (previous?.tools && previous.turn === turn) previous.keys.push(key)
      else {
        previous = { key, keys: [key], tools: true, turn }
        groups.push(previous)
      }
    } else {
      groups.push({ key, keys: [key], tools: false, turn })
      const protocolOnly = node?.kind === 'assistant-step'
        && node.data?.status !== 'running' && node.data?.status !== 'interrupted'
        && Array.isArray(node.data?.blocks)
        && node.data.blocks.every(block => block.kind === 'tool-call')
      const hiddenContext = node?.kind === 'context' || node?.kind === 'system-prompt'
      if (!protocolOnly && !hiddenContext) previous = undefined
    }
  }
  return groups
}

export const TOOL_GROUP_COMPONENT = `
function CrawshrimpToolGroup({ group, seatProps }) {
  const [open, setOpen] = react.useState(false);
  const historyId = react.useId();
  const latest = group.keys[group.keys.length - 1];
  const historyRef = useSearchableHidden(!open, react.useCallback(() => setOpen(true), []));
  const seat = (nodeKey) => react_jsx_runtime.jsx(ChatNodeSeat, { nodeKey, ...seatProps }, nodeKey);
  return react_jsx_runtime.jsxs("div", {
    className: "cs-tool-group",
    "data-chat-flow-kind": "tool-group",
    "data-chat-turn": group.turn,
    children: [react_jsx_runtime.jsxs("div", {
      className: "cs-tool-group-latest",
      children: [seat(latest), group.keys.length > 1 && react_jsx_runtime.jsx("button", {
        type: "button",
        className: "cs-tool-group-toggle",
        "aria-expanded": open,
        "aria-controls": historyId,
        "aria-label": (open ? "收起" : "展开") + "工具调用历史（共 " + group.keys.length + " 条）",
        title: (open ? "收起" : "展开") + "工具调用历史",
        onClick: () => setOpen(value => !value),
        children: group.keys.length + (open ? " ▾" : " ›")
      })]
    }), react_jsx_runtime.jsx("div", {
      id: historyId,
      ref: historyRef,
      className: "cs-tool-group-history",
      children: group.keys.slice(0, -1).reverse().map(seat)
    })]
  });
}
`

function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error('Compact chat patch anchor changed: ' + anchor.slice(0, 100))
  return source.replace(anchor, replacement)
}

export function patchCompactChatSource(source) {
  if (source.includes(COMPACT_CHAT_MARKER)) return source
  const start = source.indexOf('\t\tconst ChatNodeList =')
  const end = source.indexOf('\n\t\t/**', start)
  if (start < 0 || end < 0) throw new Error('ChatNodeList boundary changed')
  source = source.slice(0, start) + `/* ${COMPACT_CHAT_MARKER} */\n${groupToolCalls.toString()}\n${TOOL_GROUP_COMPONENT}
const ChatNodeList = (0, react.memo)(function ChatNodeList({ order, nodeStore, ...seatProps }) {
  return groupToolCalls(order, nodeStore).map(group => group.tools
    ? react_jsx_runtime.jsx(CrawshrimpToolGroup, { group, seatProps }, group.key)
    : react_jsx_runtime.jsx(ChatNodeSeat, { nodeKey: group.key, ...seatProps }, group.key));
});` + source.slice(end)
  source = replaceOnce(source, 'jsx)(ChatNodeList, {\n', 'jsx)(ChatNodeList, {\n                                    nodeStore,\n')
  source = replaceOnce(source, 'sessionId, openFile, loadOlder,', 'sessionId, openFile, openDetails, loadOlder,')
  source = replaceOnce(source, 'openView("trajectory", callId);\n\t\t\t}, [openView]);', 'openDetails({ callId });\n\t\t\t}, [openDetails]);')
  // Nested historical rows remain available to turn navigation and history anchoring.
  source = replaceOnce(source, '[data-chat-flow] > [data-chat-flow-key]:not(:empty):not([hidden])', '[data-chat-flow] > [data-chat-flow-key]:not(:empty):not([hidden]), .cs-tool-group-latest > [data-chat-flow-key]:not([hidden])')
  return source
}

export function patchConversationSource(source) {
  if (!source.includes('crawshrimp-idle-todos-v1')) {
    source = replaceOnce(source, 'function TodoDock({ useProjection, t }) {', '/* crawshrimp-idle-todos-v1 */\nfunction TodoDock({ useProjection, useSession, t }) {')
    source = replaceOnce(source, 'todos: useProjection("todos") ?? [],', 'running: useSession(s => s.running),\n                todos: useProjection("todos") ?? [],')
    source = replaceOnce(source, 'function TodoPanel({ todos, t }) {', 'function TodoPanel({ todos, running, t }) {')
    source = replaceOnce(source, 'children: progressLabel(todos, t)', 'children: !running && todos.some(item => item.status !== "completed") ? "本轮已结束 · 计划尚未收尾（" + progressLabel(todos, t) + "）" : progressLabel(todos, t)')
    source = replaceOnce(source, 'jsx)(StatusGlyph, { status: item.status })', 'jsx)(StatusGlyph, { status: !running && item.status === "in_progress" ? "pending" : item.status })')
  }
  if (source.includes(COMPACT_CHAT_MARKER)) return source
  // Resolve old saved trajectory preferences to chat as well as removing the tab strip.
  return replaceOnce(source, 'if (entry.options.id === void 0) continue;',
    `/* ${COMPACT_CHAT_MARKER}: the product has one conversation view. */\n\t\t\t\t\tif (entry.options.id !== "chat") continue;`)
}

export function patchCompactChat(root) {
  for (const [name, patch] of [['chat', patchCompactChatSource], ['conversation', patchConversationSource]]) {
    const entry = join(root, 'node_modules/@deepseek-ai/dsh-client-ui-' + name + '/lib/client.js')
    const before = readFileSync(entry, 'utf8')
    const after = patch(before)
    if (before !== after) writeFileSync(entry, after)
  }
  return { marker: COMPACT_CHAT_MARKER }
}
