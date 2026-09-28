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
    MutationObserver: class { observe() {} }, document: { body: {}, querySelector: () => null },
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

function shellFixture(cs) {
  const source = readFileSync(resolve(__dirname, 'renderer/views/AgentWebView.vue'), 'utf8')
  const code = source.slice(source.indexOf('function reportAttachmentError('), source.indexOf('\nasync function handlePickAttachments'))
  const messages = []
  const sandbox = { window: { cs }, activeRuntimeSessionId: { value: 'session-a' },
    MAX_ATTACHMENT_BYTES: 200 * 1024 * 1024, Uint8Array,
    isImageLikeFile: file => String(file.type || '').startsWith('image/'), postToFrame: m => messages.push(m) }
  vm.runInNewContext(code, sandbox)
  return { register: sandbox.registerAttachmentFile, messages }
}

test('folder drop preserves its real path without reading bytes, copying or uploading its contents', async () => {
  const folder = { name: '项目 资料', type: '', arrayBuffer: () => assert.fail('directory is not a byte upload') }
  const f = shellFixture({ saveAgentAttachment: () => assert.fail('no copy'),
    getAgentAttachmentPath: f => { assert.equal(f, folder); return '/tmp/项目 资料' },
    describeAgentAttachment: async path => ({ ok: true, kind: 'directory', path, name: folder.name }),
    agentApi: () => assert.fail('directory is a path reference') })
  await f.register(folder, 'running-session')
  assert.equal(f.messages[0].kind, 'directory')
  assert.equal(f.messages[0].path, '/tmp/项目 资料')
  assert.equal(f.messages[0].runtimeSessionId, 'running-session')
})

test('file drop registers once with the original session even when selection changes during upload', async () => {
  let calls = 0
  const f = shellFixture({ saveAgentAttachment: async () => ({ ok: true, name: '报告.txt', path: '/tmp/copy', size: 4 }),
    getAgentAttachmentPath: () => '', agentApi: async (_method, _url, body) => {
      calls++; assert.equal(body.runtime_session_id, 'old-session')
      return { attachment: { filename: body.name, attachment_id: 'att-123' } }
    } })
  await f.register(new File(['text'], '报告.txt'), 'old-session')
  assert.equal(calls, 1)
  assert.equal(f.messages[0].runtimeSessionId, 'old-session')
  assert.equal(f.messages[0].attachmentId, 'att-123')
})

test('attachment errors are visible and do not report a successful attachment', async () => {
  const f = shellFixture({ saveAgentAttachment: async () => ({ ok: false, error: '磁盘已满' }) })
  await f.register(new File(['text'], '报告.txt'))
  assert.equal(f.messages[0].__crawshrimp, 'attachment-error')
  assert.match(f.messages[0].message, /磁盘已满/)
})

test('native attachment references preserve draft text/images and queue across a locked submit', () => {
  let declaration
  vm.runInNewContext(readFileSync(slotsPath, 'utf8'), {
    window: { __ModuleLoader__: { load: v => { declaration = v } } },
    MutationObserver: class { observe() {} }, document: { body: {}, querySelector: () => null },
  })
  const client = declaration.factory(() => ({}))
  const inserted = [], consumed = []
  let locked = true
  const state = { draft: 'hello EXISTING', imageIds: ['image-1'], draftRev: 7,
    occurrences: [{ occurrenceId: 1, offset: 6, length: 8, source: 'other', ref: '{}' }] }
  const input = { state: { getSnapshot: () => ({ ...state, occurrences: [...state.occurrences, ...inserted.map((v, i) => ({ ...v.reference, offset: state.draft.length + i, length: v.reference.clipboardText.length }))] }) }, insertReference: (reference, span) => {
    if (locked) return false
    inserted.push({ reference, span }); return true
  } }
  const scoped = { get: () => ({ input: { for: () => input } }), bail: (...args) => consumed.push(args) }
  const ctx = { sessions: { scope: id => { assert.equal(id, 's1'); return scoped } } }
  client.setAttachmentContext(ctx)
  client.queueAttachmentHint('s1', '目录', undefined, { kind: 'directory', path: '/tmp/目录' })
  assert.equal(inserted.length, 0)
  locked = false
  client.flushAttachmentHints('s1')
  client.flushAttachmentHints('s1')
  assert.equal(inserted.length, 1)
  assert.equal(inserted[0].span.start, 7)
  assert.equal(inserted[0].span.draftRev, 7)
  assert.equal(inserted[0].reference.appearance, 'folder')
  assert.match(inserted[0].reference.clipboardText, /\/tmp\/目录/)
  assert.deepEqual(state.imageIds, ['image-1'])
  assert.equal(state.draft, 'hello EXISTING')
  client.removeAttachmentReference('s1', 1)
  assert.equal(consumed[0][1].guard.span.start, 6)
  assert.equal(consumed[0][1].guard.span.end, 7)
})

test('restored receipts become native cards while existing chips and ordinary text are left intact', () => {
  let declaration
  vm.runInNewContext(readFileSync(slotsPath, 'utf8'), {
    window: { __ModuleLoader__: { load: v => { declaration = v } } },
    MutationObserver: class { observe() {} }, document: { body: {}, querySelector: () => null },
  })
  const client = declaration.factory(() => ({}))
  const folder = '[文件夹路径: "/tmp/资料 目录"]'
  const file = '[附件: 报告.txt (attachment_id: att-123abc)]'
  const draft = `请分析 ${folder} ${file}`
  const inserted = []
  const input = { state: { getSnapshot: () => ({ draft, draftRev: 2, occurrences: [
    { offset: 4, length: folder.length, source: 'crawshrimp-attachment' },
  ] }) }, insertReference: (ref, span) => { inserted.push({ ref, span }); return true } }
  client.restoreAttachmentReferences(input)
  assert.equal(inserted.length, 1)
  assert.equal(inserted[0].ref.label, '报告.txt')
  assert.equal(inserted[0].span.start, 6)
  assert.equal(inserted[0].ref.clipboardText, file)
})

function transactionFixture() {
  let declaration, receiveMessage
  const parent = { postMessage: () => {} }
  vm.runInNewContext(readFileSync(slotsPath, 'utf8'), {
    window: { __ModuleLoader__: { load: value => { declaration = value } }, location: { search: '' },
      parent, addEventListener: (type, callback) => { if (type === 'message') receiveMessage = callback }, removeEventListener: () => {},
      localStorage: { getItem: () => null } }, URLSearchParams,
    MutationObserver: class { observe() {} }, document: { body: {}, querySelector: () => null },
  })
  const client = declaration.factory(() => ({}))
  const sessions = new Map(), cleanup = []
  const ctx = { effect: callback => cleanup.push(callback()), sessions: { scope: id => sessions.get(id).scope } }
  client.setAttachmentContext(ctx)
  function session(id) {
    let state = { draft: '', phase: 'plain', draftRev: 0, occurrences: [], imageIds: [] }, seq = 0
    const listeners = new Set(), sent = []
    const publish = patch => { state = { ...state, ...patch, draftRev: state.draftRev + 1 }; listeners.forEach(fn => fn()) }
    const input = {
      state: { getSnapshot: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } },
      notify: () => {},
      insertReference: ref => {
        if (!['plain', 'claimed'].includes(state.phase)) return false
        publish({ draft: state.draft + ref.clipboardText, occurrences: [...state.occurrences,
          { ...ref, occurrenceId: ++seq, offset: state.draft.length, length: ref.clipboardText.length }] })
        return true
      },
      submit: () => { sent.push(state); publish({ draft: '', occurrences: [], phase: 'plain' }) },
    }
    const scope = { get: () => ({ input: { for: () => input } }), bail: (_event, { guard }) => {
      const index = state.occurrences.findIndex((item, i) => item.offset - state.occurrences.slice(0, i).reduce((n, x) => n + x.length - 1, 0) === guard.span.start)
      publish({ occurrences: state.occurrences.filter((_, i) => i !== index) })
    } }
    const value = { input, scope, sent, publish, snapshot: () => state }
    sessions.set(id, value)
    return value
  }
  return { client, session, cleanup, message: data => {
    if (!receiveMessage) client.installShellMessageBridge(ctx)
    receiveMessage({ source: parent, data })
  } }
}
const tick = async () => { await Promise.resolve(); await Promise.resolve() }

test('select-all replacement retains pending attachments; native submit transfers once and clears', async () => {
  const { client, session } = transactionFixture(), s = session('a')
  client.queueAttachmentHint('a', '报告.txt', 'att-123')
  s.publish({ draft: 'replacement text', occurrences: [] })
  await tick()
  assert.equal(s.snapshot().occurrences.length, 1)
  assert.match(s.snapshot().draft, /^replacement text/)
  s.input.submit()
  await tick()
  assert.equal(s.sent.length, 1)
  assert.equal(s.sent[0].occurrences.length, 1)
  assert.equal(s.snapshot().occurrences.length, 0)
})

test('failed native send restores cards; attachments arriving during a locked send survive', async () => {
  const { client, session } = transactionFixture(), s = session('a')
  client.queueAttachmentHint('a', 'first.txt', 'att-111')
  s.input.submit()
  s.publish({ phase: 'submitting' })
  client.queueAttachmentHint('a', 'second.txt', 'att-222')
  assert.equal(s.snapshot().occurrences.length, 0)
  s.publish({ ...s.sent[0], phase: 'plain' })
  await tick()
  assert.deepEqual(Array.from(s.snapshot().occurrences, x => x.label), ['first.txt', 'second.txt'])
  s.input.submit()
  await tick()
  assert.equal(s.sent[1].occurrences.length, 2)
  assert.equal(s.snapshot().occurrences.length, 0)
})

test('explicit removal and per-session drafts do not leak files into another send', async () => {
  const { client, session, cleanup } = transactionFixture(), a = session('a'), b = session('b')
  client.queueAttachmentHint('a', 'remove.txt', 'att-111')
  client.queueAttachmentHint('b', 'keep.txt', 'att-222')
  client.removeAttachmentReference('a', a.snapshot().occurrences[0].occurrenceId)
  await tick()
  a.input.submit(); b.input.submit()
  await tick()
  assert.equal(a.sent[0].occurrences.length, 0)
  assert.deepEqual(Array.from(b.sent[0].occurrences, x => x.label), ['keep.txt'])
  cleanup.forEach(fn => fn?.())
})


test('pending uploads block submission until completion and do not block another session', async () => {
  const f = transactionFixture(), a = f.session('a'), b = f.session('b')
  f.client.queueAttachmentHint('b', 'ready.txt', 'att-333')
  const notices = []
  a.input.notify = (_kind, message) => notices.push(message)
  f.message({ __crawshrimp: 'attachment-upload-started', requestId: 'upload-1', runtimeSessionId: 'a', name: 'large.pdf' })
  a.input.submit(); b.input.submit()
  assert.equal(a.sent.length, 0)
  assert.equal(b.sent.length, 1)
  assert.match(notices[0], /请稍候/)
  f.message({ __crawshrimp: 'attachment-added', runtimeSessionId: 'a', name: 'large.pdf', attachmentId: 'att-444' })
  f.message({ __crawshrimp: 'attachment-upload-finished', requestId: 'upload-1' })
  a.input.submit()
  await tick()
  assert.deepEqual(Array.from(a.sent[0].occurrences, x => x.label), ['large.pdf'])
  assert.equal(a.snapshot().occurrences.length, 0)
})
