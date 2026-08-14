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
- [x] 智能体主视图:会话区(空态 + composer 骨架)+ 右侧实时浏览器面板(展开/收起);
- [x] 主进程 `agentBrowser.js`:9222 CDP 截图流;
- [x] preload 桥接;
- [x] **P0 spike(部分)**:Electron-as-Node 拉起 dsh-jsonrpc-agent(0.1.0-rc.6),initialize/shutdown + 无密钥 prompt 冒烟通过,事件流与 `turn/end` 语义已验证(详见 `integrations/deepseek-harness/P0-PLAN.md`)。

已确认指令(2026-08-14):

- 智能体会话体验与 DSH 完全一致:采用 **DSH web host 全量嵌入**(方案 §12.7)+ 两个自定义插件(crawshrimp-product-bridge / crawshrimp-slots),零对话 UI 移植;
- 模型配置对接抓虾 `ai.llm`:FastAPI 从 `route_for_model` 生成 llm-pi-ai 三路由 cordis 配置(spike 已验证),密钥走 `CRAWSHRIMP_LLM_API_KEY` 环境变量。

待完成(按方案 §14 阶段):

- [ ] P0:DSH `0.1.0-rc.6` 全族锁版 + Electron-as-Node 三平台 spike + MCP v2 互通;
- [ ] P1:产品纵切(agent 数据表、队列、SSE、Worker supervisor、DSH Web UI 嵌入);
- [ ] P2:浏览器自动化工具族、脚本创作闭环、数据分析;
- [ ] P3:安全与发布。

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
| `app/src/main.js` | 注册 `agent:browser:stream:*` IPC |
| `app/src/preload.js` | 新增浏览器流桥接 API |
| `app/src/renderer/views/AgentHome.vue` | 新增:智能体主视图 |
| `app/src/renderer/components/agent/AgentSessionBar.vue` | 新增:侧边栏会话栏 |
| `app/src/renderer/components/agent/AgentBrowserPanel.vue` | 新增:实时浏览器面板 |
| `app/src/renderer/App.vue` | 接入智能体入口与会话栏 |
| `app/package.json` | 包名/版本/描述更新 |
