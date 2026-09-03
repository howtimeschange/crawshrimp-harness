const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const helperUrl = pathToFileURL(path.join(
  __dirname,
  '..',
  '..',
  'integrations',
  'deepseek-harness',
  'scripts',
  'stage-runtime-platform.mjs',
)).href

test('Windows CI keeps the staged runtime boot check enabled', async () => {
  const { shouldSkipBootCheck } = await import(helperUrl)

  assert.equal(shouldSkipBootCheck({ args: [], platform: 'win32', ci: 'true' }), false)
  assert.equal(shouldSkipBootCheck({ args: ['--skip-boot-check'], platform: 'win32', ci: 'true' }), true)
})

test('stage runtime resolves the real Electron executable instead of a Windows cmd shim', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-electron-runtime-'))

  try {
    const electronRoot = path.join(tmp, 'node_modules', 'electron')
    const electronExe = path.join(electronRoot, 'dist', 'electron.exe')
    fs.mkdirSync(path.dirname(electronExe), { recursive: true })
    fs.writeFileSync(path.join(electronRoot, 'path.txt'), 'electron.exe\r\n')
    fs.writeFileSync(electronExe, '')

    const { resolveElectronExecutable } = await import(helperUrl)
    assert.equal(resolveElectronExecutable(tmp), electronExe)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('stage runtime rejects an Electron path that escapes the package dist directory', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-electron-runtime-'))

  try {
    const electronRoot = path.join(tmp, 'node_modules', 'electron')
    fs.mkdirSync(electronRoot, { recursive: true })
    fs.writeFileSync(path.join(electronRoot, 'path.txt'), '../../outside.exe\n')

    const { resolveElectronExecutable } = await import(helperUrl)
    assert.equal(resolveElectronExecutable(tmp), '')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('stage runtime lets the Electron package repair a missing downloaded executable', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-electron-runtime-'))

  try {
    const electronExe = path.join(tmp, 'node_modules', 'electron', 'dist', 'electron')
    fs.mkdirSync(path.dirname(electronExe), { recursive: true })
    fs.writeFileSync(electronExe, '')

    const { resolveElectronExecutable } = await import(helperUrl)
    assert.equal(
      resolveElectronExecutable(tmp, { loadElectron: () => electronExe }),
      electronExe,
    )
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('stage runtime rejects an Electron loader result outside the package dist directory', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crawshrimp-electron-runtime-'))

  try {
    const outsideExe = path.join(tmp, 'outside-electron')
    fs.writeFileSync(outsideExe, '')

    const { resolveElectronExecutable } = await import(helperUrl)
    assert.equal(
      resolveElectronExecutable(tmp, { loadElectron: () => outsideExe }),
      '',
    )
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('Windows staging records its target and requires Windows x64 native dependencies', async () => {
  const {
    getRequiredNativeRuntimePackages,
    isCrossStageTarget,
    normalizeStageTarget,
    parseStageTarget,
    stageTargetKey,
    targetInstallEnvironment,
  } = await import(helperUrl)
  const target = { platform: 'win32', arch: 'x64' }

  assert.match(stageTargetKey(target), /win32-x64/)
  assert.deepEqual(getRequiredNativeRuntimePackages(target), [
    { packagePath: '@img/sharp-win32-x64', artifactExtension: '.node' },
    { packagePath: '@koromix/koffi-win32-x64', artifactExtension: '.node' },
    { packagePath: '@vscode/ripgrep-win32-x64', artifactName: 'rg.exe' },
  ])
})

test('staging parses explicit macOS targets and selects target-specific npm optional dependencies', async () => {
  const { parseStageTarget, targetInstallEnvironment, isCrossStageTarget, runtimeInstallArgs } = await import(helperUrl)
  const target = parseStageTarget(['--target=darwin-x64'], { platform: 'darwin', arch: 'arm64' })

  assert.deepEqual(target, { platform: 'darwin', arch: 'x64' })
  assert.equal(isCrossStageTarget(target, { platform: 'darwin', arch: 'arm64' }), true)
  assert.deepEqual(targetInstallEnvironment(target, { PATH: '/usr/bin' }), {
    PATH: '/usr/bin',
    npm_config_platform: 'darwin',
    npm_config_arch: 'x64',
    npm_config_os: 'darwin',
    npm_config_cpu: 'x64',
  })
  assert.deepEqual(runtimeInstallArgs({ crossTarget: true }), [
    'ci', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts',
  ])
  assert.deepEqual(runtimeInstallArgs({ crossTarget: false }), [
    'ci', '--omit=dev', '--no-audit', '--no-fund',
  ])
})

test('staging rejects unsafe or unsupported target values', async () => {
  const { normalizeStageTarget, parseStageTarget } = await import(helperUrl)

  assert.throws(() => normalizeStageTarget({ platform: '../../tmp', arch: 'x64' }), /unsupported staging platform/)
  assert.throws(() => parseStageTarget(['--target', 'darwin'], { platform: 'darwin', arch: 'arm64' }), /expected <platform>-<arch>/)
})
