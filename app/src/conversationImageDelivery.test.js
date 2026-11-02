const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.events = {}; this.attributes = {}; this.hidden = false; this.classList = { toggle: (name, enabled) => { const names = new Set((this.className || '').split(' ').filter(Boolean)); enabled ? names.add(name) : names.delete(name); this.className = [...names].join(' ') } } }
  appendChild(node) { node.remove(); node.parentNode = this; this.children.push(node); return node }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)) }
  remove() { if (this.parentNode) { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null } }
  after(node) { node.remove(); const parent = this.parentNode; parent.children.splice(parent.children.indexOf(this) + 1, 0, node); node.parentNode = parent }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] }
  get childElementCount() { return this.children.length }
  get isConnected() { return this.tagName === 'body' || Boolean(this.parentNode?.isConnected) }
  setAttribute(key, value) { this.attributes[key] = value }
  removeAttribute(key) { delete this.attributes[key] }
  get firstChild() { return this.children[0] }
  addEventListener(type, callback) { this.events[type] = callback }
  querySelectorAll(selector) { return this.children.flatMap(child => [child, ...child.querySelectorAll(selector)]).filter(child => selector === '[data-chat-anchor-key]' ? child.dataset.chatAnchorKey : selector === 'img' ? child.tagName === 'img' : child.className?.split(' ').includes(selector.slice(1))) }
}
function fixture() {
  const body = new Element('body'), column = new Element('column')
  body.append(column)
  const timers = [], messages = []
  const context = vm.createContext({
    URL, document: { body, baseURI:'http://localhost/', createElement: tag => new Element(tag), querySelector: selector => selector === '[data-chat-flow]' ? column : null, querySelectorAll: selector => body.querySelectorAll(selector) },
    activeRuntimeSessionId: () => context.session, session: 'A',
    injectArtifactCss() {}, postToShell: msg => messages.push(msg),
    MutationObserver: class { observe() {} disconnect() {} }, clearInterval() {}, setTimeout: fn => timers.push(fn),
  })
  const source = fs.readFileSync(path.resolve(__dirname, '../../integrations/deepseek-harness/crawshrimp-slots/lib/client.js'), 'utf8')
  vm.runInContext(source.slice(source.indexOf('    function artifactSizeText('), source.indexOf('    // ---- 会话附件上传')), context)
  const row = (key, turn, final = false) => {
    const el = new Element('div'); el.dataset = { chatAnchorKey: key, chatCallId: key, chatTurn: String(turn), chatFinalAnswer: String(final) }; column.append(el); return el
  }
  const generation = (id, turn) => context.renderImageGeneration({ runtimeSessionId: 'A', tool_call_id: id, dsh_call_id: id, turn, state: 'completed' })
  const image = (id, name, url = '/signed/' + name) => context.renderArtifactShow({ runtimeSessionId: 'A', artifact: { toolCallId: id, path: '/tmp/' + name, filename: name, mediaKind: 'image' }, urls: { file: url } })
  const entries = () => vm.runInContext('[...generationGroups.values()]', context)
  return { context, column, body, row, generation, image, entries, messages, timers }
}

for (const mediaKind of ['image', 'zip']) test(`${mediaKind} previews from other tools display without an image generation group`, () => {
  const f = fixture(); f.row('video-call', 1)
  const data = { runtimeSessionId: 'A', artifact: { toolCallId: 'video-call', path: '/tmp/poster.' + mediaKind, filename: 'poster.' + mediaKind, mediaKind, zipImages: ['poster.png'] }, urls: { file: '/signed/poster', entries: ['/signed/poster-entry'] } }
  f.context.renderArtifactShow(data)
  assert.equal(f.body.querySelectorAll('.cs-artifact-block').length, 1)
  assert.equal(f.timers.length, 0)
  f.context.renderArtifactShow(data)
  assert.equal(f.body.querySelectorAll('.cs-artifact-block').length, 1)
})

test('explicit image generation delivery waits for its group before replay', () => {
  const f = fixture(); f.row('image-call', 1); f.row('answer', 1, true)
  f.context.renderArtifactShow({ runtimeSessionId: 'A', artifact: { imageGeneration: true, toolCallId: 'image-call', path: '/tmp/generated.png', filename: 'generated.png', mediaKind: 'image' }, urls: { file: '/signed/generated' } })
  assert.equal(f.body.querySelectorAll('.cs-artifact-block').length, 0)
  assert.equal(f.timers.length, 1)
  f.generation('image-call', 1)
  f.timers.shift()()
  assert.equal(f.entries()[0].delivery.childElementCount, 1)
  assert.equal(f.timers.length, 0)
})

test('image results sit outside tool folding and are delivered only with the same turn final answer', () => {
  const f = fixture(); const tool = f.row('call-a', 1)
  f.generation('call-a', 1); f.image('call-a', 'blue.png')
  const entry = f.entries()[0]
  assert.equal(entry.block.parentNode, f.column)
  assert.equal(tool.nextSibling, entry.block)
  tool.hidden = true
  assert.equal(entry.block.hidden, false)
  assert.equal(entry.block.children[0].tagName, 'details')
  assert.equal(Boolean(entry.block.children[0].open), true)
  assert.equal(entry.delivery.isConnected, false)
  f.row('later-answer', 2, true); f.context.placeGenerationGroup(entry)
  assert.equal(entry.delivery.isConnected, false)
  const answer = f.row('answer', 1, true); f.context.placeGenerationGroup(entry)
  assert.equal(answer.nextSibling, entry.gallery)
  assert.equal(entry.gallery.children[0], entry.delivery)
  assert.equal(entry.delivery.children.length, 1)
  assert.equal(entry.delivery.children[0].children[0].attributes['aria-label'], '查看大图：blue.png')
  f.image('call-a', 'blue.png'); f.context.placeGenerationGroup(entry)
  assert.equal(entry.delivery.children.length, 1)
  f.image('call-a', 'blue.png', '/renewed/url')
  assert.equal(entry.delivery.children.length, 1)
  assert.equal(entry.delivery.children[0].children[0].children[0].src, '/renewed/url')
})

test('completed process rows stay detached once the answer and gallery are present', () => {
  const f = fixture(); f.row('a', 1); f.row('b', 1); const answer = f.row('answer', 1, true)
  f.generation('a', 1); f.generation('b', 1); f.image('a', 'one.png'); f.image('b', 'two.png')
  const [a, b] = f.entries()
  for (let i = 0; i < 5; i++) { f.context.placeGenerationGroup(a); f.context.placeGenerationGroup(b) }
  assert.equal(a.block.isConnected, false)
  assert.equal(b.block.isConnected, false)
  assert.equal(answer.nextSibling, a.gallery)
})

test('multiple calls/images retain order and session switching removes and restores only owned delivery', () => {
  const f = fixture(); f.row('a', 1); f.row('b', 1); const answer = f.row('answer', 1, true)
  f.generation('a', 1); f.generation('b', 1)
  f.image('a', 'one.png'); f.image('a', 'two.png'); f.image('b', 'three.png')
  const [a,b] = f.entries()
  for (let i = 0; i < 3; i++) { f.context.placeGenerationGroup(a); f.context.placeGenerationGroup(b) }
  assert.equal(answer.nextSibling, a.gallery); assert.equal(a.gallery, b.gallery); assert.deepEqual(a.gallery.children, [a.delivery, b.delivery])
  assert.equal(a.delivery.childElementCount, 2)
  f.context.session = 'B'; f.entries().forEach(f.context.placeGenerationGroup)
  assert.equal(a.delivery.isConnected, false); assert.equal(b.block.isConnected, false)
  f.context.session = 'A'; f.entries().forEach(f.context.placeGenerationGroup)
  assert.equal(answer.nextSibling, a.gallery); assert.deepEqual(a.gallery.children, [a.delivery, b.delivery])
  answer.remove(); f.entries().forEach(f.context.placeGenerationGroup)
  assert.equal(a.delivery.isConnected, false)
})

test('only exact images already embedded in final answer are omitted from a compact per-turn gallery', () => {
  const f = fixture(); f.row('a', 1); f.row('b', 1); const answer = f.row('answer', 1, true)
  const embedded = new Element('img'); embedded.src = 'http://localhost/api/file?path=%2Ftmp%2Fone.png'; answer.append(embedded)
  f.generation('a', 1); f.generation('b', 1); f.image('a', 'one.png'); f.image('b', 'two.png')
  const [a,b] = f.entries()
  assert.equal(a.images.get('/tmp/one.png').final.hidden, true)
  assert.equal(b.images.get('/tmp/two.png').final.hidden, false)
  assert.equal(a.gallery.hidden, false)
  assert.equal(a.block.hidden, true)
  embedded.remove(); f.context.placeGenerationGroup(a); f.context.placeGenerationGroup(b)
  assert.equal(a.images.get('/tmp/one.png').final.hidden, false)
})

test('four generated images use a selectable main image and thumbnail list', () => {
  const f = fixture(); f.row('a', 1); const answer = f.row('answer', 1, true)
  f.generation('a', 1)
  for (const name of ['one.png', 'two.png', 'three.png', 'four.png']) f.image('a', name)
  const entry = f.entries()[0], collection = entry.gallery.collection
  assert.equal(collection.items.length, 4)
  assert.equal(collection.view.children[1].children.length, 4)
  assert.equal(collection.view.children[1].children[0].attributes['aria-pressed'], 'true')
  collection.view.children[1].children[2].events.click()
  assert.equal(collection.selected, 2)
  assert.equal(collection.view.children[1].children[2].attributes['aria-pressed'], 'true')
  assert.equal(collection.view.children[0].children[0].dataset.artifactPath, '/tmp/three.png')
  f.context.placeGenerationGroup(entry)
  assert.equal(entry.gallery.collection.selected, 2)
  assert.equal(answer.nextSibling, entry.gallery)
})

test('snapshot delivery matches the original source path embedded in the answer', () => {
  const f = fixture(); f.row('a', 1); const answer = f.row('answer', 1, true)
  const embedded = new Element('img'); embedded.src = 'http://localhost/api/file?path=%2Fexports%2Fdog.png'; answer.append(embedded)
  f.generation('a', 1)
  f.context.renderArtifactShow({ runtimeSessionId: 'A', artifact: { toolCallId: 'a', path: '/snapshots/version/dog.png', sourcePath: '/exports/dog.png', filename: 'dog.png', mediaKind: 'image' }, urls: { file: '/signed/dog' } })
  assert.equal(f.entries()[0].images.get('/snapshots/version/dog.png').final.hidden, true)
})

test('image card uses a preview button and line-icon file actions without the old emoji header', () => {
  const f = fixture(); const block = f.context.makeArtifactBlock({ mediaKind:'image', filename:'image.png', path:'/tmp/image.png' }, {file:'/image'})
  assert.equal(block.children[0].tagName, 'button')
  assert.equal(block.children[1].children.length, 2)
  block.children[1].children[1].events.click()
  assert.equal(f.messages[0].__crawshrimp, 'reveal-file')
  assert.equal(block.children.some(child => child.className === 'cs-artifact-head'), false)
})


test('nested tool history cannot hide the independent image result row', () => {
  const f = fixture(); const group = new Element('div'), history = new Element('div')
  f.column.append(group); group.append(history)
  const tool = f.row('nested', 1); history.append(tool); history.hidden = true
  f.generation('nested', 1); f.image('nested', 'nested.png')
  const entry = f.entries()[0]
  assert.equal(group.nextSibling, entry.block)
  assert.equal(entry.block.parentNode, f.column)
  group.hidden = true; f.context.placeGenerationGroup(entry)
  assert.equal(entry.block.hidden, false)
  assert.equal(entry.block.parentNode, f.column)
})
