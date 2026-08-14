# crawshrimp-harness 基线

> 项目代号:`crawshrimp-harness`
> 创建日期:2026-08-14
> 基线源:抓虾(crawshrimp)主仓 @ `b1f77dbf13f5db50a1bddb3a77d78d1a90866ca0`,应用版本 `2.4.12`

## 1. 项目定位

在抓虾桌面客户端中新增"智能体"能力,以 **DeepSeek Harness(DSH)** 作为无界面智能体内核,复用 crawshrimp-agent(Codex 线)已验证的产品层设计,交付具备以下能力的智能体:

1. 网页自动化(接管真实 Chrome,CDP 9222);
2. 任务编排(搜索/准备/审批/执行抓虾 Task Instance);
3. 脚本复用与创作(调用已有脚本;草稿 → 测试 → 双闸门发布);
4. 数据分析(受限预览与统计)。

完整方案见 [`01-dsh-agent-v2-proposal.md`](01-dsh-agent-v2-proposal.md)。

## 2. 仓库策略(已确认)

- **主仓 + 移植源**:本仓为产品主仓(由抓虾 2.4.12 fork);crawshrimp-agent 转为移植源,其内核(Codex sidecar)相关代码不再演进。
- 上游:本仓添加 `upstream` remote 指向本地 `/Users/xingyicheng/Documents/crawshrimp`,用于后续拉取抓虾主线的修复。
- 应用包名改为 `crawshrimp-harness`,版本 `2.4.12-harness.0`;dev 模式 userData 与抓虾原版隔离。appId(`com.crawshrimp.app`)与 productName(抓虾)暂未改动,发布前需在 P3 决策是否独立。

## 3. 界面布局(已确认)

智能体界面为三栏结构:

```
┌─────────────┬──────────────────────┬────────────────────┐
│ 侧边栏      │ 会话区(中间)         │ 实时浏览器(右侧)   │
│             │                      │ 可展开/收起        │
│ [新建会话]  │  对话消息流          │  9222 CDP 实时帧   │
│ 会话列表    │  composer            │  URL / 状态        │
│ ──────────  │                      │                    │
│ 🤖 智能体   │                      │                    │
│ 📄 我的脚本 │                      │                    │
│ ...原有菜单 │                      │                    │
└─────────────┴──────────────────────┴────────────────────┘
```

- 智能体界面下,侧边栏顶部为"新建会话 + 会话列表",下方跟随抓虾原有菜单;
- 右侧浏览器面板连接抓虾托管 Chrome 的 9222 CDP,定时 `Page.captureScreenshot` 推送 JPEG 帧(当前 800ms),用户可实时看到网页自动化过程;
- 面板展开状态持久化于 `localStorage:crawshrimp.agent.browserPanelOpen`。

## 4. 当前进度

已完成:

- [x] 源码 fork 与仓库初始化;
- [x] 侧边栏:智能体入口 + 会话栏(新建会话/会话列表);
- [x] 智能体主视图:会话区(消息流/工具卡/审批卡/停止)+ 右侧实时浏览器面板(展开/收起);
- [x] 主进程 `agentBrowser.js`:9222 CDP 截图流 + preload 桥接(浏览器流/agent API/SSE);
- [x] P0 spike:Electron-as-Node 拉起 dsh-jsonrpc-agent(0.1.0-rc.6),真实模型 + MCP v2 工具往返验证;
- [x] DSH 运行时打包链(stage-runtime + afterPack 拷入安装包 + 包内 boot 验证);
- [x] 产品后端:core/agent(db/cordis_config/cdp/mcp_gateway/worker/service/api)+ 21 个 MCP 工具 + 审批阻塞 + 单 Active Run + 事件投影 + SSE;
- [x] 前端接真实 API:会话/消息/工具卡/审批卡/停止/排队提示;
- [x] E2E:任务目录搜索与描述、浏览器观察(9222 CDP)、脚本草稿→发布双闸门(审批卡→批准→pending_review)、运行取消、运行时重启后会话碰撞自动轮换;
- [x] 桌面应用内闭环:应用自带后端(用户真实 ai.llm 配置)→ worker → DSH → MCP 网关全链路;
- [x] 回归测试 11 项。

关键修复记录(自修复):

- `_grant_for_run` NameError → queue task 静默死亡 → run 卡 starting(已修 + 队列兜底);
- db 共享 RLock 跨线程死锁 → nullcontext + busy_timeout;
- MCP SDK 2.0 挂 FastAPI 子路由无 lifespan → 独立 uvicorn(端口 = API 端口 + 200,避开应用端口回退区间);
- DSH 会话 id collision(重启后)→ 自动轮换 + 提示;
- 同步 CDP HTTP 阻塞事件循环 → to_thread。

剩余(下一里程碑):

- [ ] DSH web host 全量嵌入(方案 §12.7:web-app bundle 组合 + product-bridge/slots 两个插件 + iframe 外框;bundle 组成已调研,约 60 包);
- [ ] 脚本审核页(双闸门第二闸门 UI)+ 任务卡/产物卡;
- [ ] 打包安装包内端到端(backend+worker+DSH 闭包)与三平台验证;
- [ ] 能力授权卡 UI(browser_tab 上下文 chips)。

## 5. 开发环境

```bash
cd app
npm install        # 新仓库需先装依赖(源仓库 node_modules 未复制)
npm run dev        # Vite + Electron
```

后端(可选,骨架阶段 UI 不依赖):

```bash
bash dev.sh        # 创建 venv 并启动 FastAPI(127.0.0.1:18765)
```

实时浏览器面板依赖 9222 CDP:由抓虾托管 Chrome 或手动 `Chrome --remote-debugging-port=9222` 提供。

## 6. 新增/修改文件清单

| 文件 | 说明 |
| --- | --- |
| `app/src/agentBrowser.js` | 新增:CDP 截图流模块 |
| `app/src/deepseekHarnessPaths.js` | 新增:DSH 运行时 dev/发布态路径解析 |
| `app/src/main.js` | 注册 `agent:browser:stream:*` IPC |
| `app/src/preload.js` | 新增浏览器流桥接 API |
| `app/build.yml` | extraResources 增加 deepseek-harness 闭包 |
| `app/scripts/after-pack.js` | 增加 DSH 闭包完整性校验 |
| `app/package.json` | 包名/版本/构建链(自动 staging) |
| `app/src/renderer/views/AgentHome.vue` | 新增:智能体主视图 |
| `app/src/renderer/components/agent/AgentSessionBar.vue` | 新增:侧边栏会话栏 |
| `app/src/renderer/components/agent/AgentBrowserPanel.vue` | 新增:实时浏览器面板 |
| `app/src/renderer/App.vue` | 接入智能体入口与会话栏 |
| `integrations/deepseek-harness/package.json` | 新增:0.1.0-rc.6 精确锁版 |
| `integrations/deepseek-harness/spike.cordis.yml` | 新增:llm-pi-ai 三路由 + spine profile |
| `integrations/deepseek-harness/scripts/stage-runtime.mjs` | 新增:生产闭包编排 + boot check |
| `integrations/deepseek-harness/spike/run-spike.mjs` | 新增:spike 驱动(initialize/prompt/shutdown) |
| `integrations/deepseek-harness/P0-PLAN.md` | 新增:P0 计划与进展 |
