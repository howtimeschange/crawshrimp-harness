'use strict'

/**
 * DSH 运行时路径解析。
 *
 * 与抓虾打包 Python 的模式一致:
 * - 开发态:使用仓库内 integrations/deepseek-harness(node_modules 为开发依赖);
 * - 发布态:使用安装包 Resources/deepseek-harness(electron-builder extraResources,
 *   由 integrations/deepseek-harness/scripts/stage-runtime.mjs 编排生产闭包)。
 *
 * 运行 DSH 不额外分发 Node:用抓虾已打包的 Electron 可执行文件,
 * 以 ELECTRON_RUN_AS_NODE=1 运行(发布构建必须验证 process.versions.node 满足引擎)。
 */

const path = require('path')

function resolveDeepseekHarnessRoot({ isPackaged }) {
  if (!isPackaged) {
    return path.resolve(__dirname, '../../integrations/deepseek-harness')
  }
  return path.join(process.resourcesPath, 'deepseek-harness')
}

/** dsh-jsonrpc-agent 发布 bin 的实际入口(lib/bin.js,不经 .bin 软链)。 */
function resolveDeepseekHarnessBin(root) {
  return path.join(root, 'node_modules', '@deepseek-ai', 'dsh-sdk-jsonrpc-demo', 'lib', 'bin.js')
}

/** 默认 cordis profile 模板;P1 起由 FastAPI 从 ai.llm 生成后落盘覆盖。 */
function resolveDeepseekCordisTemplate(root) {
  return path.join(root, 'spike.cordis.yml')
}

/** 校验发布态闭包关键文件齐全(与 after-pack.js 校验同一清单)。 */
function assertDeepseekHarnessBundle(root) {
  const required = [
    'package.json',
    'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js',
    'node_modules/@deepseek-ai/dsh-agent-spine-demo/package.json',
    'node_modules/@deepseek-ai/dsh-llm-pi-ai/package.json',
    'node_modules/@deepseek-ai/dsh-mcp-client/package.json',
    'node_modules/@deepseek-ai/dsh-session-persistence-jsonl/package.json',
    'spike.cordis.yml',
  ]
  const missing = required.filter((rel) => !require('fs').existsSync(path.join(root, rel)))
  if (missing.length) {
    throw new Error(`[deepseek-harness] bundle 不完整,缺少: ${missing.join(', ')}`)
  }
}

module.exports = {
  resolveDeepseekHarnessRoot,
  resolveDeepseekHarnessBin,
  resolveDeepseekCordisTemplate,
  assertDeepseekHarnessBundle,
}
