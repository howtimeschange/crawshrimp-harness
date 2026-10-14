import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveOfficePreview } from './officePreview.js'

const office = { revision: 'v1', pages: [{ path: '/preview/1.png' }] }
test('a file-only Office link resolves existing preview metadata without creating a job', async () => {
  const requests = []
  const result = await resolveOfficePreview('/报告.pptx', {
    signal: new AbortController().signal,
    api: async (...args) => { requests.push(args); return { state: 'completed', office } },
  })
  assert.equal(result, office)
  assert.deepEqual(requests, [['POST', '/agent/artifacts/office-preview', { path: '/报告.pptx' }]])
})
test('ordinary Office preview polls the same job until its pages are ready', async () => {
  const requests = [], results = [{ state: 'queued', job_id: 'job1' }, { state: 'running', job_id: 'job1' }, { state: 'completed', office }]
  assert.equal(await resolveOfficePreview('/table.xlsx', {
    signal: new AbortController().signal, pollInterval: 0,
    api: async (_, __, body) => { requests.push(body); return results.shift() },
  }), office)
  assert.deepEqual(requests, [{ path: '/table.xlsx' }, { path: '/table.xlsx', job_id: 'job1' }, { path: '/table.xlsx', job_id: 'job1' }])
})
test('first-use downloads report progress while polling the same background job', async () => {
  const seen = [], requests = []
  const progress = { state: 'downloading', message: '正在下载 Office 资源', downloaded_bytes: 50, total_bytes: 100 }
  const results = [{ state: 'running', job_id: 'install-job', runtime_progress: progress }, { state: 'completed', office }]
  const result = await resolveOfficePreview('/first.docx', {
    signal: new AbortController().signal, pollInterval: 0,
    onProgress: value => seen.push(value),
    api: async (_, __, body) => { requests.push(body); return results.shift() },
  })
  assert.equal(result, office)
  assert.deepEqual(seen, [progress, null])
  assert.equal(requests[1].job_id, 'install-job')
})
test('switching away stops polling and discards a late preview response', async () => {
  const controller = new AbortController()
  let finish, requests = 0
  const pending = resolveOfficePreview('/old.docx', {
    signal: controller.signal,
    api: () => { requests++; return new Promise(resolve => { finish = resolve }) },
  })
  controller.abort(); finish({ state: 'completed', office })
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(requests, 1)
})
test('abort during polling releases the timer without another request', async () => {
  const controller = new AbortController()
  let requests = 0
  const pending = resolveOfficePreview('/old.pptx', {
    signal: controller.signal, pollInterval: 10000,
    api: async () => { requests++; return { state: 'running', job_id: 'job1' } },
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(requests, 1)
})
test('conversion failures, empty pages, and timeouts surface useful errors without repeating work', async () => {
  for (const [result, message] of [
    [{ state: 'failed', error: { message: 'LibreOffice 无法读取此文件' } }, /LibreOffice/],
    [{ state: 'completed', office: { pages: [] } }, /未生成/],
    [{ state: 'running', job_id: 'job1' }, /超时/],
  ]) {
    let requests = 0
    await assert.rejects(resolveOfficePreview('/bad.pptx', {
      signal: new AbortController().signal, timeout: 0,
      api: async () => { requests++; return result },
    }), message)
    assert.equal(requests, 1)
  }
})
