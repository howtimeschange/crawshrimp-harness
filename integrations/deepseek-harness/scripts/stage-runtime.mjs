/**
 * Stage the supported DSH rc.1 Web-profile closure for Electron packaging.
 * The former flat Cordis/SDK runtime is intentionally not staged.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getRequiredNativeRuntimePackages,
  isCrossStageTarget,
  parseStageTarget,
  resolveElectronExecutable,
  runtimeInstallArgs,
  shouldSkipBootCheck,
  stageTargetKey,
  targetInstallEnvironment,
} from './stage-runtime-platform.mjs'
import { buildImageGenerationEffect } from './build-image-generation-effect.mjs'
import { patchRuntimeDependencies } from './patch-runtime-dependencies.mjs'
import { dwsReleasePath, stageDwsRuntime } from './stage-dws-runtime.mjs'
import { patchBmallHelpExit } from './builtin-cli-patches.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const sourceRoot = resolve(here, '..')
const repoRoot = resolve(sourceRoot, '../..')
const appRoot = join(repoRoot, 'app')
const args = process.argv.slice(2)
let target
try {
  target = parseStageTarget(args)
} catch (error) {
  fail(error.message)
}

const targetId = stageTargetKey(target)
const stageRoot = join(repoRoot, 'build-staging', 'deepseek-harness', targetId)
const profileSource = join(sourceRoot, 'profile', 'web')
const profileRoot = join(stageRoot, 'profiles', 'web')
const markerName = '.crawshrimp-runtime-target.json'
const lockMarker = join(stageRoot, '.staged-lock-hash')
const crossTarget = isCrossStageTarget(target)
const skipBootCheck = shouldSkipBootCheck({ args }) || crossTarget
const force = args.includes('--force')
const cliSource = join(repoRoot, 'skills', 'cli')
const EXCLUDED_SOURCE_TREE_ENTRIES = new Set(['.git', 'node_modules', '.DS_Store', '__pycache__', '.pytest_cache'])

// Public built-in skills must ship as executable production closures, rather
// than leaving npm/pnpm installation to an end user on first use.
const CLI_NODE_SKILL_RUNTIMES = [
  { directory: 'bmall-cli', packageManager: 'pnpm', entry: 'dist/cli.js' },
  { directory: 'DeepDrawCLI', packageManager: 'npm', entry: 'dist/cli/main.js' },
  { directory: 'semir-yunpan-cli', packageManager: 'npm', entry: 'dist/cli.js' },
  { directory: 'tmall-cli', packageManager: 'npm', entry: 'dist/cli.js' },
]

const REQUIRED_SKILL_SOURCE_FILES = [
  [sourceRoot, 'skills/dws/SKILL.md'],
  [sourceRoot, 'skills/dws/LICENSE'],
  [repoRoot, 'skills/cli/manifest.json'],
  [sourceRoot, 'skills/dont-stop/SKILL.md'],
  ...['SKILL.md', 'scripts/computer_use.py', 'scripts/native/mac.swift', 'scripts/native/mac_feedback.swift', 'scripts/cu/windows.py'].map(file => [sourceRoot, `skills/crawshrimp-computer-use/${file}`]),
  [sourceRoot, 'skills/crawshrimp-skill/SKILL.md'],
  [sourceRoot, 'skills/web-automation-skill/SKILL.md'],
  [sourceRoot, 'skills/crawshrimp-adapter-skill/SKILL.md'],
  [sourceRoot, 'skills/crawshrimp-probe-skill/SKILL.md'],
  [sourceRoot, 'skills/suanming/SKILL.md'],
  ...['SKILL.md', 'LICENSE', 'LICENSE.ppt-master', 'UPSTREAM.md', 'references/ppt-layout.md', 'references/word-layout.md', 'references/native-api.md']
    .map(file => [sourceRoot, `skills/office-design-taste/${file}`]),
  [repoRoot, 'skills/cli/vipshop-hot-strategy-agent/src/vipshop_hot_strategy_agent/cli.py'],
  ...CLI_NODE_SKILL_RUNTIMES.map(({ directory }) => [repoRoot, `skills/cli/${directory}/package.json`]),
]
const required = [
  'worker/builtin-runtime.cjs',
  'skills/dws/SKILL.md',
  'skills/dws/UPSTREAM.md',
  'skills/cli/manifest.json',
  `skills/cli/dws/bin/${target.platform === 'win32' ? 'dws.exe' : 'dws'}`,
  'skills/cli/dws/runtime.json',
  'skills/cli/dws/LICENSE',
  'skills/cli/dws/NOTICE',
  markerName,
  'package.json',
  'node_modules/@deepseek-ai/dsh/package.json',
  'node_modules/@deepseek-ai/dsh/lib/bin.js',
  // These must stay at the runtime root. The rc.1 Web Host resolves this
  // closure from the profile loader, rather than from dsh's nested tree.
  'node_modules/@deepseek-ai/dsh-web-app/package.json',
  'node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml',
  'node_modules/@deepseek-ai/dsh-api-workspace-controller/package.json',
  'node_modules/@deepseek-ai/dsh-cordis-host-runner/package.json',
  'node_modules/@deepseek-ai/dsh-attachment-local/package.json',
  'node_modules/@deepseek-ai/dsh-llm-pi-ai/package.json',
  'node_modules/@deepseek-ai/dsh-time-context/package.json',
  'node_modules/@deepseek-ai/dsh-schedule/package.json',
  // ACP is a separately launched official DSH profile. It remains packaged so
  // Crawshrimp keeps the protocol surface without trying to splice its stdio
  // transport into the long-lived Web Host.
  'node_modules/@deepseek-ai/dsh-acp-app/package.json',
  'node_modules/@deepseek-ai/dsh-acp-app/cordis.patch.yml',
  'node_modules/@deepseek-ai/dsh-acp-app/node_modules/@deepseek-ai/dsh-acp/package.json',
  'node_modules/@xmanrui/dsh-im/package.json',
  'node_modules/@xmanrui/dsh-im/lib/index.js',
  'node_modules/@xmanrui/dsh-im/lib/client.js',
  'node_modules/@xmanrui/dsh-im/src/channels/shared/inbound-ttl.mjs',
  'node_modules/crawshrimp-product-bridge/lib/index.js',
  'node_modules/crawshrimp-slots/lib/client.js',
  'node_modules/crawshrimp-slots/lib/image-generation-effect.js',
  'worker/worker.mjs',
  'worker/native-web-follow-manager.mjs',
  'worker/web-rpc-client.mjs',
  'worker/repair-automation-receipts.mjs',
  'profiles/web/package.json',
  'profiles/web/cordis.yml',
  'profiles/web/cordis.patch.yml',
  'profiles/web/agent-presets/crawshrimp-standard/agent.cordis.yml',
  'profiles/web/agent-presets/crawshrimp-standard/preset.yml',
  'profiles/web/node_modules/@xmanrui/dsh-im/package.json',
  'profiles/web/node_modules/crawshrimp-product-bridge/lib/index.js',
  'profiles/web/node_modules/crawshrimp-slots/lib/client.js',
  'skills/dont-stop/SKILL.md',
  'skills/crawshrimp-computer-use/SKILL.md',
  'skills/crawshrimp-computer-use/scripts/computer_use.py',
  ...(target.platform === 'darwin' ? ['skills/crawshrimp-computer-use/scripts/native/mac'] : []),
  'skills/crawshrimp-skill/SKILL.md',
  'skills/web-automation-skill/SKILL.md',
  'skills/crawshrimp-adapter-skill/SKILL.md',
  'skills/crawshrimp-probe-skill/SKILL.md',
  'skills/suanming/SKILL.md',
  'skills/office-common/README.md',
  'skills/office-design-taste/SKILL.md',
  'skills/office-design-taste/LICENSE',
  'skills/office-design-taste/LICENSE.ppt-master',
  'skills/office-design-taste/UPSTREAM.md',
  'skills/office-design-taste/references/ppt-layout.md',
  'skills/office-design-taste/references/word-layout.md',
  'skills/office-design-taste/references/native-api.md',
  'skills/office-word/SKILL.md',
  'skills/office-word/templates/starter.docx',
  'skills/office-ppt/SKILL.md',
  'skills/office-ppt/templates/starter.pptx',
  'skills/office-excel/SKILL.md',
  'skills/office-excel/templates/starter.xlsx',
  'skills/cli/vipshop-hot-strategy-agent/src/vipshop_hot_strategy_agent/cli.py',
  ...CLI_NODE_SKILL_RUNTIMES.flatMap(({ directory, entry }) => [
    `skills/cli/${directory}/package.json`,
    `skills/cli/${directory}/${entry}`,
    `skills/cli/${directory}/node_modules`,
  ]),
]

function fail(message) {
  console.error('[stage-runtime] FAILED: ' + message)
  process.exit(1)
}

function hashTree(path) {
  const hash = createHash('sha256')
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      if (EXCLUDED_SOURCE_TREE_ENTRIES.has(name)) continue
      const child = join(directory, name)
      if (child === join(sourceRoot, 'skills/crawshrimp-computer-use/scripts/native/mac')) continue
      const stat = statSync(child)
      if (stat.isDirectory()) walk(child)
      else if (stat.isFile()) hash.update(name).update(readFileSync(child))
    }
  }
  if (existsSync(path)) walk(path)
  return hash.digest('hex')
}

function copyDir(source, destination) {
  // Git metadata and development-machine dependencies must not leak into the
  // packaged runtime. CLI dependencies are rebuilt below from their lockfiles.
  cpSync(source, destination, {
    recursive: true,
    force: true,
    errorOnExist: false,
    filter: (path) => !EXCLUDED_SOURCE_TREE_ENTRIES.has(basename(path)) &&
      path !== join(sourceRoot, 'skills/crawshrimp-computer-use/scripts/native/mac'),
  })
}

function linkProfilePackage(packagePath) {
  const source = join(stageRoot, 'node_modules', ...packagePath.split('/'))
  const destination = join(profileRoot, 'node_modules', ...packagePath.split('/'))
  if (!existsSync(source)) fail('profile dependency is missing: ' + packagePath)
  mkdirSync(dirname(destination), { recursive: true })
  rmSync(destination, { recursive: true, force: true })
  symlinkSync(source, destination, 'junction')
}

function stageProfile() {
  copyDir(profileSource, profileRoot)
  linkProfilePackage('@xmanrui/dsh-im')
  linkProfilePackage('crawshrimp-product-bridge')
  linkProfilePackage('crawshrimp-slots')
}

function assertNativePackages() {
  for (const spec of getRequiredNativeRuntimePackages(target)) {
    const root = join(stageRoot, 'node_modules', ...spec.packagePath.split('/'))
    const pending = [root]
    let found = false
    while (pending.length) {
      const directory = pending.pop()
      if (!existsSync(directory)) continue
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const child = join(directory, entry.name)
        if (entry.isDirectory()) pending.push(child)
        if (entry.isFile() && (
          (spec.artifactName && entry.name === spec.artifactName)
          || (spec.artifactExtension && entry.name.endsWith(spec.artifactExtension))
        )) found = true
      }
    }
    if (!found) fail('staging ' + targetId + ' is missing native artifact for ' + spec.packagePath)
  }
}

function assertSkillSourcesPresent() {
  const missing = REQUIRED_SKILL_SOURCE_FILES
    .map(([root, relative]) => join(root, relative))
    .filter((file) => !existsSync(file))
  if (missing.length) {
    fail(`内置技能源码不完整: ${missing.join(', ')}. 请先执行 git submodule update --init --recursive`)
  }
}

function runCliBuild(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  })
  if (result.error) fail(`内置 CLI 构建无法执行 ${command}: ${result.error.message}`)
  if (result.status !== 0) fail(`内置 CLI 构建失败: ${command} ${commandArgs.join(' ')} (exit ${result.status})`)
}

function buildCliSkillRuntimes(cliDest) {
  for (const spec of CLI_NODE_SKILL_RUNTIMES) {
    const skillRoot = join(cliDest, spec.directory)
    if (!existsSync(join(skillRoot, 'package.json'))) {
      fail(`CLI 技能包缺少 package.json: ${spec.directory}`)
    }
    rmSync(join(skillRoot, 'node_modules'), { recursive: true, force: true })
    rmSync(join(skillRoot, 'dist'), { recursive: true, force: true })
    if (spec.packageManager === 'pnpm') {
      // afterPack materializes directory links. pnpm's isolated layout relies
      // on the original realpath to find sibling transitive dependencies;
      // a hoisted production tree remains executable after that relocation.
      runCliBuild('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts', '--config.node-linker=hoisted'], skillRoot)
      runCliBuild('pnpm', ['run', 'build'], skillRoot)
      // Reinstall only the production graph from the store populated above.
      // pnpm prune can fetch unrelated optional dev artifacts in hoisted mode.
      rmSync(join(skillRoot, 'node_modules'), { recursive: true, force: true })
      runCliBuild('pnpm', ['install', '--prod', '--offline', '--frozen-lockfile', '--ignore-scripts', '--config.node-linker=hoisted'], skillRoot)
    } else {
      runCliBuild('npm', ['ci', '--ignore-scripts'], skillRoot)
      runCliBuild('npm', ['run', 'build'], skillRoot)
      runCliBuild('npm', ['prune', '--omit=dev', '--ignore-scripts'], skillRoot)
    }
    if (!existsSync(join(skillRoot, spec.entry)) || !existsSync(join(skillRoot, 'node_modules'))) {
      fail(`CLI 技能包生产产物不完整: ${spec.directory}`)
    }
    if (spec.directory === 'bmall-cli') {
      const entry = join(skillRoot, spec.entry)
      writeFileSync(entry, patchBmallHelpExit(readFileSync(entry, 'utf8')))
    }
  }
}

assertSkillSourcesPresent()
await buildImageGenerationEffect()

const hashInputs = [
  readFileSync(join(sourceRoot, 'package-lock.json')),
  hashTree(join(sourceRoot, 'worker')),
  hashTree(join(sourceRoot, 'compat')),
  hashTree(here),
  hashTree(join(sourceRoot, 'skills')),
  hashTree(join(sourceRoot, 'crawshrimp-product-bridge')),
  hashTree(join(sourceRoot, 'crawshrimp-slots')),
  hashTree(cliSource),
  hashTree(profileSource),
  readFileSync(fileURLToPath(import.meta.url)),
  readFileSync(join(here, 'patch-runtime-dependencies.mjs')),
  readFileSync(join(here, 'stage-dws-runtime.mjs')),
  readFileSync(join(here, 'builtin-cli-patches.mjs')),
  readFileSync(dwsReleasePath),
  readFileSync(join(here, 'office-vision.mjs')),
  readFileSync(join(here, 'configured-model-catalog.mjs')),
  readFileSync(join(here, 'currency-math.mjs')),
  readFileSync(join(here, 'compact-chat.mjs')),
  readFileSync(join(here, 'reasoning-recovery.mjs')),
  readFileSync(join(here, 'build-patched-dsh-im.mjs')),
  targetId,
].join('|')
const fingerprint = createHash('sha256').update(hashInputs).digest('hex')
const current = existsSync(lockMarker) ? readFileSync(lockMarker, 'utf8').trim() : ''

if (force || current !== fingerprint) {
  console.log('[stage-runtime] staging DSH rc.1 Web profile closure -> ' + stageRoot)
  rmSync(stageRoot, { recursive: true, force: true })
  mkdirSync(stageRoot, { recursive: true })
  copyFileSync(join(sourceRoot, 'package.json'), join(stageRoot, 'package.json'))
  copyFileSync(join(sourceRoot, 'package-lock.json'), join(stageRoot, 'package-lock.json'))
  const install = spawnSync('npm', runtimeInstallArgs({ crossTarget }), {
    cwd: stageRoot,
    stdio: 'inherit',
    env: targetInstallEnvironment(target),
    shell: process.platform === 'win32',
  })
  if (install.status !== 0) fail('npm ci --omit=dev exited ' + String(install.status))

  for (const name of ['worker', 'skills', 'crawshrimp-launcher', 'crawshrimp-slots', 'crawshrimp-product-bridge']) {
    const source = join(sourceRoot, name)
    if (existsSync(source)) copyDir(source, join(stageRoot, name))
  }
  stageComputerUse()
  const cliDest = join(stageRoot, 'skills', 'cli')
  // skills/cli is sourced exclusively from the pinned top-level CLI tree.
  // A legacy copy under integration skills must not leave obsolete SDK jars
  // or modules behind when the authoritative tree is overlaid.
  rmSync(cliDest, { recursive: true, force: true })
  copyDir(cliSource, cliDest)
  buildCliSkillRuntimes(cliDest)
  await stageDwsRuntime({ cliRoot: cliDest, cacheRoot: join(repoRoot, 'build-staging', 'dws-cache'), target })
  stageProfile()
  patchRuntimeDependencies(stageRoot)
  writeFileSync(join(stageRoot, markerName), JSON.stringify(target, null, 2) + '\n')
  writeFileSync(lockMarker, fingerprint + '\n')
  console.log('[stage-runtime] staging complete')
} else {
  console.log('[stage-runtime] staging up to date')
}

for (const relativePath of required) {
  if (!existsSync(join(stageRoot, relativePath))) fail('staging missing required file: ' + relativePath)
}
assertNativePackages()
// Development runs from sourceRoot; reuse the same host-architecture helper.
if (target.platform === 'darwin' && !crossTarget) {
  copyFileSync(join(stageRoot, 'skills/crawshrimp-computer-use/scripts/native/mac'), join(sourceRoot, 'skills/crawshrimp-computer-use/scripts/native/mac'))
  // Electron's development plist is unsealed; declare the same purpose as the packaged app.
  const devPlist = join(appRoot, 'node_modules/electron/dist/Electron.app/Contents/Info.plist')
  if (existsSync(devPlist)) {
    const checked = spawnSync('/usr/bin/plutil', ['-extract', 'NSAppleEventsUsageDescription', 'raw', devPlist])
    if (checked.status !== 0) {
      const updated = spawnSync('/usr/bin/plutil', ['-insert', 'NSAppleEventsUsageDescription', '-string', '抓虾仅在你授权的桌面任务中控制所选应用，用于读取内容和执行操作。', devPlist])
      if (updated.status !== 0) fail('Could not configure development Apple Events usage description')
    }
  }
}

if (skipBootCheck) {
  console.log('[stage-runtime] Web profile config check skipped')
} else {
  const electronBin = resolveElectronExecutable(appRoot)
  const dshBin = join(stageRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!electronBin) fail('Electron executable is unavailable for Web profile config check')
  const probe = spawnSync(electronBin, [dshBin, 'web', '--dump-config'], {
    cwd: stageRoot,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      DSH_HOME: stageRoot,
      DSH_TELEMETRY_DISABLED: '1',
      CRAWSHRIMP_STAGE_BOOT_CHECK: '1',
      CRAWSHRIMP_WORKSPACE_ROOT: stageRoot,
    },
  })
  const config = String(probe.stdout || '')
  const duplicateDeepSeekRouteDisabled = /^- id: llm-deepseek\n(?:(?!^- id:)[\s\S])*?^  disabled: true$/mu.test(config)
  if (probe.status !== 0 || !config.includes('@deepseek-ai/dsh-web-app') || !config.includes('@xmanrui/dsh-im') || !duplicateDeepSeekRouteDisabled) {
    fail('Web profile config check failed: ' + String(probe.stderr || probe.error?.message || '').slice(-3000))
  }
  console.log('[stage-runtime] Web profile config check OK')
}

function stageComputerUse() {
  if (target.platform !== 'darwin') return
  if (process.platform !== 'darwin') fail('macOS computer use helper must be built on macOS')
  const native = join(stageRoot, 'skills/crawshrimp-computer-use/scripts/native')
  const source = join(native, 'main.swift')
  writeFileSync(source, readFileSync(join(native, 'mac_feedback.swift'), 'utf8') + '\n' + readFileSync(join(native, 'mac.swift'), 'utf8'))
  try {
    const arch = target.arch === 'x64' ? 'x86_64' : target.arch
    const result = spawnSync('xcrun', ['swiftc', '-O', '-target', `${arch}-apple-macosx14.0`, source, '-o', join(native, 'mac')], { stdio: 'inherit' })
    if (result.status !== 0) fail('computer use native helper compilation failed: ' + String(result.error || result.status))
  } finally { rmSync(source, { force: true }) }
}
