// 抓虾启动器插件:在 DSH runtime 组合内提供 launcher 事实
// (cmdlineArgs + appExit),使 web-startup 插件可以解析 Web 参数并发布
// webStartup 服务 —— 替代 dsh CLI 启动器的职责。
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'crawshrimp-launcher'

export const Config = {
  args: { type: 'array', default: [] },
}

export function apply(ctx) {
  const args = Array.isArray(ctx.config?.args) ? ctx.config.args.map(String) : []
  provideCmdline(ctx, {
    args,
    exit: (code) => {
      process.exitCode = Number(code) || 0
    },
  })
}
