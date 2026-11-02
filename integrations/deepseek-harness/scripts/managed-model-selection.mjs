import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function managedModelList(models, showOlder = false, query = '') {
  const canonical = models.filter(m => !/^managed-gemini-(?:3\.8-flash-(?:low|medium|high|tiered)|2\.5-flash-thinking)$/.test(m.id))
  const version = id => (id.match(/(?:gpt-|gemini-)(\d+(?:\.\d+)?)/)?.[1] || '0').split('.').map(Number)
  const compare = (a, b) => {
    const av = version(a.id), bv = version(b.id)
    return (bv[0] - av[0]) || ((bv[1] || 0) - (av[1] || 0)) || a.id.localeCompare(b.id)
  }
  const family = id => id.startsWith('managed-gpt-') ? 'gpt' : id.startsWith('managed-gemini-') ? (id.includes('lite') ? 'gemini-lite' : 'gemini') : id
  const sorted = [...canonical].sort((a,b) => family(a.id).localeCompare(family(b.id)) || compare(a,b))
  if (showOlder || query.trim()) return sorted
  return sorted.filter(model => {
    const peers = sorted.filter(m => family(m.id) === family(model.id))
    const latest = version(peers[0].id), current = version(model.id)
    if (family(model.id) === 'gpt') {
      const role = model.id.split('-').pop()
      return current[0] === latest[0] && peers.find(m => m.id.split('-').pop() === role)?.id === model.id
    }
    return current[0] === latest[0] && (current[1] || 0) === (latest[1] || 0)
  })
}

// Explicit effort survives the SDK's provider heuristics and model-ID aliases.
export function managedReasoningWire(payload, model, effort) {
  if (!model.id?.startsWith('managed-')) return payload
  if (model.api === 'openai-responses') {
    if (effort === undefined) {
      if (payload.reasoning) { delete payload.reasoning.effort; if (!Object.keys(payload.reasoning).length) delete payload.reasoning }
    } else payload.reasoning = { ...payload.reasoning, effort }
  } else if (model.api === 'openai-completions') {
    if (effort === undefined || effort === 'off') delete payload.reasoning_effort
    else payload.reasoning_effort = effort
    if (model.id.startsWith('managed-deepseek-')) {
      if (effort === undefined) delete payload.thinking
      else payload.thinking = { type: effort === 'off' ? 'disabled' : 'enabled' }
    }
  }
  return payload
}

export function patchManagedModelMenu(source) {
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error('Managed model menu anchor changed: ' + before.slice(0,80))
    source = source.replace(before, after)
  }
  const oldButton = `
    groups.some(g => g.id.startsWith("crawshrimp-managed-")) && (0, react_jsx_runtime.jsx)("button", {
      type: "button", className: ModelSelect_module_css_default.cell,
      "aria-expanded": showOlder, onClick: () => { setShowOlder(!showOlder); setHighlightedIndex(null); },
      children: showOlder ? "收起旧版模型" : "显示旧版模型"
    }),`
  if (source.includes('// crawshrimp-managed-model-menu-v1')) {
    source = source.replace(oldButton, '').replace('// crawshrimp-managed-model-menu-v1', '// crawshrimp-managed-model-menu-v2')
  } else if (!source.includes('// crawshrimp-managed-model-menu-v2')) {
    replace('const [query, setQuery] = (0, react.useState)("");', 'const [query, setQuery] = (0, react.useState)("");\n\t\t\tconst [showOlder, setShowOlder] = (0, react.useState)(false);')
    replace('rankByName)(group.models, showSearch ? query.trim() : "")', 'rankByName)(group.id.startsWith("crawshrimp-managed-") ? managedModelList(group.models, showOlder, query) : group.models, showSearch ? query.trim() : "")')
    replace('\t\t\t\tquery,\n\t\t\t\tshowSearch\n', '\t\t\t\tquery,\n\t\t\t\tshowOlder,\n\t\t\t\tshowSearch\n')
    source = '// crawshrimp-managed-model-menu-v2\n' + managedModelList.toString() + '\n' + source
  }
  source = source.replace(/function managedModelList\([\s\S]*?\n}/, managedModelList.toString())
  if (!source.includes('data-managed-older-toggle')) {
    replace('children: filteredGroups.map((group) => {', 'children: [...filteredGroups.map((group) => {')
    const ending = '\t\t\t\t\t\t\t\t\t\t}, group.id);\n\t\t\t\t\t\t\t\t\t})'
    replace(ending, ending + `, !query.trim() && groups.some(g => g.id.startsWith("crawshrimp-managed-") && managedModelList(g.models, true).length > managedModelList(g.models).length) && (0, react_jsx_runtime.jsx)("button", {
      type: "button", role: "menuitem", "data-managed-older-toggle": "",
      className: ModelSelect_module_css_default.cell, disabled: busy,
      "aria-expanded": showOlder,
      onClick: () => { setShowOlder(!showOlder); setHighlightedIndex(null); },
      children: showOlder ? "收起旧版模型 ▴" : "展开旧版模型 ▾"
    })]`)
  }
  if (!source.includes('data-managed-footer')) {
    source = source.replace(/\(0, react_jsx_runtime.jsx\)\("button", \{\n      type: "button", role: "menuitem", "data-managed-older-toggle":[\s\S]*?\n    \}\)/, `(0, react_jsx_runtime.jsx)("div", {
      "data-managed-footer": "", role: "none",
      style: { marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--dsw-alias-border-l1)" },
      onMouseEnter: () => setHighlightedIndex(-1),
      children: (0, react_jsx_runtime.jsx)("button", {
        type: "button", role: "menuitem", "data-managed-older-toggle": "",
        className: ModelSelect_module_css_default.cell, disabled: busy,
        style: { color: "var(--dsw-alias-label-tertiary)", justifyContent: "center", fontSize: 12 },
        "aria-expanded": showOlder,
        onFocus: () => setHighlightedIndex(-1),
        onClick: () => { setHighlightedIndex(-1); setShowOlder(!showOlder); },
        children: showOlder ? "收起旧版模型 ▴" : "展开旧版模型 ▾"
      })
    })`)
  }
  if (!source.includes('data-managed-access-note')) {
    replace('children: [...filteredGroups.map((group) => {', `children: [groups.some(g => g.id.startsWith("crawshrimp-managed-")) && (0, react_jsx_runtime.jsx)("div", {
      "data-managed-access-note": "", role: "note",
      style: {padding:"8px 12px",fontSize:12,lineHeight:1.6,color:"var(--dsw-alias-label-tertiary)"},
      children:"官方模型：Plus/Pro会员或充值永久额度（¥10起）可使用GPT和DeepSeek。可在个人账号查看权限。"
    }), ...filteredGroups.map((group) => {`)
  }
  source = source.replaceAll('官方模型：免费使用 Gemini；GPT / DeepSeek 需 Plus 或 Pro。可在个人账号查看权限与会员。', '官方模型：Plus/Pro会员或充值永久额度（¥10起）可使用GPT和DeepSeek。可在个人账号查看权限。')
  return source
}

export function patchManagedModelSelection(root) {
  const menu = join(root, 'node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js')
  const before = readFileSync(menu, 'utf8'), after = patchManagedModelMenu(before)
  if (before !== after) writeFileSync(menu, after)
  const adapter = join(root, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js')
  let source = readFileSync(adapter, 'utf8')
  if (!source.includes('// crawshrimp-managed-reasoning-wire-v1')) {
    const anchor = 'onPayload: (payload) => applyReasoningWireIntent(payload, model, reasoning)'
    if (!source.includes(anchor)) throw new Error('Managed reasoning wire anchor changed')
    source = source.replaceAll(anchor, 'onPayload: (payload) => managedReasoningWire(applyReasoningWireIntent(payload, model, reasoning), model, reasoning)')
    writeFileSync(adapter, '// crawshrimp-managed-reasoning-wire-v1\n' + managedReasoningWire.toString() + '\n' + source)
  }
}
