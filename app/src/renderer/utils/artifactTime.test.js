import test from 'node:test'
import assert from 'node:assert/strict'
import { formatArtifactAge, sortArtifactsByUpdated, isOfficeDocument } from './artifactTime.js'

test('artifact age crosses minute, hour, day and 99-day boundaries', () => {
  const now = Date.parse('2026-09-09T10:00:00Z')
  const age = ms => formatArtifactAge(new Date(now - ms).toISOString(), now)
  assert.equal(age(59000), '刚刚')
  assert.equal(age(60000), '1分钟前')
  assert.equal(age(3599000), '59分钟前')
  assert.equal(age(3600000), '1小时前')
  assert.equal(age(86400000), '1天前')
  assert.equal(age(99 * 86400000), '99天前')
  assert.equal(age(100 * 86400000), '')
  assert.equal(age(-60000), '刚刚')
  assert.equal(formatArtifactAge('', now), '')
  assert.equal(formatArtifactAge('invalid', now), '')
})

test('timezone-free local events and explicit offsets preserve their meaning', () => {
  const localNow = new Date('2026-09-09T10:00:00').getTime()
  for (const value of ['2026-09-09 09:00:00', '2026-09-09T09:00:00.000']) {
    assert.equal(formatArtifactAge(value, localNow), '1小时前')
  }
  assert.equal(formatArtifactAge('2026-09-09T17:00:00+08:00', Date.parse('2026-09-09T10:00:00Z')), '1小时前')
})

test('recent updates sort first regardless of original creation time, missing dates last', () => {
  const files = [
    { filename: 'old.docx', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-09-09T10:00:00Z' },
    { filename: 'new.pptx', created_at: '2026-09-09T09:00:00Z' },
    { filename: 'missing' },
  ]
  assert.deepEqual(sortArtifactsByUpdated([files[2], files[1], files[0]]), files)
})
test('Office job metadata does not route generated chart images to a zero-page document preview', () => {
  assert.equal(isOfficeDocument({ filename: 'chart.png', office: { pages: [] } }), false)
  assert.equal(isOfficeDocument({ filename: 'report.PPTX', office: { pages: [] } }), true)
  assert.equal(isOfficeDocument({ filename: 'report.docx' }), false)
})
