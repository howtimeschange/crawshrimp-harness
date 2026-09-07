import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampDockedBrowserWidth,
  defaultDockedBrowserWidth,
  dockedBrowserWidthBounds,
} from './browserDockWidth.mjs'

test('docked browser width defaults close to half while preserving a readable conversation pane', () => {
  const bounds = dockedBrowserWidthBounds(1800)
  assert.deepEqual(bounds, { min: 420, max: 1268 })
  assert.equal(defaultDockedBrowserWidth(1800), 864)
  assert.equal(1800 - defaultDockedBrowserWidth(1800) - 12 >= 520, true)
})

test('docked browser width clamps both persisted and pointer-driven values to safe bounds', () => {
  assert.equal(clampDockedBrowserWidth(10, 1200), 420)
  assert.equal(clampDockedBrowserWidth(2000, 1200), 780)
  assert.equal(clampDockedBrowserWidth(500, 1200), 500)
})
