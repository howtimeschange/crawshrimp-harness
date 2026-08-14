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

## 5. 下一步

- [ ] `npm ci` 安装并生成 lockfile;
- [ ] 编写最小 `cordis.yml`(local 模型 + fake MCP server 先跑通 spine);
- [ ] macOS 本机跑通 `dsh-jsonrpc-agent`(ELECTRON_RUN_AS_NODE=1);
- [ ] Python MCP v2 ASGI 骨架 + Streamable HTTP 互通测试;
- [ ] Worker NDJSON JSON-RPC 协议骨架(方案窄 spec §10)。
