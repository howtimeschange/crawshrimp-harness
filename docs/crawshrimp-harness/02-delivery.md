# crawshrimp-harness 交付记录

> 更新时间：2026-08-15。证据以本轮最终命令、curl 和 Electron CDP 回读为准。

## 1. 交付总览

| 模块 | 当前状态 | 核心证据 |
| --- | --- | --- |
| DSH 内核与 Worker | 已实现 | 0.1.0-rc.6 精确锁版、Electron-as-Node、启动/EOF/超时/迟到响应回归 |
| DSH Web 唯一主界面 | 已实现 | iframe 常驻、菜单注入、右侧 overlay、脚本二级页 |
| 多会话运行隔离 | 已实现 | runtime session → run/grant 字典 + MCP context lease |
| DSH 权限继承 | 已实现 | `never` 自动批准并审计；`ask` 原生审批卡 |
| 浏览器工具 | 已实现 | tab grant、导航一次审批、敏感字段阻断、URL/body 脱敏 |
| 多窗口实时浏览器 | 已实现 | 当前会话 grant tab 子集、一页一窗口、独立截图流、置顶/级联、关闭轮询 |
| 附件和图片输入 | 已实现 | session 绑定、流式复制、magic bytes、image block |
| 会话内媒体 | 已实现 | SSE → iframe 消息列、HMAC capability、Range、ZIP entry |
| Adapter 创作三闸门 | 已实现 | schema/async IIFE 合同、review 命名空间、测试哈希、发布回滚 |
| 任务幂等与启动收敛 | 已实现 | plan 原子 claim、稳定 UID、60 秒后 starting 回查 |
| 审计与秘密处理 | 已实现 | 结构化/文本脱敏、秘密计划仅内存、token 不进 URL/日志/文档 |
| 稳定性 | 已实现 | 保留 MCP socket、DSH BOOT 端口回查、SSE cursor、孤儿安全清理 |

## 2. 运行架构

```text
Electron main
├── FastAPI（API 18765 起，最多 +100）
│   ├── SQLite 产品真值
│   ├── Task Instance / Adapter runtime
│   └── MCP gateway（实际 API + 200）
├── Node Worker
│   └── DSH JSON-RPC runtime（Electron-as-Node）
│       └── DSH Web host（实际 API + 300 起）
├── Vue shell + DSH Web iframe（Electron CDP 9223）
└── 托管 Chrome（CDP 9222）
```

MCP transport 本身不携带 DSH session。`crawshrimp-product-bridge` 在每次 `tools/execute` 外层读取 `exec.agent.id`，向后端租用对应 run context，工具完成后在 `finally` 释放。释放前把审批后更新的 grant 写回 run 级缓存；后端不再使用“最后活动 run”兜底。

## 3. 权限和审批

- DSH 会话策略为 `never`：抓虾所有审批自动 `allowed-once`，SQLite 保留审批记录和决定来源。
- DSH 会话策略为 `ask`：抓虾调用 DSH 原生 `ctx.approval.request`，卡片标题和原因使用中文人话。
- 审批 HTTP 等待在专用有界 executor；不会占满 asyncio 默认线程池。
- `browser_navigate` 自动执行，不再通过 grant toolset 申请导航审批。
- 简单下载/找图/找款仅在 read-only/local-write 风险内自动批准；名称包含 upload/publish/delete/update/modify 的任务不放行。
- 审批记录持久化 run/session/runtime 归属；跨会话提示通过全局 SSE 出现，并每 5 秒以 SQLite pending 列表恢复或清理。resolved/run 终态、后端重启和 SSE 中断都不会留下幽灵提示。

## 4. Adapter 创作和发布事务

三个硬门槛：

1. 草稿/发布入口必须是 `manifest.yaml`，任务脚本必须是包内 `.js`。
2. 每个页面脚本必须是文件末尾实际调用的 async IIFE，外层函数顶层返回含 `success`、`data`、`meta` 的对象。
3. 先安装到唯一 `review-<hash>` Adapter 并真实运行；包内容在测试后变化则必须重新测试。

正式发布流程同时保留两类快照：

- 短期 rollback snapshot：本次安装或数据库提交失败时立即恢复。
- 首次发布前长期 baseline：多次智能体覆盖不改写；清除智能体数据时恢复用户原 Adapter。

测试重装失败会清理半安装包并把修订退回 `pending_review`。卸载 test Adapter 前先停止其活动任务，避免 Windows 文件占用和孤儿实例。

## 5. 附件、媒体和数据限制

| 对象 | 限制 |
| --- | --- |
| 上传附件 | 200 MB；1 MB 分块复制；可执行扩展名/magic bytes 拒绝 |
| `attachment_read` | 50 MB；必须属于当前会话 |
| 模型图片 | PNG/JPEG/WebP/GIF，单张 8 MB，每轮 5 张 |
| Excel 文件 | 50 MB |
| Excel 解压总量 | 256 MB |
| Excel ZIP 条目 | 10,000 |
| Excel sheet | 32 |
| Excel 总行/列/cell | 100,000 / 512 / 2,000,000 |
| ZIP 媒体 entry | 64 MB |
| ZIP 图片清单 | 20 |

媒体 capability 的 canonical form 是 `v2\nroute\nexpiry\npath\nentry`。只有 GET `/agent/artifacts/file` 和 GET `/agent/artifacts/entry` 可用签名绕过 header；签名端点本身仍要求 API token。

## 6. 稳定性与安全加固

- Worker request 超时会移除 pending future；EOF/进程退出拒绝所有 pending；迟到响应安全忽略。
- DSH runtime 启动有绝对超时，超时先终止 runtime 再报告失败。
- MCP uvicorn 使用预绑定 socket，消除“先检查再 bind”竞态。
- DSH web 实际端口在 15 秒内并行扫描，并要求 BOOT、product bridge、slots 三项特征。
- SSE 使用 SQLite 全局自增 seq；session/global consumer 都按 cursor 重放，QueueFull 有统计和日志。
- CDP websocket 的 connect、command、close 都会收敛 pending；connecting socket 可被窗口关闭取消。
- `browser.activity` 根据 SQLite grant 与 9222 实时 page 的交集生成当前会话页面子集；其他会话/未授权 tab 不进入窗口列表。
- URL userinfo、token query、认证 header、请求 body、审批参数、工具结果和 Git remote 都会脱敏。
- preload/dev bridge 只向 loopback API 允许范围发送 token；query token 被拒绝。
- `dev.sh` 只提示 `api-token` 文件位置，不打印 token 值。

## 7. 验证门禁

代码门禁：

```bash
venv/bin/python -m pytest tests/ -q
npm --prefix app test
node --test tests/*.test.js
npm --prefix app run vite:build
npm --prefix app run stage:harness
git diff --check
```

真实运行门禁：

- curl：health/runtime、媒体签名有效/篡改/过期/route 混淆、附件 session、SSE cursor、脚本隔离与哈希篡改、repo transport。
- CDP 9223：DSH iframe 常驻、菜单注入、`📎`/`@`、图片 block、媒体消息列、多会话隔离、审批提示、tab 窗口绑定和关闭清理。
- 权限：`browser_navigate` 自动执行不审批；`never` 自动通过其他抓虾审批；`ask` 的风险操作仍出现原生卡。

本轮最终源码实测：Python `962 passed, 1 skipped, 42 subtests passed`；Electron/app `448 passed`；根目录 Node `1247 passed`；Vite production build complete；DSH production closure staging complete，Electron-as-Node boot check `OK`；`git diff --check` passed. 这些是 2026-08-15 当前工作区的重跑结果，不使用历史 877 项基线冒充当前证据。

2026-08-15 Electron CDP 实测：`browser_navigate` 已改为自动执行，不再生成导航审批卡或写入 `navigate` grant toolset；其他风险操作仍按 DSH 原生权限策略处理。iframe 重启后原会话、2 个图片原图节点、菜单、`📎` 和 `@` 都恢复。当前会话两个 grant tab 生成两个实时窗口，活跃窗口位于最后绘制层并按 36px 级联；关闭精确 tab 后 2 秒内对应窗口和截图流同时消失。

## 8. 构建边界

- `npm --prefix app run vite:build` 验证前端生产构建。
- `npm --prefix app run stage:harness` 生成当前主机目标的 DSH 生产闭包并运行 Electron-as-Node boot check；正式 macOS 双架构构建会分别生成 `build-staging/deepseek-harness/darwin-arm64` 与 `darwin-x64`。
- `npm --prefix app run build:mac:ci` 生成 macOS 双架构产物。
- Windows NSIS 应在 Windows 构建机执行 `npm --prefix app run build:win`；macOS 上的 win-unpacked 不能替代安装器 E2E。
