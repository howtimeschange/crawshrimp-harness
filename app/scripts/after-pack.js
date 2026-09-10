/**
 * after-pack.js — electron-builder afterPack hook
 *
 * Copies the correct Python interpreter for each platform/arch
 * into Resources/python/ after Electron is packaged.
 *
 * Expected python-dist/ layout (inside app/):
 *   python-dist/
 *     mac-arm64/   macOS arm64
 *     mac-x64/     macOS x64
 *     win-x64/     Windows x64
 *
 * Download with: app/scripts/download-python.sh
 */

const fs   = require('fs')
const path = require('path')

const REQUIRED_BACKEND_IMPORTS = [
  'fastapi',
  'uvicorn',
  'websockets',
  'yaml',
  'apscheduler',
  'docx',
  'pptx',
  'pandas',
  'matplotlib',
  'openpyxl',
  'xlrd',
  'pydantic',
  'aiofiles',
  'jsonschema',
  'tzdata',
  'PIL',
  'fitz',
  'cryptography',
  'mcp',
]

const REQUIRED_WINDOWS_BACKEND_PATHS = [
  'pywinauto',
  'comtypes',
  'psutil',
  'colorama',
  'win32/lib/pywintypes.py',
  'win32/lib/win32con.py',
  'win32/lib/ntsecuritycon.py',
  'win32/win32api.pyd',
  'win32/win32security.pyd',
  'pywin32_system32/pywintypes312.dll',
  'pywin32.pth',
]

const REQUIRED_VIDEO_INTEGRATION_FILES = [
  'seedanceCLI/package.json',
  'seedanceCLI/bin/seedance.js',
  'seedanceCLI/src/ark-client.js',
  'seedanceCLI/src/config.js',
  'bailianCLI/package.json',
  'bailianCLI/bin/bailian.js',
  'bailianCLI/src/bailian-client.js',
  'bailianCLI/src/config.js',
]

const REQUIRED_DEEPSEEK_HARNESS_FILES = [
  'skills/crawshrimp-computer-use/SKILL.md',
  'skills/crawshrimp-computer-use/scripts/computer_use.py',
  'worker/builtin-runtime.cjs',
  'skills/dws/SKILL.md',
  'skills/dws/LICENSE',
  'skills/cli/manifest.json',
  'skills/cli/dws/runtime.json',
  'skills/cli/dws/LICENSE',
  'skills/cli/dws/NOTICE',
  'package.json',
  'node_modules/@deepseek-ai/dsh/lib/bin.js',
  'node_modules/@deepseek-ai/dsh-web-app/package.json',
  'node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml',
  'node_modules/@deepseek-ai/dsh-api-workspace-controller/package.json',
  'node_modules/@deepseek-ai/dsh-cordis-host-runner/package.json',
  'node_modules/@deepseek-ai/dsh-attachment-local/package.json',
  'node_modules/@deepseek-ai/dsh-llm-pi-ai/package.json',
  'node_modules/@deepseek-ai/dsh-time-context/package.json',
  'node_modules/@deepseek-ai/dsh-schedule/package.json',
  'node_modules/@deepseek-ai/dsh-acp-app/cordis.patch.yml',
  'node_modules/@deepseek-ai/dsh-acp-app/node_modules/@deepseek-ai/dsh-acp/package.json',
  'node_modules/crawshrimp-slots/lib/client.js',
  'node_modules/crawshrimp-product-bridge/lib/index.js',
  'node_modules/@xmanrui/dsh-im/lib/index.js',
  'node_modules/@xmanrui/dsh-im/lib/client.js',
  'worker/worker.mjs',
  'worker/native-web-follow-manager.mjs',
  'worker/web-rpc-client.mjs',
  'profiles/web/cordis.yml',
  'profiles/web/cordis.patch.yml',
  'profiles/web/node_modules/@xmanrui/dsh-im/package.json',
  'profiles/web/node_modules/crawshrimp-product-bridge/lib/index.js',
  'profiles/web/node_modules/crawshrimp-slots/lib/client.js',
]

const DEEPSEEK_RUNTIME_TARGET_MARKER = '.crawshrimp-runtime-target.json'

function getPythonExecutable(srcPython, srcKey = '') {
  if (srcKey === 'win-x64') return path.join(srcPython, 'python.exe')
  if (srcKey === 'mac-arm64' || srcKey === 'mac-x64') return path.join(srcPython, 'bin', 'python3')
  return null
}

function getSitePackagesDir(srcPython, srcKey = '') {
  if (srcKey === 'win-x64') return path.join(srcPython, 'Lib', 'site-packages')
  if (srcKey === 'mac-arm64' || srcKey === 'mac-x64') return path.join(srcPython, 'lib', 'python3.12', 'site-packages')
  return null
}

function requirePythonBundle(srcPython, srcKey = '') {
  if (!fs.existsSync(srcPython)) {
    throw new Error(
      `[after-pack] bundled Python not found at ${srcPython}. ` +
      'Run app/scripts/download-python.sh before building the desktop package.'
    )
  }

  const executable = getPythonExecutable(srcPython, srcKey)
  if (executable && !fs.existsSync(executable)) {
    throw new Error(`[after-pack] bundled Python executable not found: ${executable}`)
  }

  const sitePackages = getSitePackagesDir(srcPython, srcKey)
  if (!sitePackages) return
  if (!fs.existsSync(sitePackages)) {
    throw new Error(`[after-pack] bundled Python site-packages not found: ${sitePackages}`)
  }

  const requiredPaths = srcKey === 'win-x64'
    ? [...REQUIRED_BACKEND_IMPORTS, ...REQUIRED_WINDOWS_BACKEND_PATHS]
    : REQUIRED_BACKEND_IMPORTS
  const missing = requiredPaths.filter(name => !fs.existsSync(path.join(sitePackages, name)))
  if (missing.length) {
    throw new Error(
      `[after-pack] missing bundled Python dependencies in ${sitePackages}: ${missing.join(', ')}. ` +
      'Run app/scripts/download-python.sh to refresh python-dist.'
    )
  }
}

function requireAdapterManifests(adaptersDir) {
  if (!fs.existsSync(adaptersDir)) {
    throw new Error(`[after-pack] bundled adapter manifest not found under ${adaptersDir}`)
  }
  let adapterCount = 0
  for (const entry of fs.readdirSync(adaptersDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    adapterCount += 1
    const adapterDir = path.join(adaptersDir, entry.name)
    const manifestPath = path.join(adapterDir, 'manifest.yaml')
    try {
      fs.accessSync(adapterDir, fs.constants.R_OK)
      fs.accessSync(manifestPath, fs.constants.R_OK)
      if (!fs.statSync(manifestPath).isFile()) {
        throw new Error('manifest.yaml is not a file')
      }
    } catch (e) {
      throw new Error(`[after-pack] adapter ${entry.name} missing manifest.yaml or unreadable: ${e.message}`)
    }
  }
  if (!adapterCount) {
    throw new Error(`[after-pack] bundled adapter manifest not found under ${adaptersDir}`)
  }
}

function requirePythonScriptsBundle(resourcesPath) {
  const scriptsDir = path.join(resourcesPath, 'python-scripts')
  const apiServer = path.join(scriptsDir, 'core', 'api_server.py')
  if (!fs.existsSync(apiServer)) {
    throw new Error(`[after-pack] bundled backend api_server.py not found: ${apiServer}`)
  }

  const adaptersDir = path.join(scriptsDir, 'adapters')
  requireAdapterManifests(adaptersDir)

  const integrationsDir = path.join(scriptsDir, 'integrations')
  const missingIntegrations = REQUIRED_VIDEO_INTEGRATION_FILES.filter(relativePath => {
    const target = path.join(integrationsDir, relativePath)
    return !fs.existsSync(target) || !fs.statSync(target).isFile()
  })
  if (missingIntegrations.length) {
    throw new Error(
      `[after-pack] shared video integration files are missing under ${integrationsDir}: ` +
      missingIntegrations.join(', ')
    )
  }
}

function nativeRuntimePackageSpecs({ platform, arch }) {
  const suffix = `${platform}-${arch}`
  return [
    { packagePath: `@img/sharp-${suffix}`, artifactExtension: '.node' },
    { packagePath: `@koromix/koffi-${suffix}`, artifactExtension: '.node' },
    {
      packagePath: `@vscode/ripgrep-${suffix}`,
      artifactName: platform === 'win32' ? 'rg.exe' : 'rg',
    },
  ]
}

function packageContainsArtifact(packageRoot, spec) {
  if (!fs.existsSync(packageRoot)) return false
  const pending = [packageRoot]
  while (pending.length) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) {
        pending.push(target)
      } else if (entry.isFile()) {
        if (spec.artifactName && entry.name === spec.artifactName) return true
        if (spec.artifactExtension && entry.name.endsWith(spec.artifactExtension)) return true
      }
    }
  }
  return false
}

function requireNativeRuntimePackages(bundleRoot, target) {
  for (const spec of nativeRuntimePackageSpecs(target)) {
    const packageRoot = path.join(bundleRoot, 'node_modules', ...spec.packagePath.split('/'))
    if (!packageContainsArtifact(packageRoot, spec)) {
      throw new Error(
        `[after-pack] deepseek-harness ${target.platform}-${target.arch} 原生依赖缺失: ${spec.packagePath}`
      )
    }
  }
}

function requireDeepseekHarnessBundle(resourcesPath, expectedTarget = {}) {
  const bundleRoot = path.join(resourcesPath, 'deepseek-harness')
  if (!fs.existsSync(bundleRoot)) {
    throw new Error(`[after-pack] deepseek-harness bundle 未打包: ${bundleRoot}`)
  }
  if (expectedTarget.platform) {
    const targetMarker = path.join(bundleRoot, DEEPSEEK_RUNTIME_TARGET_MARKER)
    let actualTarget
    try {
      actualTarget = JSON.parse(fs.readFileSync(targetMarker, 'utf8'))
    } catch (error) {
      throw new Error(`[after-pack] deepseek-harness target metadata missing or invalid: ${targetMarker}: ${error.message}`)
    }
    const actualId = `${actualTarget.platform || 'unknown'}-${actualTarget.arch || 'unknown'}`
    const expectedId = expectedTarget.arch
      ? `${expectedTarget.platform}-${expectedTarget.arch}`
      : expectedTarget.platform
    const mismatch = actualTarget.platform !== expectedTarget.platform ||
      (expectedTarget.arch && actualTarget.arch !== expectedTarget.arch)
    if (mismatch) {
      throw new Error(`[after-pack] deepseek-harness target ${actualId} does not match ${expectedId}`)
    }
  }
  const missing = REQUIRED_DEEPSEEK_HARNESS_FILES.filter(relativePath => {
    const target = path.join(bundleRoot, relativePath)
    return !fs.existsSync(target) || !fs.statSync(target).isFile()
  })
  if (expectedTarget.platform === 'darwin' && !fs.existsSync(path.join(bundleRoot, 'skills/crawshrimp-computer-use/scripts/native/mac'))) {
    missing.push('skills/crawshrimp-computer-use/scripts/native/mac')
  }
  if (missing.length) {
    throw new Error(
      `[after-pack] deepseek-harness bundle 不完整,缺少: ${missing.join(', ')}。` +
      '请先运行 node integrations/deepseek-harness/scripts/stage-runtime.mjs。'
    )
  }
  if (expectedTarget.platform && expectedTarget.arch) {
    const dwsRoot = path.join(bundleRoot, 'skills', 'cli', 'dws')
    const dwsBinary = path.join(dwsRoot, 'bin', expectedTarget.platform === 'win32' ? 'dws.exe' : 'dws')
    if (!fs.existsSync(dwsBinary)) throw new Error(`[after-pack] DWS executable missing: ${dwsBinary}`)
    const dws = JSON.parse(fs.readFileSync(path.join(dwsRoot, 'runtime.json'), 'utf8'))
    if (dws.target?.platform !== expectedTarget.platform || dws.target?.arch !== expectedTarget.arch) {
      throw new Error('[after-pack] DWS target does not match package target')
    }
    requireNativeRuntimePackages(bundleRoot, expectedTarget)
  }
}

function deepseekHarnessStageKey(electronPlatformName, archName) {
  return `${electronPlatformName}-${archName}`
}

async function afterPack(context) {
  const { electronPlatformName, arch, appOutDir } = context
  // arch: 0=ia32, 1=x64, 2=armv7l, 3=arm64
  const archName = arch === 3 ? 'arm64' : 'x64'

  let srcKey
  if (electronPlatformName === 'darwin') {
    srcKey = archName === 'arm64' ? 'mac-arm64' : 'mac-x64'
  } else if (electronPlatformName === 'win32') {
    srcKey = 'win-x64'
  } else {
    console.log(`[after-pack] skip unsupported platform: ${electronPlatformName}`)
    return
  }

  const scriptDir = path.dirname(__dirname)  // app/
  const srcPython = path.join(scriptDir, 'python-dist', srcKey)
  requirePythonBundle(srcPython, srcKey)
  const pythonLock = fs.readFileSync(path.join(scriptDir, '..', 'runtime-locks/python', `${srcKey}-py312.txt`))
  const installedLock = path.join(srcPython, '.crawshrimp-python.lock')
  if (!fs.existsSync(installedLock) || !pythonLock.equals(fs.readFileSync(installedLock))) throw new Error('[after-pack] Python bundle lock mismatch; rebuild bundled Python')
  const officeSource = path.join(scriptDir, '..', 'build-staging', 'office', srcKey)
  const officeManifestPath = path.join(officeSource, 'runtime.json')
  if (!fs.existsSync(officeManifestPath)) throw new Error(`[after-pack] Office runtime missing: ${officeManifestPath}`)
  const officeManifest = JSON.parse(fs.readFileSync(officeManifestPath, 'utf8'))
  if (officeManifest.target !== srcKey || officeManifest.stagingVersion !== 2) throw new Error('[after-pack] Office runtime target/staging version mismatch; restage resources')
  const hash = value => require('crypto').createHash('sha256').update(value).digest('hex')
  const lockPath = path.join(scriptDir, '..', 'runtime-locks', 'office-assets.json')
  if (officeManifest.fingerprint !== hash(fs.readFileSync(lockPath))) throw new Error('[after-pack] Office asset lock changed; restage resources')
  const assetLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  for (const entry of [officeManifest.executable, ...officeManifest.fonts]) {
    const itemPath = path.resolve(officeSource, entry.path)
    if (!itemPath.startsWith(path.resolve(officeSource) + path.sep) || !fs.existsSync(itemPath) || hash(fs.readFileSync(itemPath)) !== entry.sha256) throw new Error(`[after-pack] Office resource verification failed: ${entry.path}`)
  }
  for (const font of assetLock.fonts) {
    const bundledFont = path.join(officeSource, assetLock.targets[srcKey].fontDirectory, font.filename)
    if (!fs.existsSync(bundledFont) || hash(fs.readFileSync(bundledFont)) !== font.sha256) throw new Error(`[after-pack] LibreOffice font copy missing or changed: ${font.filename}`)
  }

  let resourcesPath
  if (electronPlatformName === 'darwin') {
    resourcesPath = path.join(
      appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents', 'Resources'
    )
  } else {
    resourcesPath = path.join(appOutDir, 'resources')
  }

  requirePythonScriptsBundle(resourcesPath)

  // DeepSeek Harness:与 Python 同模式 —— stage 脚本编排生产闭包,
  // afterPack 负责拷入 Resources 并校验(extraResources 默认排除 node_modules)。
  const stageKey = deepseekHarnessStageKey(electronPlatformName, archName)
  const stageHarness = path.join(scriptDir, '..', 'build-staging', 'deepseek-harness', stageKey)
  if (!fs.existsSync(stageHarness)) {
    throw new Error(
      `[after-pack] deepseek-harness ${stageKey} staging 不存在: ${stageHarness}。` +
      '请先运行对应目标的 stage-runtime-targets.mjs。'
    )
  }
  const destHarness = path.join(resourcesPath, 'deepseek-harness')
  console.log(`[after-pack] Copying deepseek-harness → ${destHarness}`)
  fs.mkdirSync(destHarness, { recursive: true })
  copyDirSync(stageHarness, destHarness)
  requireDeepseekHarnessBundle(resourcesPath, {
    platform: electronPlatformName,
    arch: archName,
  })
  console.log('[after-pack] deepseek-harness bundled')

  copyOfficeRuntime(officeSource, path.join(resourcesPath, 'office'))
  const destPython = path.join(resourcesPath, 'python')
  console.log(`[after-pack] Copying Python ${srcKey} → ${destPython}`)
  fs.mkdirSync(destPython, { recursive: true })
  copyDirSync(srcPython, destPython)
  console.log(`[after-pack] Python bundled (${srcKey})`)
  runOfficeSmoke(resourcesPath, path.join(appOutDir, `office-smoke-${srcKey}-${Date.now()}`), srcKey)
}

function copyOfficeRuntime(source, destination) {
  // Node's default cpSync resolves relative symlinks against the source tree.
  // Native app links must remain relative when the DMG is detached or app moved.
  fs.cpSync(source, destination, { recursive: true, verbatimSymlinks: true })
}

function runOfficeSmoke(resourcesPath, output, srcKey) {
  const { spawnSync } = require('child_process')
  const python = getPythonExecutable(path.join(resourcesPath, 'python'), srcKey)
  const cli = path.join(resourcesPath, 'python-scripts/core/office/cli.py')
  const env = { ...process.env, CRAWSHRIMP_PYTHON_EXECUTABLE: python,
    CRAWSHRIMP_RESOURCES_ROOT: resourcesPath, CRAWSHRIMP_OFFICE_ROOT: path.join(resourcesPath, 'office'),
    PYTHONNOUSERSITE: '1', PYTHONUTF8: '1', MPLBACKEND: 'Agg', MPLCONFIGDIR: path.join(output, 'mpl-cache') }
  for (const name of ['PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV', 'CRAWSHRIMP_OFFICE_CHILD']) delete env[name]
  const result = spawnSync(python, [cli, 'smoke', output], { env, encoding: 'utf8', timeout: 300000, maxBuffer: 2 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`[after-pack] Native Office smoke failed for ${srcKey}. Run packaging on a compatible host. ${result.error || result.stderr || result.stdout}`)
  const report = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8'))
  if (!report.ok || report.runtime.target !== srcKey) throw new Error('[after-pack] Office smoke did not validate the packaged target')
  console.log(`[after-pack] Office generation/reopen/render verified: ${output}`)
}

function isPrunedPnpmVirtualStoreLink(source) {
  const segments = path.normalize(source).split(path.sep)
  const pnpmIndex = segments.lastIndexOf('.pnpm')
  return pnpmIndex > 0
    && segments[pnpmIndex - 1] === 'node_modules'
    && segments[pnpmIndex + 1] === 'node_modules'
}

function copyDirSync(src, dest, ancestorSources = new Set()) {
  const canonicalSource = fs.realpathSync(src)
  if (ancestorSources.has(canonicalSource)) {
    throw new Error(`[after-pack] cyclic directory link while copying ${src} -> ${canonicalSource}`)
  }
  const nextAncestors = new Set(ancestorSources)
  nextAncestors.add(canonicalSource)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true })
      copyDirSync(s, d, nextAncestors)
    } else if (entry.isSymbolicLink()) {
      let realSrc
      try {
        realSrc = fs.realpathSync(s)
      } catch (error) {
        // `pnpm prune --prod` can leave its private virtual-store index with
        // links to removed development-only packages. Those links cannot be
        // reached through normal Node resolution and must not block copying a
        // production CLI closure. Any other broken runtime link still fails.
        if (error?.code === 'ENOENT' && isPrunedPnpmVirtualStoreLink(s)) continue
        throw error
      }
      const targetStat = fs.statSync(s)
      if (targetStat.isDirectory()) {
        fs.mkdirSync(d, { recursive: true })
        copyDirSync(realSrc, d, nextAncestors)
      } else if (targetStat.isFile()) {
        fs.copyFileSync(realSrc, d)
      } else {
        throw new Error(`[after-pack] unsupported symlink target while copying ${s}`)
      }
    } else {
      fs.copyFileSync(s, d)
    }
  }
}

exports.default = afterPack
exports.runOfficeSmoke = runOfficeSmoke
exports.copyOfficeRuntime = copyOfficeRuntime
exports.copyDirSync = copyDirSync
exports.requirePythonBundle = requirePythonBundle
exports.requirePythonScriptsBundle = requirePythonScriptsBundle
exports.requireDeepseekHarnessBundle = requireDeepseekHarnessBundle
exports.requireNativeRuntimePackages = requireNativeRuntimePackages
exports.deepseekHarnessStageKey = deepseekHarnessStageKey
exports.REQUIRED_BACKEND_IMPORTS = REQUIRED_BACKEND_IMPORTS
exports.REQUIRED_WINDOWS_BACKEND_PATHS = REQUIRED_WINDOWS_BACKEND_PATHS
exports.REQUIRED_VIDEO_INTEGRATION_FILES = REQUIRED_VIDEO_INTEGRATION_FILES
exports.REQUIRED_DEEPSEEK_HARNESS_FILES = REQUIRED_DEEPSEEK_HARNESS_FILES
