const fs = require('node:fs')
const path = require('node:path')

function resolveBuiltinCliRoot(runtimeRoot, env = process.env, platform = process.platform, arch = process.arch) {
  if (env.CRAWSHRIMP_CLI_ROOT) return path.resolve(env.CRAWSHRIMP_CLI_ROOT)
  const staged = path.resolve(runtimeRoot, '../../build-staging/deepseek-harness', `${platform}-${arch}`, 'skills/cli')
  // Source checkouts may contain an old copied skills/cli tree. Prefer the
  // production closure produced by dev's mandatory staging step.
  if (fs.existsSync(path.join(runtimeRoot, 'scripts/stage-runtime.mjs')) &&
      fs.existsSync(path.join(staged, 'manifest.json'))) return staged
  return path.join(runtimeRoot, 'skills', 'cli')
}

function builtinRuntimeEnvironment({ runtimeRoot, cliRoot, env = process.env, platform = process.platform }) {
  const root = path.resolve(runtimeRoot)
  const skills = path.resolve(env.CRAWSHRIMP_SKILL_ROOT || path.join(root, 'skills'))
  const cli = path.resolve(cliRoot || resolveBuiltinCliRoot(root, env, platform))
  const bin = path.join(cli, 'dws', 'bin')
  const executable = path.join(bin, platform === 'win32' ? 'dws.exe' : 'dws')
  const result = { ...env }
  const separator = platform === 'win32' ? ';' : ':'
  const pathKey = Object.keys(result).find(key => key.toLowerCase() === 'path') || 'PATH'
  const previous = String(result[pathKey] || '')
  // Windows env keys are case-insensitive; avoid two conflicting Path/PATHs.
  for (const key of Object.keys(result)) if (key.toLowerCase() === 'path') delete result[key]
  result.PATH = [bin, ...previous.split(separator).filter(value => value && value !== bin)].join(separator)
  return {
    ...result,
    CRAWSHRIMP_SKILL_ROOT: skills,
    DSH_BUNDLED_SKILL_DIR: skills,
    CRAWSHRIMP_CLI_ROOT: cli,
    CRAWSHRIMP_DWS_EXECUTABLE: executable,
    DINGDING_ME_AGENT_DWS_BIN: executable,
  }
}

module.exports = { builtinRuntimeEnvironment, resolveBuiltinCliRoot }
