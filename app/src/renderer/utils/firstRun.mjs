// Completion is local to this desktop and scoped to the managed account.
export function hasManagedTextModel(account) {
  return Boolean(account?.user?.id && account?.models?.some(model => model.kind === 'text'))
}
function key(owner) { return 'crawshrimp.first-run.v1.' + encodeURIComponent(String(owner)) }
export function firstRunCompletion(storage, owner) {
  if (!owner) return null
  try { const value = storage.getItem(key(owner)); return ['desktop', 'paired'].includes(value) ? value : null } catch { return null }
}
export function finishFirstRun(storage, owner, mode) {
  if (!owner || !['desktop', 'paired'].includes(mode)) return false
  try { storage.setItem(key(owner), mode); return true } catch { return false }
}
