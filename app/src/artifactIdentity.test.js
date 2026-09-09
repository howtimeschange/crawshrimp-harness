import test from 'node:test'
import assert from 'node:assert/strict'
import { sameArtifact } from './renderer/components/agent/artifactIdentity.js'
test('artifact identity survives differing event IDs without merging same-name files', () => {
  assert.equal(sameArtifact({ path: '/a/report.xlsx', artifact_id: 'event' }, { path: '/a/report.xlsx', artifactId: 'task' }), true)
  assert.equal(sameArtifact({ path: '/a/report.xlsx' }, { path: '/b/report.xlsx' }), false)
  assert.equal(sameArtifact({ artifact_id: 'one' }, { artifactId: 'one' }), true)
  assert.equal(sameArtifact({ filename: 'report.xlsx' }, { filename: 'report.xlsx' }), false)
})
