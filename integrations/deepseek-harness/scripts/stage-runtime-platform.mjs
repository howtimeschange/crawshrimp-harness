import { existsSync, readFileSync } from 'node:fs'
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

export function resolveElectronExecutable(appRoot) {
  const electronRoot = resolve(appRoot, 'node_modules', 'electron')
  const distRoot = resolve(electronRoot, 'dist')
  const pathFile = resolve(electronRoot, 'path.txt')
  if (!existsSync(pathFile)) return ''

  const relativeExecutable = readFileSync(pathFile, 'utf8').trim()
  if (!relativeExecutable) return ''

  const executable = resolve(distRoot, relativeExecutable)
  if (executable !== distRoot && !executable.startsWith(distRoot + sep)) return ''
  return existsSync(executable) ? executable : ''
}
