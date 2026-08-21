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
import {
  getRequiredNativeRuntimePackages,
  resolveElectronExecutable,
  shouldSkipBootCheck,
  stageTargetKey,
} from './stage-runtime-platform.mjs'
import { patchRuntimeDependencies } from './patch-runtime-dependencies.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const sourceRoot = resolve(here, '..')
const repoRoot = resolve(sourceRoot, '../..')
const appRoot = join(repoRoot, 'app')
const stageRoot = join(repoRoot, 'build-staging', 'deepseek-harness')
const stageTarget = { platform: process.platform, arch: process.arch }
const stageTargetId = stageTargetKey(stageTarget)
const runtimeTargetMarkerName = '.crawshrimp-runtime-target.json'
const runtimeTargetMarkerFile = join(stageRoot, runtimeTargetMarkerName)

const STAGE_FILES = ['spike.cordis.yml', 'web-cordis.yml']
const STAGE_PRUNE_VERSION = 'runtime-node-modules-prune-v1'
const PRUNABLE_NODE_MODULE_DIRS = new Set([
  '__tests__',
  'test',
  'tests',
  'example',
  'examples',
  'coverage',
])
const PRUNABLE_NODE_MODULE_FILE_PATTERNS = [
  /\.d\.ts(?:\.map)?$/i,
  /\.(?:js|mjs|cjs)\.map$/i,
  /\.tsbuildinfo$/i,
]

const REQUIRED_STAGE_FILES = [
  runtimeTargetMarkerName,
  'package.json',
  'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js',
  'node_modules/@deepseek-ai/dsh-agent-spine-demo/package.json',
  'node_modules/@deepseek-ai/dsh-client-ui-directory-picker-browse/package.json',
  'node_modules/@deepseek-ai/dsh-host-directory-picker-browse/package.json',
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
const skipBootCheck = shouldSkipBootCheck({ args })

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

function shouldPruneNodeModuleFile(filePath) {
  return PRUNABLE_NODE_MODULE_FILE_PATTERNS.some((pattern) => pattern.test(filePath))
}

function pruneRuntimeNodeModules(root) {
  if (!existsSync(root)) return
  const removed = { dirs: 0, files: 0 }
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (PRUNABLE_NODE_MODULE_DIRS.has(name)) {
          rmSync(p, { recursive: true, force: true })
          removed.dirs += 1
          continue
        }
        walk(p)
      } else if (st.isFile() && shouldPruneNodeModuleFile(p)) {
        rmSync(p, { force: true })
        removed.files += 1
      }
    }
  }
  walk(root)
  console.log(`[stage-runtime] pruned non-runtime node_modules files: ${removed.files} files, ${removed.dirs} dirs`)
}

function hasNativeArtifact(packageRoot, spec) {
  if (!existsSync(packageRoot)) return false
  const pending = [packageRoot]
  while (pending.length) {
    const current = pending.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const target = join(current, entry.name)
      if (entry.isDirectory()) {
        pending.push(target)
      } else if (entry.isFile()) {
        if (spec.artifactName && entry.name === spec.artifactName) return true
        if (spec.artifactExtension && entry.name.endsWith(spec.artifactExtension)) return true
      }
    }
  }
  return false
}

function assertNativeRuntimePackages() {
  for (const spec of getRequiredNativeRuntimePackages(stageTarget)) {
    const packageRoot = join(stageRoot, 'node_modules', ...spec.packagePath.split('/'))
    if (!hasNativeArtifact(packageRoot, spec)) {
      fail(`staging ${stageTargetId} missing native runtime package/artifact: ${spec.packagePath}`)
    }
  }
}

const sourceAssetsHash = ['crawshrimp-launcher', 'crawshrimp-slots', 'crawshrimp-product-bridge', 'worker', 'skills', 'web-cordis.yml']
  .map((p) => hashTree(join(sourceRoot, p)))
  .join(':') + `:${hashOf(fileURLToPath(import.meta.url))}:${hashOf(join(here, 'stage-runtime-platform.mjs'))}:${hashOf(join(here, 'patch-runtime-dependencies.mjs'))}:${STAGE_PRUNE_VERSION}`
const lockHash = hashOf(join(sourceRoot, 'package-lock.json')) + '|' + sourceAssetsHash + '|target:' + stageTargetId
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
  patchRuntimeDependencies(stageRoot)
  // CLI 技能包本体(项目根 skills/cli 的 submodule 内容)随安装包分发:
  // SKILL.md 内路径 skills/cli/<name> 在发布态即 Resources/deepseek-harness/skills/cli
  const cliSource = join(repoRoot, 'skills', 'cli')
  const cliDest = join(stageRoot, 'skills', 'cli')
  if (existsSync(cliSource)) {
    mkdirSync(join(stageRoot, 'skills'), { recursive: true })
    copyDir(cliSource, cliDest)
    if (!existsSync(join(cliDest, 'tmall-cli'))) fail('CLI 技能包本体拷贝不完整')
  }
  pruneRuntimeNodeModules(join(stageRoot, 'node_modules'))
  writeFileSync(runtimeTargetMarkerFile, JSON.stringify(stageTarget, null, 2) + '\n')
  writeFileSync(markerFile, `${lockHash}\n`)
  console.log('[stage-runtime] staging complete')
} else {
  console.log('[stage-runtime] staging up to date (lockfile unchanged), skipping reinstall')
}

for (const rel of REQUIRED_STAGE_FILES) {
  if (!existsSync(join(stageRoot, rel))) fail(`staging missing required file: ${rel}`)
}
assertNativeRuntimePackages()

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
  console.log('[stage-runtime] boot check skipped (flag)')
} else {
  bootCheck()
}

function bootCheck() {
  const electronBin = resolveElectronExecutable(appRoot)
  if (!electronBin) fail('app Electron 可执行文件不存在(打包机请先 npm install)')
  const demoBin = join(stageRoot, 'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js')
  const webBootPort = findFreeLoopbackPort()
  bootCheckProfile(electronBin, demoBin, {
    label: 'spike.cordis.yml',
    cordisFile: 'spike.cordis.yml',
    env: {
      CRAWSHRIMP_SESSION_ROOT: join(stageRoot, '.boot-check-spike-sessions'),
    },
    cleanup: ['.boot-check-spike-sessions'],
  })
  bootCheckProfile(electronBin, demoBin, {
    label: 'web-cordis.yml (Crawshrimp shell directory picker composition)',
    cordisFile: 'web-cordis.yml',
    env: {
      CRAWSHRIMP_DIRECTORY_PICKER_MODE: 'shell',
      CRAWSHRIMP_STAGE_BOOT_CHECK: '1',
      CRAWSHRIMP_SESSION_ROOT: join(stageRoot, '.boot-check-web-sessions'),
      CRAWSHRIMP_STORAGE_ROOT: join(stageRoot, '.boot-check-web-storages'),
      CRAWSHRIMP_WORKSPACE_ROOT: stageRoot,
      CRAWSHRIMP_WEB_PORT: String(webBootPort),
      DSH_HOME: join(stageRoot, '.boot-check-dsh-home'),
    },
    webUrl: `http://127.0.0.1:${webBootPort}/`,
    cleanup: ['.boot-check-web-sessions', '.boot-check-web-storages', '.boot-check-dsh-home'],
  })
  console.log('[stage-runtime] boot checks OK')
}

function findFreeLoopbackPort() {
  const probe = spawnSync(
    process.execPath,
    ['-e', "const net=require('node:net');const server=net.createServer();server.listen(0,'127.0.0.1',()=>{process.stdout.write(String(server.address().port));server.close()})"],
    { encoding: 'utf8', timeout: 5000 },
  )
  const port = Number(String(probe.stdout || '').trim())
  if (probe.status !== 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`无法为 web-cordis boot check 分配本机端口: ${probe.error?.message || probe.stderr || 'unknown error'}`)
  }
  return port
}

function bootCheckProfile(electronBin, demoBin, profile) {
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    DSH_CORDIS_CONFIG: join(stageRoot, profile.cordisFile),
    ...profile.env,
  }
  console.log(`[stage-runtime] boot check ${profile.label}: Electron-as-Node 启动 staged dsh-jsonrpc-agent…`)
  const probe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
import { spawn } from 'node:child_process'
const child = spawn(${JSON.stringify(electronBin)}, [${JSON.stringify(demoBin)}], { stdio: ['pipe', 'pipe', 'inherit'] })
let buf = ''
let initialized = false
const webUrl = ${JSON.stringify(profile.webUrl || '')}
async function verifyWebSurface() {
  if (!webUrl) return
  let lastError
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      const response = await fetch(webUrl)
      const html = await response.text()
      if (!response.ok) throw new Error('HTTP ' + response.status)
      const browseEntry = '"id":"@deepseek-ai/dsh-client-ui-directory-picker-browse"'
      const nativeEntry = '"id":"@deepseek-ai/dsh-client-ui-directory-picker-native"'
      const slotsEntry = '"id":"crawshrimp-slots"'
      if (html.includes(browseEntry)) throw new Error('browse picker client entry unexpectedly active in HTML')
      if (html.includes(nativeEntry)) throw new Error('native picker client entry unexpectedly active in HTML')
      if (!html.includes(slotsEntry)) throw new Error('crawshrimp-slots client entry missing from HTML')
      console.log(${JSON.stringify(profile.label)} + ' web surface: HTTP ' + response.status + ', Crawshrimp slots active, upstream picker absent')
      return
    } catch (error) {
      lastError = error
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
    }
  }
  throw lastError || new Error('web surface unavailable')
}
const done = new Promise((resolveIt) => {
  child.on('error', (error) => {
    console.error(${JSON.stringify(profile.label)} + ' 启动失败:', error.message)
    process.exitCode = 1
    resolveIt()
  })
  child.on('exit', (code) => {
    if (initialized) return
    console.error(${JSON.stringify(profile.label)} + ' 在 initialize 前退出:', code)
    process.exitCode = 1
    resolveIt()
  })
  child.stdout.on('data', (d) => {
    buf += String(d)
    let i
    while ((i = buf.indexOf('\\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
      if (!line) continue
      let msg; try { msg = JSON.parse(line) } catch { continue }
      if (msg.id === 1) {
        initialized = true
        ;(async () => {
          if (msg.error) {
            console.error(${JSON.stringify(profile.label)} + ' initialize error:', JSON.stringify(msg.error))
            process.exitCode = 1
          } else {
            console.log(${JSON.stringify(profile.label)} + ' serverInfo:', JSON.stringify(msg.result?.serverInfo))
            try { await verifyWebSurface() } catch (error) {
              console.error(${JSON.stringify(profile.label)} + ' web surface check failed:', error.message)
              process.exitCode = 1
            }
          }
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'shutdown', params: {} }) + '\\n')
          resolveIt()
        })()
        return
      }
    }
  })
})
const timer = setTimeout(() => { console.error(${JSON.stringify(profile.label)} + ' boot check 超时'); process.exitCode = 1; try { child.kill() } catch {} }, 45000)
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { cwd: ${JSON.stringify(stageRoot)}, provider: 'crawshrimp-overseas-openai', model: 'gpt-5.6-terra', maxTokens: 8000 } }) + '\\n')
await done
clearTimeout(timer)
try { child.stdin.end() } catch {}
`,
    ],
    { cwd: stageRoot, timeout: 60000, env },
  )
  const stdout = String(probe.stdout || '').trim()
  const stderr = String(probe.stderr || '').trim()
  // 清理 boot check 产生的状态目录,避免进入安装包。
  for (const rel of profile.cleanup || []) {
    try { rmSync(join(stageRoot, rel), { recursive: true, force: true }) } catch {}
  }
  if (probe.status !== 0) {
    const detail = [probe.error?.message, stdout, stderr].filter(Boolean).join('\n').slice(-4000)
    fail(`${profile.label} staged runtime boot check exited ${probe.status}: ${detail || 'unknown error'}`)
  }
  if (stdout) console.log(stdout.split('\n').map((line) => `[stage-runtime] ${line}`).join('\n'))
  console.log(`[stage-runtime] boot check ${profile.label} OK`)
}
