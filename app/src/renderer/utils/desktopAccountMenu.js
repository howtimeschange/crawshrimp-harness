export function accountIdentity(account = {}, error = '') {
  const user = account.user
  if (error) return { name: '账号状态暂不可用', detail: '点击管理账号', initial: '', authenticated: false }
  if (!user) return { name: '登录 / 注册', detail: '', initial: '', authenticated: false }
  if (user.anonymous) return { name: '访客', detail: '绑定邮箱，保留身份', initial: '', authenticated: true }
  const name = String(user.name || user.email?.split('@')[0] || '个人账号').trim()
  return { name, detail: user.email || '个人账号', initial: Array.from(name)[0]?.toUpperCase() || '', authenticated: true }
}

export function runtimeIndicators(status = {}) {
  const starting = ['starting', 'restarting', 'recovering'].includes(status.apiState)
  const browserError = !status.chrome && ['occupied-non-cdp', 'invalid-cdp'].includes(status.chromeDiagnostic?.kind)
  return {
    core: { label: status.api ? '运行中' : starting ? '启动中' : '未连接', tone: status.api ? 'on' : starting ? 'pending' : 'error' },
    browser: { label: status.chrome ? '已连接' : browserError ? '连接异常' : '按需启动', tone: status.chrome ? 'on' : browserError ? 'error' : 'idle' },
  }
}
