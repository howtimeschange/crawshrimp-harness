const { test } = require('node:test')
const assert = require('node:assert/strict')
const { officialModelAvailable } = require('./managedModelAccess')
test('official permissions use catalogue booleans regardless of local plan, balance, or model family', () => {
  const catalog = [{ id: 'future-model', available: true }, { id: 'gemini-disabled', available: false }, { id: 'unknown-model' }]
  assert.equal(officialModelAvailable('future-model', 'free', catalog, false), true)
  assert.equal(officialModelAvailable('gemini-disabled', 'pro', catalog, true), false)
  assert.equal(officialModelAvailable('unknown-model', 'pro', catalog, true), false)
  assert.equal(officialModelAvailable('removed-model', 'pro', catalog, true), false)
  assert.equal(officialModelAvailable('gemini-old', 'free', [], true), false)
})
test('catalogue updates can grant or revoke the same model without changing the plan', () => {
  for (const available of [false, true, false]) assert.equal(officialModelAvailable('arbitrary-model', 'free', [{ id: 'arbitrary-model', available }]), available)
})
