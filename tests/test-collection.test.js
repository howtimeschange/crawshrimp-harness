const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

test('collection includes nested app tests and detects unsupported new test locations', async () => {
  const { collect, uncollected } = await import('../scripts/test-collection.mjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test-collection-'))
  const write = file => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), '')
  }
  try {
    write('app/src/renderer/components/nested/example.test.js')
    write('app/src/renderer/example.test.mjs')
    write('tests/test_example.py')
    assert.equal(collect('app', root).length, 2)
    assert.equal(collect('python', root).length, 1)
    assert.deepEqual(uncollected(root), [])
    write('skills/cli/new-cli/tests/uncollected.test.ts')
    write('app/scripts/new-smoke.cjs')
    assert.deepEqual(uncollected(root).sort(), [
      'app/scripts/new-smoke.cjs', 'skills/cli/new-cli/tests/uncollected.test.ts',
    ])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('workflow guard rejects removing a required suite step', async () => {
  const { root, verifyWorkflow } = await import('../scripts/test-collection.mjs')
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-collection-'))
  try {
    fs.mkdirSync(path.join(temporary, '.github/workflows'), { recursive: true })
    fs.symlinkSync(path.join(root, 'app'), path.join(temporary, 'app'))
    fs.symlinkSync(path.join(root, 'skills'), path.join(temporary, 'skills'))
    const workflow = fs.readFileSync(path.join(root, '.github/workflows/build-desktop.yml'), 'utf8')
    fs.writeFileSync(path.join(temporary, '.github/workflows/build-desktop.yml'), workflow)
    verifyWorkflow(temporary)
    fs.writeFileSync(path.join(temporary, '.github/workflows/build-desktop.yml'), workflow.replace('node scripts/test-collection.mjs run integrations', 'echo omitted'))
    assert.throws(() => verifyWorkflow(temporary), /CI does not run suite integrations/)
    fs.writeFileSync(path.join(temporary, '.github/workflows/build-desktop.yml'), workflow.replace('run: node integrations/deepseek-harness/scripts/patch-runtime-dependencies.mjs', 'run: echo omitted'))
    assert.throws(() => verifyWorkflow(temporary), /CI must patch DSH runtime before integration tests/)
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
})
