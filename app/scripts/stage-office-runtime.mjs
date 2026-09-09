#!/usr/bin/env node
/** Build Harness-owned native Office assets from hash-pinned official archives. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync, renameSync } from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const manifestPath = join(repo, 'runtime-locks/office-assets.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const host = process.platform === 'win32' ? 'win-x64' : `mac-${process.arch}`
const target = process.argv[2] || host
const source = manifest.targets[target]
if (!source) throw new Error(`Unsupported Office target: ${target}`)
const root = join(repo, 'build-staging/office', target)
const cache = join(repo, '.codex-tmp/office-downloads')
const sha = data => createHash('sha256').update(data).digest('hex')
const fingerprint = sha(readFileSync(manifestPath))
const run = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...options })
  if (result.status !== 0) throw new Error(`${cmd} failed: ${result.stderr || result.error || result.stdout}`)
  return result.stdout
}
async function download(entry, filename) {
  mkdirSync(cache, { recursive: true })
  const path = join(cache, filename || basename(new URL(entry.url).pathname))
  if (existsSync(path) && sha(readFileSync(path)) === entry.sha256) return path
  run('curl', ['--fail', '--location', '--retry', '2', '--connect-timeout', '20', '--max-time', '600', '-o', path + '.partial', entry.url])
  if (sha(readFileSync(path + '.partial')) !== entry.sha256) throw new Error(`Office asset checksum mismatch: ${basename(path)}`)
  renameSync(path + '.partial', path)
  return path
}
const previous = existsSync(join(root, 'runtime.json')) ? JSON.parse(readFileSync(join(root, 'runtime.json'))) : null
if (previous?.stagingVersion === 2 && previous?.fingerprint === fingerprint && [previous.executable, ...previous.fonts,
  ...manifest.fonts.map(font => ({ path: join(source.fontDirectory, font.filename), sha256: font.sha256 }))]
  .every(item => existsSync(join(root, item.path)) && sha(readFileSync(join(root, item.path))) === item.sha256)) {
  console.log(`[office] ${target} assets verified, unchanged`)
  process.exit(0)
}
if (target !== host && !(process.platform === 'darwin' && target.startsWith('mac-'))) {
  throw new Error(`Stage ${target} on its native platform; cross-target file checks do not prove it runs.`)
}
const archive = await download(source)
const temporary = root + `.stage-${process.pid}`
mkdirSync(temporary, { recursive: true })
try {
  if (target.startsWith('mac-')) {
    const plist = run('hdiutil', ['attach', '-readonly', '-nobrowse', '-plist', archive])
    const mounts = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', '-'], { input: plist }))['system-entities']
    const mount = mounts.find(item => item['mount-point'])?.['mount-point']
    if (!mount) throw new Error('LibreOffice image has no mount point')
    try {
      cpSync(join(mount, 'LibreOffice.app'), join(temporary, 'libreoffice/LibreOffice.app'), { recursive: true, dereference: false, verbatimSymlinks: true })
    } finally { run('hdiutil', ['detach', mount]) }
  } else {
    const extracted = join(temporary, 'msi')
    mkdirSync(extracted, { recursive: true })
    run(join(process.env.SystemRoot, 'System32/msiexec.exe'), ['/a', archive, '/qn', `TARGETDIR=${extracted}`])
    const findOffice = dir => {
      if (existsSync(join(dir, 'program/soffice.exe'))) return dir
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) { const found = findOffice(join(dir, entry.name)); if (found) return found }
      }
    }
    const extractedRoot = findOffice(extracted)
    if (!extractedRoot) throw new Error('LibreOffice MSI did not extract program/soffice.exe')
    cpSync(extractedRoot, join(temporary, 'libreoffice'), { recursive: true })
    rmSync(extracted, { recursive: true })
  }
  mkdirSync(join(temporary, 'fonts'), { recursive: true })
  mkdirSync(join(temporary, source.fontDirectory), { recursive: true })
  const fonts = []
  for (const font of manifest.fonts) {
    const path = await download(font, font.filename)
    cpSync(path, join(temporary, 'fonts', font.filename))
    // LO loads bundled fonts using its native application font directory.
    cpSync(path, join(temporary, source.fontDirectory, font.filename))
    fonts.push({ path: `fonts/${font.filename}`, sha256: font.sha256 })
  }
  cpSync(join(repo, 'runtime-locks/licenses'), join(temporary, 'licenses'), { recursive: true })
  const executable = { path: source.executable, sha256: sha(readFileSync(join(temporary, source.executable))) }
  writeFileSync(join(temporary, 'runtime.json'), JSON.stringify({ schemaVersion: 1, stagingVersion: 2, target, fingerprint,
    libreofficeVersion: manifest.libreofficeVersion, fontFamily: manifest.fontFamily,
    executable, fonts, source: { url: source.url, sha256: source.sha256 } }, null, 2) + '\n')
  if (existsSync(root)) rmSync(root, { recursive: true })
  renameSync(temporary, root)
  console.log(`[office] staged ${target}: ${root}`)
} catch (error) {
  rmSync(temporary, { recursive: true, force: true })
  throw error
}
