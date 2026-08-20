const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const test = require('node:test')

const appRoot = resolve(__dirname, '..')

test('worker absolute timeout stops the runtime before reporting failure', () => {
  const source = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/worker/worker.mjs'), 'utf8')
  const timeoutBody = source.match(/timer:\s*setTimeout\(\(\)\s*=>\s*\{([\s\S]*?)\},\s*RUN_ABSOLUTE_TIMEOUT_MS\)/)?.[1] || ''
  assert.match(timeoutBody, /stopRuntime\(\)/)
  assert.match(timeoutBody, /RUN_TIMEOUT/)
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
})

test('browser windows are isolated per target and remove closed tabs', () => {
  const main = readFileSync(resolve(appRoot, 'src/agentBrowser.js'), 'utf8')
  const panel = readFileSync(resolve(appRoot, 'src/renderer/components/agent/AgentBrowserPanel.vue'), 'utf8')
  const webView = readFileSync(resolve(appRoot, 'src/renderer/views/AgentWebView.vue'), 'utf8')
  const productLayer = readFileSync(resolve(appRoot, 'src/renderer/components/agent/AgentProductLayer.vue'), 'utf8')
  assert.match(main, /const startingByTarget = new Map\(\)/)
  assert.match(main, /const startingSockets = new Map\(\)/)
  assert.ok(main.indexOf('streams.set(actualTid, st)') < main.indexOf('startingSockets.delete(startKey)', main.indexOf('streams.set(actualTid, st)')))
  assert.match(main, /CDP_COMMAND_TIMEOUT_MS/)
  assert.match(main, /if \(st\.capturing\) return/)
  assert.match(main, /throw new Error\(`绑定的浏览器页面已关闭:/)
  assert.match(main, /targetId:\s*actualTid[\s\S]*?width:[\s\S]*?height:/)
  assert.match(panel, /payload\?\.targetId[\s\S]*?props\.tabId/)
  assert.match(panel, /crawshrimp\.browserWindow\.\$\{String\(props\.tabId/)
  assert.match(webView, /listAgentBrowserTabs\(\)/)
  assert.match(webView, /const closed = browserWindows\.value\.filter/)
  assert.match(webView, /closeBrowserWindow\(win\.tabId\)/)
  assert.match(productLayer, /tool\.approval_resolved/)
  assert.match(productLayer, /run\.interrupted/)
  assert.match(productLayer, /reconcilePendingApprovals/)
  assert.match(productLayer, /\/agent\/approvals\?status=pending/)
  assert.match(productLayer, /pendingIds\.has\(String\(card\.approvalId/)
})

test('DSH attachment bridge sends image content blocks through session prompt', () => {
  const slots = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/crawshrimp-slots/lib/client.js'), 'utf8')
  const slotsPackage = JSON.parse(readFileSync(resolve(appRoot, '../integrations/deepseek-harness/crawshrimp-slots/package.json'), 'utf8'))
  const webView = readFileSync(resolve(appRoot, 'src/renderer/views/AgentWebView.vue'), 'utf8')
  const worker = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/worker/worker.mjs'), 'utf8')
  assert.ok(slotsPackage.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'))
  assert.match(slots, /exports\.inject\s*=\s*\[[^\]]*['"]sessions['"]/)
  assert.match(slots, /session\.prompt\([\s\S]*?['"]queue['"]\)/)
  assert.match(slots, /mediaType:[\s\S]*?data:/)
  assert.match(slots, /pendingImagePartsBySession/)
  assert.match(slots, /pendingAttachmentHintsBySession/)
  assert.match(slots, /queueAttachmentHint\(sessionId/)
  assert.match(slots, /localStorage\?\.getItem\?\.\(['"]dsh\.sessions\.current['"]\)/)
  assert.match(slots, /activeRuntimeSessionId\(\)/)
  assert.match(slots, /lastPublishedRuntimeSessionId/)
  assert.match(slots, /current === lastPublishedRuntimeSessionId/)
  assert.match(slots, /document\.documentElement\.dataset\.csAttachCapture/)
  assert.doesNotMatch(slots, /document\.dataset\.csAttachCapture/)
  assert.match(slots, /data\.runtimeSessionId\s*\|\|\s*currentRuntimeSessionId/)
  assert.match(webView, /readAgentImageDataUrl/)
  assert.match(webView, /runtime_session_id:\s*runtimeId/)
  assert.match(webView, /runtimeSessionId:\s*runtimeId/)
  assert.match(worker, /type:\s*['"]image['"]/)
  assert.match(worker, /MODEL_IMAGE_MEDIA_TYPES\.has\(mediaType\)/)
})

test('DSH Crawshrimp brand slots replace the official DeepSeek Harness wordmark', () => {
  const slots = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/crawshrimp-slots/lib/client.js'), 'utf8')
  const slotsPackage = JSON.parse(readFileSync(resolve(appRoot, '../integrations/deepseek-harness/crawshrimp-slots/package.json'), 'utf8'))
  const webCordis = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/web-cordis.yml'), 'utf8')
  const brandOfficialBlock = webCordis.split('- id: ui-brand-official', 2)[1]?.split('\n- id:', 1)[0] || ''

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
  assert.doesNotMatch(slots, /hHd-Xa_brand::after/)
  assert.doesNotMatch(slots, /抓虾 Harness 智能体/)
  assert.match(brandOfficialBlock, /name:\s*'@deepseek-ai\/dsh-client-ui-brand-official'/)
  assert.match(brandOfficialBlock, /disabled:\s*true/)
})

test('DSH rc.8 dependency graph keeps launcher and runtime on one cmdline version', () => {
  const harnessPackage = JSON.parse(readFileSync(resolve(appRoot, '../integrations/deepseek-harness/package.json'), 'utf8'))
  const launcherPackage = JSON.parse(readFileSync(resolve(appRoot, '../integrations/deepseek-harness/crawshrimp-launcher/package.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(resolve(appRoot, '../integrations/deepseek-harness/package-lock.json'), 'utf8'))
  const expected = '0.1.0-rc.8'
  const requiredWebPackages = [
    '@deepseek-ai/dsh-client-ui-attachment',
    '@deepseek-ai/dsh-client-ui-brand-official',
    '@deepseek-ai/dsh-client-ui-reference',
    '@deepseek-ai/dsh-client-ui-renderer',
    '@deepseek-ai/dsh-file-reference-local',
    '@deepseek-ai/dsh-session-reference',
  ]

  for (const [name, version] of Object.entries(harnessPackage.dependencies)) {
    if (name.startsWith('@deepseek-ai/')) assert.equal(version, expected, `${name} must stay on ${expected}`)
  }
  for (const name of requiredWebPackages) {
    assert.equal(harnessPackage.dependencies[name], expected, `${name} must be a direct runtime dependency`)
    assert.equal(lock.packages[''].dependencies[name], expected, `${name} must be pinned in package-lock root`)
  }
  assert.equal(launcherPackage.dependencies['@deepseek-ai/dsh-cmdline'], expected)
  assert.equal(lock.packages['crawshrimp-launcher'].dependencies['@deepseek-ai/dsh-cmdline'], expected)

  const cmdlineEntries = Object.entries(lock.packages)
    .filter(([key]) => key.includes('@deepseek-ai/dsh-cmdline'))
    .map(([key, value]) => [key, value.version])
  assert.deepEqual(cmdlineEntries, [['node_modules/@deepseek-ai/dsh-cmdline', expected]])
})

test('DSH web cordis registers Crawshrimp DeepSeek provider without exposing the native route', () => {
  const webCordis = readFileSync(resolve(appRoot, '../integrations/deepseek-harness/web-cordis.yml'), 'utf8')
  const launcherBlock = webCordis.split('- id: launcher', 2)[1].split('\n- id:', 1)[0]
  const webRuntimeBlock = webCordis.split('- id: web-runtime', 2)[1].split('\n- id:', 1)[0]
  const defaultBlock = webCordis.split('- id: agent-default-model', 2)[1].split('\n- id:', 1)[0]
  const piAiBlock = webCordis.split('- id: llm-pi-ai', 2)[1].split('\n- id:', 1)[0]
  const nativeBlock = webCordis.split('- id: llm-deepseek', 2)[1].split('\n- id:', 1)[0]
  const activeWebRows = [
    ['session-reference', '@deepseek-ai/dsh-session-reference'],
    ['file-reference-local', '@deepseek-ai/dsh-file-reference-local'],
    ['ui-renderer', '@deepseek-ai/dsh-client-ui-renderer'],
    ['ui-attachment', '@deepseek-ai/dsh-client-ui-attachment'],
    ['ui-reference', '@deepseek-ai/dsh-client-ui-reference'],
  ]
  const brandOfficialBlock = webCordis.split('- id: ui-brand-official', 2)[1]?.split('\n- id:', 1)[0] || ''

  assert.match(launcherBlock, /--no-open/)
  assert.match(webRuntimeBlock, /openBrowser:\s*!!js ctx\.webStartup\.openBrowser/)
  assert.match(defaultBlock, /provider:\s*crawshrimp-overseas-openai/)
  assert.match(defaultBlock, /model:\s*gpt-5\.6-terra/)
  assert.match(piAiBlock, /crawshrimp-deepseek-official:/)
  assert.match(piAiBlock, /apiKeyEnv:\s*CRAWSHRIMP_DEEPSEEK_API_KEY/)
  assert.match(piAiBlock, /baseURL:[\s\S]*CRAWSHRIMP_DEEPSEEK_BASE_URL[\s\S]*https:\/\/api\.deepseek\.com/)
  assert.match(piAiBlock, /id:\s*deepseek-v4-flash/)
  assert.match(nativeBlock, /disabled:\s*true/)

  for (const [id, packageName] of activeWebRows) {
    const block = webCordis.split(`- id: ${id}`, 2)[1]?.split('\n- id:', 1)[0] || ''
    assert.match(block, new RegExp(`name:\\s*'${packageName.replaceAll('/', '\\/')}'`))
    assert.doesNotMatch(block, /disabled:\s*true/)
  }
  assert.match(brandOfficialBlock, /name:\s*'@deepseek-ai\/dsh-client-ui-brand-official'/)
  assert.match(brandOfficialBlock, /disabled:\s*true/)
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
