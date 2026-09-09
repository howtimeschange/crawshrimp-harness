const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve, basename, extname } = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const slotsPath = resolve(__dirname, '../../integrations/deepseek-harness/crawshrimp-slots/lib/client.js')

function fixture({ imagesAvailable = true, reject = [] } = {}) {
  let declaration
  const messages = [], drafts = [], nativeFiles = [], resets = []
  class Transfer {
    files = []
    items = { add: file => this.files.push(file) }
  }
  class TransferEvent {
    constructor(type, options = {}) { this.type = type; Object.assign(this, options) }
    preventDefault() { this.defaultPrevented = true }
    stopPropagation() { this.stopped = true }
    stopImmediatePropagation() { this.immediate = true }
  }
  const sandbox = {
    MutationObserver: class { observe() {} }, document: { body: {} },
    File, DataTransfer: Transfer, Event: TransferEvent, DragEvent: TransferEvent, ClipboardEvent: TransferEvent,
    setTimeout: () => {}, URLSearchParams,
    window: {
      localStorage: { getItem: () => JSON.stringify({ sessionId: 'session-upload' }) }, location: { search: '' },
      parent: { postMessage: message => messages.push(message) },
      dispatchEvent: event => resets.push(event.type),
      __ModuleLoader__: { load: value => { declaration = value } },
    },
  }
  vm.runInNewContext(readFileSync(slotsPath, 'utf8'), sandbox)
  const client = declaration.factory(() => ({}))
  const conversation = {
    createDraftImages: ([file]) => [{ id: file.name }], releaseDraftImages: () => {},
    input: { for: () => ({ addImages: ([name]) => {
      if (reject.includes(name)) return false
      drafts.push(name); return true
    } }) },
  }
  const ctx = imagesAvailable ? { sessions: { scope: () => ({ get: () => conversation }) } } : {}
  function dispatch(type, files, { inComposer = true } = {}) {
    const target = {
      closest: () => inComposer ? {} : null,
      dispatchEvent: forwarded => {
        forwarded.target = target
        handle(forwarded)
      },
    }
    const event = new TransferEvent(type, {
      target, dataTransfer: { files },
      clipboardData: { items: files.map(file => ({ kind: 'file', getAsFile: () => file })) },
    })
    function handle(e) {
      client[type === 'drop' ? 'handleDropAttachments' : 'handlePasteAttachments'](e, ctx)
      if (!e.stopped) nativeFiles.push(...(type === 'drop' ? e.dataTransfer.files : e.clipboardData.files || files))
    }
    handle(event)
    return event
  }
  return { dispatch, messages, drafts, nativeFiles, resets }
}

for (const type of ['drop', 'paste']) {
  test(`${type}: regular documents are registered once and never enter native image validation`, () => {
    const f = fixture()
    const files = [new File(['report'], '报告.txt', { type: 'text/plain' }), new File(['data'], '表格.xlsx'), new File(['pdf'], '报告.pdf', { type: 'application/pdf' })]
    const event = f.dispatch(type, files)
    assert.equal(event.defaultPrevented, true)
    assert.equal(event.immediate, true)
    assert.deepEqual(f.messages.map(m => m.file), files)
    assert.ok(f.messages.every(m => m.__crawshrimp === 'upload-attachment' && m.runtimeSessionId === 'session-upload'))
    assert.deepEqual(f.nativeFiles, [])
    if (type === 'drop') assert.ok(f.resets.includes('dragend'))
  })
  test(`${type}: mixed documents and images are each installed exactly once`, () => {
    const f = fixture()
    const image = new File(['png'], 'photo.png', { type: 'image/png' })
    const file = new File(['text'], 'report.txt', { type: 'text/plain' })
    f.dispatch(type, [file, image])
    assert.deepEqual(f.messages.map(m => m.file), [file])
    assert.deepEqual(f.drafts, ['photo.png'])
    assert.deepEqual(f.nativeFiles, [])
  })
  test(`${type}: unavailable image API forwards only images from a mixed transfer`, () => {
    const f = fixture({ imagesAvailable: false })
    const image = new File(['png'], 'photo.png', { type: 'image/png' })
    const file = new File(['text'], 'report.txt')
    f.dispatch(type, [file, image])
    assert.deepEqual(f.messages.map(m => m.file), [file])
    assert.deepEqual(f.nativeFiles, [image])
    assert.deepEqual(f.drafts, [])
  })
  test(`${type}: partial image failure does not duplicate earlier images or omit later images`, () => {
    const f = fixture({ reject: ['bad.png'] })
    const files = ['first.png', 'bad.png', 'last.png'].map(name => new File(['png'], name, { type: 'image/png' }))
    f.dispatch(type, files)
    assert.deepEqual(f.drafts, ['first.png', 'last.png'])
    assert.deepEqual(f.nativeFiles, [files[1]])
    assert.deepEqual(f.messages, [])
  })
  test(`${type}: image-only fallback leaves the native event available`, () => {
    const f = fixture({ imagesAvailable: false })
    const image = new File(['png'], 'photo.png', { type: 'image/png' })
    assert.equal(f.dispatch(type, [image]).defaultPrevented, undefined)
    assert.deepEqual(f.nativeFiles, [image])
    assert.deepEqual(f.messages, [])
  })
}

test('document drop works outside the composer while paste elsewhere stays untouched', () => {
  const file = new File(['text'], 'report.txt')
  const f = fixture()
  assert.equal(f.dispatch('drop', [file], { inComposer: false }).defaultPrevented, true)
  assert.equal(f.dispatch('paste', [file], { inComposer: false }).defaultPrevented, undefined)
  assert.equal(f.messages.length, 1)
})

test('attachment picker has no type filter and returns selected documents and images', async () => {
  const source = readFileSync(resolve(__dirname, 'main.js'), 'utf8')
  const code = source.slice(source.indexOf("secureHandle('agent:pick-attachments'"), source.indexOf("secureHandle('agent:save-clipboard-image'"))
  let handler, options
  const paths = ['/tmp/report.pdf', '/tmp/table.xlsx', '/tmp/photo.png', '/tmp/archive.zip']
  vm.runInNewContext(code, {
    secureHandle: (name, fn) => { assert.equal(name, 'agent:pick-attachments'); handler = fn },
    mainWindow: {}, dialog: { showOpenDialog: async (_window, value) => { options = value; return { filePaths: paths } } },
    path: { basename, extname }, fs: { statSync: () => ({ size: 12 }) },
  })
  const result = await handler()
  assert.deepEqual(Array.from(options.filters), [])
  assert.deepEqual(Array.from(options.properties), ['openFile', 'multiSelections'])
  assert.equal(result.ok, true)
  assert.deepEqual(Array.from(result.files, f => f.path), paths)
  assert.equal(result.files[0].mime, 'application/pdf')
  assert.equal(result.files[2].mime, 'image/png')
})
