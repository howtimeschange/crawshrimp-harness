const assert = require('node:assert/strict')
const { existsSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')
const { inflateSync } = require('node:zlib')

const appRoot = resolve(__dirname, '..')

function paethPredictor(left, up, upperLeft) {
  const estimate = left + up - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left
  if (upDistance <= upperLeftDistance) return up
  return upperLeft
}

function readPngRgba(filePath) {
  const source = readFileSync(filePath)
  const signature = source.subarray(0, 8)
  assert.equal(signature.toString('hex'), '89504e470d0a1a0a')
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []
  while (offset < source.length) {
    const length = source.readUInt32BE(offset)
    const type = source.subarray(offset + 4, offset + 8).toString('ascii')
    const data = source.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      assert.equal(data[12], 0, 'interlaced PNGs are not supported by this test decoder')
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  assert.equal(bitDepth, 8)
  assert.equal(colorType, 6)
  const bytesPerPixel = 4
  const stride = width * bytesPerPixel
  const inflated = inflateSync(Buffer.concat(idat))
  const pixels = Buffer.alloc(width * height * bytesPerPixel)
  let inputOffset = 0
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset]
    inputOffset += 1
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[inputOffset + x]
      const left = x >= bytesPerPixel ? pixels[y * stride + x - bytesPerPixel] : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const upperLeft = y > 0 && x >= bytesPerPixel ? pixels[(y - 1) * stride + x - bytesPerPixel] : 0
      let value = raw
      if (filter === 1) value = raw + left
      else if (filter === 2) value = raw + up
      else if (filter === 3) value = raw + Math.floor((left + up) / 2)
      else if (filter === 4) value = raw + paethPredictor(left, up, upperLeft)
      else assert.equal(filter, 0)
      pixels[y * stride + x] = value & 0xff
    }
    inputOffset += stride
  }
  return {
    width,
    height,
    pixelAt(x, y) {
      const index = (y * stride) + (x * bytesPerPixel)
      return {
        r: pixels[index],
        g: pixels[index + 1],
        b: pixels[index + 2],
        a: pixels[index + 3],
      }
    },
  }
}

test('worker absolute timeout cancels only the active Session and keeps the IM Host alive', () => {
  const source = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/worker/worker.mjs'), 'utf8')
  const timeoutBody = source.match(/timer:\s*setTimeout\(\(\)\s*=>\s*\{([\s\S]*?)\},\s*RUN_ABSOLUTE_TIMEOUT_MS\)/)?.[1] || ''
  assert.match(timeoutBody, /cancelActiveRuntimeSession\(run,/)
  assert.doesNotMatch(timeoutBody, /stopRuntime\(\)/)
  assert.match(timeoutBody, /RUN_TIMEOUT/)
})

test('worker auto-continues text output budgets without restarting the runtime', () => {
  const source = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/worker/worker.mjs'), 'utf8')
  assert.match(source, /maxTextDeltas/)
  assert.match(source, /maxOutputChars/)
  assert.match(source, /maxOutputSegments/)
  assert.match(source, /minOutputDeltasBeforePause/)
  assert.match(source, /maxTextDeltaRatePerSecond/)
  assert.match(source, /outputRateWindowMs/)
  assert.match(source, /outputDeltaTimes/)
  assert.match(source, /function extractEventDeltaText\(data\)/)
  assert.match(source, /function recordAssistantOutput\(run, text\)/)
  assert.match(source, /outputChars \+= text\.length/)
  assert.match(source, /文本输出速率过高/)
  assert.match(source, /function outputBudgetName\(\)/)
  assert.match(source, /文本增量预算耗尽/)
  assert.match(source, /输出长度预算耗尽/)
  assert.match(source, /session\/cancel/)
  assert.match(source, /function continueRunAfterOutputBudget\(run\)/)
  assert.match(source, /只输出后续内容,不要重复已经写过的内容/)
  assert.match(source, /status:\s*'interrupted'/)
  assert.match(source, /OUTPUT_BUDGET_REACHED/)
  assert.match(source, /resumable:\s*true/)
  const continuation = source.match(/function continueRunAfterOutputBudget\(run\)\s*\{[\s\S]*?\n\}/)?.[0] || ''
  assert.match(continuation, /runtime\.continueOutput\(\{[\s\S]*?sessionId:\s*run\.sessionId[\s\S]*?text,/)
  assert.doesNotMatch(continuation, /runtime\.prompt\(/)
  assert.match(continuation, /agent\/inbox\/spliced[\s\S]*?internal:\s*true/)
})

test('worker output protection defaults are long-form friendly and pressure-based', () => {
  const source = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/worker/worker.mjs'), 'utf8')
  assert.match(source, /CRAWSHRIMP_AGENT_MAX_TEXT_DELTAS \|\| 12000/)
  assert.match(source, /CRAWSHRIMP_AGENT_MAX_OUTPUT_CHARS \|\| 240000/)
  assert.match(source, /CRAWSHRIMP_AGENT_MAX_OUTPUT_SEGMENTS \|\| 6/)
  assert.match(source, /CRAWSHRIMP_AGENT_MIN_OUTPUT_DELTAS_BEFORE_PAUSE \|\| 2500/)
  assert.match(source, /CRAWSHRIMP_AGENT_MAX_TEXT_DELTA_RATE_PER_SECOND \|\| 32/)
  assert.match(source, /CRAWSHRIMP_AGENT_OUTPUT_RATE_WINDOW_MS \|\| 10000/)
  assert.match(source, /outputPressureName\(run, b\)/)
})

test('worker keeps every mutable DSH runtime path under CRAWSHRIMP_DATA', () => {
  const source = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/worker/worker.mjs'), 'utf8')
  assert.match(source, /DSH_HOME:\s*process\.env\.DSH_HOME\s*\|\|\s*`\$\{state\.dataRoot\}\/agent\/dsh-home`/)
  assert.match(source, /CRAWSHRIMP_STORAGE_ROOT:\s*process\.env\.CRAWSHRIMP_STORAGE_ROOT\s*\|\|\s*`\$\{state\.dataRoot\}\/agent\/storages`/)
  assert.match(source, /CRAWSHRIMP_SESSION_ROOT:\s*process\.env\.CRAWSHRIMP_SESSION_ROOT\s*\|\|\s*`\$\{state\.dataRoot\}\/agent\/harness-sessions`/)
})

test('worker compacts image-heavy user message events before FastAPI notifications', () => {
  const source = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/worker/worker.mjs'), 'utf8')
  assert.match(source, /function compactHarnessEvent\(event\)/)
  assert.match(source, /event\.type !== 'user\/message'/)
  assert.match(source, /event:\s*compactHarnessEvent\(event\)/)
  assert.match(source, /function extractEventText\(data\)/)
})

test('staged DSH rc.1 runtime applies the small verified 4.11 source overlay after a clean install', () => {
  const patcherPath = resolve(appRoot, '../integrations/deepseek-harness/scripts/patch-runtime-dependencies.mjs')
  assert.equal(existsSync(patcherPath), true, 'runtime dependency patcher must be packaged from source')
  const patcher = readFileSync(patcherPath, 'utf8')
  const staging = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/scripts/stage-runtime.mjs'), 'utf8')
  assert.match(patcher, /RUNTIME_GUARD_MARKER/)
  assert.match(patcher, /patched:\s*true/)
  assert.match(patcher, /DSH_IM_USER_VISIBLE_SOURCE_ROOTS = \['src', 'plugin-src', 'lib'\]/)
  assert.match(patcher, /CRAWSHRIMP_DSH_IM_NATURAL_CONTROLS_MARKER/)
  assert.match(patcher, /CRAWSHRIMP_DSH_IM_SESSION_PERMISSION_MARKER/)
  assert.match(patcher, /CRAWSHRIMP_DEEPSEEK_VISION_BRIDGE_MARKER/)
  assert.match(patcher, /crawshrimpBridgeDeepSeekImages/)
  assert.match(patcher, /deepseek-v4-flash-vision-exp/)
  assert.match(patcher, /upstreamModelDispatch/)
  assert.match(patcher, /TextHarnessBridge natural model dispatch/)
  assert.match(patcher, /@deepseek-ai\/dsh\/package\.json[\s\S]*0\.1\.2-rc\.1/)
  assert.match(patcher, /@deepseek-ai\/dsh-web-app\/package\.json[\s\S]*0\.1\.2-rc\.1/)
  assert.match(patcher, /@deepseek-ai\/dsh-api-workspace-controller\/package\.json/)
  assert.match(patcher, /@deepseek-ai\/dsh-cordis-host-runner\/package\.json/)
  assert.match(patcher, /@deepseek-ai\/dsh-attachment-local\/package\.json/)
  assert.match(patcher, /@deepseek-ai\/dsh-llm-pi-ai\/package\.json/)
  assert.match(patcher, /@deepseek-ai\/dsh-time-context\/package\.json/)
  assert.match(patcher, /@deepseek-ai\/dsh-schedule\/package\.json/)
  assert.match(patcher, /assertEffectiveProfileRootClosure/)
  assert.match(patcher, /dsh-base\/cordis\.patch\.yml/)
  assert.match(patcher, /dsh-web-app\/cordis\.patch\.yml/)
  assert.match(patcher, /assertStandardPresetRootClosure/)
  assert.match(patcher, /dsh-agent-presets\/presets\/standard\/agent\.cordis\.yml/)
  assert.match(patcher, /crawshrimp-standard\/agent\.cordis\.yml/)
  assert.match(patcher, /@xmanrui\/dsh-im\/package\.json[\s\S]*4\.11\.0/)
  assert.match(patcher, /inbound-ttl\.mjs[\s\S]*DEFAULT_INBOUND_TTL_HOURS = 168/)
  assert.match(patcher, /harness-session-binding\.mjs/)
  assert.match(patcher, /model-setting\.mjs/)
  assert.match(staging, /patchRuntimeDependencies\(stageRoot\)/)
})

test('dsh-im brief-card patch accepts fresh upstream and already-branded 4.11 approval text', async () => {
  const patcherPath = resolve(appRoot, '../integrations/deepseek-harness/scripts/patch-runtime-dependencies.mjs')
  const { patchDshImApprovalBriefCardSource } = await import(`${pathToFileURL(patcherPath).href}?approval-brief-fresh-red=${Date.now()}`)
  const toolArguments = [
    'function toolArguments(toolCall) {',
    '  const source = toolCall?.arguments;',
    '  if (source !== null && typeof source === \'object\') {',
    '    try {',
    '      return JSON.stringify(source, null, 2);',
    '    } catch {',
    '      return null;',
    '    }',
    '  }',
    '  if (typeof source !== \'string\') return null;',
    '  const raw = printableText(source);',
    '  // Harness treats an empty tool argument string as an empty object.',
    '  if (!raw) return source === \'\' ? \'{}\' : null;',
    '  try {',
    '    return JSON.stringify(JSON.parse(raw), null, 2);',
    '  } catch {',
    '    return raw;',
    '  }',
    '}',
  ].join('\n')
  const approvalText = (brand) => [
    '  const lines = [',
    `    t('${brand} 需要你的审批：'),`,
    '    \'\',',
    "    t('工具：{tool}', { tool: printableText(payload.toolName) }),",
    "    t('操作参数：'),",
    '    operation,',
    '  ];',
    '  const reason = printableText(payload.reason);',
    "  if (reason) lines.push(t('原因：{reason}', { reason }));",
  ].join('\n')

  for (const brand of ['DeepSeek Harness', '抓虾 Harness']) {
    const freshSource = `${toolArguments}\n${approvalText(brand)}`
    const patched = patchDshImApprovalBriefCardSource(freshSource)
    assert.match(patched, /crawshrimp-dsh-im-411-approval-brief-card-v1/)
    assert.match(patched, /t\('抓虾 Harness 需要你的审批'\)/)
    assert.match(patched, /简略参数：/)
    assert.doesNotMatch(patched, /需要你的审批：/)
    assert.equal(patchDshImApprovalBriefCardSource(patched), patched)
  }
})

test('the runtime guard accepts both the source profile layout and the staged profile layout', async () => {
  const patcherPath = resolve(appRoot, '../integrations/deepseek-harness/scripts/patch-runtime-dependencies.mjs')
  const runtimeRoot = resolve(appRoot, '../integrations/deepseek-harness')
  const { patchRuntimeDependencies } = await import(`${pathToFileURL(patcherPath).href}?source-layout=${Date.now()}`)

  const result = patchRuntimeDependencies(runtimeRoot)

  assert.match(result.crawshrimpPreset, /profile\/web\/agent-presets\/crawshrimp-standard\/agent\.cordis\.yml$/)
  assert.match(result.deepseekVisionBridge.entry, /dsh-llm-pi-ai\/lib\/index\.js$/)
})

test('runtime admits image prompts to the installed Vision bridge only for official DeepSeek Flash and Pro', async () => {
  const patcherPath = resolve(appRoot, '../integrations/deepseek-harness/scripts/patch-runtime-dependencies.mjs')
  const runtimeRoot = resolve(appRoot, '../integrations/deepseek-harness')
  const controllerPath = resolve(runtimeRoot, 'node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js')
  const { patchRuntimeDependencies } = await import(`${pathToFileURL(patcherPath).href}?vision-admission=${Date.now()}`)

  const result = patchRuntimeDependencies(runtimeRoot)
  const controller = readFileSync(controllerPath, 'utf8')

  assert.match(result.deepseekVisionAdmission.entry, /dsh-api-session-controller\/lib\/index\.js$/)
  assert.match(controller, /crawshrimp-deepseek-vision-admission-v1/)
  assert.match(controller, /current\.provider === "crawshrimp-deepseek-official"/)
  assert.match(controller, /current\.model === "deepseek-v4-flash"/)
  assert.match(controller, /current\.model === "deepseek-v4-pro"/)
  assert.match(controller, /!crawshrimpVisionBridgeAllowsImageAdmission/)
  assert.match(controller, /MODEL_DOES_NOT_SUPPORT_IMAGES/)
})

test('rc.1 Web native approval card exposes allow-all through the current Session command seam', async () => {
  const patcherPath = resolve(appRoot, '../integrations/deepseek-harness/scripts/patch-runtime-dependencies.mjs')
  const runtimeRoot = resolve(appRoot, '../integrations/deepseek-harness')
  const approvalPath = resolve(runtimeRoot, 'node_modules/@deepseek-ai/dsh-client-ui-approval/lib/client.js')
  const { patchRuntimeDependencies } = await import(`${pathToFileURL(patcherPath).href}?web-approval-allow-all-red=${Date.now()}`)

  patchRuntimeDependencies(runtimeRoot)
  const source = readFileSync(approvalPath, 'utf8')

  assert.match(source, /crawshrimp-dsh-im-411-web-approval-allow-all-v1/)
  assert.match(source, /runCommand\("\/permission danger-full-access"\)/)
  assert.match(source, /pending\.answer\("allowed-once"\)/)
  assert.match(source, /children: t\("allowAll"\)/)
  assert.match(source, /inject: \(sessionId\) => \(\{/)
  assert.match(source, /sessions\.binding\(sessionId\)\?\.session/)
  assert.match(source, /result\.ok && result\.value\.matched/)
})

test('DeepSeek Vision preflight audit retains structured fields in logger and stderr', async () => {
  const patcherPath = resolve(appRoot, '../integrations/deepseek-harness/scripts/patch-runtime-dependencies.mjs')
  const runtimeRoot = resolve(appRoot, '../integrations/deepseek-harness')
  const bridgePath = resolve(runtimeRoot, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js')
  const { patchRuntimeDependencies } = await import(`${pathToFileURL(patcherPath).href}?vision-audit-red=${Date.now()}`)

  patchRuntimeDependencies(runtimeRoot)
  const source = readFileSync(bridgePath, 'utf8')

  assert.match(source, /crawshrimp-deepseek-vision-audit-v1/)
  assert.match(source, /event:\s*"deepseek_vision_preflight"/)
  assert.match(source, /vision_preflight:\s*true/)
  assert.match(source, /original_model:\s*model/)
  assert.match(source, /vision_model:\s*visionModel/)
  assert.match(source, /session_id:\s*sessionId \?\? null/)
  assert.match(source, /process\.stderr\.write\("crawshrimp\.audit "/)
})

test('runtime suppresses native web registration even when an upstream preset mounts tool-web', async () => {
  const patcherPath = resolve(appRoot, '../integrations/deepseek-harness/scripts/patch-runtime-dependencies.mjs')
  const runtimeRoot = resolve(appRoot, '../integrations/deepseek-harness')
  const toolWebPath = resolve(runtimeRoot, 'node_modules/@deepseek-ai/dsh-tool-web/lib/index.js')
  const { patchRuntimeDependencies } = await import(`${pathToFileURL(patcherPath).href}?native-web=${Date.now()}`)
  patchRuntimeDependencies(runtimeRoot)
  const toolWeb = await import(`${pathToFileURL(toolWebPath).href}?native-web=${Date.now()}`)
  const calls = []
  const original = process.env.CRAWSHRIMP_DISABLE_NATIVE_WEB
  process.env.CRAWSHRIMP_DISABLE_NATIVE_WEB = '1'
  try {
    toolWeb.apply({
      systemPrompt: { section: (...args) => calls.push(['prompt', args]) },
      tools: { register: (...args) => calls.push(['tool', args]) },
    }, {
      search: true,
      fetch: true,
      searchMaxResults: 8,
      searchMaxQueries: 4,
      fetchTimeoutMs: 30_000,
      searchTimeoutMs: 30_000,
      fetchMaxOutputChars: 200_000,
    })
  } finally {
    if (original === undefined) delete process.env.CRAWSHRIMP_DISABLE_NATIVE_WEB
    else process.env.CRAWSHRIMP_DISABLE_NATIVE_WEB = original
  }
  assert.deepEqual(calls, [], 'web_search/web_fetch must never be registered in a Crawshrimp runtime')
  assert.match(readFileSync(toolWebPath, 'utf8'), /crawshrimp-disable-native-web-tools-v1/)
})

test('session header guard rejects native web tools before a prompt can proceed', async () => {
  const clientPath = resolve(appRoot, '../integrations/deepseek-harness/worker/web-rpc-client.mjs')
  const { assertSessionHeadersExcludeNativeWebTools } = await import(`${pathToFileURL(clientPath).href}?header-guard=${Date.now()}`)
  const nativeHeader = {
    type: 'request/header',
    data: { header: { tools: [{ name: 'browser_observe' }, { name: 'web_search' }, { name: 'web_fetch' }] } },
  }

  assert.throws(
    () => assertSessionHeadersExcludeNativeWebTools([nativeHeader]),
    (error) => error?.code === 'NATIVE_WEB_TOOL_POLICY' && /web_search, web_fetch/.test(error.message),
  )
  assert.doesNotThrow(() => assertSessionHeadersExcludeNativeWebTools([{
    type: 'request/header',
    data: { header: { tools: [{ name: 'browser_observe' }] } },
  }]))
  const worker = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/worker/worker.mjs'), 'utf8')
  assert.match(worker, /onSnapshotComplete:[\s\S]*?assertSessionHeadersExcludeNativeWebTools/)
  assert.match(worker, /onEvent:[\s\S]*?assertSessionHeadersExcludeNativeWebTools/)
})

test('migration guard retains a real workspace write probe and strict user-image boundary', () => {
  const patcher = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/scripts/patch-runtime-dependencies.mjs'), 'utf8')
  assert.match(patcher, /CRAWSHRIMP_WORKSPACE_ACCESS_PROBE_MARKER/)
  assert.match(patcher, /probeWorkspaceDirectoryAccess/)
  assert.match(patcher, /await handle\.sync\(\)/)
  assert.match(patcher, /await rename\(temporary, renamed\)/)
  assert.match(patcher, /function crawshrimpLatestImageUserMessageIndex\(messages\)/)
  assert.match(patcher, /message\.role === "user" && contentHasImage\(message\.content\)/)
  assert.doesNotMatch(patcher, /function crawshrimpLatestImageMessageIndex\(messages\)/)
})

test('Crawshrimp standard preset owns the effective persona and routes webpage work through the CDP skill', () => {
  const profilePatch = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/profile/web/cordis.patch.yml'), 'utf8')
  const preset = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/profile/web/agent-presets/crawshrimp-standard/agent.cordis.yml'), 'utf8')
  const presetMetadata = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/profile/web/agent-presets/crawshrimp-standard/preset.yml'), 'utf8')
  const personaExpression = /^\s+text: !!js (.+)$/mu.exec(preset)?.[1]
  const worker = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/worker/worker.mjs'), 'utf8')
  const webClient = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/worker/web-rpc-client.mjs'), 'utf8')
  const staging = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/scripts/stage-runtime.mjs'), 'utf8')

  assert.match(profilePatch, /id: agent-presets[\s\S]*?default: crawshrimp-standard/)
  assert.match(profilePatch, /roots:[\s\S]*?dshHomePath\('profiles\/web\/agent-presets'\)/)
  assert.match(presetMetadata, /name: 抓虾工作模式（推荐）/)
  assert.match(presetMetadata, /description: 适合日常抓虾任务/)
  assert.match(staging, /agent-presets\/crawshrimp-standard\/preset\.yml/)
  assert.match(preset, /id: persona[\s\S]*?CRAWSHRIMP_AGENT_PERSONA/)
  assert.match(preset, /你是抓虾智能体/)
  for (const packageName of [
    '@deepseek-ai/dsh-tool-bash',
    '@deepseek-ai/dsh-tool-fs',
    '@deepseek-ai/dsh-tool-fs-search',
    '@deepseek-ai/dsh-tool-skill',
    '@deepseek-ai/dsh-tool-subagent',
    '@deepseek-ai/dsh-tool-workflow',
  ]) assert.match(preset, new RegExp(`name: '${packageName}'`), `${packageName} must remain mounted`)
  assert.match(preset, /所有网页任务必须使用抓虾 CDP 浏览器通道/)
  assert.match(preset, /skill_read.*crawshrimp-skill\/SKILL\.md/)
  assert.ok(personaExpression, 'product persona must be a single valid JavaScript expression')
  assert.doesNotThrow(() => new Function(`return (${personaExpression})`))
  assert.match(preset, /id: tool-web[\s\S]*?disabled: true/)
  assert.match(preset, /Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode/)
  assert.match(preset, /The tool catalog stays the same across modes for request-cache stability/)
  assert.match(preset, /Make exit_plan_mode the only and final tool call in that assistant response/)
  assert.match(worker, /agentPreset:\s*'crawshrimp-standard'/)
  assert.match(webClient, /agentPreset = 'crawshrimp-standard'/)
})

test('standard rc.1 Web profile retains the product operational surface without the parallel generic web route', () => {
  const profile = JSON.parse(readFileSync(resolve(appRoot, '../integrations/deepseek-harness/profile/web/package.json'), 'utf8'))
  const webBundle = JSON.parse(readFileSync(resolve(appRoot, '../integrations/deepseek-harness/node_modules/@deepseek-ai/dsh-web-app/package.json'), 'utf8'))
  const patch = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/profile/web/cordis.patch.yml'), 'utf8')
  const standardPreset = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml'), 'utf8')
  assert.deepEqual(profile.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@xmanrui/dsh-im'])
  for (const packageName of [
    '@deepseek-ai/dsh-tool-subagent',
    '@deepseek-ai/dsh-client-ui-settings-plugin-inventory',
    '@deepseek-ai/dsh-client-ui-permission-presets',
    '@deepseek-ai/dsh-client-ui-plan',
    '@deepseek-ai/dsh-client-ui-schedule',
    '@deepseek-ai/dsh-client-ui-skill',
    '@deepseek-ai/dsh-client-ui-workflow-run',
    '@deepseek-ai/dsh-client-ui-workspace',
  ]) assert.equal(webBundle.dependencies[packageName], '^0.1.2-rc.1', `${packageName} must remain in the Web profile`)
  assert.match(patch, /id: schedule/)
  assert.match(patch, /id: ui-schedule[\s\S]*disabled:\s*false/)
  for (const [id, packageName] of [
    ['agent-instructions', '@deepseek-ai/dsh-agent-instructions'],
    ['tool-bash', '@deepseek-ai/dsh-tool-bash'],
    ['tool-fs', '@deepseek-ai/dsh-tool-fs'],
    ['tool-fs-search', '@deepseek-ai/dsh-tool-fs-search'],
    ['tool-jobs', '@deepseek-ai/dsh-tool-jobs'],
    ['tool-skill', '@deepseek-ai/dsh-tool-skill'],
    ['tool-subagent-control', '@deepseek-ai/dsh-tool-subagent-control'],
    ['tool-subagent', '@deepseek-ai/dsh-tool-subagent'],
    ['tool-workflow', '@deepseek-ai/dsh-tool-workflow'],
  ]) {
    assert.match(standardPreset, new RegExp(`id: ${id}[\\s\\S]*?name: '${packageName}'`), `${id} must be usable by the standard preset`)
  }
  assert.match(standardPreset, /id: tool-web[\s\S]*fetch: true/)
  assert.match(patch, /id: approval/)
  assert.match(patch, /id: permission/)
  for (const id of [
    'agent-instructions',
    'command-goal',
    'plan-mode',
    'skill-filesystem',
    'tool-bash',
    'tool-fs',
    'tool-fs-search',
    'tool-str-replace-editor',
    'tool-skill',
    'tool-goal',
    'tool-todo',
    'tool-jobs',
    'tool-subagent',
    'tool-subagent-fork',
    'tool-subagent-control',
    'tool-subagent-list-agents',
    'tool-workflow',
    'workflow-worker-thread',
  ]) {
    assert.match(patch, new RegExp(`- id: ${id}\\s+disabled: false`), `${id} must be enabled in Crawshrimp's Web profile`)
  }
  assert.match(patch, /- id: tool-web\s+disabled: true/)
})

test('rc.1 Web transport keeps image input and session-follow without reviving the old SDK patch', () => {
  const worker = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/worker/worker.mjs'), 'utf8')
  const client = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/worker/web-rpc-client.mjs'), 'utf8')
  const profile = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/profile/web/cordis.patch.yml'), 'utf8')
  assert.match(worker, /MODEL_IMAGE_MEDIA_TYPES/)
  assert.match(worker, /type:\s*'image'[\s\S]*?data:\s*readFileSync\(imagePath\)\.toString\('base64'\)/)
  assert.match(client, /endpoint:\s*'session\/follow'/)
  assert.match(client, /type\s*===\s*['"]snapshot['"]/)
  assert.match(profile, /id:\s*deepseek-v4-flash-vision-exp[\s\S]*input:\s*\[text, image\]/)
  assert.doesNotMatch(client, /dsh-sdk-jsonrpc-demo/)
})

test('the Vision model is not forced onto a DeepSeek-only reasoning effort', () => {
  const profile = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/profile/web/cordis.patch.yml'), 'utf8')
  const deepseekProvider = profile.split('crawshrimp-deepseek-official:', 2)[1].split('crawshrimp-overseas-openai:', 1)[0]
  const visionModel = deepseekProvider.split('- id: deepseek-v4-flash-vision-exp', 2)[1].split('crawshrimp-overseas-openai:', 1)[0]
  assert.doesNotMatch(deepseekProvider, /^\s+reasoning:\s+high\s*$/mu)
  assert.match(visionModel, /input:\s*\[text, image\]/)
})

test('rc.1 Session follow projects inner events from live envelopes and snapshot chunk rows', async () => {
  const clientUrl = pathToFileURL(resolve(appRoot, '../integrations/deepseek-harness/worker/web-rpc-client.mjs'))
  const { wireEvents, activeTurnEvents } = await import(`${clientUrl.href}?follow-frame=${Date.now()}`)
  const turnEnd = { type: 'turn/end', seq: 7, data: { reason: { kind: 'completed' } } }
  const assistantChunkRow = { type: 'chunkrow/text-chunks', seq: 6, data: { chunks: [{ text: '抓虾中' }] } }

  assert.deepEqual(wireEvents({ type: 'event', event: turnEnd }), [turnEnd])
  assert.deepEqual(wireEvents({
    type: 'snapshot',
    records: [
      { type: 'event', event: { type: 'turn/start', seq: 5, data: {} } },
      { type: 'chunks', event: assistantChunkRow },
      { type: 'unknown', event: { type: 'turn/end', seq: 999, data: {} } },
    ],
  }), [
    { type: 'turn/start', seq: 5, data: {} },
    assistantChunkRow,
  ])
  assert.deepEqual(wireEvents({ type: 'event' }), [])
  assert.deepEqual(activeTurnEvents([
    { type: 'turn/start', seq: 1 },
    { type: 'turn/end', seq: 2 },
    { type: 'turn/start', seq: 3 },
    { type: 'assistant/chunk', seq: 4 },
  ]), [
    { type: 'turn/start', seq: 3 },
    { type: 'assistant/chunk', seq: 4 },
  ])
  assert.deepEqual(activeTurnEvents([
    { type: 'turn/start', seq: 1 },
    { type: 'turn/end', seq: 2 },
  ]), [])
})

test('Web RPC reasserts a product session model through the authenticated Session API', async () => {
  const clientUrl = pathToFileURL(resolve(appRoot, '../integrations/deepseek-harness/worker/web-rpc-client.mjs'))
  const { DshWebRuntime } = await import(`${clientUrl.href}?session-model=${Date.now()}`)
  const originalFetch = global.fetch
  const requests = []
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(String(options.body)) })
    return new Response(JSON.stringify({ ok: true, selected: { provider: 'crawshrimp-deepseek-official', model: 'deepseek-v4-flash-vision-exp' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const runtime = new DshWebRuntime({ child: { exitCode: 0 }, origin: 'http://127.0.0.1:19099', cookie: 'session=test', launchUrl: 'http://127.0.0.1:19099/?<redacted>' })
    const result = await runtime.selectModel({
      sessionId: 'dsh-test',
      provider: 'crawshrimp-deepseek-official',
      model: 'deepseek-v4-flash-vision-exp',
    })
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, 'http://127.0.0.1:19099/api/crawshrimp/session/select-model')
    assert.deepEqual(requests[0].body, {
      sessionId: 'dsh-test',
      provider: 'crawshrimp-deepseek-official',
      model: 'deepseek-v4-flash-vision-exp',
    })
    assert.equal(result.selected.model, 'deepseek-v4-flash-vision-exp')
  } finally {
    global.fetch = originalFetch
  }
})

test('Web startup diagnostics redact every one-time launch URL query parameter', async () => {
  const clientUrl = pathToFileURL(resolve(appRoot, '../integrations/deepseek-harness/worker/web-rpc-client.mjs'))
  const { redactWebDiagnostic } = await import(`${clientUrl.href}?diagnostic-redaction=${Date.now()}`)
  const diagnostic = redactWebDiagnostic('dsh web: http://127.0.0.1:19077/launch?temporary_launch_capability=secret-value&token=also-secret')
  assert.match(diagnostic, /http:\/\/127\.0\.0\.1:19077\/launch\?<redacted>/)
  assert.doesNotMatch(diagnostic, /secret-value|also-secret/)
})

test('desktop dev shell patches DSH runtime dependencies before backend launch', () => {
  const main = readFileSync(resolve(appRoot, 'src/main.js'), 'utf8')
  assert.match(main, /function patchDeepseekHarnessDevRuntime\(harnessRoot\)/)
  assert.match(main, /patch-runtime-dependencies\.mjs/)
  assert.match(main, /ELECTRON_RUN_AS_NODE:\s*'1'/)
  assert.match(main, /patchDeepseekHarnessDevRuntime\(deepseekHarnessRoot\)/)
  assert.match(main, /CRAWSHRIMP_HARNESS_ROOT:\s*deepseekHarnessRoot/)
})

test('product bridge leases the matching DSH session and honors its approval policy', () => {
  const source = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/crawshrimp-product-bridge/lib/index.js'), 'utf8')
  assert.match(source, /ctx\.on\(['"]tools\/execute['"]/)
  assert.match(source, /postMcpContext\(['"]acquire['"]/) 
  assert.match(source, /postMcpContext\(['"]release['"]/) 
  assert.match(source, /exec\.agent\?\.id/)
  assert.match(source, /finally/)
  assert.match(source, /effectivePolicy\(agent\.session\)/)
  assert.match(source, /policy === ['"]never['"][\s\S]*?outcome: ['"]allowed-once['"]/) 
})

test('agent SSE consumers reconnect from the last persisted event id', () => {
  const productLayer = readFileSync(resolve(appRoot, 'src/renderer/components/agent/AgentProductLayer.vue'), 'utf8')
  const agentHome = readFileSync(resolve(appRoot, 'src/renderer/views/AgentHome.vue'), 'utf8')
  assert.match(productLayer, /lastEventSeq/)
  assert.match(productLayer, /streamGlobalAgentEvents\(lastEventSeq/)
  assert.match(agentHome, /lastEventSeq/)
  assert.match(agentHome, /streamAgentEvents\(props\.sessionId,\s*lastEventSeq/)
  assert.match(agentHome, /function scheduleEventRebind\(\)/)
  assert.match(agentHome, /onDone:\s*\(\)\s*=>\s*scheduleEventRebind\(\)/)
})

test('agent views present final output budget interruptions without calling them failures', () => {
  const productLayer = readFileSync(resolve(appRoot, 'src/renderer/components/agent/AgentProductLayer.vue'), 'utf8')
  const agentHome = readFileSync(resolve(appRoot, 'src/renderer/views/AgentHome.vue'), 'utf8')
  assert.match(agentHome, /case 'run\.interrupted'/)
  assert.match(productLayer, /case 'run\.interrupted'/)
  assert.match(agentHome, /OUTPUT_BUDGET_REACHED/)
  assert.match(productLayer, /OUTPUT_BUDGET_REACHED/)
  assert.match(agentHome, /已自动分段输出/)
  assert.match(productLayer, /已自动分段输出/)
  assert.doesNotMatch(agentHome.match(/case 'run\.interrupted':[\s\S]*?break/)?.[0] || '', /运行失败/)
  assert.doesNotMatch(productLayer.match(/case 'run\.interrupted':[\s\S]*?break/)?.[0] || '', /运行失败/)
})

test('authenticated Web transport cancels the active Session without restarting the IM Host', () => {
  const worker = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/worker/worker.mjs'), 'utf8')
  const client = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/worker/web-rpc-client.mjs'), 'utf8')
  assert.match(client, /cancel\(sessionId\)[\s\S]*?session\/cancel/)
  assert.match(worker, /cancelActiveRuntimeSession\(run,/)
  assert.doesNotMatch(worker.match(/function cancelActiveRun\(\)[\s\S]*?\n\}/)?.[0] || '', /stopRuntime\(\)/)
})

test('automatic continuations use the trusted private Host entry and keep their product event private', () => {
  const worker = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/worker/worker.mjs'), 'utf8')
  const continuation = worker.match(/function continueRunAfterOutputBudget\(run\)\s*\{[\s\S]*?\n\}/)?.[0] || ''
  assert.match(continuation, /runtime\.continueOutput\(/)
  assert.doesNotMatch(continuation, /runtime\.prompt\(/)
  assert.match(continuation, /agent\/inbox\/spliced/)
  assert.match(continuation, /internal:\s*true/)
  assert.doesNotMatch(continuation, /dsh-sdk-jsonrpc-demo|sdk\.request/)
})

test('agent iframe reloads when runtime generation changes on the same web URL', () => {
  const webView = readFileSync(resolve(appRoot, 'src/renderer/views/AgentWebView.vue'), 'utf8')
  assert.match(webView, /const runtimeGeneration = ref\(0\)/)
  assert.match(webView, /csRuntimeGeneration/)
  assert.match(webView, /function applyRuntimeSnapshot\(result\)/)
  assert.match(webView, /generation !== runtimeGeneration\.value/)
  assert.match(webView, /const runtimeUrl = applyRuntimeSnapshot\(st\)/)
  assert.match(webView, /webUrl\.value !== runtimeUrl/)
})

test('agent iframe uses the authenticated Web launch URL and never probes a bare origin', () => {
  const webView = readFileSync(resolve(appRoot, 'src/renderer/views/AgentWebView.vue'), 'utf8')
  assert.match(webView, /result\?\.web_launch_url \|\| ''/)
  assert.match(webView, /never rendered as text or probed with a[\s\S]*bare fetch/)
  assert.doesNotMatch(webView, /web_candidate_url|web_url \|\|/)
})

test('agent runtime failures leave the loading screen and expose a retry action', () => {
  const webView = readFileSync(resolve(appRoot, 'src/renderer/views/AgentWebView.vue'), 'utf8')
  assert.match(webView, /const runtimeNeedsAttention = computed\(\(\) => \{[\s\S]*?return Boolean\(error\.value\)/)
  assert.match(webView, /\['starting', 'ready'\]\.includes\(lastRuntimeState\.value\)/)
  assert.match(webView, /error\.value \|\| '正在准备会话环境,请稍候片刻。'/)
  assert.match(webView, /state === 'disabled_until_manual_restart'/)
  assert.match(webView, /重新连接智能体/)
  assert.match(webView, /lastRuntimeState\.value === 'needs_configuration' \|\| lastRuntimeState\.value === 'disabled_until_manual_restart'/)
})

test('agent runtime missing model keys suppresses upstream onboarding and defers Crawshrimp provider configuration to composer interaction', () => {
  const webView = readFileSync(resolve(appRoot, 'src/renderer/views/AgentWebView.vue'), 'utf8')
  const settings = readFileSync(resolve(appRoot, 'src/renderer/views/SettingsPage.vue'), 'utf8')
  const slots = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/crawshrimp-slots/lib/client.js'), 'utf8')
  const profile = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/profile/web/cordis.patch.yml'), 'utf8')
  const service = readFileSync(resolve(appRoot, '../core/agent/service.py'), 'utf8')
  const app = readFileSync(resolve(appRoot, 'src/renderer/App.vue'), 'utf8')
  assert.match(webView, /csNeedsModelKey/)
  assert.match(webView, /function syncRuntimeModelConfiguration\(result\)/)
  assert.match(webView, /const needsModelKey = result\?\.api_key_configured === false/)
  assert.doesNotMatch(webView, /llmConfigPromptedAutomatically/)
  assert.doesNotMatch(webView, /needsModelKey[\s\S]{0,320}inlineLlmModalOpen\.value = true/)
  assert.match(webView, /data\.__crawshrimp === 'llm-config-request'/)
  assert.match(webView, /openInlineLlmModal/)
  assert.match(webView, /runtime-model-configuration/)
  assert.match(webView, /配置大模型供应商/)
  assert.match(webView, /DeepSeek 官方 API/)
  assert.match(webView, /配置 DeepSeek/)
  assert.match(webView, /森马 AI 网关/)
  assert.match(webView, /配置森马 AI 网关/)
  assert.match(webView, /自定义模型供应商/)
  assert.match(webView, /进入大模型配置页/)
  assert.match(webView, /provider-text-link/)
  assert.match(webView, /flex-wrap: nowrap/)
  assert.match(webView, /width: 178px/)
  assert.match(webView, /openDeepSeekProviderSettings/)
  assert.match(webView, /openCustomProviderSettings/)
  assert.match(webView, /emit\('open-settings', \{/)
  assert.match(webView, /panelId: 'ai-llm'/)
  assert.doesNotMatch(webView, /open-llm-provider/)
  assert.doesNotMatch(webView, /new-llm-provider/)
  assert.doesNotMatch(webView, /providerId: 'crawshrimp-deepseek-official'/)
  assert.doesNotMatch(webView, /saveInlineLlmSettings/)
  assert.doesNotMatch(webView, /buildLlmSettingsPatch/)
  assert.doesNotMatch(webView, /patchSettings/)
  assert.match(slots, /csNeedsModelKey/)
  assert.match(slots, /llm-config-request/)
  assert.match(slots, /requestLlmConfigFromComposer/)
  assert.match(slots, /updateRuntimeModelConfiguration/)
  assert.match(slots, /target\.closest\('\.wSkVaW_composerSeat'\)/)
  assert.match(slots, /\['pointerdown', 'keydown', 'beforeinput', 'paste'\]/)
  assert.doesNotMatch(slots, /\['pointerdown', 'click', 'keydown', 'beforeinput', 'paste'\]/)
  assert.match(slots, /postToShell\(\{ __crawshrimp: 'llm-config-request', source: 'composer' \}\)/)
  assert.match(slots, /exports\.inject = \['theme', 'workspaces', 'sessions', 'slots', 'uiWorkspace'\]/)
  assert.match(profile, /- id: ui-settings-models\s+disabled: true/)
  assert.match(service, /CRAWSHRIMP_LLM_CONFIG_REQUIRED/)
  assert.match(app, /@open-settings="openSettingsPanel"/)
  assert.match(app, /const panelId = target && typeof target === 'object'[\s\S]*?target\.panelId \|\| target\.id/)
  assert.doesNotMatch(app, /:focus-action=/)
  assert.doesNotMatch(app, /focusSettingsAction/)
  assert.doesNotMatch(settings, /focusAction/)
  assert.doesNotMatch(settings, /queueFocusAction/)
  assert.doesNotMatch(settings, /pendingFocusAction/)
  assert.doesNotMatch(settings, /settingsLoaded/)
  assert.doesNotMatch(settings, /flushFocusAction/)
  assert.doesNotMatch(settings, /openLlmProviderModal\(action/)
  assert.match(settings, /function resolvePanelSelection/)
  assert.match(settings, /const initialPanelSelection = resolvePanelSelection\(props\.focusPanelId\)/)
  assert.match(settings, /const activePanelId = ref\(initialPanelSelection\.panelId\)/)
  assert.doesNotMatch(settings, /await load\(\)\s*\n\s*focusPanel\(props\.focusPanelId\)/)
  assert.match(settings, /待配置/)
  assert.match(settings, /DEEPSEEK_PLATFORM_URL/)
  assert.match(settings, /重置或更换 Key/)
})

test('LLM provider settings save provider rows directly and keep the compact settings page', () => {
  const settings = readFileSync(resolve(appRoot, 'src/renderer/views/SettingsPage.vue'), 'utf8')
  const llmSettings = readFileSync(resolve(appRoot, 'src/renderer/utils/llmSettings.mjs'), 'utf8')
  const providerBlock = llmSettings.match(/export const LLM_BUILTIN_PROVIDERS = Object\.freeze\(\[\n([\s\S]*?)\n\]\)/)?.[1] || ''
  const firstProvider = providerBlock.match(/\{\n([\s\S]*?)\n  \}/)?.[1] || ''
  assert.match(firstProvider, /id: 'crawshrimp-deepseek-official'/)
  assert.match(settings, /保存 Provider/)
  assert.match(settings, /saveLlmProviderDraft/)
  assert.match(settings, /savePanel\('ai-llm', \{ silent: true \}\)/)
  assert.match(settings, /child\?\.id === 'ai-llm'[\s\S]*?isLlmConfigured\(cfg\.value\)/)
  assert.match(settings, /llm-provider-logo/)
  assert.match(settings, /deepseek-logo\.png/)
  assert.match(settings, /semir-logo\.png/)
  assert.match(settings, /v-if="provider\.logoImage && !failedProviderLogos\[provider\.id\]"/)
  assert.match(settings, /\{ 'with-image': provider\.logoImage && !failedProviderLogos\[provider\.id\] \}/)
  assert.match(settings, /<button\s+[\s\S]*?:class="\['llm-provider-logo'/)
  assert.match(settings, /:aria-label="`编辑 \$\{provider\.name\}`"[\s\S]*?@click="openLlmProviderModal\(provider\.id\)"/)
  assert.match(settings, /class="llm-provider-title-button"[\s\S]*?@click="openLlmProviderModal\(provider\.id\)"/)
  assert.match(settings, /function llmProviderLogoImage/)
  assert.match(settings, /height: 34px/)
  assert.match(settings, /brand-deepseek/)
  assert.match(settings, /brand-semir/)
  assert.match(settings, /return String\(provider\.name \|\| provider\.id \|\| 'AI'\)\.trim\(\)\.replace\(/)
  assert.doesNotMatch(settings, /slice\(0,\s*2\)/)
  assert.match(settings, /\.llm-provider-logo\.brand-custom span \{[\s\S]*?font-size: 16px/)
  assert.match(settings, /\.llm-provider-title-button \{[\s\S]*?white-space: nowrap/)
  assert.match(settings, /\.llm-model-preview \.chip,[\s\S]*?max-width: min\(100%, 360px\)[\s\S]*?white-space: nowrap/)
  assert.match(settings, /llmProviderLogoText/)
  assert.match(llmSettings, /brand: 'deepseek'/)
  assert.match(llmSettings, /brand: 'semir'/)
  assert.match(settings, /保存并重启智能体/)
  assert.doesNotMatch(settings, /运行时路由说明/)
  assert.doesNotMatch(settings, /llm-route-note/)
})

test('LLM provider Semir logo has transparent outer corners', () => {
  const logo = readPngRgba(resolve(appRoot, 'src/renderer/assets/llm-providers/semir-logo.png'))
  const corners = [
    logo.pixelAt(0, 0).a,
    logo.pixelAt(logo.width - 1, 0).a,
    logo.pixelAt(0, logo.height - 1).a,
    logo.pixelAt(logo.width - 1, logo.height - 1).a,
  ]
  assert.deepEqual(corners, [0, 0, 0, 0])
  assert.equal(logo.pixelAt(Math.floor(logo.width / 2), Math.floor(logo.height / 2)).a, 255)
})

test('core status indicator debounces transient backend probe drops', () => {
  const app = readFileSync(resolve(appRoot, 'src/renderer/App.vue'), 'utf8')
  assert.match(app, /API_STATUS_OFF_STREAK_THRESHOLD = 3/)
  assert.match(app, /apiStatusOffStreak \+= 1/)
  assert.match(app, /status\.value\.api && apiStatusOffStreak < API_STATUS_OFF_STREAK_THRESHOLD/)
  assert.match(app, /window\.cs\.onStatus\(\(\{ key, value \}\) => \{ applyRuntimeStatus\(\{ \[key\]: value \}\) \}\)/)
})

test('browser windows are isolated per target and remove closed tabs', () => {
  const main = readFileSync(resolve(appRoot, 'src/agentBrowser.js'), 'utf8')
  const desktopMain = readFileSync(resolve(appRoot, 'src/main.js'), 'utf8')
  const app = readFileSync(resolve(appRoot, 'src/renderer/App.vue'), 'utf8')
  const panel = readFileSync(resolve(appRoot, 'src/renderer/components/agent/AgentBrowserPanel.vue'), 'utf8')
  const webView = readFileSync(resolve(appRoot, 'src/renderer/views/AgentWebView.vue'), 'utf8')
  const productLayer = readFileSync(resolve(appRoot, 'src/renderer/components/agent/AgentProductLayer.vue'), 'utf8')
  const resources = readFileSync(resolve(appRoot, 'src/renderer/components/agent/SessionResources.vue'), 'utf8')
  assert.match(main, /const startingByTarget = new Map\(\)/)
  assert.match(main, /const \{ resolveCdpPort \} = require\('\.\/cdpPort'\)/)
  assert.match(main, /const CDP_PORT = resolveCdpPort\(\)/)
  assert.match(desktopMain, /const \{ resolveCdpPort, loopbackCdpUrl \} = require\('\.\/cdpPort'\)/)
  assert.match(desktopMain, /CRAWSHRIMP_CDP_PORT: String\(CDP_PORT\)/)
  assert.match(desktopMain, /CRAWSHRIMP_CDP_URL: loopbackCdpUrl\(CDP_PORT\)/)
  assert.match(main, /const startingSockets = new Map\(\)/)
  assert.ok(main.indexOf('streams.set(actualTid, st)') < main.indexOf('startingSockets.delete(startKey)', main.indexOf('streams.set(actualTid, st)')))
  assert.match(main, /CDP_COMMAND_TIMEOUT_MS/)
  assert.match(main, /if \(st\.capturing\) return/)
  assert.match(main, /throw new Error\(`绑定的浏览器页面已关闭:/)
  assert.match(main, /targetId:\s*actualTid[\s\S]*?width:[\s\S]*?height:/)
  assert.match(panel, /payload\?\.targetId[\s\S]*?props\.tabId/)
  assert.match(panel, /crawshrimp\.browserWindow\.v2\.\$\{String\(props\.tabId/)
  assert.match(panel, /@pointerdown\.left="onDragStart"/)
  assert.match(panel, /:disabled="isDocked"/)
  assert.match(panel, /layout-change/)
  assert.match(panel, /data-tooltip/)
  assert.match(panel, /layoutActionLabel/)
  assert.match(panel, /IconLayoutSidebarRight/)
  assert.match(panel, /IconExternalLink/)
  assert.doesNotMatch(panel, /IconWindow/)
  assert.match(panel, /if \(isDocked\.value\) return/)
  assert.match(panel, /safelySetPointerCapture/)
  assert.match(panel, /safelyReleasePointerCapture/)
  assert.match(panel, /stopInteractions/)
  assert.match(panel, /watch\(isDocked/)
  assert.match(panel, /window\.addEventListener\('pointerdown', onNextPointerDown, \{ capture: true \}\)/)
  assert.match(panel, /window\.addEventListener\('blur', onFinish, \{ once: true \}\)/)
  assert.match(panel, /requestAnimationFrame/)
  assert.match(panel, /translate3d\(\$\{win\.x\}px, \$\{win\.y\}px, 0\)/)
  assert.match(panel, /DEFAULT_FLOAT_W = 520/)
  assert.match(panel, /defaultY = 54 \+ off/)
  assert.match(panel, /\.layout-btn::after[\s\S]*?content: attr\(data-tooltip\)/)
  assert.match(panel, /IconArrowsMaximize/)
  assert.match(panel, /IconMinus/)
  assert.match(panel, /IconX/)
  assert.match(webView, /<SessionResources/)
  assert.doesNotMatch(webView, /browser-toggle|showBrowserWindows|tabsForActiveBrowserWindow/)
  assert.match(resources, /listAgentBrowserTabs/)
  assert.match(resources, /liveById.has\(t.id\)/)
  assert.match(resources, /:key="selection.id"/)
  assert.match(resources, /:tab-id="selection.id"/)
  assert.match(resources, /role="separator"/)
  assert.match(resources, /session-resources\?runtime_session_id/)
  assert.match(resources, /token !== generation \|\| id !== props.sessionId/)
  assert.match(resources, /aria-label="导出会话日志"/)
  assert.match(productLayer, /tool\.approval_resolved/)
  assert.match(productLayer, /run\.interrupted/)
  assert.match(productLayer, /reconcilePendingApprovals/)
  assert.match(productLayer, /\/agent\/approvals\?status=pending/)
  assert.match(productLayer, /pendingIds\.has\(String\(card\.approvalId/)
})

test('DSH attachment bridge sends regular files to Crawshrimp and images into DSH native drafts', () => {
  const slots = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/crawshrimp-slots/lib/client.js'), 'utf8')
  const slotsPackage = JSON.parse(readFileSync(resolve(appRoot, '../integrations/deepseek-harness/crawshrimp-slots/package.json'), 'utf8'))
  const webView = readFileSync(resolve(appRoot, 'src/renderer/views/AgentWebView.vue'), 'utf8')
  const worker = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/worker/worker.mjs'), 'utf8')
  assert.ok(slotsPackage.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'))
  assert.match(slots, /exports\.inject\s*=\s*\[[^\]]*['"]sessions['"]/)
  assert.match(slots, /function isImageFile\(file\)/)
  assert.match(slots, /function nonImageFiles\(files\)/)
  assert.match(slots, /filter\(\(file\) => file && !isImageFile\(file\)\)/)
  assert.match(slots, /function installNativeImageDraft\(ctx, data\)/)
  assert.match(slots, /new File\(\[data\.bytes\], data\.name, \{ type: data\.mime \}\)/)
  assert.match(slots, /scoped\.get\('conversation'\)/)
  assert.match(slots, /conversation\.createDraftImages\(\[image\]\)/)
  assert.match(slots, /conversation\.input\.for\(scoped\)\.addImages/)
  assert.doesNotMatch(slots, /session\.prompt\([\s\S]*?native-image/)
  assert.match(slots, /pendingAttachmentHintsBySession/)
  assert.match(slots, /queueAttachmentHint\(sessionId/)
  assert.match(slots, /function insertAttachmentHint\(name, attachmentId\)/)
  assert.match(slots, /document\.querySelector\('\[contenteditable="true"\]'\)/)
  assert.match(slots, /editor\.textContent = current \? `\$\{current\}\\n\$\{hint\}` : hint/)
  assert.match(slots, /new InputEvent\('input', \{[\s\S]*?inputType: 'insertText'/)
  assert.match(slots, /localStorage\?\.getItem\?\.\(['"]dsh\.sessions\.current['"]\)/)
  assert.match(slots, /activeRuntimeSessionId\(\)/)
  assert.match(slots, /lastPublishedRuntimeSessionId/)
  assert.match(slots, /current === lastPublishedRuntimeSessionId/)
  assert.match(slots, /function updateNavButton\(btn,\s*item,\s*activeId\)/)
  assert.match(slots, /function findNavButton\(host,\s*id\)/)
  assert.match(slots, /function updateNavToggle\(toggle,\s*host,\s*items,\s*activeId,\s*collapsible\)/)
  assert.match(slots, /btn\.dataset\.csNavItemId/)
  assert.match(slots, /host\.insertBefore\(btn,\s*toggle \|\| null\)/)
  assert.doesNotMatch(slots, /host\.replaceChildren\(\)/)
  assert.doesNotMatch(slots, /cs-nav-in/)
  assert.match(slots, /document\.documentElement\.dataset\.csAttachCapture/)
  assert.doesNotMatch(slots, /document\.dataset\.csAttachCapture/)
  assert.match(slots, /data\.runtimeSessionId\s*\|\|\s*currentRuntimeSessionId/)
  assert.match(slots, /const UPLOAD_BUTTON_TOOLTIP = ['"]上传附件['"]/)
  assert.match(slots, /function setComposerButtonTooltip\(button,\s*tooltip,\s*ariaLabel\)/)
  assert.match(slots, /button\.dataset\.csTooltip = tooltip/)
  assert.match(slots, /delete button\.dataset\.csTooltip/)
  assert.match(slots, /color:\s*#f7f7fa;/)
  assert.doesNotMatch(slots, /var\(--dsw-alias-label-primary-inverted/)
  assert.match(slots, /addBtn\.removeAttribute\(['"]aria-haspopup['"]\)/)
  assert.match(slots, /addBtn\.removeAttribute\(['"]aria-expanded['"]\)/)
  assert.match(slots, /function installComposerTooltipShield\(\)/)
  assert.match(slots, /function composerTooltipButtonFromEvent\(event\)/)
  assert.match(slots, /function isComposerTooltipButton\(target\)/)
  assert.match(slots, /document\.documentElement\.dataset\.csComposerTooltipShield = ['"]1['"]/)
  assert.match(slots, /\[data-cs-composer-tooltip-shield="1"\] \[role="tooltip"\]/)
  assert.match(slots, /\[role="tooltip"\]\[data-cs-suppressed-tooltip="1"\]/)
  assert.match(slots, /function suppressNativeCommandTooltips\(\)/)
  assert.match(slots, /function installNativeCommandTooltipSuppressor\(\)/)
  assert.match(slots, /label !== COMMAND_BUTTON_LABEL && label !== '指令'/)
  assert.match(slots, /target\.closest\('\.uV2eYG_add\[data-cs-upload-button="1"\], \.uV2eYG_add\.cs-cmd-at-btn'\)/)
  assert.match(slots, /at\.dataset\.csCommandButton = ['"]1['"]/)
  assert.match(slots, /setComposerButtonTooltip\(at,\s*COMMAND_BUTTON_LABEL,\s*COMMAND_BUTTON_LABEL\)/)
  assert.doesNotMatch(slots, /setComposerButtonTooltip\(at,\s*null,\s*COMMAND_BUTTON_LABEL\)/)
  assert.match(slots, /if \(at\.className !== wantedClass\) at\.className = wantedClass/)
  assert.match(slots, /if \(at\.dataset\.csCommandButton !== ['"]1['"]\) at\.dataset\.csCommandButton = ['"]1['"]/)
  assert.match(slots, /if \(at\.getAttribute\(['"]aria-haspopup['"]\) !== ['"]listbox['"]\)/)
  assert.match(slots, /if \(!glyph \|\| glyph\.textContent !== ['"]@['"]\)/)
  assert.doesNotMatch(slots, /at\.innerHTML = ['"]['"]/)
  assert.match(slots, /let composerButtonMountQueued = false/)
  assert.match(slots, /function scheduleComposerButtonMount\(\)/)
  assert.match(slots, /requestAnimationFrame\(run\)/)
  assert.match(slots, /let lastRailMetricsSignature = ['"]['"]/)
  assert.match(slots, /function scheduleRailMetricsPush\(force = false\)/)
  assert.match(slots, /function installRailResizeObserver\(\)/)
  assert.match(slots, /signature === lastRailMetricsSignature/)
  assert.match(slots, /function mutationsTouchShellMountPoints\(mutations\)/)
  assert.match(slots, /if \(!mutationsTouchShellMountPoints\(mutations\)\) return/)
  assert.match(slots, /scheduleComposerButtonMount\(\)[\s\S]*?installRailResizeObserver\(\)[\s\S]*?scheduleRailMetricsPush\(\)/)
  assert.match(slots, /observer\.observe\(document\.documentElement,\s*\{[^}]*attributeFilter:\s*\['data-phase'\]/)
  assert.doesNotMatch(slots, /attributeFilter:\s*\[['"]class['"],\s*['"]style['"]\]/)
  assert.match(webView, /function isImageLikeFile\(file\)/)
  assert.match(webView, /function pushNativeImageDraft\(file, runtimeSessionId/)
  assert.match(webView, /readAgentAttachment/)
  assert.match(webView, /__crawshrimp:\s*'native-image-attachment'/)
  assert.match(webView, /if \(!postToFrame\(\{[\s\S]*?native-image-attachment[\s\S]*?\}\)\) return false/)
  assert.doesNotMatch(webView, /readAgentImageDataUrl/)
  assert.match(webView, /runtime_session_id:\s*runtimeId/)
  assert.match(webView, /runtimeSessionId:\s*runtimeId/)
  assert.match(worker, /type:\s*['"]image['"]/)
  assert.match(worker, /MODEL_IMAGE_MEDIA_TYPES\.has\(mediaType\)/)
})

test('the Crawshrimp attachment picker accepts images and documents without a native file filter', () => {
  const main = readFileSync(resolve(appRoot, 'src/main.js'), 'utf8')

  assert.match(main, /title:\s*['"]选择图片或附件['"]/)
  const picker = main.slice(main.indexOf("secureHandle('agent:pick-attachments'"), main.indexOf("secureHandle('agent:pick-attachments'") + 1800)
  assert.match(picker, /filters:\s*\[\]/)
  for (const extension of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'xlsx', 'pdf']) {
    assert.ok(picker.includes(`'.${extension}':`), `${extension} remains classified after selection`)
  }
})

test('native Web sessions obtain a per-session shadow follow without a latest-run fallback', () => {
  const worker = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/worker/worker.mjs'), 'utf8')
  const followManager = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/worker/native-web-follow-manager.mjs'), 'utf8')
  const webView = readFileSync(resolve(appRoot, 'src/renderer/views/AgentWebView.vue'), 'utf8')
  const api = readFileSync(resolve(appRoot, '../core/agent/api.py'), 'utf8')
  const service = readFileSync(resolve(appRoot, '../core/agent/service.py'), 'utf8')

  assert.match(webView, /observeNativeWebSession\(activeRuntimeSessionId\.value\)/)
  assert.match(webView, /NATIVE_WEB_FOLLOW_RETRY_DELAYS_MS/)
  assert.match(webView, /scheduleNativeWebSessionFollow/)
  assert.match(api, /@router\.post\("\/runtime\/web-session"\)/)
  assert.match(service, /async def observe_native_web_session\(\s*self, runtime_session_id: str/)
  assert.match(service, /worker\.request\(\s*"worker\.observe_web_session"/)
  assert.match(service, /_recover_native_web_mcp_context/)
  assert.match(service, /refresh=True/)
  assert.match(service, /McpContextUnavailableError/)
  assert.match(worker, /nativeWebFollows:\s*new Map\(\)/)
  assert.match(worker, /createNativeWebFollowManager\(\{/)
  assert.match(worker, /async function observeNativeWebSession\(sessionId, \{ refresh = false, owner = '' \} = \{\}\)/)
  assert.match(followManager, /runtime\.follow\(normalized, \{/)
  assert.match(followManager, /await record\.follow\.ready/)
  assert.match(followManager, /heldForActiveTurn:\s*true/)
  assert.match(worker, /notifyHarnessShadow\(sessionId, event\)/)
  assert.match(worker, /refresh: params\.refresh === true/)
  assert.match(worker, /case 'worker\.observe_web_session'/)
  assert.match(worker, /case 'worker\.unobserve_web_session'/)
  assert.doesNotMatch(worker, /latest.*active.*run/i)
})

test('native Web follow manager is required by development and packaged runtime manifests', () => {
  const paths = readFileSync(resolve(appRoot, 'src/deepseekHarnessPaths.js'), 'utf8')
  const staging = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/scripts/stage-runtime.mjs'), 'utf8')
  const afterPack = readFileSync(resolve(appRoot, 'scripts/after-pack.js'), 'utf8')

  for (const source of [paths, staging, afterPack]) {
    assert.match(source, /worker\/native-web-follow-manager\.mjs/)
  }
})

test('browser wait is explicitly local-only and does not request an act approval', () => {
  const gateway = readFileSync(resolve(appRoot, '../core/agent/mcp_gateway.py'), 'utf8')
  const body = gateway.split('async def tool_browser_act(', 2)[1]?.split('\n\nasync def tool_browser_verify', 1)[0] || ''
  assert.match(body, /requires_act_approval = action != "wait"/)
  assert.match(body, /if requires_act_approval and "act" not in toolset/)
  assert.match(body, /if requires_act_approval and action == "click"/)
})

test('Crawshrimp running-status branding follows the semantic live region rather than a retired hash class', () => {
  const slots = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/crawshrimp-slots/lib/client.js'), 'utf8')

  assert.match(slots, /function normalizeRunningStatus\(root = document\)/)
  assert.match(slots, /\[role="status"\]/)
  assert.match(slots, /EvIC1a_turnStatus/)
  assert.match(slots, /dataset\.csRunningStatus/)
  assert.match(slots, /抓虾中\.\.\./)
  assert.match(slots, /cs-running-status-shimmer/)
  assert.match(slots, /background-clip:\s*text/)
  assert.match(slots, /prefers-reduced-motion:\s*reduce/)
  assert.doesNotMatch(slots, /\[data-cs-running-status="1"\] \{[^}]*animation:\s*none !important;/)
  assert.doesNotMatch(slots, /\.Md3f7G_turnStatus::before/)
})

test('DSH attachment bridge resets and retitles the native file-drop overlay', () => {
  const slots = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/crawshrimp-slots/lib/client.js'), 'utf8')
  const dropHandler = slots.split('function handleDropAttachments(event, ctx = crawshrimpContext)', 2)[1]?.split('\n    const DROP_TITLE_ZH', 1)[0] || ''

  assert.match(slots, /function hasFileTransfer\(event\)/)
  assert.doesNotMatch(dropHandler, /inComposer\(event\.target\)/)
  assert.match(slots, /function resetNativeDropOverlay\(\)/)
  assert.match(slots, /event = new Event\(['"]dragend['"]\)/)
  assert.match(slots, /document\.createEvent\(['"]Event['"]\)/)
  assert.match(slots, /window\.dispatchEvent\(event\)/)
  assert.match(slots, /function installNativeDropOverlayFixups\(\)/)
  assert.match(slots, /document\.addEventListener\(['"]drop['"],\s*\(event\) => \{[\s\S]*?hasFileTransfer\(event\)[\s\S]*?resetNativeDropOverlay\(\)[\s\S]*?\},\s*true\)/)
  assert.match(slots, /try \{[\s\S]*?routeAttachmentFiles\(event, files, ctx\)[\s\S]*?\} finally \{[\s\S]*?resetNativeDropOverlay\(\)[\s\S]*?\}/)
  assert.match(slots, /const DROP_TITLE_ZH = ['"]图片\/文件拖动到此处即可添加['"]/)
  assert.match(slots, /const DROP_TITLE_EN = ['"]Drag images or files here to add them['"]/)
  assert.match(slots, /const FILE_LIMIT_ZH = ['"]文件最大 200MB['"]/)
  assert.match(slots, /Images: up to \$1, \$2 each; \$\{FILE_LIMIT_EN\}/)
  assert.match(slots, /mutationTouchesDropOverlay/)
  assert.match(slots, /installNativeDropOverlayFixups\(\)[\s\S]*?if \(document\.documentElement\.dataset\.csAttachCapture === ['"]1['"]\) return/)
})

test('DSH Crawshrimp brand slots replace the official DeepSeek Harness wordmark', () => {
  const slots = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/crawshrimp-slots/lib/client.js'), 'utf8')
  const app = readFileSync(resolve(appRoot, 'src/renderer/App.vue'), 'utf8')
  const webView = readFileSync(resolve(appRoot, 'src/renderer/views/AgentWebView.vue'), 'utf8')
  const slotsPackage = JSON.parse(readFileSync(resolve(appRoot, '../integrations/deepseek-harness/crawshrimp-slots/package.json'), 'utf8'))
  const profilePatch = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/profile/web/cordis.patch.yml'), 'utf8')
  const webAppPatch = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml'), 'utf8')
  const brandOfficialBlock = profilePatch.split('- id: ui-brand-official', 2)[1]?.split('\n- id:', 1)[0] || ''

  assert.ok(slotsPackage.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar'))
  assert.ok(slotsPackage.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'))
  assert.match(slots, /exports\.inject\s*=\s*\[[^\]]*['"]slots['"]/)
  assert.match(slots, /CrawshrimpBrandMark/)
  assert.match(slots, /CrawshrimpBrandName/)
  assert.match(slots, /normalizeDocumentTitle/)
  assert.match(slots, /setInterval\(normalizeDocumentTitle,\s*1000\)/)
  assert.match(slots, /ctx\.slots\.inject\(['"]sidebar\.brand\.mark['"]/)
  assert.match(slots, /ctx\.slots\.inject\(['"]sidebar\.brand\.name['"]/)
  assert.match(slots, /ctx\.slots\.inject\(['"]conversation\.hero\.brand\.mark['"]/)
  assert.match(slots, /ctx\.slots\.register\(\{\s*name:\s*['"]sidebar\.brand\.mark['"]/)
  assert.match(slots, /ctx\.slots\.register\(\{\s*name:\s*['"]sidebar\.brand\.name['"]/)
  assert.match(slots, /ctx\.slots\.register\(\{\s*name:\s*['"]conversation\.hero\.brand\.mark['"]/)
  assert.match(slots, /抓虾智能体/)
  assert.match(slots, /抓住灵感，拿到结果/)
  assert.match(slots, /content:\s*["']· 抓住灵感，拿到结果["']/)
  assert.match(slots, /font-size:\s*22px/)
  assert.match(slots, /cs-slogan-wave/)
  assert.match(app, /:app-version="agentAppVersionLabel"/)
  assert.match(app, /const agentAppVersionLabel = computed/)
  assert.match(webView, /appVersion/)
  assert.match(webView, /__crawshrimp:\s*['"]app-version['"]/)
  assert.match(slots, /normalizeCrawshrimpAppVersion/)
  assert.match(slots, /cs-brand-version/)
  assert.doesNotMatch(slots, /hHd-Xa_brand::after/)
  assert.doesNotMatch(slots, /抓虾 Harness 智能体/)
  assert.match(webAppPatch, /id: ui-brand-official[\s\S]*?name: '@deepseek-ai\/dsh-client-ui-brand-official'/)
  assert.match(brandOfficialBlock, /disabled:\s*true/)
})

test('agent persona introduces itself as Crawshrimp agent', () => {
  const profilePatch = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/profile/web/cordis.patch.yml'), 'utf8')
  const service = readFileSync(resolve(appRoot, '../core/agent/service.py'), 'utf8')
  const runtimeCordisSource = readFileSync(resolve(appRoot, '../core/agent/cordis_config.py'), 'utf8')
  const preset = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/profile/web/agent-presets/crawshrimp-standard/agent.cordis.yml'), 'utf8')

  assert.match(profilePatch, /id: system-prompt[\s\S]*CRAWSHRIMP_AGENT_PERSONA/)
  assert.match(service, /CRAWSHRIMP_AGENT_PERSONA.*AGENT_PERSONA/)
  assert.match(runtimeCordisSource, /你是抓虾智能体/)
  assert.match(runtimeCordisSource, /新用户引导/)
  assert.match(runtimeCordisSource, /可直接复制/)
  assert.match(runtimeCordisSource, /查看当前可用的抓虾脚本/)
  assert.match(runtimeCordisSource, /读取我上传的销售表/)
  assert.match(runtimeCordisSource, /先查看.*不要执行/)
  assert.match(profilePatch, /agent-presets[\s\S]*crawshrimp-standard/)
  assert.match(preset, /如何开始使用抓虾智能体/)
  assert.match(runtimeCordisSource, /当用户明确问[\s\S]*首句明确回答[\s\S]*我是抓虾智能体/)
  assert.match(runtimeCordisSource, /普通寒暄[\s\S]*不要主动输出长篇介绍[\s\S]*简短回答/)
  assert.match(runtimeCordisSource, /其它明确任务直接处理[\s\S]*不重复粘贴介绍/)
  assert.match(runtimeCordisSource, /普通寒暄[\s\S]*你好[\s\S]*需要我帮你处理什么/)
  assert.doesNotMatch(runtimeCordisSource, /首句必须明确回答/)
  assert.doesNotMatch(runtimeCordisSource, /你是抓虾桌面应用中的操作智能体/)
})

test('native DSH Web has one profile source of truth instead of a flat generated configuration', () => {
  const runtimeCordisSource = readFileSync(resolve(appRoot, '../core/agent/cordis_config.py'), 'utf8')
  const profilePatch = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/profile/web/cordis.patch.yml'), 'utf8')

  assert.equal(existsSync(resolve(appRoot, '../integrations/deepseek-harness/web-cordis.yml')), false)
  assert.equal(existsSync(resolve(appRoot, '../integrations/deepseek-harness/scripts/gen-web-cordis.py')), false)
  assert.equal(existsSync(resolve(appRoot, '../integrations/deepseek-harness/scripts/bisect-web.py')), false)
  assert.doesNotMatch(runtimeCordisSource, /build_cordis_yaml|_web_cordis_template|web-cordis\.yml/)
  assert.match(profilePatch, /id: agent-presets[\s\S]*?default: crawshrimp-standard/)
  assert.match(profilePatch, /id: tool-web[\s\S]*?disabled: true/)
})

test('DSH rc.1 profile graph pins the supported Web and ACP runtime closure', () => {
  const harnessPackage = JSON.parse(readFileSync(resolve(appRoot, '../integrations/deepseek-harness/package.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(resolve(appRoot, '../integrations/deepseek-harness/package-lock.json'), 'utf8'))
  assert.equal(harnessPackage.dependencies['@deepseek-ai/dsh'], '0.1.2-rc.1')
  assert.equal(harnessPackage.dependencies['@deepseek-ai/dsh-web-app'], '0.1.2-rc.1')
  for (const packageName of [
    '@deepseek-ai/dsh-attachment-local',
    '@deepseek-ai/dsh-bash-sandbox',
    '@deepseek-ai/dsh-command-feedback',
    '@deepseek-ai/dsh-credentials-local',
    '@deepseek-ai/dsh-fs-observation-policy',
    '@deepseek-ai/dsh-fs-sandbox',
    '@deepseek-ai/dsh-llm-pi-ai',
    '@deepseek-ai/dsh-persona',
    '@deepseek-ai/dsh-repeat-tool-reminder',
    '@deepseek-ai/dsh-schedule',
    '@deepseek-ai/dsh-session-checkpoint-policy',
    '@deepseek-ai/dsh-session-query-sqlite',
    '@deepseek-ai/dsh-session-telemetry-otel',
    '@deepseek-ai/dsh-session-title-first-prompt-llm',
    '@deepseek-ai/dsh-settings-file',
    '@deepseek-ai/dsh-skill-badge',
    '@deepseek-ai/dsh-spill-local',
    '@deepseek-ai/dsh-spill-policy',
    '@deepseek-ai/dsh-storage-json',
    '@deepseek-ai/dsh-subagent-fork-in-process',
    '@deepseek-ai/dsh-subagent-spawn-in-process',
    '@deepseek-ai/dsh-time-context',
    '@deepseek-ai/dsh-tool-call-timeout-policy',
    '@deepseek-ai/dsh-tool-ask-user',
    '@deepseek-ai/dsh-typert-loader',
    '@deepseek-ai/dsh-web-app',
    '@deepseek-ai/dsh-web-fetch-http',
    '@deepseek-ai/dsh-web-search-deepseek',
  ]) {
    assert.equal(harnessPackage.dependencies[packageName], '0.1.2-rc.1', `${packageName} must be pinned at the Cordis runtime root`)
    assert.equal(lock.packages[`node_modules/${packageName}`].version, '0.1.2-rc.1')
  }
  assert.equal(harnessPackage.dependencies['@xmanrui/dsh-im'], '4.11.0')
  assert.equal(lock.packages['node_modules/@deepseek-ai/dsh'].version, '0.1.2-rc.1')
  assert.equal(lock.packages['node_modules/@deepseek-ai/dsh-web-app'].version, '0.1.2-rc.1')
  assert.equal(lock.packages['node_modules/@xmanrui/dsh-im'].version, '4.11.0')
  assert.equal(lock.packages['node_modules/@deepseek-ai/dsh-acp-app'].version, '0.1.2-rc.1')
  const dshPackage = JSON.parse(readFileSync(resolve(appRoot, '../integrations/deepseek-harness/node_modules/@deepseek-ai/dsh/package.json'), 'utf8'))
  assert.equal(dshPackage.dependencies['@deepseek-ai/dsh-acp-app'], '^0.1.2-rc.1')
})

test('DSH rc.1 Web profile retains upstream directory selection and Crawshrimp workspace bridge', () => {
  const webAppPatch = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml'), 'utf8')
  const webBundle = JSON.parse(readFileSync(resolve(appRoot, '../integrations/deepseek-harness/node_modules/@deepseek-ai/dsh-web-app/package.json'), 'utf8'))
  const stageRuntime = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/scripts/stage-runtime.mjs'), 'utf8')
  const webView = readFileSync(resolve(appRoot, 'src/renderer/views/AgentWebView.vue'), 'utf8')
  const slots = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/crawshrimp-slots/lib/client.js'), 'utf8')
  const main = readFileSync(resolve(appRoot, 'src/main.js'), 'utf8')
  const browseHandler = main.split("secureHandle('browse-file'", 2)[1]?.split("\nsecureHandle('select-bala-workspace'", 1)[0] || ''

  assert.match(webAppPatch, /id: directory-picker[\s\S]*?@deepseek-ai\/dsh-host-directory-picker-auto/)
  assert.equal(webBundle.dependencies['@deepseek-ai/dsh-host-directory-picker-browse'], '^0.1.2-rc.1')
  assert.equal(webBundle.dependencies['@deepseek-ai/dsh-host-directory-picker-native'], '^0.1.2-rc.1')
  assert.equal(webBundle.dependencies['@deepseek-ai/dsh-client-ui-directory-picker-browse'], '^0.1.2-rc.1')
  assert.equal(webBundle.dependencies['@deepseek-ai/dsh-client-ui-directory-picker-native'], '^0.1.2-rc.1')
  assert.match(stageRuntime, /profiles\/web\/cordis\.yml/)
  assert.match(stageRuntime, /CRAWSHRIMP_STAGE_BOOT_CHECK:\s*'1'/)
  assert.match(webView, /web_launch_url/)
  assert.match(webView, /data\.__crawshrimp === 'workspace-directory-pick'/)
  assert.match(webView, /window\.cs\.browseFile\(\{[\s\S]*directory:\s*true,[\s\S]*createDirectory:\s*true/)
  assert.match(slots, /function CrawshrimpShellDirectoryFlow\(props\)/)
  assert.match(slots, /conversation\.hero\.workspace\.directoryFlow/)
  assert.match(slots, /sidebar\.workspaces\.directoryFlow/)
  assert.match(slots, /workspace-directory-pick/)
  assert.match(slots, /workspace-directory-picked/)
  assert.match(browseHandler, /if \(opts\.directory && opts\.createDirectory\) props\.push\('createDirectory'\)/)
})

test('DSH Web profile registers Crawshrimp providers through a persistent official profile', () => {
  const profilePatch = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/profile/web/cordis.patch.yml'), 'utf8')
  const defaultBlock = profilePatch.split('- id: agent-default-model', 2)[1].split('\n- id:', 1)[0]
  const attachmentBlock = profilePatch.split('- id: attachment-local', 2)[1].split('\n- id:', 1)[0]
  const piAiBlock = profilePatch.split('- id: llm-pi-ai', 2)[1].split('\n- id:', 1)[0]
  const webClient = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/worker/web-rpc-client.mjs'), 'utf8')

  assert.match(webClient, /dshBin, 'web', '--no-open', '--host', '127\.0\.0\.1'/)
  assert.match(defaultBlock, /provider:\s*!!js process\.env\.CRAWSHRIMP_AGENT_PROVIDER \?\? 'crawshrimp-deepseek-official'/)
  assert.match(defaultBlock, /model:\s*!!js process\.env\.CRAWSHRIMP_AGENT_MODEL \?\? 'deepseek-v4-flash'/)
  assert.match(attachmentBlock, /maxImageDimension:\s*8192/)
  assert.match(attachmentBlock, /maxImageBytes:\s*16777216/)
  assert.match(piAiBlock, /crawshrimp-deepseek-official:/)
  assert.match(piAiBlock, /apiKeyEnv:\s*CRAWSHRIMP_DEEPSEEK_API_KEY/)
  assert.match(piAiBlock, /baseURL:\s*!!js process\.env\.CRAWSHRIMP_DEEPSEEK_BASE_URL \?\? 'https:\/\/api\.deepseek\.com'/)
  assert.match(piAiBlock, /id:\s*deepseek-v4-flash/)
  assert.match(piAiBlock, /reasoningEfforts:[\s\S]*low:\s*low[\s\S]*high:\s*high[\s\S]*max:\s*max/)
  assert.match(piAiBlock, /id:\s*deepseek-v4-flash-vision-exp[\s\S]*input:\s*\[text,\s*image\]/)
  assert.match(piAiBlock, /id:\s*kimi-k3/)
  assert.doesNotMatch(piAiBlock.split('id: deepseek-v4-flash-vision-exp', 2)[1]?.split('crawshrimp-overseas-openai:', 1)[0] || '', /reasoningEfforts|reasoning:\s*high/)
})

test('native DSH model discovery suppresses the duplicate upstream DeepSeek credential route', () => {
  const profile = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/profile/web/cordis.patch.yml'), 'utf8')
  const staging = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/scripts/stage-runtime.mjs'), 'utf8')
  const service = readFileSync(resolve(appRoot, '../core/agent/service.py'), 'utf8')
  const upstreamRoute = profile.split('- id: llm-deepseek', 2)[1]?.split('\n- id:', 1)[0] || ''

  assert.match(upstreamRoute, /disabled:\s*true/)
  assert.match(staging, /duplicateDeepSeekRouteDisabled/)
  assert.match(service, /def build_llm_runtime_environment\(external_env: Mapping\[str, str\], cfg: Mapping\[str, Any\]\)/)
  assert.match(service, /env\[env_key\] = configured/)
  assert.match(service, /if deepseek_key and not _compact_text\(external_env\.get\("DEEPSEEK_API_KEY"\)\)/)
  assert.match(service, /env\["DEEPSEEK_API_KEY"\] = deepseek_key/)
  assert.match(service, /env\["DEEPSEEK_BASE_URL"\] = deepseek_base/)
})

test('development bridge never accepts API credentials from URL query', () => {
  const bridge = readFileSync(resolve(appRoot, 'src/renderer/utils/devCsBridge.js'), 'utf8')
  const preload = readFileSync(resolve(appRoot, 'src/preload.js'), 'utf8')
  assert.doesNotMatch(bridge, /TOKEN_QUERY_KEYS/)
  assert.doesNotMatch(bridge, /crawshrimp_token/)
  assert.doesNotMatch(preload, /TOKEN_QUERY_KEYS/)
  assert.doesNotMatch(preload, /crawshrimp_token/)
  assert.match(bridge, /凭证不允许放入 URL query/)
  assert.match(bridge, /只允许访问本机 Crawshrimp API/)
  assert.match(preload, /本地 API 路径必须以单个 \/ 开头/)
  assert.match(bridge, /port < 18765 \|\| port > 18865/)
  assert.match(preload, /port < 18765 \|\| port > 18865/)
})
