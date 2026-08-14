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
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const sourceRoot = resolve(here, '..')
const repoRoot = resolve(sourceRoot, '../..')
const appRoot = join(repoRoot, 'app')
const stageRoot = join(repoRoot, 'build-staging', 'deepseek-harness')

const STAGE_FILES = ['spike.cordis.yml']

const REQUIRED_STAGE_FILES = [
  'package.json',
  'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js',
  'node_modules/@deepseek-ai/dsh-agent-spine-demo/package.json',
  'node_modules/@deepseek-ai/dsh-llm-pi-ai/package.json',
  'node_modules/@deepseek-ai/dsh-mcp-client/package.json',
  'node_modules/@deepseek-ai/dsh-session-persistence-jsonl/package.json',
  'spike.cordis.yml',
]

const args = process.argv.slice(2)
const force = args.includes('--force')
const skipBootCheck = args.includes('--skip-boot-check')

function fail(message) {
  console.error(`[stage-runtime] FAILED: ${message}`)
  process.exit(1)
}

function hashOf(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

const lockHash = hashOf(join(sourceRoot, 'package-lock.json'))
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
  // 未来 Worker 入口(P1)也会随 worker/ 目录一起进来
  const workerDir = join(sourceRoot, 'worker')
  if (existsSync(workerDir)) {
    spawnSync(process.platform === 'win32' ? 'xcopy' : 'cp', ['-R', workerDir, stageRoot], { stdio: 'inherit', shell: true })
  }
  writeFileSync(markerFile, `${lockHash}\n`)
  console.log('[stage-runtime] staging complete')
} else {
  console.log('[stage-runtime] staging up to date (lockfile unchanged), skipping reinstall')
}

for (const rel of REQUIRED_STAGE_FILES) {
  if (!existsSync(join(stageRoot, rel))) fail(`staging missing required file: ${rel}`)
}

// 禁止包校验(方案 §6.2):生产闭包中不得出现禁用能力族
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
  if (existsSync(scoped)) {
    const { readdirSync } = require('node:fs')
    const banned = readdirSync(scoped).filter((name) => BANNED_PACKAGES.some((b) => name === b))
    if (banned.length) fail(`生产闭包含禁用包: ${banned.join(', ')}`)
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
