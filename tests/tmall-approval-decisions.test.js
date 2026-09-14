const { test } = require('node:test')
const assert = require('node:assert/strict')

test('face swap refresh keeps newer server approval and unsaved local prompt', async () => {
  const { approvalDecisionSnapshot, changedApprovalDecisions, applyApprovalDecisions } = await import('../app/src/renderer/utils/tmallApprovalDecisions.mjs')
  const batch = { items: [{ assets: [{ id: 'source', kind: 'ai', status: 'pending', custom_prompt: 'old' }] }] }
  const baseline = approvalDecisionSnapshot(batch)
  batch.items[0].assets[0].custom_prompt = 'user edit'
  const changes = changedApprovalDecisions(approvalDecisionSnapshot(batch), baseline)
  assert.deepEqual(changes, { source: { custom_prompt: 'user edit' } })
  const latest = { items: [{ assets: [
    { id: 'source', kind: 'ai', status: 'approved', custom_prompt: 'old' },
    { id: 'face', kind: 'ai', status: 'pending' },
  ] }] }
  const saved = approvalDecisionSnapshot(latest)
  applyApprovalDecisions(latest, changes)
  assert.equal(latest.items[0].assets[0].status, 'approved')
  assert.equal(latest.items[0].assets[1].status, 'pending')
  assert.deepEqual(changedApprovalDecisions(approvalDecisionSnapshot(latest), saved), changes)
})
