// 抓虾启动器插件:在 DSH runtime 树内提供 launcher 事实(cmdlineArgs + appExit),
// 使官方 web-startup 行解析 --host/--port 并提供 webStartup 服务 —— 替代 dsh CLI
// 启动器的职责(树内 Cordis 服务同 scope 可见,官方 web patch 即依赖此语义)。
import z from '@deepseek-ai/schemastery'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'crawshrimp-launcher'

/** 配置契约:launcher 事实(config.args 为命令行参数快照)。 */
export const Config = z.object({
  args: z.array(z.string()).default([]),
})

export function apply(ctx, config) {
  const args = Array.isArray(config?.args) ? config.args.map(String) : []
  provideCmdline(ctx, {
    args,
    exit: (code) => {
      process.exitCode = Number(code) || 0
    },
  })
}
