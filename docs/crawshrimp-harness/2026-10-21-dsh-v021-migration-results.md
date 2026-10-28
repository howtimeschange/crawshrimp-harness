# DSH 0.2.1-rc.2 迁移执行记录

分支 `codex/dsh-runtime-v021`，基线 `d66b4d172`。工作区位于 `/Users/xingyicheng/.codex/worktrees/dsh-runtime-v021/crawshrimp-harness`。本轮仅实现和本地验证；不替换已安装应用、不迁移真实用户数据、不推送或发布。原工作区的会员/账号修改保持独立。

完整验收计划见 [迁移测试计划](2026-10-21-dsh-v021-migration-plan.md)。机器可读的脱敏实测摘要见 [live-summary.json](qa-2026-10-21-dsh-v021/live-summary.json)。详细原始日志和临时脚本保存在工作区 `.codex-tmp/dont-stop/dsh-v021/`；其中测试凭据、会话库和临时目录不应提交。

## 实施内容与迁移取舍

| 优先级 | 改动 | 落地方式 |
|---|---|---|
| P0 | 流式超时、退出清理 | 提供针对旧 0.1.2-rc.1 的小补丁；rc.2 使用上游原生实现，避免重复覆盖。挂起 next/return、断流、取消、迟到错误、重试分类均有回归。 |
| P0 | 原生 Messages | 官方 `crawshrimp-deepseek-official` 保留产品身份，接入 `https://api.deepseek.com/anthropic`；从 pi-ai 移除同名重复注册。第三方通道保留原协议。保存用户模型名称、上下文预算和输出预算。 |
| P0 | 整套锁版与桌面宿主 | DSH 依赖族精确锁为 rc.2；settings 包和产品预设注册迁到新结构；dsh-im 仍为 4.11.0。Electron 精确锁为 44.7.0，以匹配上游原生加载器已支持的运行时。 |
| P1 | 动态提示和工具 | Flash 声明 in-history system 更新和 addition-only 工具更新；保留抓虾 enable_tools、中文身份、CDP、权限与审批。时间上下文兼容新的来源格式，按新输入刷新。 |
| P1 | 历史与模型切换 | 历史搜索、压缩、恢复适配新结构；旧会话复制后迁移；原生适配器归一化旧 Flash 标识；保留 Pro 经 Flash 的图片预处理，并计入其 token。 |
| P1 | 生命周期与归档 | 配套升级 Agent/Session/后台工作流/子任务；采用上游 archive/unarchive 与活动会话保护；产品资源面板恢复路径重新对接。 |
| P2 | 持久 Node PTC | `executionMode: persistent-in-memory`；沿用抓虾产品预设，设置 `CRAWSHRIMP_PTC_TOOLS=1` 可切到 run_code 工具呈现。桌面默认仍是原生工具，避免未验证通道被整体切换。变量仅在当前运行进程内保留，不承诺重启后恢复。 |
| P2 | 插件会话状态 | 新增产品自己的版本化 SQLite SessionStateStore：工作区/会话/插件隔离、revision CAS、JSON 检查、64 KiB 上限、未知版本兼容。用于记忆召回引用元数据，长期记忆事实仍由原 MemoryStore 管理。未冒用上游限制外部插件调用的实验 API。 |

旧补丁处置：C01 分页游标保护按新 MCP 接口重写；C02 使用已具备等价行为的上游实现并保留 guard；C03 适配新的资源地址 API。归档及流式清理优先使用上游能力。产品 reasoning 恢复、GLM 视觉桥、Office、IM、中文提示、资源面板与审批继续保留并通过相邻回归。

## 已执行验证

| 验收 | 结果与证据 |
|---|---|
| A01–A02 | watchdog 5 项、真实适配器本地 HTTP 故障夹具 7 项：401 不重试、429/500 限次重试、TIMEOUT/TRANSPORT/ABORTED 分类、取消后无额外重试、未伪造成功完成。 |
| A03–A04 | 独立目录 npm ci 生产依赖安装、产品补丁应用、Web profile 启动；前端 Vite 构建；macOS arm64 打包。桌面最终验证状态见下方收尾记录。 |
| A05 | 真实官方 Flash Messages off/high/max 均完成；多轮 bash→read 工具续接完成。 |
| A06 | 真实 enable_tools 激活 delegation，后续子任务调用完成；权限边界由现有沙箱和审批回归覆盖。 |
| A07 | 原 0.1.2-rc.1 测试会话复制后由 rc.2 恢复，核对 7319；进程重启后恢复；33 条历史压缩后继续；Flash→Pro→Flash 切换后继续读回。长期记忆保存、查询、重启召回通过，隔离/遗忘由存储回归覆盖。 |
| A08 | 真实子任务启动并读回 7319；后台工作流返回 jobId、父轮次结束后继续完成、通知/结果读回 BG-7319；另一个后台任务立即取消，job_output 与 job_list 读回 killed。 |
| A09 | 真实 run_code 第一轮返回 7319，第二轮不重定义变量返回 7320；运行时夹具验证会话隔离、取消、release 清理和沙箱拒绝越界写入。 |
| A10 | 插件状态重建后恢复、工作区/会话/插件隔离、旧 revision 冲突、未知 version、不合法 JSON/超大值拒绝通过。 |
| A11 | 官方 Flash：截图正确读取两项 P0 建议，动态工具、压缩、恢复和记忆全链路通过；Pro 原生 Messages 配对 Flash 识图也通过。 |
| A12 | 官方 Flash 新旧版本和当前国内通道 Qwen 均完成 4 类同题 smoke。国内通道的 DeepSeek 型号返回 model_not_found；海外 GPT 通道 60 秒未完成，未放行。 |
| A13 | Node/Python/构建/真实桌面检查及最终 diff 自查，见收尾记录。 |

## 同题 smoke 数据

每组 1 次，四个用户轮次：文本、工具续接、截图、压缩后继续。表内耗时和 token **不包含 `/compact` 指令自身**。不同模型的推理和工具选择会造成额外差异，不能据此推断统计显著的性能提升。

| 环境 | 完成 | 四轮总耗时 | inputTokens | outputTokens | cacheReadTokens |
|---|---:|---:|---:|---:|---:|
| rc.2 官方 Flash Messages | 4/4 | 15.662 秒 | 6,355 | 800 | 70,656 |
| 基线 0.1.2-rc.1 官方 Flash pi-ai | 4/4 | 10.544 秒 | 17,129 | 654 | 37,120 |
| rc.2 国内通道 Qwen 3.7 Plus | 4/4 | 25.615 秒 | 20,877 | 1,049 | 不完整；已返回部分合计 26,240 |

token 使用运行时返回的标准 usage 字段，cacheRead 单列，缺失不当作 0。Messages 本轮非缓存输入更低、缓存读取更高，但耗时更高；本轮结论是功能兼容通过，不能宣称普遍提速或总成本下降。

## 验证中修复的问题

1. rc.2 变更预设、归档、流事件和提示来源；迁移了对应产品适配与测试夹具，没有通过删除行为断言放行。
2. Pro 的旧视觉预处理只在 pi-ai 内实现。补上原生 Messages 预处理，并声明其配对视觉能力，防止上游在进入适配器前丢弃截图。
3. Electron 43.1.0 不在新版原生加载器支持的指纹列表内。升级到明确支持的 44.7.0；原生模块实际加载成功，没有绕过版本检查。
4. DSH 认证重定向从 `/` 改为 `./`。桌面 cookie 桥只允许这两种根路径，继续拒绝外部重定向。
5. npm 提升 ACP 包后，旧打包检查仍寻找嵌套目录。更新为锁文件中的实际顶层路径。
6. 后台验证脚本首次误用 guest 环境不支持的 setTimeout；记录为失败后改成受管子任务等待，重新通过。未把首次失败算成功。
7. 新 Electron 下载与测试并行导致一次重复下载挂起。停止本任务的重复安装进程后，相关 profile-links 测试独立通过，并重跑最终套件。

## 已知边界与回退

- Python 全量相邻检查有 11 项旧图像服务/模型目录测试失败，在基线 d66b4d172 的独立源码副本中同样复现。本次未扩大范围修改旧 1XM 图像服务；其余 178 项及 4 个 subtests 通过。
- 海外通道与国内不支持的 DeepSeek 型号没有推广。需要通道恢复或提供有效模型映射后，沿用相同四类任务重测；不能用其他模型通过替代该通道通过。
- 仅本机 macOS arm64 的未签名验证包。Windows、macOS x64、签名、公证、真实账号登录与真实钥匙串升级均不属于已通过范围。桌面 smoke 使用独立数据目录及 mock keychain，未复制真实账号或业务会话。
- 不改生产依赖或安装应用即可回退：继续使用原工作区/现有安装包。若以后正式升级，必须先备份真实数据；旧运行时不能直接写入新格式会话目录。
- PTC 先按 `CRAWSHRIMP_PTC_TOOLS=1` 显式启用，清除此环境变量即可回到原生工具呈现；它不改变长期记忆或权限边界。

## 收尾记录

2026-10-21 本地验证完成，保留外部通道限制；未提交、推送或发布。

| 检查 | 最终结果 | 本地证据 |
|---|---|---|
| 桌面完整回归 `node scripts/test-collection.mjs run app` | **968/968 通过** | `app-delivery.log` |
| 运行时脚本、兼容和产品桥 Node tests | **56/56 通过** | `runtime-final-v2.log` |
| Python 运行时硬化与网关相邻检查 | **178 passed、4 subtests passed、11 failed**；11 项在原基线同样复现 | `python-final.log`、`baseline-python.log` |
| Vite 前端构建 | 通过 | `app-build.log` |
| 生产依赖干净安装及运行时 staging | 通过；295 个 DSH 包全部 rc.2，无混版 | `stage-ptc.log`、锁文件复核 |
| Electron 44.7.0 macOS arm64 未签名包 | 打包完成，原生模块可加载 | `package-final.log`、`electron-native-probe.log` |
| 实际打包应用 | 核心服务运行中、认证 cookie 桥成功、原生 iframe 显示抓虾新会话/工具菜单/输入区；截图人工检查通过 | `packaged-ui-v7.json`、`packaged-ui-v7.log` |
| 退出 | 主应用退出、后端由现有超时强制退出兜底结束；**不宣称所有后端均优雅退出** | `packaged-ui-v7.log` |
| 模型切换复核 | 修正测试日志的固定模型标签，服务读回 Pro→Flash 均正确，两个轮次继续 read 并核对 7319 | `model-switch-confirmed.log` |
| 自查 | `git diff --check` 通过；临时 Python 打包链接移除，旧 smoke 遗留进程清理；原始凭据/会话未加入交付文件 | 工作区状态 |

以上日志均相对于 `.codex-tmp/dont-stop/dsh-v021/`。桌面 screenshot 见 [打包界面](qa-2026-10-21-dsh-v021/packaged-desktop.png)。UI smoke 使用 mock keychain 和空账号；真实模型任务另由上表的运行时实测覆盖，未声称在打包 UI 内完成真实账号任务。

最终状态：P0/P1/P2 的本地实施与可用通道验证已完成。海外 GPT 超时、国内 DeepSeek 型号不存在，相关通道保持未放行。下一步是取得有效通道后续测，以及在正式发布前补齐真实登录/钥匙串与其他平台验证。
