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
    return { success: false, error: e.message }
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

# crawshrimp SPEC v2 增补(2026-08-14,DSH 智能体落地)

> 本节对齐 crawshrimp-harness 智能体(DSH 内核)的最新实现,与 §4/§5 适配器规范配套阅读。
> 详细交付记录见 docs/crawshrimp-harness/02-delivery.md 与 03-media-in-chat-handover.md。

## 11. 智能体(DSH Harness)架构

- 内核:@deepseek-ai/dsh 全族锁版 0.1.0-rc.6,经 `dsh-sdk-jsonrpc-demo` 以 Electron-as-Node 运行。
- 进程模型:Electron main 内嵌 FastAPI 后端(端口 18765,回退 +1..+100)→ AgentWorker(node)→ DSH harness(Electron RUN_AS_NODE);MCP 网关独立端口(API+200),DSH web host(API+300)。
- 双真值:SQLite 产品真值(会话/run/消息/审批/修订投影)+ DSH harness 会话真值;web UI 原生会话经「影子投影」建立 run-web-* 影子 run。
- 界面:智能体 DSH Web 会话界面为唯一主界面(iframe 常驻),抓虾菜单注入会话侧边栏,其他菜单覆盖右侧内容区;实时浏览器为可拖动/缩放/最小化/最大化浮动窗口,`browser_*` 工具调用时自动弹出。
- 端口稳定性:孤儿后端/运行时清理、`_pick_free_port` 自愈、`_settle_web_port` 按 `__DSH_BOOT__` 特征探测真实端口、前端 HTTP 探活自恢复、SSE 自动重连。

## 12. 智能体权限模型(2026-08-14 全面放开)

| 能力 | 工具 | 授权 |
| --- | --- | --- |
| 任务/脚本/数据/技能 | tasks_*/script_*/data_*/skill_*/attachment_read | 现有风险审批模型 |
| 读本机任意文件/目录 | fs_read / fs_list | 无需审批(用户授权全盘读) |
| 写本机文件 | fs_write | 审批卡(DSH 原生,允许一次) |
| 执行本机命令 | fs_exec | 审批卡 |
| 浏览器导航 | browser_navigate | 任意 http(s) URL(不再限授权前缀) |
| 仓库克隆 | repo_install 等 | URL SSRF 防护 |

媒体展示专用 token(由 API token 派生,仅 `/agent/artifacts/*` 可用),master token 不进媒体 URL。

## 13. 脚本创作与双闸门(强制规范)

- **硬性规范**:所有脚本一律按抓虾适配器规范编写——`manifest.yaml` + 页面 JS 脚本(async IIFE,读取 `window.__CRAWSHRIMP_PARAMS__`,返回 `{ success, data: 扁平对象数组, meta: { has_more } }`);独立 Python/Node 脚本在草稿/测试/发布三关全部被拒。
- 契约技能包:`crawshrimp-adapter-skill`(含 `references/script-contract.md` 最小契约)、`dont-stop`(实施-自测-修复-交付循环)等 11 个技能包。
- 双闸门:script_publish → ① 审批卡(DSH 原生)→ ② 脚本审核页。审核页支持「安装到测试区并测试」(页内嵌正式任务执行界面 TaskRunner 真实运行),测试确认后批准发布(转正、我的脚本可见),拒绝则卸载测试安装并恢复同名生产适配器快照。
- 修订状态机:draft → tested → pending_review → testing(已测试安装)→ published / rejected。

## 14. 会话内媒体展示(图片多图/视频/附件)

- 产物媒体经 `artifact.created` 事件(带 media_kind + zip 内图片清单)广播 → shell 直接 postMessage 到会话 iframe → 注入消息列表(`.Md3f7G_column` 末尾),像消息一样出现在信息流。
- 图片:单图直显;ZIP 多图网格(`/agent/artifacts/entry` 流式解压,zip bomb 防护:解压前检查 file_size)。
- 视频:页内 `<video controls>` 播放(`/agent/artifacts/file` 支持 Range,含后缀区间 `bytes=-N`)。
- 附件上传:composer 原生「加号」按钮改造为上传(📎),旁开「@」命令按钮;支持拖入/粘贴;上传注册为会话附件,输入框插入 `[附件: name (attachment_id)]` 供模型 attachment_read。
- iframe 重载/端口漂移后经 artifact-replay 双向重放,去重以 DOM 为准。

## 16. 最近迭代增补(2026-08-14 深夜)

### 16.1 任务展示与审批人话化

- 任务实例标题使用适配器 manifest 的中文任务名(创建时注入;历史实例在 detail/list 返回时兜底替换),任务卡/任务中心显示「MOP-唯品商品上新资料检查」而非英文 task_id。
- 审批卡(DSH 原生)标题与内容中文人话:「运行任务:中文名」+「运行任务「中文名」(adapter/task)。参数:days=7。」;发布脚本/写入文件/执行命令/任务控制各有专属文案。

### 16.2 附件 → 任务参数桥接

- `attachment_read` 返回内容 + `local_path` + 任务参数传法提示。
- `task_prepare` 对 `file_excel`/`file` 参数自动解析:值可为 attachment_id(`att-*`)或本地路径(或 `{"path": ...}`),后端用产品同款 `_read_local_excel` 注入 `rows/headers/sheet_name/sheets`,智能体无需手工构造解析对象。
- 上传表格跑任务的正确流程:attachment_read → tasks_search/task_describe → task_prepare(文件参数传 `att-*`)→ task_run → 审批卡 → 执行。

### 16.3 实时浏览器多窗口

- 后端 `browser_*` 工具每次调用广播 `browser.activity`(活跃 tab id + 全部页面快照)。
- 前端为每个浏览器页面(tab)渲染一个实时浏览器窗口(标题带页面 ID 后 4 位),活跃页面窗口置顶,多窗口级联偏移 36px 排列;窗口独立拖动/缩放/最小化/关闭(关闭停对应截图流)。
- 截图流按 targetId 独立(agentBrowser 多流),URL 实时更新(Page.frameNavigated + SPA 定期回读)。

### 16.4 工具缺陷修复

- task_wait 误 `await` 同步返回值;data_analyze bytes 直接进文本预览;fs_exec 函数内 uuid 未 import;task_prepare 的 ParamType 枚举匹配(此前桥接静默失效)。

## 15. 与 §4/§5 的关系

- 智能体按 §4(manifest)与 §5(JS 协议)编写适配包;§4/§5 为唯一脚本规范。
- 发布固化经 adapter_loader.install_from_dir 进入 adapters 运行时,与「我的脚本」/tasks_search 同一数据源。
