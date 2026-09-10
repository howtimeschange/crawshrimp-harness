const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { patchOsxSign } = require('./patch-osx-sign')

test('signing traversal handles a large resource tree with a low descriptor limit', () => {
  patchOsxSign()
  const utilPath = path.join(path.dirname(require.resolve('@electron/osx-sign')), 'util.js')
  const once = fs.readFileSync(utilPath, 'utf8')
  patchOsxSign()
  assert.equal(fs.readFileSync(utilPath, 'utf8'), once)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sign-walk-'))
  try {
    for (let i = 0; i < 1000; i++) fs.writeFileSync(path.join(root, `${i}.py`), 'print("hello")')
    const bundle = path.join(root, 'Nested.app')
    fs.mkdirSync(bundle)
    const binary = path.join(bundle, 'native')
    fs.writeFileSync(binary, Buffer.from([0xfe, 0xed, 0xfa, 0xcf, 0, 0, 0, 0]))
    fs.writeFileSync(path.join(root, 'old.cstemp'), 'temporary')
    const script = `require(${JSON.stringify(utilPath)}).walkAsync(process.argv[1]).then(paths => console.log(JSON.stringify(paths))).catch(e => { console.error(e); process.exit(1) })`
    const result = process.platform === 'win32'
      ? spawnSync(process.execPath, ['-e', script, root], { encoding: 'utf8' })
      : spawnSync('/bin/sh', ['-c', 'ulimit -n 128; exec "$@"', 'sign-test', process.execPath, '-e', script, root], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), [binary, bundle])
    assert.equal(fs.existsSync(path.join(root, 'old.cstemp')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
