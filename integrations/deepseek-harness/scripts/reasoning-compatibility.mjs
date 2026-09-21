import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const REASONING_COMPATIBILITY_MARKER = 'crawshrimp-reasoning-compatibility-v1'

// Only repair persisted/inherited selections, before any provider I/O. Fresh
// explicit selections still pass the runtime's strict capability validation.
export async function normalizeStoredReasoning(llm, selection) {
  if (selection?.reasoningEffort === undefined) return selection
  try {
    await llm.resolveCallConfig(selection)
    return selection
  } catch (error) {
    if (error?.code !== 'UNSUPPORTED_REASONING_EFFORT') throw error
    const { reasoningEffort, ...rest } = selection
    await llm.resolveCallConfig(rest)
    return rest
  }
}

export function normalizeCatalogReasoning(selection, groups) {
  const model = groups.find(group => group.id === selection?.provider)?.models.find(model => model.id === selection.model)
  // A failed/missing catalog is not evidence of missing capabilities.
  if (!model || selection.reasoningEffort === undefined || model.reasoning?.efforts.some(e => e.id === selection.reasoningEffort)) return selection
  const { reasoningEffort, ...rest } = selection
  return rest
}

// pi-ai normally maps both Default and Off to an absent reasoning option, then
// emits thinking:disabled. Preserve the user's three distinct wire intentions.
export function applyReasoningWireIntent(payload, model, effort) {
  if (model.api !== 'openai-completions') return payload
  if (model.compat?.thinkingFormat === 'deepseek') {
    if (effort === undefined) {
      delete payload.thinking
      delete payload.reasoning_effort
    } else if (effort === 'off') {
      payload.thinking = { type: 'disabled' }
      delete payload.reasoning_effort
    }
  } else if (model.compat?.thinkingFormat === 'openai' && effort === undefined) {
    delete payload.reasoning_effort
  }
  return payload
}

function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error('Reasoning compatibility anchor changed: ' + anchor.slice(0, 100))
  return source.replace(anchor, replacement)
}

export function patchReasoningAgentSource(source) {
  if (source.includes(REASONING_COMPATIBILITY_MARKER)) return source
  source = replaceOnce(source, 'function installModelSelection(agentCtx, selection) {', 'function installModelSelection(agentCtx, selection, onReasoningRepair) {')
  source = replaceOnce(source, '\t\tconst selected = selection.current;\n\t\tconst assembled = await next();', `\t\tconst previous = selection.current;
\t\tconst selected = await normalizeStoredReasoning(agentCtx.llm, previous);
\t\t// Do not overwrite a newer user selection while capability lookup awaits.
\t\tif (selected !== previous && selection.current?.provider === previous?.provider && selection.current?.model === previous?.model && selection.current?.reasoningEffort === previous?.reasoningEffort) {
\t\t\tselection.current = selected;
\t\t\tonReasoningRepair?.(selected);
\t\t}
\t\tconst assembled = await next();`)
  return `// ${REASONING_COMPATIBILITY_MARKER}\n${normalizeStoredReasoning.toString()}\n` + source
}

export function patchReasoningControllerSource(source) {
  if (source.includes(REASONING_COMPATIBILITY_MARKER)) return source
  source = replaceOnce(source, '\t\tinstallModelSelection(agent.ctx, selection);', `\t\tinstallModelSelection(agent.ctx, selection, (next) => {
\t\t\tagent.session.append("model/selection", next);
\t\t\tthis.ctx.logger.info("已将旧会话不兼容的推理等级恢复为 Default");
\t\t});`)
  source = replaceOnce(source, '\t\t\t\tconst resolved = await this.ctx.llm.resolveCallConfig({\n\t\t\t\t\tprovider: request.provider,', `\t\t\t\tconst current = this.agents.selectionFor(agent).current;
\t\t\t\tif (current?.provider !== request.provider || current?.model !== request.model) {
\t\t\t\t\trequest = await normalizeStoredReasoning(this.ctx.llm, request);
\t\t\t\t}
\t\t\t\tconst resolved = await this.ctx.llm.resolveCallConfig({
\t\t\t\t\tprovider: request.provider,`)
  source = replaceOnce(source, '\t\t\t\t\t...resolved.reasoningEffort === void 0 ? {} : { reasoningEffort: resolved.reasoningEffort }', '\t\t\t\t\t...request.reasoningEffort === void 0 ? {} : { reasoningEffort: resolved.reasoningEffort }')
  return `// ${REASONING_COMPATIBILITY_MARKER}\n${normalizeStoredReasoning.toString()}\n` + source
}

export function patchReasoningMenuSource(source) {
  if (source.includes(REASONING_COMPATIBILITY_MARKER)) return source
  source = replaceOnce(source, '\t\t\t\tconst current = projected.next ?? catalog.value.default;', '\t\t\t\tconst current = normalizeCatalogReasoning(projected.next ?? catalog.value.default, catalog.value.groups);')
  source = replaceOnce(source, '\t\t\t\t\t...model.reasoning?.defaultEffort === void 0 ? {} : { reasoningEffort: model.reasoning.defaultEffort }', '')
  source = replaceOnce(source, 'const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort;', 'const effectiveEffort = state.current?.reasoningEffort;')
  source = replaceOnce(source, 'reasoning === void 0 ? [] : [...reasoning.defaultEffort === void 0 ? [{', 'reasoning === void 0 ? [] : [{')
  source = replaceOnce(source, '}] : [], ...reasoning.efforts.map((effort) => ({', '}, ...reasoning.efforts.map((effort) => ({')
  source = replaceOnce(source, 'const reasoningEffort = state.current?.provider === group.id && state.current.model === model.id ? state.current?.reasoningEffort ?? model.reasoning?.defaultEffort : model.reasoning?.defaultEffort;', 'const reasoningEffort = state.current?.provider === group.id && state.current.model === model.id ? state.current?.reasoningEffort : void 0;')
  return `// ${REASONING_COMPATIBILITY_MARKER}\n${normalizeCatalogReasoning.toString()}\n` + source
}

export function patchReasoningAdapterSource(source) {
  if (source.includes(REASONING_COMPATIBILITY_MARKER)) return source
  source = replaceOnce(source, '\t\t\t\t\t...profileOptions(profile, reasoning, apiKey),', `\t\t\t\t\t...profileOptions(profile, reasoning, apiKey),
\t\t\t\t\tonPayload: (payload) => applyReasoningWireIntent(payload, model, reasoning),`)
  return `// ${REASONING_COMPATIBILITY_MARKER}\n${applyReasoningWireIntent.toString()}\n` + source
}

export function patchReasoningCompatibility(root) {
  for (const [file, patch] of [
    ['dsh-agent/lib/index.js', patchReasoningAgentSource],
    ['dsh-api-session-controller/lib/index.js', patchReasoningControllerSource],
    ['dsh-client-ui-model-selection/lib/client.js', patchReasoningMenuSource],
    ['dsh-llm-pi-ai/lib/index.js', patchReasoningAdapterSource],
  ]) {
    const path = join(root, 'node_modules/@deepseek-ai', file)
    const before = readFileSync(path, 'utf8')
    const after = patch(before)
    if (before !== after) writeFileSync(path, after)
  }
}
