export function approvalDecisionSnapshot(batch) {
  const result = {}
  for (const item of batch?.items || []) for (const asset of item.assets || []) {
    if (asset.kind !== 'ai' || !asset.id) continue
    result[asset.id] = {
      status: String(asset.status || 'pending'),
      custom_prompt: String(asset.custom_prompt || ''),
      reference_paths: [...(asset.reference_paths || [])],
      review_note: String(asset.review_note || ''),
    }
  }
  return result
}

export function changedApprovalDecisions(current, baseline) {
  const changes = {}
  for (const [id, fields] of Object.entries(current)) {
    const patch = {}
    for (const [field, value] of Object.entries(fields)) {
      if (JSON.stringify(value) !== JSON.stringify(baseline[id]?.[field])) patch[field] = value
    }
    if (Object.keys(patch).length) changes[id] = patch
  }
  return changes
}

export function applyApprovalDecisions(batch, changes) {
  for (const item of batch?.items || []) for (const asset of item.assets || []) {
    if (asset.kind === 'ai' && changes[asset.id]) Object.assign(asset, changes[asset.id])
  }
}
