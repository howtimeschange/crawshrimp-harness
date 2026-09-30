import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDelimited, restoreWorkspace } from './resourceWorkspace.js'
test('CSV preserves quoted separators, multiline values, CRLF, escaped quotes and empty cells', () => {
  assert.deepEqual(parseDelimited('商品,说明,金额\r\n童装A,"两件,\n\"\"套装\"\"",1188\r\n童装B,,1032\r\n').rows,
    [['商品','说明','金额'],['童装A','两件,\n"套装"','1188'],['童装B','','1032']])
})
test('CSV limits rows/columns and marks incomplete quoted records', () => {
  assert.equal(parseDelimited('a,b,c\n1,2,3', ',', 1, 2).clipped, true)
  assert.deepEqual(parseDelimited('a\tb\n1\t2','\t').rows, [['a','b'],['1','2']])
  assert.equal(parseDelimited('a,"partial').incomplete, true)
})
test('restoration migrates legacy selection, deduplicates paths and rejects malformed entries', () => {
  assert.equal(restoreWorkspace({ selection: { kind: 'artifact', path: '/中文/report.md' } }).tabs.length, 1)
  const saved = restoreWorkspace({ workTabs: [null, {}, {kind:'artifact', path:'/a.csv'}, {kind:'artifact', path:'/a.csv'}, {kind:'browser', id:42}], activeIds:['missing'] })
  assert.equal(saved.tabs.length, 1); assert.equal(saved.active[0], 'file:/a.csv')
})
