function clean(value) {
  const text = String(value || '').trim()
  return text || ''
}

export function normalizeSelection(value) {
  if (!value || typeof value !== 'object') return null
  const provider = clean(value.provider)
  const model = clean(value.model)
  if (!provider || !model) return null
  const reasoningEffort = clean(value.reasoningEffort)
  return {
    provider,
    model,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  }
}

export function desiredSelectionForRun(params = {}, currentSelection = null) {
  const desired = normalizeSelection(params)
  if (!desired) return null
  if (desired.reasoningEffort === undefined) {
    const current = normalizeSelection(currentSelection)
    if (current?.reasoningEffort) return { ...desired, reasoningEffort: current.reasoningEffort }
  }
  return desired
}

export function shouldSelectModelForRun(params = {}, currentSelection = null) {
  const desired = normalizeSelection(params)
  if (!desired) return true
  const current = normalizeSelection(currentSelection)
  if (!current) return true
  if (current.provider !== desired.provider || current.model !== desired.model) return true
  if (desired.reasoningEffort !== undefined && current.reasoningEffort !== desired.reasoningEffort) return true
  return false
}
