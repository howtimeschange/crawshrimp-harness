// Preserve provenance when projecting compact messages into the product DB.
export function compactUserMessage(event, text) {
  const kind = event.data?.source?.kind
  return { ...event, data: { ...(text ? { text } : {}),
    ...(typeof kind === 'string' ? { source: { kind } } : {}) } }
}
