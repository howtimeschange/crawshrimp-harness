import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, sep } from 'node:path'

export function stageTargetKey({ platform, arch }) {
  return platform + '-' + arch
}

const VALID_STAGE_PLATFORMS = new Set(['darwin', 'linux', 'win32'])
const VALID_STAGE_ARCHES = new Set(['arm64', 'x64', 'ia32', 'arm', 'armv7l'])

export function normalizeStageTarget(target = {}) {
  const platform = String(target.platform || '').trim()
  const arch = String(target.arch || '').trim()
  if (!VALID_STAGE_PLATFORMS.has(platform)) {
    throw new Error(`unsupported staging platform: ${platform || '(empty)'}`)
  }
  if (!VALID_STAGE_ARCHES.has(arch)) {
    throw new Error(`unsupported staging architecture: ${arch || '(empty)'}`)
  }
  return { platform, arch }
}

export function parseStageTarget(args = [], hostTarget = {
  platform: process.platform,
  arch: process.arch,
}) {
  let targetValue = ''
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || '')
    if (arg === '--target') {
      targetValue = String(args[index + 1] || '')
      index += 1
      break
    }
    if (arg.startsWith('--target=')) {
      targetValue = arg.slice('--target='.length)
      break
    }
  }
  if (!targetValue) return normalizeStageTarget(hostTarget)
  const separator = targetValue.indexOf('-')
  if (separator <= 0 || separator === targetValue.length - 1) {
    throw new Error(`invalid staging target: ${targetValue}; expected <platform>-<arch>`)
  }
  return normalizeStageTarget({
    platform: targetValue.slice(0, separator),
    arch: targetValue.slice(separator + 1),
  })
}

export function isCrossStageTarget(target, hostTarget = {
  platform: process.platform,
  arch: process.arch,
}) {
  return target.platform !== hostTarget.platform || target.arch !== hostTarget.arch
}

export function targetInstallEnvironment(target, baseEnv = process.env) {
  const normalized = normalizeStageTarget(target)
  return {
    ...baseEnv,
    // npm uses these config values when resolving optionalDependencies with
    // os/cpu constraints. Keep both names for npm versions used locally/CI.
    npm_config_platform: normalized.platform,
    npm_config_arch: normalized.arch,
    npm_config_os: normalized.platform,
    npm_config_cpu: normalized.arch,
  }
}

export function runtimeInstallArgs({ crossTarget = false } = {}) {
  return [
    'ci',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    ...(crossTarget ? ['--ignore-scripts'] : []),
  ]
}

export function getRequiredNativeRuntimePackages({ platform, arch }) {
  const suffix = platform + '-' + arch
  return [
    { packagePath: '@img/sharp-' + suffix, artifactExtension: '.node' },
    { packagePath: '@koromix/koffi-' + suffix, artifactExtension: '.node' },
    {
      packagePath: '@vscode/ripgrep-' + suffix,
      artifactName: platform === 'win32' ? 'rg.exe' : 'rg',
    },
  ]
}

export function shouldSkipBootCheck({ args = [] } = {}) {
  return args.includes('--skip-boot-check')
}

function verifiedElectronExecutable(distRoot, candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) return ''

  const executable = resolve(candidate)
  if (executable !== distRoot && !executable.startsWith(distRoot + sep)) return ''

  try {
    return statSync(executable).isFile() ? executable : ''
  } catch {
    return ''
  }
}

export function resolveElectronExecutable(appRoot, { loadElectron } = {}) {
  const electronRoot = resolve(appRoot, 'node_modules', 'electron')
  const distRoot = resolve(electronRoot, 'dist')
  const pathFile = resolve(electronRoot, 'path.txt')

  if (existsSync(pathFile)) {
    const relativeExecutable = readFileSync(pathFile, 'utf8').trim()
    if (relativeExecutable) {
      const executable = verifiedElectronExecutable(
        distRoot,
        resolve(distRoot, relativeExecutable),
      )
      if (executable) return executable

      // A path that escapes dist is invalid even if Electron's loader accepts it.
      const resolvedPath = resolve(distRoot, relativeExecutable)
      if (resolvedPath !== distRoot && !resolvedPath.startsWith(distRoot + sep)) return ''
    }
  }

  // Electron's public entry point runs its pinned installer when npm left the
  // package present but path.txt/the executable absent (observed on CI runners).
  // Validate the returned location so an override cannot redirect this smoke
  // check to an unrelated executable.
  try {
    const electronExecutable = loadElectron
      ? loadElectron()
      : createRequire(resolve(appRoot, 'package.json'))('electron')
    return verifiedElectronExecutable(distRoot, electronExecutable)
  } catch {
    return ''
  }
}
