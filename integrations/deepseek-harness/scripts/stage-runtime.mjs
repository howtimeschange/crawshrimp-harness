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
const EXCLUDED_SOURCE_TREE_ENTRIES = new Set(['.git', 'node_modules', '.DS_Store'])

// Public built-in skills must ship as executable production closures, rather
// than leaving npm/pnpm installation to an end user on first use.
const CLI_NODE_SKILL_RUNTIMES = [
  { directory: 'bmall-cli', packageManager: 'pnpm', entry: 'dist/cli.js' },
  { directory: 'DeepDrawCLI', packageManager: 'npm', entry: 'dist/cli/main.js' },
  { directory: 'semir-yunpan-cli', packageManager: 'npm', entry: 'dist/cli.js' },
  { directory: 'tmall-cli', packageManager: 'npm', entry: 'dist/cli.js' },
]

const REQUIRED_SKILL_SOURCE_FILES = [
  [sourceRoot, 'skills/dont-stop/SKILL.md'],
  [sourceRoot, 'skills/crawshrimp-skill/SKILL.md'],
  [sourceRoot, 'skills/web-automation-skill/SKILL.md'],
  [sourceRoot, 'skills/crawshrimp-adapter-skill/SKILL.md'],
  [sourceRoot, 'skills/crawshrimp-probe-skill/SKILL.md'],
  [sourceRoot, 'skills/suanming/SKILL.md'],
  [repoRoot, 'skills/cli/vipshop-hot-strategy-agent/src/vipshop_hot_strategy_agent/cli.py'],
  ...CLI_NODE_SKILL_RUNTIMES.map(({ directory }) => [repoRoot, `skills/cli/${directory}/package.json`]),
]
const required = [
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
  'profiles/web/package.json',
  'profiles/web/cordis.yml',
  'profiles/web/cordis.patch.yml',
  'profiles/web/agent-presets/crawshrimp-standard/agent.cordis.yml',
  'profiles/web/agent-presets/crawshrimp-standard/preset.yml',
  'profiles/web/node_modules/@xmanrui/dsh-im/package.json',
  'profiles/web/node_modules/crawshrimp-product-bridge/lib/index.js',
  'profiles/web/node_modules/crawshrimp-slots/lib/client.js',
  'skills/dont-stop/SKILL.md',
  'skills/crawshrimp-skill/SKILL.md',
  'skills/web-automation-skill/SKILL.md',
  'skills/crawshrimp-adapter-skill/SKILL.md',
  'skills/crawshrimp-probe-skill/SKILL.md',
  'skills/suanming/SKILL.md',
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
    filter: (path) => !EXCLUDED_SOURCE_TREE_ENTRIES.has(basename(path)),
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
      runCliBuild('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], skillRoot)
      runCliBuild('pnpm', ['run', 'build'], skillRoot)
      runCliBuild('pnpm', ['prune', '--prod', '--ignore-scripts'], skillRoot)
    } else {
      runCliBuild('npm', ['ci', '--ignore-scripts'], skillRoot)
      runCliBuild('npm', ['run', 'build'], skillRoot)
      runCliBuild('npm', ['prune', '--omit=dev', '--ignore-scripts'], skillRoot)
    }
    if (!existsSync(join(skillRoot, spec.entry)) || !existsSync(join(skillRoot, 'node_modules'))) {
      fail(`CLI 技能包生产产物不完整: ${spec.directory}`)
    }
  }
}

assertSkillSourcesPresent()
await buildImageGenerationEffect()

const hashInputs = [
  readFileSync(join(sourceRoot, 'package-lock.json')),
  hashTree(join(sourceRoot, 'worker')),
  hashTree(join(sourceRoot, 'skills')),
  hashTree(join(sourceRoot, 'crawshrimp-product-bridge')),
  hashTree(join(sourceRoot, 'crawshrimp-slots')),
  hashTree(cliSource),
  hashTree(profileSource),
  readFileSync(fileURLToPath(import.meta.url)),
  readFileSync(join(here, 'patch-runtime-dependencies.mjs')),
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
  const cliDest = join(stageRoot, 'skills', 'cli')
  copyDir(cliSource, cliDest)
  buildCliSkillRuntimes(cliDest)
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
