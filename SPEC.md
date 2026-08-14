# crawshrimp SPEC v1

> Status: Draft | Date: 2026-03-26

---

## 1. Project Overview

crawshrimp is a universal web automation desktop app.

- Users install adapter packages; the core handles Chrome, scheduling, export, notifications
- Developers write adapters (JS scripts + manifest.yaml) to support new platforms
- Core: CDP connection, JS injection, task scheduling, data export, notifications
- Adapter: only "what to scrape / do on this page"

---

## 2. Tech Stack

| Layer | Tech | Notes |
|-------|------|-------|
| GUI | Electron 29 + Vue 3 + Vite | Reuse temu-assistant Electron shell, replace renderer with Vue |
| Core | Python 3.12 + FastAPI | Reuse python-build-standalone bundle |
| Browser | CDP (bb-browser / websockets) | JS injection via Runtime.evaluate, no Playwright |
| Scheduler | APScheduler | manual / interval / cron triggers |
| Storage | SQLite (task state) + filesystem (data/logs) | Lightweight, no external deps |
| IPC | Electron <-> Python HTTP (FastAPI localhost:18765) | Electron spawns Python subprocess |
| Adapter install | Local directory path + zip file | v1 only, no cloud marketplace |

---

## 3. Directory Structure

```
crawshrimp/
  core/
    api_server.py        FastAPI entry, all endpoints
    cdp_bridge.py        CDP connection manager
    js_runner.py         JS injection executor (timeout/retry/pagination)
    adapter_loader.py    Adapter scan/load/validate/install
    scheduler.py         APScheduler task engine
    data_sink.py         Data persistence (Excel/JSON/SQLite)
    notifier.py          Notification push (DingTalk/Feishu/webhook)
    config.py            Global config read/write
    models.py            Pydantic data models
    requirements.txt
  app/
    src/
      main.js            Electron main process (spawn Python, window mgmt)
      preload.js         IPC bridge
      renderer/          Vue 3 app
        main.js
        App.vue
        views/
          PlatformManager.vue   adapter list/install/enable
          TaskDashboard.vue     task status + live logs
          DataExplorer.vue      data preview + export
          Settings.vue          Chrome path / notifications
    scripts/after-pack.js
    build.yml
    package.json
    vite.config.js
  adapters/
    temu/
      manifest.yaml
      auth_check.js
      goods-data.js
      reviews.js
      aftersales.js
      store-items.js
  sdk/
    ADAPTER_GUIDE.md
    manifest.schema.json
    template/
      manifest.yaml
      example-task.js
  .github/workflows/build.yml
```

---

## 4. Adapter Manifest Spec v1

```yaml
id: temu
name: Temu Seller Assistant
version: 1.0.0
author: howtimeschange
description: "Temu seller platform data collection"
entry_url: https://seller.temu.com

auth:
  check_script: auth_check.js     # returns {meta: {logged_in: bool}}
  login_url: https://seller.temu.com/login

tasks:
  - id: goods_data
    name: Product Data
    script: goods-data.js         # relative to manifest.yaml
    trigger:
      type: manual                # manual | interval | cron
      interval_minutes: 30
      cron: "0 9 * * *"
    output:
      - type: excel               # excel | json | sqlite | notify
        filename: "goods_{date}.xlsx"
      - type: notify
        channel: dingtalk         # dingtalk | feishu | webhook
        condition: "data.length > 0"
```

---

## 5. JS Script Protocol

```js
;(async () => {
  try {
    const data = []
    // scraping logic here
    return {
      success: true,
      data,             // required: array of plain objects
      meta: { has_more: false }  // optional pagination signal
    }
  } catch (e) {
    return { success: false, data: [], meta: { has_more: false, error: e.message } }
  }
})()
```

Core behavior: 60s timeout, auto-pagination on meta.has_more, errors logged (no crash).

Pagination: core injects `window.__CRAWSHRIMP_PAGE__` (1-indexed) before each call.

---

## 6. FastAPI Endpoints

```
GET  /health
GET  /adapters
POST /adapters/install          body: {path} or {zip_base64}
DEL  /adapters/{id}
PATCH /adapters/{id}/enable     body: {enabled: bool}
GET  /tasks
POST /tasks/{adapter_id}/{task_id}/run
GET  /tasks/{adapter_id}/{task_id}/status
GET  /tasks/{adapter_id}/{task_id}/logs
DELETE /tasks/{adapter_id}/{task_id}/logs   # 清空任务日志
GET  /data/{adapter_id}/{task_id}
GET  /data/{adapter_id}/{task_id}/export?format=excel
GET  /settings
PUT  /settings
GET  /settings/chrome-tabs
```

---

## 7. GUI Views

**PlatformManager**: adapter list (name/version/status/task count), install from dir or zip, enable/disable/uninstall

**TaskDashboard**: all tasks across adapters, last run time, next run time, success/fail status, live log stream, manual trigger button

**DataExplorer**: filter by adapter/task/date, virtual-scroll table preview, export Excel/JSON

**Settings**: Chrome path, CDP port (default 9222), DingTalk/Feishu webhook URLs, data directory, auto-start

---

## 8. Code Reuse from temu-assistant

| Module | Source | Action |
|--------|--------|--------|
| CDP/JS injection | src/temu_utils.py | Extracted into cdp_bridge.py + js_runner.py |
| DingTalk notify | src/dingtalk.py | Generalized as notifier.py |
| Excel export | src/excel_writer.py | Interface generalized |
| Electron main | electron-app/src/main.js | Reuse Python Bundle + afterPack, replace renderer |
| Python Bundle CI | scripts/after-pack.js + build.yml | Direct reuse (python-build-standalone) |
| Temu JS scripts | adapters/temu/*.js | Reorganized per manifest spec |
| Scheduler | loop_worker.py | Rewritten as APScheduler multi-task |

---

## 9. Roadmap

**Phase 1 - Core skeleton (3 days)**
- core/ directory + FastAPI endpoint scaffolding
- cdp_bridge, js_runner, adapter_loader
- scheduler, data_sink, notifier

**Phase 2 - Electron + Vue GUI (4 days)**
- Electron main process (reuse temu-assistant shell, replace renderer with Vue 3 + Vite)
- 4 views: PlatformManager / TaskDashboard / DataExplorer / Settings
- Full Electron <-> FastAPI IPC

**Phase 3 - Temu adapter migration (2 days)**
- adapters/temu/manifest.yaml complete
- Migrate 4 JS scripts, end-to-end test

**Phase 4 - SDK & docs (1 day)**
- manifest.schema.json, template, ADAPTER_GUIDE.md

**Phase 5 - Build & CI (1 day)**
- Reuse temu-assistant build.yml + after-pack.js
- tag push -> macOS DMG + Windows NSIS

---

## 10. Future (out of scope for v1)

- Cloud adapter marketplace
- Multi-Chrome instance concurrency
- Adapter version management / auto-update
- Anti-bot library (adapters self-manage)

---

# crawshrimp SPEC v2 增补（2026-08-15，DSH Harness）

> 本节是当前 Harness 实现的规范真值，与 §4/§5 Adapter 规范配套使用。实现证据见 `docs/crawshrimp-harness/02-delivery.md`。

## 11. DSH Harness 架构

### 11.1 进程与端口

- DSH 包族精确锁定 `@deepseek-ai/*@0.1.0-rc.6`，由 `dsh-sdk-jsonrpc-demo` 以 Electron-as-Node 运行。
- 进程树：Electron main → FastAPI → Node Worker → DSH runtime。
- FastAPI 默认 `127.0.0.1:18765`，在 `+1..+100` 内回退。
- MCP gateway 使用实际 API 端口 `+200`，通过预绑定 socket 交给 uvicorn。
- DSH Web host 使用实际 API 端口 `+300` 起始；启动后在 `preferred..+8` 并行回查，页面必须同时包含 `__DSH_BOOT__`、`crawshrimp-product-bridge` 和 `crawshrimp-slots`。
- Vite 开发端口 `5173`；Electron CDP `9223`；托管 Chrome CDP `9222`。

### 11.2 双真值和会话身份

- DSH JSONL 是模型上下文真值；SQLite 是产品 session/run/message/event/tool/approval/plan/grant/revision 真值。
- DSH Web 原生会话在首个 `turn/start` 时建立产品影子 session/run。
- 后端维护 `runtime_session_id → active run` 和 `run_id → grant`。
- MCP transport 不携带 session；product bridge 必须在每次 Crawshrimp MCP tool execute 外层按 `exec.agent.id` 获取 context lease，并在 `finally` 释放。
- context lease 释放前必须把工具调用原地更新的 grant 写回 `run_id → grant` 真值，防止下一次 lease 恢复审批前快照。
- context 不存在或 lease 冲突时安全失败，禁止回退到最后活动 run。

### 11.3 UI

- DSH Web iframe 是唯一主界面并常驻全幅。
- 抓虾菜单注入 DSH 会话侧栏；其他页面是右侧 overlay；脚本详情为独立二级页面。
- 抓虾产品事件由 SQLite seq 的全局 SSE 消费；iframe 消息必须校验 source 和 origin。

## 12. 权限、审批与审计

| 能力 | 策略 |
| --- | --- |
| `fs_read` / `fs_list` | 全盘只读，免审批 |
| `fs_write` / `fs_exec` | 允许，但服从当前 DSH 会话权限 |
| `browser_observe` / `verify` / `capture_requests` | 仅当前 run 绑定 tab |
| `browser_navigate` | 任意 HTTP(S)，每 run 最多审批一次 |
| `browser_act` 普通 click/type/scroll/wait | 当前 tab grant 内执行 |
| 凭证输入 | 直接阻断 |
| 提交/上传/发布/支付/删除等敏感点击 | DSH 原生审批 |
| 简单下载/找图/找款 | 风险允许时自动批准，审计保留 |

- DSH `never` 是统一放开策略：抓虾审批自动 `allowed-once`；DSH `ask` 才展示原生审批卡。
- 不得在抓虾 shell 自造审批浮层；审批标题、原因、参数摘要必须是中文人话并脱敏。
- 审批等待必须使用专用有界 executor，不得占用 asyncio 默认线程池。
- approval 必须持久化 run/session 归属。跨会话提示通过全局 SSE 可见，并以 SQLite pending 列表定时校准；approval resolved 或 run terminal 必须清理，后端重启/断流不得留下幽灵提示。
- 审批、工具、计划和事件持久化内容必须脱敏。含秘密计划的原始参数只驻留内存，进程重启后安全失效。

## 13. Adapter 创作、测试和发布

### 13.1 硬合同

- 智能体脚本只能是完整抓虾 Adapter 包：`manifest.yaml` + 页面 `.js`。
- manifest 必须通过正式 `AdapterManifest` schema；Adapter ID 和 task ID 不能形成路径。
- 页面 JS 必须是文件末尾实际调用的 async IIFE；外层 IIFE 顶层返回对象必须包含 `success`、`data`、`meta`。
- manifest 声明的脚本必须存在于同一修订包内，禁止绝对路径、`..` 和非 `.js` 页面脚本。
- 独立 Python/Node/单 JS 草稿不能测试或发布。

### 13.2 三闸门

```text
草稿合同校验
  → DSH 原生发布审批
  → review-<hash> 隔离测试安装与真实 TaskRunner 测试
  → 人工批准正式发布
```

- 测试 Adapter ID 由 revision ID 稳定派生，不覆盖目标正式 Adapter。
- 测试安装后记录完整包 SHA-256；发布时内容不一致必须重新测试。
- 重装、拒绝或批准前先停止 test Adapter 的活动 Task Instance。
- 正式安装使用本次 rollback snapshot；首次智能体发布另存长期 baseline。
- 正式安装或数据库状态提交失败必须恢复旧包；清智能体数据时恢复长期 baseline，原本不存在的目标才卸载。

## 14. 附件、模型图片和会话内媒体

### 14.1 附件

- 上传必须显式绑定 product session 或 runtime session，归档会话拒绝上传。
- 上传硬上限 200 MB，采用 1 MB 分块复制并在复制中再次计数。
- 可执行安装文件同时按扩展名和 magic bytes 拒绝。
- `attachment_read` 只能读取当前 run session 的附件，实际文件超过 50 MB 拒绝解析。
- `file_excel` / `file` 参数可接受 attachment ID、路径或 `{path}`，由后端桥接为产品同款解析对象。

### 14.2 模型图片

- 仅 PNG/JPEG/WebP/GIF；单张 8 MB；每轮最多 5 张。
- 图片通过 DSH image content block 进入 prompt；文件丢失或类型不支持时跳过 image block，但文本 prompt 仍继续。

### 14.3 媒体展示

- `artifact.created` 通过全局 SSE 按 runtime session 分流，插入 DSH `.Md3f7G_column` 末尾。
- iframe 重载后 client 请求 `artifact-replay`；shell 每 session 缓存最近 12 条，DOM 标记负责去重。
- 图片直接显示；ZIP 图片最多 20 条，单 entry 解压上限 64 MB；视频支持 Range；附件卡调用系统默认应用。
- AI 直接产物使用稳定 `media-<hash>` ID。
- 媒体 URL 不得携带主 API token。短期 HMAC capability 必须绑定 GET route、path、entry、expiry，只能访问 file/entry 两个字节端点。

### 14.4 Excel 解析上限

- 文件 50 MB，压缩后解压总量 256 MB，ZIP 条目 10,000。
- sheet 32，总行 100,000，单行列数 512，总 cell 2,000,000。
- `.xlsx/.xlsm/.xls/.csv` 都必须在读取过程中执行结构限制并返回明确错误。

## 15. 浏览器与多窗口

- 每个 run 在首次 turn 固定绑定当时的 Chrome page `grant.tab_id`；tab 关闭后不得回退到其他页面。
- `browser.activity` 只广播当前 session 历次 run 已 grant 且在 9222 仍存活的 page 子集；不得暴露其他会话/未授权 page，也不得退化为只能展示一个窗口。
- 每个 tab 独立 WebSocket、command pending map 和截图 timer；connect/close/timeout 必须拒绝并清理 pending。
- 每个页面一个浮动窗口，活跃窗口置顶，默认级联；窗口可拖动、缩放、最小化、最大化和关闭。
- 前端每 2 秒回读 tab 快照并关闭僵尸窗口；connecting socket 在 stream 正式登记前始终可取消。
- observe 输出不得包含 password 或 name/id/autocomplete 命中凭证特征的值。
- 请求捕获必须去除 URL userinfo 并脱敏 query、header、POST body。

## 16. 稳定性、清理与验证

- Worker request 超时移除 pending；EOF/退出拒绝所有 pending；迟到响应不恢复已结束 future。
- runtime 启动和 run 有绝对超时，超时先终止 runtime 再报告。
- Task plan 通过 SQLite 原子 claim 单次消费。Task Instance 启动超过 60 秒返回 `starting + UID`，后台继续收敛，重放不重复创建。
- SSE event seq 来自 SQLite 全局自增主键；订阅后补历史，cursor 去重，QueueFull 记录累计丢弃数。
- 清智能体数据前必须确认没有 active run；恢复 Adapter baseline 后再清数据库和受控目录。失败时保留 baseline 供重试。
- API token 只从当前运行数据目录的 `api-token` 读取；禁止进入 URL、文档、日志、截图或 Git。
- preload/dev bridge 只允许 loopback `18765..18865`，拒绝 query token 和任意绝对 API URL。
- repo 工具只接受公网 HTTP(S) URL、安全单目录名和非 symlink 目标；审批后再次 DNS 校验并固定 Git transport。

必须通过的门禁：

```bash
venv/bin/python -m pytest tests/ -q
npm --prefix app test
npm --prefix app run vite:build
git diff --check
```

同时必须用真实源码应用完成 curl API 与 Electron CDP 9223 UI 回读；只通过单元测试不能宣称会话、审批、媒体或多窗口交付完成。
