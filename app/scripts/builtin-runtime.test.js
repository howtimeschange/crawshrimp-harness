const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const { builtinRuntimeEnvironment, resolveBuiltinCliRoot } = require('../../integrations/deepseek-harness/worker/builtin-runtime.cjs')
const dwsModule = pathToFileURL(path.resolve(__dirname, '../../integrations/deepseek-harness/scripts/stage-dws-runtime.mjs')).href

test('relocated runtime exposes the same skill root to native DSH and MCP and prepends bundled DWS', () => {
  const root = path.join(os.tmpdir(), '抓虾 installed Resources', 'deepseek-harness')
  const env = builtinRuntimeEnvironment({ runtimeRoot: root, env: { PATH: '/old/dws:/usr/bin', KEEP: 'yes' }, platform: 'darwin' })
  assert.equal(env.CRAWSHRIMP_SKILL_ROOT, path.join(root, 'skills'))
  assert.equal(env.DSH_BUNDLED_SKILL_DIR, env.CRAWSHRIMP_SKILL_ROOT)
  assert.equal(env.CRAWSHRIMP_CLI_ROOT, path.join(root, 'skills/cli'))
  assert.equal(env.CRAWSHRIMP_DWS_EXECUTABLE, path.join(root, 'skills/cli/dws/bin/dws'))
  assert.equal(env.PATH.split(':')[0], path.dirname(env.CRAWSHRIMP_DWS_EXECUTABLE))
  assert.equal(env.KEEP, 'yes')
  assert.equal(builtinRuntimeEnvironment({ runtimeRoot: root, env, platform: 'darwin' }).PATH, env.PATH)
})

test('Windows uses dws.exe and a single PATH key with semicolon-separated entries', () => {
  const env = builtinRuntimeEnvironment({ runtimeRoot: '/fixture', env: { Path: 'C:\\Windows;C:\\tools' }, platform: 'win32' })
  assert.ok(env.CRAWSHRIMP_DWS_EXECUTABLE.endsWith('dws.exe'))
  assert.equal(env.Path, undefined)
  assert.ok(env.PATH.endsWith(';C:\\Windows;C:\\tools'))
  assert.equal(env.DINGDING_ME_AGENT_DWS_BIN, env.CRAWSHRIMP_DWS_EXECUTABLE)
})

test('development prefers the freshly staged CLI closure over a stale source copy', t => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-cli-root-'))
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
  const runtime = path.join(repo, 'integrations/deepseek-harness')
  fs.mkdirSync(path.join(runtime, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(runtime, 'scripts/stage-runtime.mjs'), '')
  const staged = path.join(repo, 'build-staging/deepseek-harness/darwin-arm64/skills/cli')
  fs.mkdirSync(staged, { recursive: true })
  fs.writeFileSync(path.join(staged, 'manifest.json'), '{}')
  assert.equal(resolveBuiltinCliRoot(runtime, {}, 'darwin', 'arm64'), staged)
  assert.equal(resolveBuiltinCliRoot(runtime, { CRAWSHRIMP_CLI_ROOT: '/explicit' }, 'darwin', 'arm64'), path.resolve('/explicit'))
})

test('DWS selects every supported platform asset and rejects unknown targets', async () => {
  const { dwsAssetName } = await import(dwsModule)
  assert.equal(dwsAssetName({ platform: 'darwin', arch: 'arm64' }), 'dws-darwin-arm64.tar.gz')
  assert.equal(dwsAssetName({ platform: 'darwin', arch: 'x64' }), 'dws-darwin-amd64.tar.gz')
  assert.equal(dwsAssetName({ platform: 'win32', arch: 'x64' }), 'dws-windows-amd64.zip')
  assert.equal(dwsAssetName({ platform: 'linux', arch: 'arm64' }), 'dws-linux-arm64.tar.gz')
  assert.throws(() => dwsAssetName({ platform: 'darwin', arch: 'ia32' }), /Unsupported/)
})

test('DWS rejects altered download/cache bytes before extracting or executing them', async t => {
  const { verifyDwsArchive } = await import(dwsModule)
  const file = path.join(os.tmpdir(), `dws-checksum-${process.pid}`)
  t.after(() => fs.rmSync(file, { force: true }))
  fs.writeFileSync(file, 'abc')
  const digest = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  verifyDwsArchive(file, digest)
  fs.appendFileSync(file, 'altered')
  assert.throws(() => verifyDwsArchive(file, digest), /SHA256 mismatch/)
})

test('bundled bmall accepts Commander informational exits but retains real command failures', async () => {
  const { patchBmallHelpExit } = await import('../../integrations/deepseek-harness/scripts/builtin-cli-patches.mjs')
  const original = "try { throw failure }\n    catch (error) {\n        logger.debug({ error }, 'command failed');\n        return 'failed';\n    }"
  const patched = patchBmallHelpExit(original)
  const run = new Function('failure', 'logger', patched)
  assert.equal(run({ code: 'commander.helpDisplayed' }, { debug() {} }), undefined)
  assert.equal(run({ code: 'commander.version' }, { debug() {} }), undefined)
  assert.equal(run({ code: 'commander.unknownCommand' }, { debug() {} }), 'failed')
  assert.equal(patchBmallHelpExit(patched), patched)
  assert.throws(() => patchBmallHelpExit('different source'), /anchor missing/)
})

test('native DSH filesystem provider discovers and loads every bundled skill outside the workspace', async t => {
  const { FileSystemSkillProvider } = await import('../../integrations/deepseek-harness/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js')
  const root = path.resolve(__dirname, '../../integrations/deepseek-harness/skills')
  const controller = new AbortController()
  const warnings = []
  const provider = new FileSystemSkillProvider({ get() {}, logger: { warn: message => warnings.push(message) } },
    { signal: controller.signal, invalidate() {} },
    { includeDefaultRoots: false, bundledSkillDir: root })
  t.after(() => controller.abort())
  const response = await provider.list({ cwd: os.tmpdir() })
  const candidates = Array.isArray(response) ? response : response.candidates
  const expected = fs.readdirSync(root).filter(name => fs.existsSync(path.join(root, name, 'SKILL.md')))
  for (const name of expected) {
    const candidate = candidates.find(item => item.locator?.path === path.join(root, name, 'SKILL.md'))
    assert.ok(candidate, `native skill missing: ${name}; candidates=${JSON.stringify(candidates.map(c => c.locator))}; warnings=${warnings}`)
    const skill = await provider.get(candidate, { signal: controller.signal })
    assert.equal(skill.content, fs.readFileSync(path.join(root, name, 'SKILL.md'), 'utf8').split('---').slice(2).join('---').trim())
  }
})
