# crawshrimp-harness 维护交接与 code review 关闭记录

> 更新时间：2026-08-15。本文以当前源码、测试和运行验证为准，不把旧交接结论当作事实。

## 1. 当前结论

2026-08-14 交接中记录的 24 项高中低优先级问题已逐项关闭。本轮额外修复了跨 lease 重复审批、审批终态提示残留、当前会话上报被附件缓存吞掉、浏览器流启动取消竞态、会话级多 tab 聚合、脚本合同辅助函数绕过、启动脚本泄露 token、媒体空 ID 等问题。

产品决策保持不变：DSH Web 会话是唯一主界面；权限服从 DSH 会话策略；审批使用 DSH 原生卡；脚本必须是抓虾 Adapter 包；媒体显示在消息流；实时浏览器按会话 tab 绑定。

## 2. 原 24 项关闭表

| # | 级别 | 原问题 | 当前实现 |
| --- | --- | --- | --- |
| 1 | 高 | 审批等待占用默认线程池 | `crawshrimp-approval` 专用 4 线程 executor + 提交前 semaphore，默认 executor 不再被 15 分钟审批饿死 |
| 2 | 高 | `ctx.active_run` 单槽串会话 | `active_runs_by_runtime` / `grants_by_run` 保存会话真值；产品桥在 MCP 工具外层获取 context lease，未知会话安全失败 |
| 3 | 高 | test-install 覆盖生产 Adapter | 测试安装固定进入 `review-<hash>` 隔离命名空间；卸载前停止测试实例；正式包不被测试覆盖 |
| 4 | 高 | 媒体 token 静态长期有效 | 短期 HMAC capability，绑定 GET route、规范化 path、ZIP entry、expiry；不能跨端点或改 entry 使用 |
| 5 | 高 | Task Instance 启动超时被误判失败 | 60 秒后返回稳定 UID 与 `starting`，协程继续收敛；完成后更新 plan，重放不创建第二实例 |
| 6 | 中 | DSH web 端口探测最坏过长/误命中 | 15 秒并行探测 `preferred..+8`，同时要求 `__DSH_BOOT__`、product bridge 与 slots 特征 |
| 7 | 中 | 孤儿后端误杀存活实例 | 仅处理同 data 目录、父进程已死亡的后端；运行时清理同样验证父进程存活 |
| 8 | 中 | 端口选择 TOCTOU/失败仍返回占用端口 | MCP 使用预绑定保留 socket 交给 uvicorn；全部占用时明确失败；DSH web 另有特征回查 |
| 9 | 中 | 产物 ZIP/SQLite 阻塞事件循环 | run 产物收集通过 `asyncio.to_thread` 调度；ZIP 只读有限清单 |
| 10 | 中 | 拒绝审核时测试任务仍运行 | 拒绝、重装、批准前都先停止该 `review-*` Adapter 的活动 Task Instance |
| 11 | 中 | 审核页看不到真正执行的脚本 | 修订详情返回 manifest 与完整包文件；审核页支持文件切换、内容查看和真实 TaskRunner 测试 |
| 12 | 中 | 附件绑定“最近会话”导致串会话 | 上传显式携带 runtime session；后端按 runtime 建立/查询产品会话；附件读取再校验所属 session |
| 13 | 中 | preload 统一 60 秒超时导致双执行 | runtime/清库/脚本审核使用 5 分钟白名单；AbortError 改为“后台可能仍在处理，先回查” |
| 14 | 低 | 清智能体数据残留物理文件/Adapter | 清 attachments/workspace/harness/runtime/review/tmp；恢复首次发布前用户基线，清理 review Adapter |
| 15 | 低 | `attachment_read` 大文件 OOM | 解析前检查实际文件大小，50 MB 以上明确拒绝；Excel/CSV 另有结构上限 |
| 16 | 低 | AI 媒体事件没有稳定 ID | 基于绝对 path、size、mtime 生成稳定 `media-<hash>` ID；前端仍有 path fallback |
| 17 | 低 | repo name 路径穿越/SSRF/DNS rebinding | 单目录段校验、拒绝 symlink、仅公网 HTTP(S)、审批后重解析、Git curl DNS 固定 |
| 18 | 低 | 浏览器窗口显示 `undefined×undefined` | CDP 首次和周期回读 layout metrics，frame payload 带 width/height |
| 19 | 低 | `artifact-show` emit 无消费者 | 删除死事件；SSE consumer 直接安全 postMessage 到 DSH iframe |
| 20 | 低 | 上传图片没有进入模型 | PNG/JPEG/WebP/GIF 转 DSH image block；单张 8 MB、每轮 5 张，文件消失时降级为文本 |
| 21 | 新增 | 浏览器窗口拿全局 tab 集合 | 以 SQLite grant 和 9222 实时 page 的交集聚合当前 session 的 tab 子集；不泄露其他会话或未授权 tab，同时保留多窗口 |
| 22 | 新增 | Chrome tab 关闭后窗口残留 | 前端每 2 秒回读 tab 快照并关闭僵尸窗口；CDP socket/pending command 同步收敛 |
| 23 | 新增 | 附件/Excel 解析上限未声明 | README、SPEC、错误文案和测试统一声明 200 MB 上传、50 MB 解析及 Excel/ZIP 结构上限 |
| 24 | 新增 | 审批卡跨会话不可见 | 全局 SSE 提示可切换到审批会话；审批记录持久化归属并用 SQLite pending 列表定时恢复/清理，重启或断流不留幽灵提示 |

## 3. 本轮继续发现并关闭

- DSH `never` 权限现在是抓虾审批真值：所有抓虾审批自动批准但保留审计；`ask` 才出现原生卡。
- `browser_navigate` 自动执行，不再写入 `navigate` grant toolset，也不触发导航审批卡。
- MCP context lease 释放前把更新后的 grant 写回 `grants_by_run`；`act` 等仍需授权的能力跨 lease 继续复用批准结果。
- iframe client 用独立 `lastPublishedRuntimeSessionId` 跟踪会话上报；附件重放不再提前吞掉首次 `active-runtime-session`，浏览器事件能正确识别当前会话。
- 审批数据、执行计划、工具参数/结果、URL、POST body、Git remote 输出统一脱敏；含秘密计划明文只驻留内存并限制为 512 条。
- `fs_write` 在审批前不创建父目录；拒绝操作无文件系统副作用。
- 附件上传采用 1 MB 流式复制并在复制过程中执行 200 MB 硬限制；按扩展名和 magic bytes 拒绝可执行文件。
- Excel 解析限制文件、解压总量、条目、sheet、行、列、cell；恢复有界 `.xls` 支持。
- 页面 observe 对 password 以及 name/id/autocomplete 命中凭证特征的输入统一隐藏值。
- AgentBrowser 保留 connecting socket 直到 stream 正式登记，关闭窗口不会漏掉连接完成前的流。
- 同一会话历次 run 的存活 grant tab 聚合为会话子集；真实两 tab 同时显示、活跃置顶/级联和精确 tab 关闭清理均已回读。
- 脚本合同解析使用平衡对象和外层 IIFE 顶层返回校验；辅助函数里的伪合同不能绕过。
- 正式发布前复用 `AdapterManifest` schema；路径型 Adapter ID 在快照或安装前拒绝。
- 测试后按完整包哈希锁定；正式安装失败恢复短期快照；多次智能体发布保留首次发布前长期基线。
- `dev.sh` 不再把 API token 打印到终端。

## 4. 关键代码位置

- `core/agent/service.py`：run/session 编排、context lease、审批、SSE、runtime、自清理。
- `core/agent/mcp_gateway.py`：工具合同、计划幂等、文件/仓库/浏览器/附件/媒体。
- `core/agent/api.py`：附件、媒体 capability、SSE、脚本隔离测试与发布事务。
- `core/agent/script_contract.py`：Adapter manifest 与页面 async IIFE 硬校验。
- `core/agent/redaction.py`：结构化和文本脱敏。
- `app/src/agentBrowser.js`：按 target 的 CDP 截图流。
- `app/src/renderer/views/AgentWebView.vue`：DSH iframe、附件、多窗口和 tab 清理。
- `app/src/renderer/components/agent/AgentProductLayer.vue`：跨会话产品事件与媒体重放。
- `integrations/deepseek-harness/crawshrimp-product-bridge/lib/index.js`：DSH 权限和 MCP context lease。
- `integrations/deepseek-harness/crawshrimp-slots/lib/client.js`：菜单、附件、图片 block、媒体消息流。

## 5. 环境与验证规则

- API 默认 `18765`，Electron 会在 `+1..+100` 内寻找可用端口。
- MCP 为实际 API 端口 `+200`；DSH Web host 为 `+300` 起始并由 BOOT 特征回查。
- Vite `5173`、Electron CDP `9223`、托管 Chrome CDP `9222`。
- API token 只从当前数据目录的 `api-token` 读取；禁止写入交接文档、命令行参数、URL、日志或 Git。
- DSH 0.1.0-rc.6 hash 类名：侧栏 `.hHd-Xa_root`、会话列表 `.qDHVXG_list`、消息列表 `.Md3f7G_column`、滚动区 `.wSkVaW_scrollBody`、composer `.wSkVaW_composerSeat/.wSkVaW_composerStack`、加号 `.uV2eYG_add`、发送 `.uV2eYG_primary`。
- iframe 重载后旧 CDP execution context 失效，UI 验证必须重新取 frame/context。

标准门禁：

```bash
venv/bin/python -m pytest tests/ -q
npm --prefix app test
npm --prefix app run vite:build
git diff --check
```

再启动源码应用，以 curl 和 CDP 验证 runtime、签名媒体、附件 session、SSE cursor、脚本隔离、DSH iframe、上传按钮、审批策略和浏览器窗口。

## 6. 剩余外部平台限制

- DSH 版本升级不是普通依赖更新：必须重新核对 BootManifest、插件 API、事件词汇、hash 类名和全部 contract test。
- Windows NSIS 最终安装器应在 Windows 构建机验证；macOS 无法替代安装阶段的 Windows 文件占用/进程树测试。
- 模型、平台登录态、第三方站点或真实付费生成需要相应外部凭据；测试不得把凭据写入仓库。
