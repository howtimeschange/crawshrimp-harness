const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { prunePackagedRuntime } = require('./prune-packaged-runtime')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-prune-runtime-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function writeFile(filePath, content = 'x') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function mkdir(directory) {
  fs.mkdirSync(directory, { recursive: true })
}

test('prunePackagedRuntime removes packaged Python tests without deleting runtime bytecode caches', t => {
  const resources = fixture(t)
  writeFile(path.join(resources, 'python', 'Lib', 'site-packages', 'fastapi', '__pycache__', 'routing.cpython-312.pyc'))
  writeFile(path.join(resources, 'python', 'Lib', 'site-packages', 'fastapi', 'tests', 'test_routing.py'))
  writeFile(path.join(resources, 'python', 'Lib', 'site-packages', 'fastapi', 'tests', '__pycache__', 'test_routing.cpython-312.pyc'))
  writeFile(path.join(resources, 'python', 'Lib', 'site-packages', 'fastapi.pdb'))
  writeFile(path.join(resources, 'python', 'Include', 'Python.h'))
  writeFile(path.join(resources, 'python', 'Lib', 'site-packages', 'numpy', 'core', 'include', 'numpy', 'arrayobject.h'))

  const result = prunePackagedRuntime(resources, { platform: 'win32', arch: 'x64' })

  assert.equal(fs.existsSync(path.join(resources, 'python', 'Lib', 'site-packages', 'fastapi', 'tests')), false)
  assert.equal(fs.existsSync(path.join(resources, 'python', 'Lib', 'site-packages', 'fastapi', '__pycache__', 'routing.cpython-312.pyc')), true)
  assert.equal(fs.existsSync(path.join(resources, 'python', 'Lib', 'site-packages', 'fastapi.pdb')), false)
  assert.equal(fs.existsSync(path.join(resources, 'python', 'Include')), false)
  assert.equal(fs.existsSync(path.join(resources, 'python', 'Lib', 'site-packages', 'numpy', 'core', 'include', 'numpy', 'arrayobject.h')), true)
  assert.ok(result.removed.some(entry => entry.reason === 'python-test-directory'))
  assert.ok(result.bytes > 0)
})

test('prunePackagedRuntime removes harness maps, type declarations, test directories, and debug symbols', t => {
  const resources = fixture(t)
  const harness = path.join(resources, 'deepseek-harness')
  writeFile(path.join(harness, 'worker', 'worker.mjs'), 'export const ok = true\n')
  writeFile(path.join(harness, 'worker', 'worker.mjs.map'), '{}')
  writeFile(path.join(harness, 'worker', 'types.d.ts'), 'export {}\n')
  writeFile(path.join(harness, 'worker', 'types.d.mts'), 'export {}\n')
  writeFile(path.join(harness, 'worker', 'types.d.cts'), 'export {}\n')
  writeFile(path.join(harness, 'worker', 'module.ts'), 'export const runtimeSource = true\n')
  writeFile(path.join(harness, 'skills', 'cli', 'DeepDrawCLI', 'tests', 'docs.test.ts'), 'test\n')
  writeFile(path.join(harness, 'skills', 'suanming', 'tests', 'test_bazi.py'), 'test\n')
  writeFile(path.join(harness, 'skills', 'suanming', 'tests', 'fixtures', 'jiang_jieshi.json'), '{"expected":true}\n')
  writeFile(path.join(harness, 'node_modules', 'pkg', '__tests__', 'index.test.js'), 'test\n')
  writeFile(path.join(harness, 'node_modules', 'pkg', 'LICENSE'), 'license\n')
  writeFile(path.join(harness, 'node_modules', 'pkg', 'binding.pdb'), 'debug\n')
  writeFile(path.join(harness, 'skills', 'crawshrimp-product-guide', 'references', 'examples', 'demo.test.js'), 'doc example\n')
  writeFile(path.join(harness, 'skills', 'crawshrimp-product-guide', 'knowledge', 'test', 'case.md'), 'keep docs\n')

  prunePackagedRuntime(resources, { platform: 'darwin', arch: 'arm64' })

  assert.equal(fs.existsSync(path.join(harness, 'worker', 'worker.mjs')), true)
  assert.equal(fs.existsSync(path.join(harness, 'worker', 'module.ts')), true)
  assert.equal(fs.existsSync(path.join(harness, 'node_modules', 'pkg', 'LICENSE')), true)
  assert.equal(fs.existsSync(path.join(harness, 'worker', 'worker.mjs.map')), false)
  assert.equal(fs.existsSync(path.join(harness, 'worker', 'types.d.ts')), false)
  assert.equal(fs.existsSync(path.join(harness, 'worker', 'types.d.mts')), false)
  assert.equal(fs.existsSync(path.join(harness, 'worker', 'types.d.cts')), false)
  assert.equal(fs.existsSync(path.join(harness, 'skills', 'cli', 'DeepDrawCLI', 'tests')), false)
  assert.equal(fs.existsSync(path.join(harness, 'skills', 'suanming', 'tests', 'test_bazi.py')), true)
  assert.equal(fs.existsSync(path.join(harness, 'skills', 'suanming', 'tests', 'fixtures', 'jiang_jieshi.json')), true)
  assert.equal(fs.existsSync(path.join(harness, 'node_modules', 'pkg', '__tests__')), false)
  assert.equal(fs.existsSync(path.join(harness, 'node_modules', 'pkg', 'binding.pdb')), false)
  assert.equal(fs.existsSync(path.join(harness, 'skills', 'crawshrimp-product-guide', 'references', 'examples', 'demo.test.js')), true)
  assert.equal(fs.existsSync(path.join(harness, 'skills', 'crawshrimp-product-guide', 'knowledge', 'test', 'case.md')), true)
})

test('prunePackagedRuntime keeps only the matching node-pty prebuild target', t => {
  const resources = fixture(t)
  const prebuilds = path.join(resources, 'deepseek-harness', 'node_modules', 'node-pty', 'prebuilds')
  writeFile(path.join(prebuilds, 'darwin-arm64', 'node.napi.node'))
  writeFile(path.join(prebuilds, 'darwin-x64', 'node.napi.node'))
  writeFile(path.join(prebuilds, 'win32-x64', 'node.napi.node'))
  writeFile(path.join(resources, 'deepseek-harness', 'node_modules', '@img', 'sharp-wasm32', 'sharp.wasm'))

  prunePackagedRuntime(resources, { platform: 'darwin', arch: 'arm64' })

  assert.equal(fs.existsSync(path.join(prebuilds, 'darwin-arm64', 'node.napi.node')), true)
  assert.equal(fs.existsSync(path.join(prebuilds, 'darwin-x64')), false)
  assert.equal(fs.existsSync(path.join(prebuilds, 'win32-x64')), false)
  assert.equal(fs.existsSync(path.join(resources, 'deepseek-harness', 'node_modules', '@img', 'sharp-wasm32', 'sharp.wasm')), true)
})

test('prunePackagedRuntime does not follow symlinks out of packaged resources', t => {
  const resources = fixture(t)
  const source = fixture(t)
  writeFile(path.join(source, 'tests', 'source.test.js'), 'source\n')
  mkdir(path.join(resources, 'deepseek-harness'))
  try {
    fs.symlinkSync(path.join(source, 'tests'), path.join(resources, 'deepseek-harness', 'tests'), 'dir')
  } catch (error) {
    t.skip(`symlinks unavailable: ${error.code || error.message}`)
    return
  }

  prunePackagedRuntime(resources, { platform: 'darwin', arch: 'x64' })

  assert.equal(fs.lstatSync(path.join(resources, 'deepseek-harness', 'tests')).isSymbolicLink(), true)
  assert.equal(fs.existsSync(path.join(source, 'tests', 'source.test.js')), true)
})

test('prunePackagedRuntime validates target metadata before pruning', t => {
  const resources = fixture(t)

  assert.throws(
    () => prunePackagedRuntime(resources, { platform: 'linux', arch: 'x64' }),
    /unsupported platform/
  )
  assert.throws(
    () => prunePackagedRuntime(resources, { platform: 'win32', arch: 'arm64' }),
    /unsupported Windows arch/
  )
})
