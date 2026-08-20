import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')

test('desktop build workflow runs on pull requests before merge', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/build-desktop.yml'), 'utf8')

  assert.match(workflow, /^  pull_request:/m)
})

test('desktop package scripts disable implicit publishing before npm parses extra arguments', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/build-desktop.yml'), 'utf8')
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'app/package.json'), 'utf8'))

  assert.match(packageJson.scripts['build:mac:ci'], /--publish=never/)
  assert.match(packageJson.scripts['build:win'], /--publish=never/)
  assert.doesNotMatch(workflow, /--publish(?:=|\s+)/)
})

test('desktop build workflow keeps default token permissions read-only', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/build-desktop.yml'), 'utf8')

  assert.match(workflow, /^permissions:\n  contents: read$/m)
  assert.doesNotMatch(workflow, /^permissions:\n  contents: write$/m)
})

test('desktop build release jobs request write permissions explicitly', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/build-desktop.yml'), 'utf8')

  assert.match(
    workflow,
    /prepare-version-release:[\s\S]*?permissions:\n      contents: write[\s\S]*?steps:/m,
  )
  assert.match(
    workflow,
    /build:[\s\S]*?permissions:\n      contents: write[\s\S]*?strategy:/m,
  )
  assert.match(
    workflow,
    /publish-version-release:[\s\S]*?permissions:\n      contents: write[\s\S]*?steps:/m,
  )
  assert.doesNotMatch(workflow, /publish-release:/)
})

test('desktop build workflow has no rolling desktop-latest release path', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/build-desktop.yml'), 'utf8')

  assert.doesNotMatch(workflow, /desktop-latest/)
  assert.doesNotMatch(workflow, /refs\/tags\/desktop-latest/)
})

test('desktop build workflow marks the validated version release as GitHub latest', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/build-desktop.yml'), 'utf8')

  assert.match(workflow, /TAG_VERSION="\$\{GITHUB_REF_NAME#v\}"[\s\S]*APP_VERSION[\s\S]*TAG_VERSION/)
  assert.match(workflow, /\[\[ "\$\{GITHUB_REF_NAME\}" =~ \^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$ \]\]/)
  assert.match(workflow, /gh release create "\$\{GITHUB_REF_NAME\}"[\s\S]*--draft[\s\S]*--latest=false[\s\S]*--verify-tag/)
  assert.match(workflow, /gh release view "\$\{GITHUB_REF_NAME\}" --json assets/)
  assert.match(workflow, /Unexpected release asset set/)
  assert.match(workflow, /gh release edit "\$\{GITHUB_REF_NAME\}"[\s\S]*--draft=false[\s\S]*--latest/)
  assert.doesNotMatch(workflow, /gh release create "\$\{GITHUB_REF_NAME\}"[\s\S]*--latest\s*\\[\s\S]*--verify-tag/)
})

test('desktop version release uploads build assets directly and validates release readback', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/build-desktop.yml'), 'utf8')
  const buildUploadStep = workflow.slice(
    workflow.indexOf('name: Upload release assets to GitHub Release'),
    workflow.indexOf('prepare-version-release:'),
  )
  const publishStep = workflow.slice(workflow.indexOf('name: Publish versioned release'))

  assert.match(buildUploadStep, /gh release upload "\$\{GITHUB_REF_NAME\}" "\$\{release_assets\[@\]\}" --clobber/)
  assert.match(workflow, /prepare-version-release:[\s\S]*gh release create "\$\{GITHUB_REF_NAME\}"[\s\S]*--draft[\s\S]*--verify-tag/)
  assert.match(workflow, /gh release download "\$\{GITHUB_REF_NAME\}" --dir release-downloads --clobber/)
  assert.match(workflow, /node app\/scripts\/validate-update-artifacts\.js release-assets --formal-release --version "\$\{APP_VERSION\}"/)
  assert.match(publishStep, /gh release view "\$\{GITHUB_REF_NAME\}" --json assets --jq '\.assets\[\]\.name'/)
  assert.doesNotMatch(workflow, /actions\/upload-artifact@v4/)
  assert.doesNotMatch(workflow, /actions\/download-artifact@v4/)
})

test('desktop version release fails asset mismatch before publishing', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/build-desktop.yml'), 'utf8')
  const publishStep = workflow.slice(workflow.indexOf('name: Publish versioned release'))
  const mismatchIndex = publishStep.indexOf('Unexpected release asset set')
  const editIndex = publishStep.indexOf('gh release edit "${GITHUB_REF_NAME}"')
  const uploadIndex = publishStep.indexOf('gh release upload "${GITHUB_REF_NAME}"')

  assert.ok(mismatchIndex !== -1, 'release mismatch failure is present')
  assert.ok(editIndex === -1 || mismatchIndex < editIndex, 'published mismatch fails before release edit')
  assert.equal(uploadIndex, -1, 'publish step does not upload assets after validation')
})

test('independent desktop publication uses only the validated version release', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/build-desktop.yml'), 'utf8')

  assert.match(workflow, /publish-version-release:[\s\S]*gh release edit "\$\{GITHUB_REF_NAME\}"[\s\S]*--draft=false[\s\S]*--latest/)
  assert.match(workflow, /publish-version-release:[\s\S]*needs:\s*build/)
  assert.doesNotMatch(workflow, /publish-cloudflare-r2:/)
  assert.doesNotMatch(workflow, /publish-release:/)
})
