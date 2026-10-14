const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const YAML = require('yaml')

const appRoot = path.join(__dirname, '..')
const packageJson = require('../package.json')

function readBuildConfig() {
  return YAML.parse(fs.readFileSync(path.join(appRoot, 'build.yml'), 'utf8'))
}

test('renderer-only packages stay out of production dependencies', () => {
  const rendererOnlyPackages = [
    '@tabler/icons-vue',
    '@tldraw/assets',
    'css-tree',
    'dompurify',
    'highlight.js',
    'img-fx',
    'markdown-it',
    'pdfjs-dist',
    'react',
    'react-dom',
    'three',
    'tldraw',
  ]

  for (const name of rendererOnlyPackages) {
    assert.equal(packageJson.dependencies[name], undefined, `${name} must not be installed by production pruning`)
    assert.ok(packageJson.devDependencies[name], `${name} must remain available to Vite renderer builds`)
  }

  for (const name of [
    '@supabase/supabase-js',
    'electron-updater',
    'portfinder',
    'semver',
    'tesseract.js',
    'yaml',
    'yauzl',
  ]) {
    assert.ok(packageJson.dependencies[name], `${name} must remain available at runtime`)
  }
})

test('build config prunes sourcemaps but keeps bundled renderer worker assets', () => {
  const config = readBuildConfig()
  const excludedRendererAssets = config.files.filter((pattern) => pattern.startsWith('!dist/renderer/'))

  assert.ok(config.files.includes('dist/renderer/**/*'), 'renderer bundle must be packaged')
  assert.ok(config.files.includes('!dist/renderer/**/*.map'), 'renderer sourcemaps must be excluded')
  assert.ok(config.files.includes('!node_modules/**/*.map'), 'published node_modules sourcemaps must be excluded')
  assert.deepEqual(excludedRendererAssets, ['!dist/renderer/**/*.map'], 'PDF worker cmaps/fonts/wasm assets must remain packaged')
})

test('OCR vendor ships once as a shared asset while adapter sources stay exportable', () => {
  const config = readBuildConfig()
  const adaptersResource = config.extraResources.find((resource) => resource.to === 'python-scripts/adapters')
  const sharedTesseract = config.extraResources.find((resource) => resource.to === 'python-scripts/shared-assets/tesseract')

  assert.equal(adaptersResource.from, '../adapters')
  assert.ok(adaptersResource.filter.includes('**/*'), 'adapter source files must remain available for standalone export')
  assert.ok(adaptersResource.filter.includes('!tmall-ops-assistant/vendor/tesseract/**'))
  assert.ok(adaptersResource.filter.includes('!vipshop-ops-assistant/vendor/tesseract/**'))

  assert.equal(sharedTesseract.from, '../adapters/tmall-ops-assistant/vendor/tesseract')
  assert.ok(sharedTesseract.filter.includes('**/*'), 'shared OCR copy must include LICENSE and runtime assets')
})
