import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, sep } from 'node:path'

export function stageTargetKey({ platform, arch }) {
  return platform + '-' + arch
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
