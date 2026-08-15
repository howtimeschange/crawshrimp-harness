# 交接 Prompt（给下一位维护者）

你是 `crawshrimp-harness` 的维护者。工作目录：`/Users/xingyicheng/Documents/crawshrimp-harness`。

这是抓虾桌面应用与 DeepSeek Harness（DSH）的融合项目：Electron 43.1.0 → FastAPI → Node Worker → DSH runtime（Electron-as-Node，`@deepseek-ai/*@0.1.0-rc.6` 精确锁版）。Vite 默认 5173，Electron CDP 9223，托管 Chrome CDP 9222。

## 必读顺序

1. `README.md`：当前架构、开发、权限、限制和验证。
2. `docs/crawshrimp-harness/04-codex-handover.md`：24 项 code review 关闭表和关键代码。
3. `docs/crawshrimp-harness/03-media-in-chat-handover.md`：媒体/附件链路和 10 个历史坑。
4. `docs/crawshrimp-harness/02-delivery.md`：交付能力与最终证据。
5. `docs/crawshrimp-harness/01-dsh-agent-v2-proposal.md` §18：提案对当前实现的落账。
6. `SPEC.md` §11–16：当前规范真值。

不要轻信文档。开始工作前应同时检查当前 branch/worktree、关键源码、测试和实际端口/进程。

## 不得推翻的产品决策

1. DSH Web 会话 iframe 是唯一主界面；抓虾菜单注入会话侧栏；其他菜单是右侧 overlay；脚本详情是独立二级页。
2. DSH 会话权限是审批真值：`never` 时抓虾审批自动通过并审计，`ask` 时使用 DSH 原生审批卡。
3. `fs_read/fs_list` 全盘读免审批；`browser_navigate` 自动执行不审批；`fs_write/fs_exec` 允许但服从 DSH。
4. 简单下载/找图/找款自动批准，上传/发布/删除/修改类不自动放行。
5. 智能体脚本必须是抓虾 Adapter 包：`manifest.yaml + 页面 JS async IIFE`，外层返回 `{success,data,meta}`；草稿/测试/发布均强校验。
6. 审批卡必须是 DSH 原生卡，内容是中文人话。
7. 图片、视频和附件显示在消息流末尾；composer 原生加号改成 `📎`，旁边保留 `@`。
8. 实时浏览器聚合当前会话已 grant 且仍存活的 tab 子集，一个页面一个窗口，活跃置顶、级联排列、关闭自动清理。

## 环境事实

- API 默认 18765，在 `+1..+100` 内漂移；MCP 为实际 API `+200`；DSH Web 为 `+300` 起始并按 BOOT 特征回查。
- API token 只从当前数据目录的 `api-token` 读取。绝对不要把 token 值写入 prompt、文档、命令参数、URL、日志、截图或 Git。
- 数据目录通常为 `~/.crawshrimp`，包含 SQLite、config、Adapter、attachments、workspace 和 DSH session。
- DSH 0.1.0-rc.6 hash 类名：`.hHd-Xa_root`、`.qDHVXG_list`、`.Md3f7G_column`、`.wSkVaW_scrollBody`、`.wSkVaW_composerSeat/.wSkVaW_composerStack`、`.uV2eYG_add`、`.uV2eYG_primary`。
- iframe 重载后旧 CDP execution context 失效，必须重新获取 frame/context。

## 验证合同

使用 don't-stop 循环：实现 → 聚焦测试 → 修复 → 全量回归 → 构建 → curl/CDP 实机回读 → 自审 → 提交。

```bash
venv/bin/python -m pytest tests/ -q
npm --prefix app test
npm --prefix app run vite:build
git diff --check
```

实机至少验证：

- `/health` 和 `/agent/runtime`；
- 媒体 HMAC 的有效、篡改、过期和 route/entry 混淆；
- 附件 runtime session 绑定、SSE cursor、review Adapter 隔离和测试后篡改拒绝；
- DSH iframe 常驻、菜单、`📎`/`@`、图片 image block、媒体消息流和跨会话隔离；
- `browser_navigate` 自动执行不审批；DSH `never` 自动批准其他抓虾审批，`ask` 的风险操作使用原生审批；
- 当前会话多 grant tab 窗口、活跃层/级联和精确 tab 关闭清理；
- 后端重启或 SSE 断开后，pending 审批提示能按 SQLite 真值恢复/清理。

提交时使用中文、按模块分 commit；只 stage 本轮确切路径，保留用户的无关改动。若用户要求推送，提交后回读远端仓库隐私、默认分支和 SHA，不能用本地 commit 代替远端证据。
