/**
 * Stage the supported DSH rc.1 Web-profile closure for Electron packaging.
 * The former flat Cordis/SDK runtime is intentionally not staged.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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
  'worker/worker.mjs',
  'worker/web-rpc-client.mjs',
  'profiles/web/package.json',
  'profiles/web/cordis.yml',
  'profiles/web/cordis.patch.yml',
  'profiles/web/agent-presets/crawshrimp-standard/agent.cordis.yml',
  'profiles/web/agent-presets/crawshrimp-standard/preset.yml',
  'profiles/web/node_modules/@xmanrui/dsh-im/package.json',
  'profiles/web/node_modules/crawshrimp-product-bridge/lib/index.js',
  'profiles/web/node_modules/crawshrimp-slots/lib/client.js',
]

function fail(message) {
  console.error('[stage-runtime] FAILED: ' + message)
  process.exit(1)
}

function hashTree(path) {
  const hash = createHash('sha256')
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const child = join(directory, name)
      const stat = statSync(child)
      if (stat.isDirectory()) walk(child)
      else if (stat.isFile()) hash.update(name).update(readFileSync(child))
    }
  }
  if (existsSync(path)) walk(path)
  return hash.digest('hex')
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
  cpSync(profileSource, profileRoot, { recursive: true, force: true })
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

const hashInputs = [
  readFileSync(join(sourceRoot, 'package-lock.json')),
  hashTree(join(sourceRoot, 'worker')),
  hashTree(join(sourceRoot, 'skills')),
  hashTree(join(sourceRoot, 'crawshrimp-product-bridge')),
  hashTree(join(sourceRoot, 'crawshrimp-slots')),
  hashTree(profileSource),
  readFileSync(fileURLToPath(import.meta.url)),
  readFileSync(join(here, 'patch-runtime-dependencies.mjs')),
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
    if (existsSync(source)) cpSync(source, join(stageRoot, name), { recursive: true, force: true })
  }
  const cliSource = join(repoRoot, 'skills', 'cli')
  if (existsSync(cliSource)) cpSync(cliSource, join(stageRoot, 'skills', 'cli'), { recursive: true, force: true })
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
