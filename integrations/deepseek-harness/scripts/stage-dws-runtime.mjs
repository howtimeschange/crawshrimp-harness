import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const dwsReleasePath = fileURLToPath(new URL('../dws-release.json', import.meta.url))

export function dwsAssetName({ platform, arch }) {
  const os = { darwin: 'darwin', win32: 'windows', linux: 'linux' }[platform]
  const cpu = { x64: 'amd64', arm64: 'arm64' }[arch]
  if (!os || !cpu) throw new Error(`Unsupported DWS target: ${platform}-${arch}`)
  return `dws-${os}-${cpu}.${platform === 'win32' ? 'zip' : 'tar.gz'}`
}

export function verifyDwsArchive(file, expected) {
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex')
  if (actual !== expected) throw new Error(`DWS SHA256 mismatch: ${file}`)
}

export async function stageDwsRuntime({ cliRoot, cacheRoot, target }) {
  const release = JSON.parse(readFileSync(dwsReleasePath, 'utf8'))
  const name = dwsAssetName(target)
  const asset = release.assets[name]
  if (!asset || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error(`DWS release asset missing: ${name}`)
  const cache = join(cacheRoot, release.version)
  mkdirSync(cache, { recursive: true })
  const archive = join(cache, name)
  if (!existsSync(archive)) {
    const partial = `${archive}.${process.pid}.part`
    try {
      // curl is available on supported desktop build hosts; use its proxy,
      // redirect and retry support without invoking npm/global installers.
      execFileSync(process.platform === 'win32' ? 'curl.exe' : 'curl', [
        '--http1.1', '--fail', '--location', '--silent', '--show-error', '--retry', '2',
        '--connect-timeout', '20', '--max-time', '120', asset.url, '--output', partial,
      ], { timeout: 400_000, stdio: 'inherit' })
      verifyDwsArchive(partial, asset.sha256)
      renameSync(partial, archive)
    } finally {
      rmSync(partial, { force: true })
    }
  }
  verifyDwsArchive(archive, asset.sha256)
  const unpack = mkdtempSync(join(cache, 'unpack-'))
  const destination = join(cliRoot, 'dws')
  try {
    if (name.endsWith('.zip') && process.platform !== 'win32') {
      execFileSync('unzip', ['-q', archive, '-d', unpack])
    } else {
      // Windows 10+ tar.exe supports ZIP; no PowerShell interpolation.
      execFileSync('tar', ['-xf', archive, '-C', unpack])
    }
    const find = (directory, filename) => {
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, item.name)
        if (item.isFile() && item.name === filename) return path
        if (item.isDirectory()) { const found = find(path, filename); if (found) return found }
      }
      return null
    }
    const binary = target.platform === 'win32' ? 'dws.exe' : 'dws'
    const source = find(unpack, binary)
    if (!source) throw new Error(`DWS archive missing ${binary}`)
    mkdirSync(join(destination, 'bin'), { recursive: true })
    const executable = join(destination, 'bin', binary)
    copyFileSync(source, executable)
    if (process.platform !== 'win32') chmodSync(executable, 0o755)
    for (const name of ['LICENSE', 'NOTICE']) {
      const source = find(unpack, name)
      if (!source) throw new Error(`DWS archive missing ${name}`)
      copyFileSync(source, join(destination, name))
    }
    writeFileSync(join(destination, 'runtime.json'), JSON.stringify({
      version: release.version, target, archive: name, sha256: asset.sha256,
      executable: `bin/${binary}`, release_url: release.release_url,
    }, null, 2) + '\n')
    if (target.platform === process.platform && target.arch === process.arch) {
      const output = execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 15_000 })
      if (!output.includes(release.version)) throw new Error(`Unexpected DWS version: ${output}`)
      console.log(`[stage-dws] ${output.trim()}`)
    }
    return executable
  } finally {
    rmSync(unpack, { recursive: true, force: true })
  }
}
