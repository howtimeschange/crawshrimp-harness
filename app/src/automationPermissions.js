'use strict'
const { spawn, execFile } = require('node:child_process')
const path = require('node:path')
const { promisify } = require('node:util')
const exec = promisify(execFile)

function validateTarget(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.-]{1,254}$/.test(value)) throw new Error('请输入有效的应用 Bundle ID，例如 com.apple.TextEdit')
  return value
}

function classifyPermission(result, host = {}) {
  const base = { ...result, host, canRequest: false, fallback: result.accessibility ? 'ax' : 'unavailable' }
  if (result.status === 'authorized') return { ...base, message: '已获系统授权。实际任务仍需在模型执行环境复检；操作结果必须读回。' }
  if (result.status === 'target_unavailable' || result.status === 'target_not_running') return { ...base, message: '目标应用未安装或未运行。请先打开该应用，再检查权限。' }
  if (host.usageDescription === false) return { ...base, status: 'configuration_blocked', message: '宿主缺少 NSAppleEventsUsageDescription，用途说明未随应用构建。请修复开发环境或更新安装包，无需反复修改系统权限。' }
  if (host.hardened && host.appleEventsEntitlement === false) return { ...base, status: 'configuration_blocked', message: '宿主启用了 Hardened Runtime，但签名缺少 Apple Events entitlement。请修复签名后重新构建；系统设置无法补齐签名能力。' }
  if (host.appSandbox) return { ...base, status: 'sandbox_restricted', message: '检测到宿主 App Sandbox。Apple Events 还受目标访问规则限制；请开发者核对目标授权配置，不要反复申请系统权限。' }
  if (result.status === 'not_determined' && host.usageDescription === true && host.signatureInspected) return { ...base, canRequest: true, message: '尚未决定是否允许控制此应用。点击“授权”后，macOS 会征询你的选择。' }
  if (result.status === 'denied_or_restricted') return { ...base, message: 'macOS 返回 -1743：可能已拒绝、受系统策略或执行环境限制，单凭此代码无法确定原因。可检查“隐私与安全性 → 自动化”；如果已允许，请检查模型沙箱。不会自动重复弹窗。' }
  return { ...base, message: '当前无法确认授权状态。保留诊断信息，暂不重复申请；有可用的 AX 控件时可继续该通道。' }
}

async function inspectHost(executable) {
  const contents = path.resolve(path.dirname(executable), '..')
  const host = { executable, usageDescription: null, signatureInspected: false }
  try { await exec('/usr/bin/plutil', ['-extract', 'NSAppleEventsUsageDescription', 'raw', path.join(contents, 'Info.plist')]); host.usageDescription = true } catch { host.usageDescription = false }
  try {
    const signature = await exec('/usr/bin/codesign', ['-dvv', executable])
    host.hardened = /flags=.*\bruntime\b/.test(signature.stderr)
    const entitlements = await exec('/usr/bin/codesign', ['-d', '--entitlements', ':-', executable])
    const xml = entitlements.stdout + entitlements.stderr
    host.appleEventsEntitlement = /<key>com\.apple\.security\.automation\.apple-events<\/key>\s*<true\s*\/>/.test(xml)
    host.appSandbox = /<key>com\.apple\.security\.app-sandbox<\/key>\s*<true\s*\/>/.test(xml)
    host.signatureInspected = true
  } catch { /* Unknown signing state must not be reported as a TCC denial. */ }
  return host
}

function runNative(helper, bundleId, askUser, command = 'automation_permission') {
  return new Promise((resolve, reject) => {
    const child = spawn(helper, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    let output = '', error = ''
    const timeout = setTimeout(() => { child.kill(); reject(new Error('授权检查超时。结果未知，请点击“重新检查”，不要重复申请。')) }, askUser ? 120000 : 15000)
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { error += data })
    child.on('error', err => { clearTimeout(timeout); reject(err) })
    child.on('close', code => {
      clearTimeout(timeout)
      try { if (code !== 0) throw new Error(error || output); resolve(JSON.parse(output)) } catch (err) { reject(err) }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ command, bundle_id: bundleId, ask_user: askUser }))
  })
}

function createAutomationPermissions({ helper, executable, platform = process.platform, native = runNative, hostInfo = inspectHost, onBeforePrompt = () => {} }) {
  let pending = false
  async function check(bundleId) {
    validateTarget(bundleId)
    if (platform !== 'darwin') return { status: 'unsupported', canRequest: false, message: 'AppleScript 授权仅适用于 macOS。' }
    const [result, host] = await Promise.all([native(helper, bundleId, false), hostInfo(executable)])
    return classifyPermission(result, host)
  }
  return {
    check,
    async list() {
      if (platform !== 'darwin') return { status: 'unsupported', applications: [] }
      return native(helper, '', false, 'automation_applications')
    },
    async request(bundleId, purpose = '仅在你要求的桌面任务中读取内容和操作此应用。') {
      if (pending) throw new Error('已有授权请求正在处理，请先完成系统弹窗。')
      pending = true
      try {
        const before = await check(bundleId)
        if (!before.canRequest) return before
        await onBeforePrompt({ bundle_id: bundleId, target_name: before.target_name, purpose })
        await native(helper, bundleId, true)
        // Never infer the user's choice from the request call: preflight again.
        return await check(bundleId)
      } finally { pending = false }
    },
  }
}
module.exports = { validateTarget, classifyPermission, createAutomationPermissions, inspectHost }
