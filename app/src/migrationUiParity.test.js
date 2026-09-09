const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const root = resolve(__dirname, '../../integrations/deepseek-harness')
const source = readFileSync(resolve(root, 'crawshrimp-slots/lib/client.js'), 'utf8')

function element(tag) {
  return { tag, dataset: {}, children: [], listeners: {},
    appendChild(child) { this.children.push(child) },
    querySelectorAll() { return [] },
    addEventListener(type, listener) { this.listeners[type] = listener },
  }
}

for (const columnClass of ['EvIC1a_column', 'Md3f7G_column']) {
  test(`artifact media renders, deduplicates and opens in ${columnClass}`, () => {
    const upstream = readFileSync(resolve(root, 'node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js'), 'utf8')
    assert.ok(upstream.includes('"column": "EvIC1a_column"'))
    const column = element('div')
    const scroll = { scrollHeight: 900, scrollTop: 0, clientHeight: 900 }
    const messages = []
    const timers = []
    const sandbox = {
      MutationObserver: class { observe() {} disconnect() {} },
      document: {
        createElement: element,
        querySelector: (selector) => selector === `.${columnClass}` ? column : selector === '.wSkVaW_scrollBody' ? scroll : null,
        querySelectorAll: () => column.children,
      },
      injectArtifactCss() {},
      postToShell: (message) => messages.push(message),
      setTimeout: (callback) => timers.push(callback),
    }
    const start = source.indexOf('    function artifactSizeText(')
    const end = source.indexOf('\n    }', source.indexOf('    function renderArtifactShow(')) + 6
    assert.ok(start > 0 && end > start)
    vm.runInNewContext(source.slice(start, end), sandbox)
    for (const [mediaKind, tag] of [['image', 'img'], ['zip', 'div']]) {
      const data = { artifact: { path: `/tmp/${mediaKind}`, filename: mediaKind, mediaKind, zipImages: ['one.png'] }, urls: { file: 'https://media.test/file', entries: ['https://media.test/one.png'] } }
      sandbox.renderArtifactShow(data)
      const block = column.children.at(-1)
      const media = block.children[1]
      assert.equal(media.tag, tag)
      if (mediaKind === 'zip') assert.equal(media.children[0].src, data.urls.entries[0])
      else assert.equal(media.src, data.urls.file)
      if (['video', 'audio'].includes(mediaKind)) assert.equal(media.controls, true)
      block.children[0].listeners.click()
      assert.equal(messages.at(-1).path, data.artifact.path)
      sandbox.renderArtifactShow(data)
    }
    for (const mediaKind of ['file', 'video', 'audio', 'zip']) {
      sandbox.renderArtifactShow({ artifact: { path: `/tmp/hidden-${mediaKind}`, mediaKind }, urls: { file: 'https://media.test/file' } })
    }
    assert.equal(column.children.length, 2)
    assert.equal(scroll.scrollTop, 900)
    assert.equal(timers.length, 0)
  })
}

test('workspace header search stays on the product page while session navigation still works', () => {
  const upstream = readFileSync(resolve(root, 'node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js'), 'utf8')
  assert.ok(upstream.includes('"sectionHeader": "bhn1Oq_sectionHeader"'))
  const start = source.indexOf("      document.addEventListener('click', (event) => {")
  const end = source.indexOf('\n      })', start) + 9
  let click
  const messages = []
  class Element {
    constructor(classes) { this.classes = classes }
    closest(selector) { return selector.split(',').some((part) => this.classes.includes(part.trim().slice(1))) ? this : null }
  }
  vm.runInNewContext(source.slice(start, end), {
    Element,
    document: { addEventListener: (_type, callback) => { click = callback } },
    postToShell: (message) => messages.push(message),
  })
  for (const header of ['bhn1Oq_sectionHeader', 'qDHVXG_sectionHeader']) {
    click({ target: new Element(['hHd-Xa_regionArea', header]) })
    assert.equal(messages.length, 0)
  }
  click({ target: new Element(['hHd-Xa_regionArea']) })
  assert.equal(messages.at(-1).kind, 'session')
  click({ target: new Element(['hHd-Xa_newSession']) })
  assert.equal(messages.at(-1).kind, 'new')
})
