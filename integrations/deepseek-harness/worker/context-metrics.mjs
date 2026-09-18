// Numeric context diagnostics only; never persist prompts, tools, or credentials.
const bytes = value => value == null ? 0 : Buffer.byteLength(JSON.stringify(value))
export function compactRequestEvent(event) {
  if (event?.type === 'request/header') {
    const header = event.data?.header || {}, config = header.config || {}
    return { ...event, data: { header: { config: { provider: config.provider, model: config.model } }, context_metrics: {
      header_bytes: bytes(header), tools_count: Array.isArray(header.tools) ? header.tools.length : 0,
      tools_bytes: bytes(header.tools), system_bytes: bytes(header.system ?? header.systemPrompt),
      // These are measured bytes, deliberately not guessed token counts.
    } } }
  }
  if (event?.type === 'request/context') {
    // DSH request/context is routing/capacity metadata, not model history.
    return { ...event, data: { context_metrics: { request_metadata_bytes: bytes(event.data), context_window: Number.isFinite(event.data?.contextWindow) ? event.data.contextWindow : null } } }
  }
  return event
}
