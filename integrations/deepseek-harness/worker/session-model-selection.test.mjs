import assert from 'node:assert/strict'
import test from 'node:test'

import {
  desiredSelectionForRun,
  shouldSelectModelForRun,
} from './session-model-selection.mjs'

test('same provider and model skips selection so existing reasoning effort is preserved', () => {
  const current = { provider: 'crawshrimp-deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }
  assert.equal(shouldSelectModelForRun({ provider: current.provider, model: current.model }, current), false)
})

test('explicit reasoning effort mismatch triggers a selection update', () => {
  const current = { provider: 'official', model: 'deepseek-flash', reasoningEffort: 'high' }
  assert.equal(shouldSelectModelForRun({ provider: 'official', model: 'deepseek-flash', reasoningEffort: 'low' }, current), true)
})

test('true model changes carry the current reasoning effort when the run has no explicit effort', () => {
  assert.deepEqual(
    desiredSelectionForRun(
      { provider: 'official', model: 'deepseek-v4-pro' },
      { provider: 'official', model: 'deepseek-flash', reasoningEffort: 'high' },
    ),
    { provider: 'official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
  )
})
