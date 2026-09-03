/**
 * Stage one or more explicit desktop targets before electron-builder runs.
 *
 * Usage:
 *   node stage-runtime-targets.mjs darwin-arm64 darwin-x64
 *   node stage-runtime-targets.mjs win32-x64
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const stageScript = resolve(here, 'stage-runtime.mjs')
const targets = process.argv.slice(2).filter(Boolean)

if (!targets.length) {
  if (process.platform === 'darwin') {
    targets.push('darwin-arm64', 'darwin-x64')
  } else {
    targets.push(`${process.platform}-${process.arch}`)
  }
}

for (const target of targets) {
  console.log(`[stage-runtime-targets] staging ${target}`)
  const result = spawnSync(process.execPath, [stageScript, '--target', target], {
    cwd: resolve(here, '../../..'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) {
    console.error(`[stage-runtime-targets] ${target} failed: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`[stage-runtime-targets] ${target} failed with exit code ${result.status}`)
    process.exit(result.status || 1)
  }
}
