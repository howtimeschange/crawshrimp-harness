// Exercise the same materialized dependency trees as afterPack, outside the
// checkout and under a path containing spaces/Chinese. No login or remote writes.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const assert = require('node:assert/strict')
const { copyDirSync } = require('./after-pack.js')
const { builtinRuntimeEnvironment } = require('../../integrations/deepseek-harness/worker/builtin-runtime.cjs')

const repo = path.resolve(__dirname, '../..')
const target = `${process.platform}-${process.arch}`
const source = path.join(repo, 'build-staging/deepseek-harness', target, 'skills')
const pythonTarget = process.platform === 'win32' ? `win-${process.arch}` : `mac-${process.arch}`
const python = process.env.CRAWSHRIMP_PYTHON_EXECUTABLE || path.join(repo, 'app/python-dist', pythonTarget,
  process.platform === 'win32' ? 'python.exe' : 'bin/python3')
const node = process.env.CRAWSHRIMP_NODE_EXECUTABLE || require('electron')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), '抓虾 CLI acceptance '))
const runtimeRoot = path.join(temporary, 'Application Resources/deepseek-harness')
const skills = path.join(runtimeRoot, 'skills')
const results = []
try {
  fs.mkdirSync(skills, { recursive: true })
  copyDirSync(source, skills)
  const env = builtinRuntimeEnvironment({ runtimeRoot, env: { PATH: process.env.PATH || process.env.Path || '',
    SystemRoot: process.env.SystemRoot || '', TEMP: temporary, TMP: temporary, HOME: temporary, USERPROFILE: temporary,
    CRAWSHRIMP_NODE_EXECUTABLE: node, CRAWSHRIMP_PYTHON_EXECUTABLE: python } })
  const manifest = JSON.parse(fs.readFileSync(path.join(env.CRAWSHRIMP_CLI_ROOT, 'manifest.json'), 'utf8'))
  for (const cli of manifest.clis) {
    const cwd = path.join(env.CRAWSHRIMP_CLI_ROOT, cli.directory)
    const entry = path.join(cwd, process.platform === 'win32' ? (cli.windows_entry || cli.entry) : cli.entry)
    const executable = cli.runtime === 'node' ? node : cli.runtime === 'python' ? python : entry
    const args = cli.runtime === 'node' ? [entry, '--help'] : cli.runtime === 'python' ? ['-m', cli.module, '--help'] : ['--version']
    try {
      let sdk
      if (cli.name === 'deepdraw') {
        const expectedRoot = path.join(repo, 'skills/cli/DeepDrawCLI/vendor/deepdraw-sdk')
        const actualRoot = path.join(cwd, 'vendor/deepdraw-sdk')
        const sdkJars = root => fs.readdirSync(root).filter(name => /^dop-sdk-.*\.jar$/.test(name)).sort()
        const expected = sdkJars(expectedRoot)
        assert.equal(expected.length, 1, 'source CLI must contain exactly one dop SDK')
        assert.deepEqual(sdkJars(actualRoot), expected, 'relocated CLI contains stale or missing SDK jars')
        const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
        const sha256 = digest(path.join(actualRoot, expected[0]))
        assert.equal(sha256, digest(path.join(expectedRoot, expected[0])), 'relocated SDK differs from source')
        sdk = { file: expected[0], sha256 }
      }
      const output = execFileSync(executable, args, {
        cwd: cli.runtime === 'python' ? cwd : temporary,
        env: { ...env, ...(cli.runtime === 'node' ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
          ...(cli.runtime === 'python' ? { PYTHONPATH: path.join(cwd, 'src') } : {}) },
        encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'],
      })
      if (!output.trim()) throw new Error('empty help/version output')
      results.push({ name: cli.name, ok: true, output: output.trim().slice(0, 180), ...(sdk ? { sdk } : {}) })
    } catch (error) {
      results.push({ name: cli.name, ok: false, error: String(error.stderr || error.message).slice(0, 1000) })
    }
  }
  console.log(JSON.stringify({ target, results }, null, 2))
  if (results.length !== 6 || results.some(result => !result.ok)) process.exitCode = 1
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
