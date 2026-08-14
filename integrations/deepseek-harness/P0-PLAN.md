# deepseek-harness 集成:P0 运行时可行性 spike 计划

> 状态:准备中(骨架阶段)
> 对应方案:docs/crawshrimp-harness/01-dsh-agent-v2-proposal.md §14 P0

## 1. 版本锁定(2026-08-14 已核验 npm)

全部锁定 `0.1.0-rc.6`(`package.json` 精确版本,无 caret/无 dist-tag)。
已确认该版本在 npm registry 上完整存在,且 `dsh-client-web@0.1.0-rc.6` 前端闭包亦完整可解析。

> ⚠️ npm `latest` tag 仍指向 `0.0.1-rc.x` 旧族;一切安装必须显式版本。

## 2. P0 门禁清单(全部通过才进入 P1)

1. **三平台 Electron Node mode 启动 Worker + Harness**
   - macOS arm64:本机已实测 `ELECTRON_RUN_AS_NODE=1` → Node 24.18.0,`node:zlib` 内建 zstd 可用;
   - 待补:macOS x64、Windows x64(koffi/kernel32 FFI、进程树终止、stdio 管道)。
2. **锁版可重复安装**:`npm ci` 从 lockfile 干净安装(本目录)。
3. **最小 Cordis profile 启动**,工具 registry 快照精确匹配(9 个 task 工具 + browser_observe/eval + fs + skill)。
4. **DSH MCP client ↔ 官方 Python MCP v2 Streamable HTTP 互通**(含长审批挂起)。
5. **抓虾默认候选模型完成真实 tool call round trip**。
6. **三种阶段取消无孤儿进程**:active model / approval wait / tool wait。
7. **签名/公证与 Windows 安装包不阻止子进程运行**(P3 前复验)。

## 3. 进程模型(发布态)

```
Crawshrimp Electron
└── bundled Python / FastAPI
    └── Electron executable in Node mode / Agent Worker
        └── Electron executable in Node mode / dsh-jsonrpc-agent (DSH_CORDIS_CONFIG)
```

- Worker stdout 仅 NDJSON JSON-RPC;Harness stdout 仅 SDK JSON-RPC;诊断走 stderr;
- argv 数组传递,不经 shell;
- `CRAWSHRIMP_NODE_EXECUTABLE` 指向发布态 Electron 路径。

## 4. Profile 允许/禁止(方案 §6)

允许:sdk-jsonrpc-server、agent-spine-demo、llm-pi-ai、session-persistence-jsonl、
session-checkpoint-policy、token-meter、compaction-basic、mcp-client、
fs + tool-fs + fs-sandbox、workspace、skill + skill-filesystem + tool-skill。

禁止:shell/subprocess/terminal、web search、browser、第三方 MCP、subagent 全族、
session telemetry、console logger。

构建校验:解析最终 profile 与生产依赖闭包,断言禁用包名不存在;运行时断言模型可见工具集合与方案 §7 清单一致。

## 5. P0 进展(2026-08-14,macOS arm64)

- [x] `npm install` 生成 lockfile,锁 0.1.0-rc.6 全族可重复安装;
- [x] **Electron-as-Node 启动 `dsh-jsonrpc-agent`**:`ELECTRON_RUN_AS_NODE=1` + Electron 43.1.0(Node 24.18.0)→ `initialize` 返回 `serverInfo {name: deepseek-harness-sdk-runtime, version: 0.0.1}`,正常 `shutdown`;
- [x] 最小 profile(spike.cordis.yml):sdk-jsonrpc-server + llm-pi-ai 三路由(抓虾网关)+ spine(persona)+ persistence(zstd)+ checkpoint + token-meter + compaction + mcp-client;
- [x] 无密钥 prompt 冒烟(`SPIKE_PROMPT=1 node spike/run-spike.mjs`):
  - `session/prompt` 返回 durable `messageId`;
  - 事件流:`turn/start → user/message → assistant/chunk → step/end → turn/end`,与窄 spec §7.3 词汇一致;
  - 无 key 时 `turn/end.reason = {kind:'error', error:{code:'MISSING_CREDENTIAL'}}`,错误信息正确引用路由名与 `CRAWSHRIMP_LLM_API_KEY`;
  - `session.status` running → idle;
- [x] **staging + boot check**:`stage-runtime.mjs` 编排生产闭包(260 包),staged bin 经 Electron-as-Node initialize/shutdown 通过。

待补:

- [ ] 真实模型 tool call round trip(需网关 key + 一个 fake MCP server);
- [ ] DSH MCP client ↔ Python MCP v2 Streamable HTTP 互通;
- [ ] fs/skill/workspace 族 profile v2(草稿:spike.cordis.v2.yml);
- [ ] macOS x64 / Windows x64(koffi、进程树、管道);
- [ ] 三种阶段取消无孤儿进程。

## 6. 打包(开箱即用,与抓虾打包 Python 同模式)

```
integrations/deepseek-harness/     ← 开发版(含 dev 依赖)
build-staging/deepseek-harness/    ← 发布版(仅生产闭包,npm ci --omit=dev)
Resources/deepseek-harness/        ← 安装包内(extraResources)
```

- `scripts/stage-runtime.mjs`:编排生产闭包(lockfile 哈希增量跳过)+ 完整性清单 + **Electron-as-Node boot check**(staged bin 必须能 initialize/shutdown);
- `app/build.yml` `extraResources`:`../build-staging/deepseek-harness` → `deepseek-harness`;
- `app/scripts/after-pack.js` `requireDeepseekHarnessBundle`:安装包内闭包不完整则构建失败;
- 构建链:`npm run build` / `build:mac` / `build:win` 自动先跑 staging;
- 运行时:`app/src/deepseekHarnessPaths.js` —— 开发态用仓库目录,发布态用 `process.resourcesPath/deepseek-harness`;不额外分发 Node,用已打包 Electron(`ELECTRON_RUN_AS_NODE=1`)。

待补:

- [ ] P1 起 FastAPI 从 ai.llm 生成 cordis 配置替换 spike.cordis.yml;
- [ ] Worker 入口随 `worker/` 目录进入 staging;
- [ ] Windows x64 打包验证(koffi 加载);macOS x64 验证。
