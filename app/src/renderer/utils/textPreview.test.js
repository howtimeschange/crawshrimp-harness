import assert from 'node:assert/strict'
import test from 'node:test'
import { isPartialTextPreview } from './textPreview.js'
const response = (status, range) => ({ status, headers: { get: () => range } })
test('Range responses distinguish complete small files, partial bytes and unknown sizes', () => {
  assert.equal(isPartialTextPreview(response(206, 'bytes 0-32/33')), false)
  assert.equal(isPartialTextPreview(response(206, 'bytes 0-657/658')), false)
  assert.equal(isPartialTextPreview(response(206, 'bytes 0-262143/300000')), true)
  assert.equal(isPartialTextPreview(response(206, 'bytes 0-262143/*')), true)
  assert.equal(isPartialTextPreview(response(206, null)), true)
  assert.equal(isPartialTextPreview(response(200, null)), false)
})
