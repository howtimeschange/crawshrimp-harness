// A local artifact keeps its identity when task polling and SSE assign different IDs.
export function sameArtifact(a, b) {
  const pathA = String(a?.path || '').trim().replaceAll('\\', '/')
  const pathB = String(b?.path || '').trim().replaceAll('\\', '/')
  if (pathA && pathB) return pathA === pathB
  const idA = a?.artifact_id || a?.artifactId
  const idB = b?.artifact_id || b?.artifactId
  return Boolean(idA && idB && idA === idB)
}
