/**
 * stage-runtime.mjs — 把 DSH 运行时生产依赖闭包编排到 build-staging,
 * 供 electron-builder 以 extraResources 打包进 Resources/deepseek-harness。
 *
 * 与抓虾打包 Python(scripts/download-python.sh + after-pack.js)同模式:
 * 源码目录(integrations/deepseek-harness)是"开发版",
 * build-staging/deepseek-harness 是"发布版"(仅生产依赖 + 配置模板),
 * 安装包内由 after-pack.js 校验完整性。
 *
 * 用法:
 *   node integrations/deepseek-harness/scripts/stage-runtime.mjs [--force] [--skip-boot-check]
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const sourceRoot = resolve(here, '..')
const repoRoot = resolve(sourceRoot, '../..')
const appRoot = join(repoRoot, 'app')
const stageRoot = join(repoRoot, 'build-staging', 'deepseek-harness')

const STAGE_FILES = ['spike.cordis.yml', 'web-cordis.yml']

const REQUIRED_STAGE_FILES = [
  'package.json',
  'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js',
  'node_modules/@deepseek-ai/dsh-agent-spine-demo/package.json',
  'node_modules/@deepseek-ai/dsh-llm-pi-ai/package.json',
  'node_modules/@deepseek-ai/dsh-mcp-client/package.json',
  'node_modules/@deepseek-ai/dsh-session-persistence-jsonl/package.json',
  'node_modules/@crawshrimp/launcher/package.json',
  'node_modules/@crawshrimp/launcher/index.js',
  'node_modules/crawshrimp-slots/package.json',
  'node_modules/crawshrimp-slots/lib/index.js',
  'node_modules/crawshrimp-slots/lib/client.js',
  'node_modules/crawshrimp-product-bridge/package.json',
  'node_modules/crawshrimp-product-bridge/lib/index.js',
  'node_modules/@deepseek-ai/dsh-cmdline/package.json',
  'node_modules/@deepseek-ai/dsh-web-app/package.json',
  'node_modules/@deepseek-ai/dsh-web-app/lib/startup.js',
  'node_modules/@deepseek-ai/dsh-host-webserver/package.json',
  'node_modules/@deepseek-ai/dsh-client-modules/package.json',
  'spike.cordis.yml',
  'web-cordis.yml',
]

const args = process.argv.slice(2)
const force = args.includes('--force')
const skipBootCheck = args.includes('--skip-boot-check')

function fail(message) {
  console.error(`[stage-runtime] FAILED: ${message}`)
  process.exit(1)
}

function copyDir(src, dest) {
  cpSync(src, dest, { recursive: true, force: true, errorOnExist: false })
}

function hashOf(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** 目录或文件内容哈希(本地插件/worker/skills 变化也要触发重拷)。 */
function hashTree(dir) {
  const h = createHash('sha256')
  if (existsSync(dir) && statSync(dir).isFile()) {
    return h.update(readFileSync(dir)).digest('hex')
  }
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (st.isFile()) h.update(name).update(readFileSync(p))
    }
  }
  if (existsSync(dir)) walk(dir)
  return h.digest('hex')
}

const sourceAssetsHash = ['crawshrimp-launcher', 'crawshrimp-slots', 'crawshrimp-product-bridge', 'worker', 'skills', 'web-cordis.yml']
  .map((p) => hashTree(join(sourceRoot, p)))
  .join(':')
const lockHash = hashOf(join(sourceRoot, 'package-lock.json')) + '|' + sourceAssetsHash
const markerFile = join(stageRoot, '.staged-lock-hash')
const upToDate = !force && existsSync(markerFile) && readFileSync(markerFile, 'utf8').trim() === lockHash

if (!upToDate) {
  console.log('[stage-runtime] staging production closure →', stageRoot)
  rmSync(stageRoot, { recursive: true, force: true })
  mkdirSync(stageRoot, { recursive: true })
  copyFileSync(join(sourceRoot, 'package.json'), join(stageRoot, 'package.json'))
  copyFileSync(join(sourceRoot, 'package-lock.json'), join(stageRoot, 'package-lock.json'))

  const install = spawnSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: stageRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (install.status !== 0) fail(`npm ci --omit=dev exited ${install.status}`)

  for (const file of STAGE_FILES) {
    copyFileSync(join(sourceRoot, file), join(stageRoot, file))
  }
  // Worker 入口、技能包、本地 launcher/slots 插件随 staging 一起进安装包
  // (file: 依赖从这些目录打包)
  for (const dir of ['worker', 'skills', 'crawshrimp-launcher', 'crawshrimp-slots', 'crawshrimp-product-bridge']) {
    const src = join(sourceRoot, dir)
    if (existsSync(src)) {
      copyDir(src, join(stageRoot, dir))
    }
  }
  // CLI 技能包本体(项目根 skills/cli 的 submodule 内容)随安装包分发:
  // SKILL.md 内路径 skills/cli/<name> 在发布态即 Resources/deepseek-harness/skills/cli
  const cliSource = join(repoRoot, 'skills', 'cli')
  const cliDest = join(stageRoot, 'skills', 'cli')
  if (existsSync(cliSource)) {
    mkdirSync(join(stageRoot, 'skills'), { recursive: true })
    copyDir(cliSource, cliDest)
    if (!existsSync(join(cliDest, 'tmall-cli'))) fail('CLI 技能包本体拷贝不完整')
  }
  writeFileSync(markerFile, `${lockHash}\n`)
  console.log('[stage-runtime] staging complete')
} else {
  console.log('[stage-runtime] staging up to date (lockfile unchanged), skipping reinstall')
}

for (const rel of REQUIRED_STAGE_FILES) {
  if (!existsSync(join(stageRoot, rel))) fail(`staging missing required file: ${rel}`)
}

// 禁止能力族校验(方案 §6.2):npm 传递依赖会把禁用包装进闭包,
// 安全保证由 web-cordis.yml 的 disabled 行提供(loader 不 import 禁用行代码)。
// 这里断言:闭包中出现的禁用包,其 cordis 行必须全部 disabled。
const BANNED_PACKAGES = [
  'dsh-tool-bash', 'dsh-tool-bash-persistent', 'dsh-terminal', 'dsh-tool-terminal',
  'dsh-subprocess', 'dsh-subprocess-local',
  'dsh-subagent', 'dsh-tool-subagent', 'dsh-subagent-acp', 'dsh-subagent-claude-code',
  'dsh-subagent-codex', 'dsh-subagent-dsh-sdk',
  'dsh-web-search-deepseek', 'dsh-web-search-exa', 'dsh-web-search-perplexity', 'dsh-tool-web',
  'dsh-session-telemetry', 'dsh-session-telemetry-otel',
]
{
  const scoped = join(stageRoot, 'node_modules', '@deepseek-ai')
  const present = existsSync(scoped) ? new Set(readdirSync(scoped)) : new Set()
  const webYml = readFileSync(join(stageRoot, 'web-cordis.yml'), 'utf8')
  // 解析 name 行(6 空格缩进),取其包名;行 id 是禁用断言的锚点
  const rows = [...webYml.matchAll(/^- id: (\S+)\n  name: '([^']+)'/gm)]
    .map((m) => ({ id: m[1], name: m[2].split('/')[0] }))
  const problems = []
  for (const row of rows) {
    if (!BANNED_PACKAGES.some((b) => row.name.includes(b))) continue
    const block = webYml.slice(webYml.indexOf(`- id: ${row.id}`), webYml.length)
    const next = block.indexOf('\n- id: ')
    const rowText = next >= 0 ? block.slice(0, next) : block
    if (!/^\s*disabled:\s*('true'|true)\s*$/m.test(rowText)) {
      problems.push(`${row.id} (${row.name})`)
    }
  }
  if (problems.length) fail(`web-cordis.yml 中禁用能力行未 disabled: ${problems.join(', ')}`)
  const activeBanned = rows.filter((r) => BANNED_PACKAGES.some((b) => r.name.includes(b)) && !problems.includes(`${r.id} (${r.name})`))
  if (activeBanned.length) {
    console.log(`[stage-runtime] 禁用能力族已在 cordis 行隔离(包仍在闭包,不加载代码): ${activeBanned.map((r) => r.id).join(', ')}`)
  }
}

if (skipBootCheck) {
  console.log('[stage-runtime] boot check skipped')
} else {
  bootCheck()
}

function bootCheck() {
  const electronBin = join(appRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron')
  if (!existsSync(electronBin)) {
    console.warn('[stage-runtime] WARN: app electron 未安装,跳过 boot check(打包机请先 npm install)')
    return
  }
  const demoBin = join(stageRoot, 'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js')
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    DSH_CORDIS_CONFIG: join(stageRoot, 'spike.cordis.yml'),
    CRAWSHRIMP_SESSION_ROOT: join(stageRoot, '.boot-check-sessions'),
  }
  console.log('[stage-runtime] boot check: Electron-as-Node 启动 staged dsh-jsonrpc-agent…')
  const probe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
import { spawn } from 'node:child_process'
const child = spawn(${JSON.stringify(electronBin)}, [${JSON.stringify(demoBin)}], { env: ${JSON.stringify(env)}, stdio: ['pipe', 'pipe', 'inherit'] })
let buf = ''
const done = new Promise((resolveIt) => {
  child.stdout.on('data', (d) => {
    buf += String(d)
    let i
    while ((i = buf.indexOf('\\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
      if (!line) continue
      let msg; try { msg = JSON.parse(line) } catch { continue }
      if (msg.id === 1) {
        if (msg.error) { console.error('initialize error:', JSON.stringify(msg.error)); process.exitCode = 1 }
        else console.log('serverInfo:', JSON.stringify(msg.result?.serverInfo))
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'shutdown', params: {} }) + '\\n')
        resolveIt()
      }
    }
  })
})
const timer = setTimeout(() => { console.error('boot check 超时'); process.exitCode = 1; try { child.kill() } catch {} }, 45000)
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { cwd: ${JSON.stringify(stageRoot)}, provider: 'crawshrimp-overseas-openai', model: 'gpt-5.6-terra', maxTokens: 8000 } }) + '\\n')
await done
clearTimeout(timer)
try { child.stdin.end() } catch {}
`,
    ],
    { cwd: stageRoot, timeout: 60000 },
  )
  if (probe.status !== 0) fail(`staged runtime boot check exited ${probe.status}`)
  // 清理 boot check 产生的会话目录,避免进入安装包
  try { rmSync(join(stageRoot, '.boot-check-sessions'), { recursive: true, force: true }) } catch {}
  console.log('[stage-runtime] boot check OK')
}
