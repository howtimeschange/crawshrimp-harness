import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { mcpPagination, composerSubmit } from './backports/index.mjs'
const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url)))
const transforms = { C01: mcpPagination, C02: composerSubmit }
const hash = text => createHash('sha256').update(text).digest('hex')
// Preflight every new compatibility patch before any runtime writes.
export function prepareCompatibility(root) {
  const plans = manifest.patches.map(patch => {
    const pkg = JSON.parse(readFileSync(join(root, 'node_modules', patch.package, 'package.json')))
    if (pkg.version !== patch.version) throw new Error(`${patch.id}: unsupported ${pkg.name}@${pkg.version}`)
    const path = join(root, 'node_modules', patch.package, patch.file)
    const before = readFileSync(path, 'utf8'), after = transforms[patch.id](before)
    if (transforms[patch.id](after) !== after) throw new Error(`${patch.id}: not idempotent`)
    return { patch, path, before, after }
  })
  return () => {
    const report = plans.map(({ patch, path, before, after }) => {
      // Historical patches may touch other regions of the same bundle.
      const current = readFileSync(path, 'utf8'), output = transforms[patch.id](current)
      if (current !== output) writeFileSync(path, output)
      return { id: patch.id, package: patch.package, version: patch.version, before: hash(current), after: hash(output), changed: current !== output, verified: transforms[patch.id](output) === output }
    })
    writeFileSync(join(root, 'compat-report.json'), JSON.stringify({ upstream: manifest.upstream, baseline: manifest.baseline, patches: report }, null, 2) + '\n')
    return report
  }
}
