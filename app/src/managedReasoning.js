'use strict'

// The account gateway publishes Gemini effort routes as separate allowlisted
// IDs. Keep this translation at the broker boundary, never invent an upstream ID.
function applyManagedReasoning(body, catalog) {
  const model = body.model
  if (model !== 'gemini-3.8-flash') return body
  const effort = body.reasoning_effort
  if (effort !== undefined && !['low', 'medium', 'high'].includes(effort)) {
    throw new Error('此模型不支持所选推理档位')
  }
  const available = new Set(catalog.filter(m => m.kind === 'text' && m.protocol === 'openai' && m.available === true).map(m => m.id))
  const candidate = `${model}-${effort ?? 'tiered'}`
  if (available.has(candidate)) return { ...body, model: candidate }
  if (available.has(model)) return body
  // Default must preserve a real account route; never substitute an explicit effort.
  if (effort === undefined && available.has(`${model}-medium`)) return { ...body, model: `${model}-medium` }
  if (effort === undefined) {
    for (const fallback of ['low', 'high']) {
      if (available.has(`${model}-${fallback}`)) return { ...body, model: `${model}-${fallback}` }
    }
  }
  throw new Error('账号当前未开放此模型的推理档位，请刷新模型列表')
}
module.exports = { applyManagedReasoning }
