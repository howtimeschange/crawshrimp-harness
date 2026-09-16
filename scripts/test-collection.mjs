// Shared CI collection and execution. File lists are expanded here, never by a shell glob.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

export const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const ignored = new Set(['node_modules', '.git', 'dist', '__pycache__', '.pytest_cache', '.venv', 'venv'])
export function walk(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (ignored.has(entry.name) || entry.isSymbolicLink()) return []
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : []
  }).sort()
}
const cliNames = ['DeepDrawCLI', 'bmall-cli', 'semir-yunpan-cli', 'tmall-cli']
export const suites = {
  app: { cwd: 'app', roots: ['app/src', 'app/scripts'], pattern: /\.test\.(?:js|mjs)$/, node: true },
  adapters: { cwd: '.', roots: ['tests'], pattern: /\.test\.js$/, node: true },
  integrations: { cwd: '.', roots: ['integrations'], pattern: /\.test\.(?:js|mjs)$/, node: true },
  python: { cwd: '.', roots: ['tests'], pattern: /\/(test_[^/]+|[^/]+_test)\.py$/, python: true },
  ...Object.fromEntries(cliNames.map(name => [name, {
    cwd: `skills/cli/${name}`, roots: [`skills/cli/${name}/tests`], pattern: /\.test\.ts$/, cli: true,
  }])),
}
export function collect(name, base = root) {
  const spec = suites[name]
  if (!spec) throw new Error(`Unknown suite: ${name}`)
  return spec.roots.flatMap(path => walk(join(base, path)))
    .map(path => relative(base, path).replaceAll('\\', '/')).filter(path => spec.pattern.test('/' + path))
}
export const manual = {
  'app/scripts/market-read-smoke.cjs': 'Live read-only cloud check requires a signed-in OS-encrypted desktop account.',
  'app/scripts/market-electron-smoke.cjs': 'Explicit live admin workflow publishes/approves/withdraws a QA package.',
  'app/scripts/market-lifecycle-local-smoke.cjs': 'Requires an authenticated cloud account and a matching approved example ZIP.',
  'app/scripts/analytics-electron-smoke.cjs': 'Requires an authenticated cloud account and sends live test analytics.',
  'app/scripts/performance-audit.cjs': 'Manual machine-specific performance investigation.',
  'app/scripts/performance-logs.cjs': 'Manual machine-specific performance investigation.',
  'app/scripts/performance-repaired-source.cjs': 'Manual source-client performance investigation.',
  'app/scripts/performance-repaired-startup.cjs': 'Manual source-client startup measurement.',
  'app/scripts/performance-repaired-thumbnail.cjs': 'Manual thumbnail performance measurement.',
  'app/scripts/performance-windows-startup.cjs': 'Requires a real Windows performance target.',
}
export const smokes = {
  'app/scripts/smoke-builtin-clis.cjs': 'npm run test:builtin-clis',
  'app/scripts/dsh-web-auth-electron-smoke.cjs': 'npm run test:dsh-web-auth',
}
export function uncollected(base = root) {
  const inventory = ['app/src', 'app/scripts', 'tests', 'integrations', 'skills/cli']
    .flatMap(path => walk(join(base, path)))
    .map(path => relative(base, path).replaceAll('\\', '/'))
    .filter(path => /\.test\.(js|mjs|cjs|ts|tsx|jsx)$/.test(path)
      || (path.startsWith('tests/') && /\/(?:test_[^/]+|[^/]+_test)\.py$/.test(path))
      || /^app\/scripts\/[^/]+\.cjs$/.test(path))
  // integrations/skills/cli is a generated, untracked copy of skills/cli.
  const covered = new Set(Object.keys(suites).flatMap(name => collect(name, base)))
  return inventory.filter(path => !path.startsWith('integrations/deepseek-harness/skills/cli/')
    && !covered.has(path) && !manual[path] && !smokes[path])
}
export function verifyWorkflow(base = root) {
  const require = createRequire(join(base, 'app/package.json'))
  const { parse } = require('yaml')
  const workflow = parse(readFileSync(join(base, '.github/workflows/build-desktop.yml'), 'utf8'))
  const steps = workflow.jobs.test.steps
  const runs = steps.filter(step => !step.if && !step['continue-on-error']).map(step => step.run)
  const pkg = JSON.parse(readFileSync(join(base, 'app/package.json'), 'utf8'))
  if (pkg.scripts.test !== 'node ../scripts/test-collection.mjs run app') throw new Error('app npm test bypasses shared collection')
  if (!steps.some(step => step.run === 'npm test' && step['working-directory'] === 'app' && !step.if && !step['continue-on-error'])) throw new Error('CI must run app npm test')
  for (const name of Object.keys(suites).filter(name => name !== 'app')) {
    if (!runs.includes(`node scripts/test-collection.mjs run ${name}`)) throw new Error(`CI does not run suite ${name}`)
  }
  if (!runs.includes('node scripts/test-collection.mjs verify')) throw new Error('CI collection guard is missing')
  const build = workflow.jobs.build
  if (!build.needs.includes('test')) throw new Error('Build must depend on test')
  for (const command of Object.values(smokes)) {
    if (!build.steps.some(step => step.run === command && step['working-directory'] === 'app' && !step.if && !step['continue-on-error'])) throw new Error(`Build does not run ${command}`)
  }
  if (pkg.scripts['test:builtin-clis'] !== 'node scripts/smoke-builtin-clis.cjs'
    || pkg.scripts['test:dsh-web-auth'] !== 'electron scripts/dsh-web-auth-electron-smoke.cjs') throw new Error('Smoke entrypoint changed; update coverage verification')
  for (const name of cliNames) {
    const pkg = JSON.parse(readFileSync(join(base, suites[name].cwd, 'package.json'), 'utf8'))
    const expected = name === 'DeepDrawCLI' ? 'node --import tsx --test' : 'vitest run'
    if (pkg.scripts.test !== expected) throw new Error(`Review changed ${name} test entrypoint`)
    if (name !== 'DeepDrawCLI') {
      const config = readFileSync(join(base, suites[name].cwd, 'vitest.config.ts'), 'utf8')
      if (!/include:\s*\[['"]tests\/\*\*\/\*\.test\.ts['"]\]/.test(config) || /\bexclude\s*:/.test(config)) throw new Error(`Review ${name} Vitest collection rules`)
    }
  }
}
export function run(name) {
  const spec = suites[name]
  const files = collect(name)
  if (!files.length) throw new Error(`No tests collected for ${name}`)
  const cwd = join(root, spec.cwd)
  const args = files.map(path => relative(cwd, join(root, path)))
  let command, options
  if (spec.python) { command = process.env.PYTHON || 'python'; options = ['-m', 'pytest', ...args, '-v'] }
  else if (spec.cli) { command = process.platform === 'win32' ? 'npm.cmd' : 'npm'; options = ['test', '--', ...args] }
  else { command = process.execPath; options = ['--test', ...args] }
  console.log(`Collected ${files.length} files for ${name}`)
  const result = spawnSync(command, options, { cwd, stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  return result.status ?? 1
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, name] = process.argv.slice(2)
  if (action === 'run') process.exitCode = run(name)
  else if (action === 'list') console.log(collect(name).join('\n'))
  else if (action === 'verify') {
    verifyWorkflow()
    const missing = uncollected()
    if (missing.length) { console.error('Uncollected test files:\n' + missing.join('\n')); process.exitCode = 1 }
    else console.log('Test collection verified; explicit manual exceptions:\n' + Object.entries(manual).map(([path, reason]) => `${path}: ${reason}`).join('\n'))
  } else throw new Error('Usage: test-collection.mjs verify | list SUITE | run SUITE')
}
