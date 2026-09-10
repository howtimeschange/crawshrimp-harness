import test from 'node:test'
import assert from 'node:assert/strict'
import { documentKind, readDocumentText, TEXT_LIMIT } from './documentPreview.js'
test('full extensions route Markdown, HTML, PDF and code without truncating suffixes', () => {
  for (const [name, kind] of [['a.markdown','markdown'],['a.HTML','html'],['a.PDF','pdf'],['a.tsx','code'],['a.docx',''],['a.jpeg','']]) assert.equal(documentKind(name),kind)
})
test('bounded text loading preserves UTF8 boundary and explicit truncation', async () => {
  const original = globalThis.fetch
  const data = new TextEncoder().encode('x'.repeat(TEXT_LIMIT - 1) + '虾 tail')
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.Range, 'bytes=0-262143')
    return new Response(data, { headers: { 'content-length': String(data.length) } })
  }
  try { const r = await readDocumentText('test'); assert.equal(r.truncated,true); assert.equal(r.text,'x'.repeat(TEXT_LIMIT-1)) }
  finally { globalThis.fetch = original }
})
test('complete small text and failed read are distinguishable', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response('中文', { headers: { 'content-length': '6' } })
    assert.deepEqual(await readDocumentText('test'),{text:'中文',truncated:false})
    globalThis.fetch = async () => new Response('', {status:404})
    await assert.rejects(readDocumentText('test'),/无法读取/)
  } finally { globalThis.fetch = original }
})
