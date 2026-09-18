# Windows v0.2.1 修复与实机验收（2026-09-18）

> 历史阶段证据：本记录对应本轮性能和上下文优化之前的Windows修复版本，不能作为最终优化版本的验收通过证明。最终门禁见 `2026-09-18-final-review-and-local-merge.md`。

## 结论与环境

已在 UTM Windows 11 ARM 虚拟机中，通过官方 NSIS 安装的 **v0.2.1 Windows x64 应用（系统仿真运行）**验证修复。实际目标为 `C:\harness-qa-20260918\app\抓虾 Harness.exe`，使用独立 QA 数据目录，调用真实 DeepSeek 官方 API。没有把宿主 macOS 源码测试当作 Windows 验收，也没有把模型自述当作文件证据。

用户要求的三种网页任务均有真实执行证据：单次网页操作、自然定时触发、单次成功后固化为抓虾脚本并重新运行。12 分 24 秒长任务没有出现自动重启；会话连接故障注入后任务继续完成。

本次修改保留在本地工作区；没有 commit、push、发布 Release 或更新自动升级源。补丁为 v0.2.1 资源覆盖包，不是完整安装器。

## 已修复的问题

| 问题 | 根因及修改 | Windows 验证 |
|---|---|---|
| 升级/再次启动报 `cannot resolve profile bundle "@xmanrui/dsh-im"` | Electron 内置 Node 在 Windows 对 junction 做递归删除，误删目标插件。链接用 `lstat` 判定后 `unlink`，只有真实目录递归删除；修复包补回三个插件。 | 原错误重现；插件修复后多次冷启动、认证会话均通过。最终又连续两次冷启动 ready，配置和聊天保留。 |
| 回答成功仍报 `SESSION_FOLLOW_FAILED` | 订阅连接短暂断线被伪装成任务终止。改为带退避重连，按序号恢复真实事件并去重。 | 使用 Windows TCP API 主动断开真实订阅连接；最终状态 completed，没有伪造 interrupted。 |
| 产品发起的任务在订阅断线后连带重启 Host | 旧路径错误地取消任务；2 秒收不到确认后杀掉共享 Host。产品任务也接入可恢复订阅。 | 在 PowerShell 等待阶段断开连接，任务随后写入/读回 391；运行时 generation 前后均为 1。 |
| GUI 启动的 Windows 沙箱 PowerShell 报 `0xC0000142` | GUI Electron-as-Node 无 console，受限 token 子进程无法初始化。启动时挂接/分配隐藏 console，并恢复原标准句柄。 | 真正受限沙箱中计算、中文空格目录写入与读取通过；未绕过 token 或放宽 ACL。临时上游诊断修改已还原。 |
| 目录选择槽位冲突 | 产品槽位和原生槽位优先级相同。产品槽位使用明确优先级。 | 目录功能及插件加载通过；相关测试 16 项通过。 |
| 可见中间步骤与工具说明常用英文 | 统一 persona 和内置 profile 的语言要求，明确中文进度、工具 description/title 示例，并保留代码/路径原文。 | 实际请求头含规则；新 DeepSeek 会话的执行说明和 pwsh 描述均为中文。 |
| Windows 深层目录 Office 渲染返回 0 却没有 PDF | LibreOffice 私有 UserInstallation 路径过深。Windows 使用独立短路径临时 profile，完毕清理；文档仍在原受控目录。 | 同一深层中文路径 DOCX/XLSX 转 PDF 通过，Excel 重算通过；真实智能体 office_render → preview → review → deliver 完成。 |
| 脚本执行后模型误判没有结果 | task_status 摘要丢失记录数；产物列表未使用数据库 label。补充受限数值统计、文件名映射；未知大小保留 null，避免伪称 0 字节。 | 实际任务记录 3、产物 1；安装代码投影检查通过。 |
| 生成脚本规范失败难以自修、漏配导出 | 合同错误提示明确外层 IIFE 对象返回要求；技能说明强调数据任务需配置 output，并核对真实产物。 | 完整包静态验证、安装、task_prepare/task_run、Excel 明细读回通过。 |

`AGENT_DISPATCH_INTERRUPTED` 是应用启动时给遗留未结束任务补记的中断状态，本身不能确定重启根因。本次已复现并修复“订阅断线导致 Host 被杀”的一条明确路径；没有旧用户日志，不能断言所有历史重启都是同一原因。旧失败/人工取消的验收记录保留，没有改数据库抹掉错误。

## 实际场景与证据

证据目录：`artifacts/windows-full-qa-20260918/`。初始启动故障证据另在 `artifacts/windows-dsh-boot-20260918/`。

| 场景 | 实际结果 | 证据 |
|---|---|---|
| 真实 DeepSeek、多轮上下文、CSV 附件 | 已配置独立 QA profile；多轮口令/计算、附件内容读取验证。密钥未写入源码或补丁。 | `live-qa.json`、`live-scenarios.json` |
| 终端、中文空格路径 | 23×17=391，写入后读回；最终新会话 31×17=527，中文文件内容一致。 | `final-live.json`、`chinese-final-proof.json`、`final-readback.json` |
| 单次网页自动化 | 真实浏览器工具筛选已付款并翻页，3 条订单 QA1001/QA1003/QA1005，258+318+199=775。 | `browser-qa.json`，run `run-cd4dd39a822c` |
| 定时网页任务 | 2026-09-18 12:33:20 +08:00 自然触发，排队后执行网页观察，完成并向创建会话回传中文摘要，notification_status=delivered。不是手动 run_now。 | `scheduled-qa.json`、`automation-status.json`，run `run-981493d0767d` |
| 固化抓虾脚本 | `windows-qa-orders-20260918 / paid_orders` 经 script_test、script_publish 安装，再经 task_prepare/task_run 执行；Excel 5294 字节，3 条明细独立读取验证合计775。 | `final-scenarios.json`、`final-readback.json`；实例 `84bef04824f04820b3f5b6dacb2180e1` |
| 长任务 | 744.1 秒，12 个顺序阶段、24,000 行；结果总额 9,288,000。采样 generation=8、worker PID 5716 / Host PID 8136 始终未变化。 | `long-task.json`、`ui-long-running.jpg`，run `run-web-fae29db49bce` |
| 原生会话断线恢复 | 主动断开实际 TCP 连接，模型任务仍 completed。 | `follow-live.json`，run `run-web-772d42617922` |
| 产品任务断线恢复 | 等待12秒期间主动断线，计算及写读完成，generation 不变。 | `product-drop.json`，run `run-cc94473223e5` |
| 取消、继续、改名、归档/恢复 | 正常取消后仍可继续会话；会话管理状态读回通过。 | `remaining-live.json` |
| Windows Office 本地能力 | bundled Python/LibreOffice 的 DOCX 3页、PPTX 5页、XLSX 3页原生 smoke 通过；代表页目视检查中文正常。 | `office-final-report.json`、`office-final.json`、`office-docx.png`、`office-pptx.png`、`office-xlsx.png` |
| 实际智能体 Office 链路 | 已有 XLSX/DOCX 在长路径渲染、预览、验收、交付完成；表格内容合计705。 | `office-deep-verify.json`、`office-retry.json`、`ui-office-final.jpg` |
| 原生依赖与工具 | 26 个 Python 模块、6 个 CLI help，以及 sharp/koffi/node-pty/ripgrep 检查。 | `native.json`、`packaged-checks.json` |
| UI 走查 | 对话、我的脚本、开放市场、任务中心、生图和视频页面已实际打开；Office 资源卡显示“已验收交付”；生图未配置 Key 有明确提示。 | `ui-*.jpg` |
| 最终冷启动及资源一致性 | 连续两次冷启动 ready；补丁 300 个文件与真正验收安装目录 SHA256 一致，0 mismatch。 | `final-cold-launch.json`、`verify-final-package.json`、`final-health.json` |

脚本首版没有 output 配置，因此“执行成功但没有可下载文件”。日志已证明前两次都抓取3条；它们并非空执行。脚本默认新开标签，原绑定页面未改变也不是失败证据。添加 Excel output 后最终明细已经独立核对。首版草稿静态校验失败、测试主动取消和中间试错均记录在证据中。

Office 初始 `office-report.json` 的测试目录已存在错误属于验收脚本复用目录，不能算产品通过；之后在新目录的 `office-final-report.json` 才是有效原生 smoke。真正产品长路径缺陷有同文件、同程序、长/短 profile 对照实验及修复后读回。

## 源码验证

- App 全套：808 passed（`final-app-tests.log`）。
- 最终启动/console/follow/RPC 定向复测：32 passed（`final-recovery-tests.log`）。
- 最后 Python 受影响测试：44 passed（`final-affected-python.log`）。
- Office 受影响集：63 passed（`office-fix-tests.log`）。
- 前阶段 Python 基线集：1841 passed、1 skipped；这不是最后每个修改后的全量重跑（`source-python-tests.log`）。
- `git diff --check` 通过。

上述测试在宿主 macOS 运行；Windows 实际执行证据单列，不混淆两者。初次使用系统 Python 缺 mcp 导致收集失败，已改用具备项目依赖的现有环境重跑通过。

## 交付、清理与边界

修复包：`artifacts/windows-full-qa-20260918/crawshrimp-harness-v0.2.1-windows-fix.zip`。

- SHA256：`097732cb004f23bad93c139d9a199d1005bace340255d0cd9ef4cd220cea2406`
- 大小：9,250,261 字节；300 个资源文件，附使用说明和逐文件 SHA256。
- 完全退出抓虾后，将包内 resources 与 v0.2.1 Windows x64 安装目录的 resources **合并覆盖**；不要先删除原目录。
- 包内没有用户 Key、会话数据库、QA 数据或诊断日志；没有改动正式用户数据目录。
- 测试专用 Windows 任务注册已清理；保留正在运行的修复后客户端和隔离 QA profile。网页 fixture 服务在验收结束后停止，测试 HTML 保留于 `/tmp/harness-win-boot-20260918/qa-orders.html`；示例脚本依赖该测试页，不是线上商家脚本。
- 生图/视频只验证界面和配置状态，没有配置相应供应商 Key 或做付费生成。没有验证真实商家账号、IM 外部发送、每个市场脚本、物理 x64 电脑及所有 Windows 版本。
- 中文是默认模型输出约束，实际本次会话已验证；不把历史英文记录重新翻译，也不承诺任何模型每次都绝对遵从。可见内容为简短执行说明，不要求暴露内部推理。

以上是明确覆盖范围内的通过结果，不表示应用所有可能路径都已经无缺陷。
