const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
function openHandler(shell) {
  let handler
  vm.runInNewContext(main.slice(main.indexOf("secureHandle('open-file',"), main.indexOf("secureHandle('open-external-url',")), {
    secureHandle: (_, fn) => { handler = fn }, URL, path, shell,
  })
  return handler
}

test('repeated ZIP opens only reveal the archive; normal files and URLs still open', async () => {
  const calls = []
  const open = openHandler({
    showItemInFolder: p => calls.push(['reveal', p]),
    openPath: async p => { calls.push(['open', p]); return '' },
    openExternal: async p => calls.push(['external', p]),
  })
  for (let i = 0; i < 3; i++) await open(null, '/tmp/图片包.ZIP')
  await open(null, '/tmp/结果.xlsx')
  await open(null, 'https://example.com/file.zip')
  assert.deepEqual(calls, [
    ['reveal', '/tmp/图片包.ZIP'], ['reveal', '/tmp/图片包.ZIP'], ['reveal', '/tmp/图片包.ZIP'],
    ['open', '/tmp/结果.xlsx'], ['external', 'https://example.com/file.zip'],
  ])
})

test('OS file-open errors are returned to the caller', async () => {
  const open = openHandler({ openPath: async () => 'File not found' })
  const result = await open(null, '/tmp/missing.pdf')
  assert.equal(result.ok, false)
  assert.equal(result.error, 'File not found')
})

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.events = {} }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)) }
  appendChild(node) { node.parent = this; this.children.push(node) }
  addEventListener(type, fn) { this.events[type] = fn }
  setAttribute() {}
  showModal() { this.open = true }
  close() { this.open = false; this.events.close?.() }
  remove() { this.parent.children = this.parent.children.filter(node => node !== this) }
  click() { this.events.click?.({ target: this, stopPropagation() {} }) }
}

test('ZIP thumbnail previews never send an OS open request and dialogs are cleaned up', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../integrations/deepseek-harness/crawshrimp-slots/lib/client.js'), 'utf8')
  const document = { body: new Element('body'), createElement: tag => new Element(tag) }
  const requests = []
  const context = { document, postToShell: message => requests.push(message) }
  vm.createContext(context)
  vm.runInContext(source.slice(source.indexOf('    function artifactSizeText('), source.indexOf('    const generationGroups =')), context)
  const block = context.makeArtifactBlock({ path: '/tmp/图片.zip', filename: '图片.zip', mediaKind: 'zip', zipImages: ['裙子.jpg'] }, { entries: ['/signed/image'] })
  assert.equal(block.children[0].children[3].textContent, '显示文件')
  const thumbnail = block.children[1].children[0]
  for (let i = 0; i < 3; i++) {
    thumbnail.click()
    const dialog = document.body.children[0]
    assert.equal(dialog.open, true)
    assert.equal(dialog.children[1].src, '/signed/image')
    dialog.children[0].click()
    assert.equal(document.body.children.length, 0)
  }
  assert.equal(requests.length, 0)
  block.children[0].children[3].click()
  assert.equal(requests[0].path, '/tmp/图片.zip')
  assert.equal(requests[0].__crawshrimp, 'reveal-file')
})
