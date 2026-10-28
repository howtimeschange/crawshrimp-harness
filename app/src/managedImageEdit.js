'use strict'

const scalarFields = new Set(['model', 'prompt', 'size', 'quality', 'n', 'output_format', 'background', 'output_compression'])
const fileFields = new Set(['image', 'image[]', 'mask'])

async function managedImageEdit(bytes, contentType, catalog) {
  if (typeof contentType !== 'string' || !/^multipart\/form-data\s*;/i.test(contentType)) throw new Error('参考图编辑需要 multipart/form-data')
  let form
  try { form = await new Request('http://127.0.0.1/edit', { method: 'POST', headers: { 'Content-Type': contentType }, body: bytes }).formData() }
  catch { throw new Error('参考图编辑格式无效') }
  const models = form.getAll('model'), model = typeof models[0] === 'string' ? models[0].replace(/^managed-/, '') : ''
  if (models.length !== 1 || !catalog.some(item => item.id === model && item.kind === 'image' && item.protocol === 'openai')) throw new Error('账号当前未开放此图片模型')
  let images = 0, files = 0
  for (const [name, value] of form) {
    if (scalarFields.has(name)) {
      if (typeof value !== 'string' || form.getAll(name).length !== 1 || value.length > 20000) throw new Error('图片编辑参数无效')
    } else if (fileFields.has(name)) {
      if (typeof value === 'string' || value.size === 0 || !['image/png', 'image/jpeg', 'image/webp'].includes(value.type)) throw new Error('参考图格式无效')
      files++; if (name !== 'mask') images++
    } else throw new Error('不支持的图片编辑参数')
  }
  if (!images || images > 10 || files - images > 1) throw new Error('参考图数量无效')
  form.set('model', model)
  const encoded = new Request('http://127.0.0.1/edit', { method: 'POST', body: form })
  return { model, contentType: encoded.headers.get('content-type'), body: Buffer.from(await encoded.arrayBuffer()) }
}

module.exports = { managedImageEdit }
