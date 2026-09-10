export async function runPermissionBatch({ ids, call, onResult, shouldStop = () => false }) {
  const completed = []
  for (const id of [...new Set(ids)]) {
    if (shouldStop()) break
    let result
    try { result = await call(id) }
    catch (error) { result = { status: 'unknown', canRequest: false, message: error.message || String(error) } }
    completed.push(id)
    onResult(id, result)
  }
  return completed
}
