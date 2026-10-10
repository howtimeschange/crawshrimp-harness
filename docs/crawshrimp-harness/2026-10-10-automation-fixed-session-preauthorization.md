# 定时任务固定会话、会话权限与脚本调度

2026-10-10，源码改造完成，尚未打包发布安装版。

## 行为

- 普通新建定时任务默认 `permission_mode=session`、`context_mode=inherited`。到点把任务追加到创建它的固定会话，使用会话当前模型、工具、工作区、浏览器上下文及访问模式；不保存另一套工具或风险白名单，也不向 worker 传独立 `automationPolicy`。
- 普通模式沿用会话本身的审批行为，不额外增加自动化权限限制，也不越过会话已有权限。超时、重试、排队等待仍属于调度参数。会话模式 payload 标记 `sessionContinuation`，native 会话使用自身步骤/工具预算；调度超时和输出保护仍保留。
- 普通回答结束可完成本轮定时执行，保存实际 assistant 回答；“执行完成”不自动证明外部业务成功，不伪造 `verified=true`。显式验证 schema 仍要求证据合同。
- 明确选择固定专用会话时，持续复用 `automation:{automation_uid}`；旧任务优先复用最近一次仍存在的执行会话。新专用会话可不带来源会话创建，并使用自己的默认设置；有来源会话的创建路径只在首次创建时复制初始模型和浏览器设置，后续使用专用会话自己的设置。
- 任务中心增加“新增脚本定时任务”：选择已安装脚本、保存 JSON 参数，按每天/每周计划直接运行现有 adapter/task，记录 task instance、运行结果和输出文件，无需每轮请求模型。默认只保留本地运行记录，通知可使用已有配置。
- worker 接续 DSH 已保存的 native session 工作区归属；新会话默认使用统一 `agent/workspace`。读取 live native 模型选择时，provider/model 未变则保留原 reasoning effort。session-mode 只要 worker Host 已 ready 就复用当前 Host，不因来源会话模型与启动默认 route 不同而重启；旧 scoped 和普通非自动化 run 仍按 provider 与真实模型名判定 generation route。
- `permission_mode=scoped` 作为高级及旧策略兼容路径保留。MCP 工具使用 `toolset`，原生文件、命令和联网工具使用 `native_toolset`，明确约定权限内自动执行。自动化中心只在该模式显示独立工具、风险和能力开关。
- 高级浏览器任务预授权 `browser_navigate` 并保存 `browser_url` 后，标签页关闭时可恢复本任务页面；普通模式直接按任务目标和会话浏览器工具重新打开地址。
- 闭环观察阶段过滤写入和命令工具。动作分支的 `allowed_native_tools` 与任务授权取交集。任务结束清除本轮原生权限，普通对话保留原访问模式。
- 真实业务结果按实际读取或脚本输出评估；读取阻断必须如实说明。

## 兼容与生效

固定会话复用对现有任务自动生效，不删除原有历史会话。旧白名单任务继续使用 scoped 策略；不会静默扩大其权限。普通新任务使用 session 默认模式。HTTP 显式 `context_mode=isolated` 的 session 任务可不带 source 创建；未显式 isolated 的普通 session 任务仍默认 inherited，并要求现存 source。旧 scoped 任务若只有标签页绑定，需要在编辑中补充网页地址和导航权限才能关闭后恢复。

代码需要随更新后的客户端和内置运行时一起交付。首次实现验收未修改实际定时任务定义；随后按用户要求运行了隔离 QA 定时任务，未执行外部业务写入、未发布新版本。

## 实现分工

| 分工 | 主要文件 |
| --- | --- |
| 会话代理 | `core/agent/service.py`、`tests/test_automation_persistent_session.py` |
| Python 权限代理 | `core/automation_policy.py`、`core/automation_controller.py`、`core/agent/mcp_gateway.py`、浏览器恢复及权限测试 |
| 原生工具代理 | `integrations/deepseek-harness/crawshrimp-product-bridge/lib/index.js`、`automation-policy.test.mjs` |
| 主代理整合 | 自动化中心 Vue 与表单状态、会话权限提示与浏览器复用、旧契约测试、分支授权集成测试、产品指引 |

## 验证

覆盖会话复用与旧数据、权限快照、定时 API、调度重叠、错过触发、闭环条件、浏览器恢复、原生权限清理、工作区接续、reasoning effort 保留、`sessionContinuation` 标记、ready Host 复用和 HTTP isolated/session 无 source 创建边界。真实 Cordis Tools 链路验证了预授权跳过下游审批，同时仍执行最终工具 guard；清除权限后恢复普通审批路径。

首次定向验证：Python 回归 154 项、原生桥接与工具展示 13 项、前端自动化中心 19 项，共 186 项通过；`npm run vite:build` 构建通过。

第一阶段旧预授权方案回归见 [原验收记录](qa-2026-10-10-automation-live/回归与真实定时验收.md)。最终 session 默认方案、完整回归与真实开发环境客户端走查记录见 [开发客户端实际走查](qa-2026-10-10-automation-live/dev-client/开发客户端实际走查.md)。安装版升级尚未验证；实时两轮接续验证另行执行。
