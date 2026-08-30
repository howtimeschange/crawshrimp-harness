import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'

test('Crawshrimp main menu toggle points down to expand and up to collapse', async () => {
  const slotsSource = await readFile(
    new URL('../../../../integrations/deepseek-harness/crawshrimp-slots/lib/client.js', import.meta.url),
    'utf8',
  )

  assert.match(slotsSource, /\.cs-nav-toggle \.cs-nav-icon \{[\s\S]*font-size: 0;/)
  assert.match(slotsSource, /\.cs-nav-toggle \.cs-nav-icon::before \{[\s\S]*border-top: 4\.5px solid currentColor;/)
  assert.match(slotsSource, /\.cs-nav-toggle\[aria-expanded="true"\] \.cs-nav-icon \{ transform: rotate\(180deg\); \}/)
  assert.match(slotsSource, /icon\.setAttribute\('aria-hidden', 'true'\)/)
  assert.match(slotsSource, /icon\.textContent !== ''\) icon\.textContent = ''/)
})
