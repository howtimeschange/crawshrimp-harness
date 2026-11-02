import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelAvailability, modelAvailabilityLabel, catalogSummary } from './managedCatalogView.mjs'
test('catalogue UI handles future models and unknown permissions without local membership rules', () => {
  assert.equal(modelAvailability({id:'future-v2',available:true}), 'available')
  assert.equal(modelAvailabilityLabel({id:'gemini-blocked',available:false}), '暂不可用')
  assert.equal(modelAvailabilityLabel({id:'gpt-new'}), '待确认')
  assert.equal(catalogSummary([{id:'future-v2',available:true},{id:'gemini-blocked',available:false}]), '当前可用 1 / 2 个官方模型')
  assert.equal(catalogSummary([]), '查看最新模型目录与使用权限')
})
