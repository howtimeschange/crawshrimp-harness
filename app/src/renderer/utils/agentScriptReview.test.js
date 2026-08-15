import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(here, '../views/AgentScriptReview.vue'), 'utf8')

test('script review surfaces isolated UI testing before approval', () => {
  assert.match(source, /v-if="testingTask"/)
  assert.match(source, /<TaskRunner[\s\S]*:adapter-id="testAdapterId"/)
  assert.match(source, /\/agent\/script-revisions\/\$\{selected\.value\.rev_id\}\/test-install/)
  assert.match(source, /selected\.value\?\.status === 'testing' && Boolean\(selected\.value\?\.test_adapter_id\)/)
})

test('script review keeps source files behind an explicit toggle', () => {
  assert.match(source, /const showSource = ref\(false\)/)
  assert.match(source, /v-if="showSource" class="package-files"/)
  assert.match(source, /查看源文件/)
  assert.match(source, /草稿还没有进入复核/)
})
