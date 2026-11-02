import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const sourceUrl = new URL('./imageGenerationReact.js', import.meta.url)

test('source-image loading regenerates into an indefinite mosaic instead of repeatedly revealing the old image', async () => {
  const source = await readFile(sourceUrl, 'utf8')

  assert.match(source, /triggerRegenerate\(\{ autoReveal: false \}\)/)
  assert.match(source, /effectMode === 'loading' && sources\.length/)
  assert.doesNotMatch(source, /autoReveal: effectMode === 'loading'/)
})

test('WebGL support probing releases its context and reuses successful detection', async () => {
  const source = await readFile(sourceUrl, 'utf8')
  const script = source.slice(source.indexOf('let webGLAvailable'), source.indexOf('class ImageGenerationErrorBoundary'))
  let created = 0, released = 0
  const scope = { document: { createElement() { created++; return { getContext: () => ({ getExtension: () => ({ loseContext() { released++ } }) }) } } } }
  vm.runInNewContext(script + '\nglobalThis.probe = supportsWebGL', scope)
  for (let i = 0; i < 100; i++) assert.equal(scope.probe(), true)
  assert.equal(created, 1); assert.equal(released, 1)
})

test('temporary WebGL failure is retried and optional context release cannot disable effects', async () => {
  const source = await readFile(sourceUrl, 'utf8')
  const script = source.slice(source.indexOf('let webGLAvailable'), source.indexOf('class ImageGenerationErrorBoundary'))
  let available = false
  const scope = { document: { createElement: () => ({ getContext: () => available ? { getExtension() { throw Error('unsupported extension') } } : null }) } }
  vm.runInNewContext(script + '\nglobalThis.probe = supportsWebGL', scope)
  assert.equal(scope.probe(), false)
  available = true; assert.equal(scope.probe(), true); assert.equal(scope.probe(), true)
})
