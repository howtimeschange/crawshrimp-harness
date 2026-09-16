# 自动化、MCP 控制与测试收集修复验收

日期：2026-09-16。基线：`bcb9bfc53`。本文记录本地验收结果，不代表远端 CI 或发布完成。

## 行为与改动

- `core/scheduler.py`：显式合并积压触发；周期/loop/重试宽限 300 秒，一次性 at 宽限 3600 秒。超过宽限的重试不再接受注册。
- `core/automation_controller.py`：每 60 秒扫描持久化定义。超宽限触发写入 `missed`；at 停用并标记 `needs_review`；周期与 loop 只安排下一次未来触发。loop 漏触发不消耗实际执行次数预算。过期重试终结为 `needs_review` 并清空 `retry_at`，解除 overlap 阻塞。扫描使用与回调相同的 claim 锁，不终结正在运行的任务。扫描异常写日志且不终止后续扫描。
- `core/api_server.py`：看护任务随 lifespan 启停；MCP 包装层删除三处对同步控制函数的错误 await。控制函数及 UI 路由的原有业务判断保持不变。
- `scripts/test-collection.mjs`、`app/package.json`、`.github/workflows/build-desktop.yml`：共用显式文件枚举，避免 shell glob 差异；加入四个 CLI、integrations、前端嵌套测试；工作流守卫检查收集入口、CLI 测试配置和构建冒烟入口。保持 build 对 test 的依赖和原有 tag 签名/公证条件。
- 新增 `tests/test_automation_misfires.py`、`tests/test_agent_task_control_regression.py`、`tests/test-collection.test.js`。

运行期宽限内可以晚到执行；后端离线后重新启动仍沿用原有 restore 策略：记录错过，不补放历史工作。运行期超过宽限的记录可能在下一次分钟扫描时才出现。

## 修复前后证据

先加入 11 个回归用例，在未修改业务代码时运行：11 failed。包括晚到 3 秒的 at 未执行、缺少 sweep、过期重试仍阻塞，以及 pause/resume/stop 在动作生效后抛 `TypeError: object dict can't be used in 'await' expression`。

修复后加入另外 4 个边界测试，覆盖注册后才失火的真实 APScheduler 重试、宽限内重试、loop 次数预算、看护任务在扫描异常后的继续运行和停止。最终 15 个新增 Python 用例全部通过，相关 7 个测试文件合计 313 passed、8 subtests passed（32.08 秒）。没有使用 stash，也没有修改、删除或放宽原有断言。

收集守卫进一步发现原审查漏算的 `app/src/renderer/aiImageResultLineage.test.mjs` 及两个 integrations CLI 的 `.test.js`，均纳入执行。加上原报告 81 个，共补入 84 个既有测试文件。

实际在 `tests/` 临时添加一个未支持的 `.test.ts`：守卫退出码 1，并输出该文件路径。移除临时文件后退出码 0。新增 Node 回归还验证删除 integrations CI 步骤会被拒绝。

## 本地验证

Python 使用 `/tmp/harness-review-venv` 隔离环境（Python 3.11，安装项目 requirements 与 httpx）；Node 22.23.1。CI 固定 Node 22.19.0。

| 命令/入口 | 结果 | 耗时 |
| --- | --- | --- |
| `cd app && npm test` | 798 passed | 10.24 秒 |
| `node scripts/test-collection.mjs run adapters` | 1239 passed | 43.67 秒 |
| `node scripts/test-collection.mjs run integrations` | 41 passed | 1.00 秒 |
| `node scripts/test-collection.mjs run DeepDrawCLI` | 245 passed / 31 文件 | 14.07 秒 |
| `node scripts/test-collection.mjs run bmall-cli` | 135 passed / 25 文件 | 5.04 秒 |
| `node scripts/test-collection.mjs run semir-yunpan-cli` | 61 passed / 15 文件 | 2.95 秒 |
| `node scripts/test-collection.mjs run tmall-cli` | 20 passed / 5 文件 | 3.37 秒 |
| `PYTHON=/tmp/harness-review-venv/bin/python node scripts/test-collection.mjs run python` | 1837 passed、1 skipped、53 subtests passed | 87.26 秒 |
| 最终调度/MCP 等 7 文件针对性回归 | 313 passed、8 subtests passed | 32.08 秒 |
| `node --test tests/test-collection.test.js` | 2 passed（也包含在 adapters 全量中） | <1 秒 |
| `node scripts/test-collection.mjs verify` | 通过；临时漏收文件演示如上 | <1 秒 |
| `cd app && npm run test:dsh-web-auth` | 原始 iframe 401 复现、修复后 iframe/fetch/WS 鉴权、dispose 清理均通过 | 未单独计时 |
| `cd app && npm run test:builtin-clis` | 当前 macOS arm64 staging 搬迁后 6 个 CLI 全部通过 | 未单独计时 |
| `git diff --check` | 通过 | — |

Python 全量在最后 4 个边界用例及 loop 次数预算调整前运行；最终针对性回归包含这些后续改动。唯一 skipped 是原有 Amazon 标签测试缺少本机示例 XLSX/PDF；未新增 skip。既有 Python 依赖弃用警告仍存在。

CLI 和 integrations 新增执行部分本机约 26 秒。CI 增量估计在依赖缓存命中时约 0.5–2 分钟，冷缓存受网络影响可能更长；尚无远端运行实测。

## 明确保留的人工验收

白名单按完整文件名列在 `scripts/test-collection.mjs`，没有通配豁免新脚本：

- `market-read-smoke.cjs`：需要已登录且由本机 OS 加密的账号，保留真实只读云端验收。
- `market-electron-smoke.cjs`：需要管理员账号，包含真实发布、审批、撤回。
- `market-lifecycle-local-smoke.cjs`：需要登录态及已审批且匹配的示例 ZIP。
- `analytics-electron-smoke.cjs`：需要真实账号及云端分析事件。
- `performance-audit.cjs`、`performance-logs.cjs`、`performance-repaired-source.cjs`、`performance-repaired-startup.cjs`、`performance-repaired-thumbnail.cjs`、`performance-windows-startup.cjs`：依赖指定机器、源码客户端或性能现场。

这 10 个脚本没有伪装为已执行。两项离线冒烟已接入 macOS/Windows build job；本轮只实际执行了 macOS。内置 CLI 冒烟证明 staging 依赖树可搬迁运行，不等价于最终安装包安装验收。未执行真实系统休眠/唤醒、完整智能体审批 UI、远端 CI 或 Windows 打包验收。
