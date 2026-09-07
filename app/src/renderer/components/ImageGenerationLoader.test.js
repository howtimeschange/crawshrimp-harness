import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sourceUrl = new URL('./ImageGenerationLoader.js', import.meta.url)

test('source-image loading regenerates into an indefinite mosaic instead of repeatedly revealing the old image', async () => {
  const source = await readFile(sourceUrl, 'utf8')

  assert.match(source, /triggerRegenerate\(\{ autoReveal: false \}\)/)
  assert.match(source, /effectMode === 'loading' && sources\.length/)
  assert.doesNotMatch(source, /autoReveal: effectMode === 'loading'/)
})
