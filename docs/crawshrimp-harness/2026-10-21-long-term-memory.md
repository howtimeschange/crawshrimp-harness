# 抓虾 Harness 本地长期记忆

## 选型（2026-10-21）

当前产品锁定 `@deepseek-ai/dsh@0.1.2-rc.1`，Electron → FastAPI → Node Worker → DSH Web，DSH JSONL 是会话真值。长期记忆作为产品自有的 scoped Cordis 插件装入 `crawshrimp-standard`，不另起服务，不替换会话日志。

| GitHub 候选 | 已查证的能力/约束 | 决策 |
|---|---|---|
| [dsh-meow-memory](https://github.com/Phant0Meow/dsh-meow-memory) | SQLite、中文 bigram/BM25、分层记忆、动态快照、反思/dream；README 标明当前兼容 DSH 0.1.5 | 复用检索源码，产品化存储和宿主适配；不整体安装 |
| [dsh-mnemon](https://github.com/omdsh-dev/dsh-mnemon/blob/main/package.json) | 当前 0.5.34 的 engines.dsh 要求 0.2.x 范围 | 与当前锁版不匹配，不为记忆升级宿主 |
| [dsh-memory-evolve](https://github.com/csyangwen/dsh-memory-evolve) | 记忆、待办、协作、同步、UI 等组合能力 | 与抓虾现有任务和协作面重叠，暂不整体引入 |
| [dsh-memory](https://github.com/FuRongJun-1999/dsh-memory) | Markdown 认知图、Python MCP、Rust 检索等可组合组件 | 功能广，当前桌面包维护成本更高 |
| [MCP server-memory](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) | 实体/关系/观察的本地知识图谱 | 可接入，但缺少抓虾需要的业务有效期和工作区策略 |
| [mcp-mem0](https://github.com/coleam00/mcp-mem0) / [Mem0](https://github.com/mem0ai/mem0) | 语义记忆；该 MCP 模板要求 embedding、LLM 和 PostgreSQL 等配置 | 暂不增加模型和数据库配置负担 |

以上是代码/文档适配判断，不是对第三方效果或安全性的完整评测。

## 实现与微调

- `memory-ranking.ts/js` 从 meow-memory 的 `src/bm25.ts` 提取中文/Unicode 分词及 BM25 × 近期权重。参考提交 `033df8589467bbe17a2c40dc864283b960795ec5`，保留 `MEOW-MEMORY-LICENSE`。JS 为提交在仓库中的构建产物，无新增运行时依赖。
- 数据位于 `CRAWSHRIMP_DATA/agent/memory/memory.sqlite`。使用 `node:sqlite`，事务串行化写入、参数化查询、文件权限 0600；Windows 继承产品数据目录 ACL。未设置产品数据目录时不启用，不向代码仓库写记忆。
- 工作区由真实 cwd 路径哈希确定；模型不能传任意目录读其他工作区。全局仅保存用户偏好。这里的“工作区隔离”不是店铺或账号隔离：同一个 cwd 下的不同店铺应在 key/content 中明确区分，不能假设自动隔离。
- 类型为 preference / fact / procedure / lesson。记录 key、内容、原句依据、会话 ID、时间、有效期及 revision。evidence 必须出现在最近一条真实用户消息中，插件快照不算来源。当前版本不自动抽取工具结果或整段会话。
- 相同作用域/key 的纠正必须携带查得的 expected_revision，防止并发会话静默覆盖。事实默认 30 天到期，允许指定更短有效期，过期不会自动召回但可显式查询；实际价格、库存、上架与部署状态仍必须实时核验。
- 中文 bigram 与字母数字检索支持内部款号和供应商号。业务指引要求保留字母数字、区分两类款号、不根据图片顺序推断颜色。
- 自动上下文最多 3 条偏好加 5 条匹配，JSON 内容预算 6000 字符；作为动态 context 注入，静态 guide 不随记忆变化。无 tool schema 时不自动读记忆；受 scoped Automation policy 保护的运行跳过自动注入，原有工具策略继续拒绝未授权原生记忆工具。
- 数据库故障不阻断主会话，模型收到“记忆暂不可用”；显式工具调用返回错误。关闭环境变量 `CRAWSHRIMP_MEMORY_ENABLED=0` 可停用，重启运行时生效，数据保留。
- 不添加后台 dream、额外模型调用、远端同步或用户画像推测。凭据正则是基础防误存，并不是完备的敏感数据识别系统。

## 使用

内置三个原生工具，所有模型共用：

1. `memory_search(query)`：中文/款号检索；空查询返回最近 8 条；`include_expired=true` 显式检索包含过期项（最多 20 条，按文字匹配）。
2. `memory_save(key, content, evidence, level, scope?, ttl_days?, expected_revision?)`：保存或纠正；默认 workspace；只有用户通用偏好可选 global。
3. `memory_forget(id, expected_revision, scope?)`：物理删除当前记忆条目，防止后续召回。历史会话的原始消息、旧快照和工具结果不被改写，所以不是整个应用历史的擦除工具。

示例：“记住，以后导出商品表时内部款号必须保留字母。”“查一下我们之前约定的款号规则。”“把那条偏好纠正为……。”“忘掉刚才那条记忆。”

记忆是历史参考，不授予执行权限，也不能覆盖当前用户指令。没有新增图形管理面板；通过对话工具管理。实现是轻量本地词法检索，不宣称 embedding 语义召回。检索目前对可见条目扫描，面向个人规模；大规模库应增加索引和基准后再扩展。

## 验证与交付边界

`node --test integrations/deepseek-harness/crawshrimp-product-bridge/lib/memory.test.mjs integrations/deepseek-harness/crawshrimp-product-bridge/lib/context-tools.test.mjs app/src/agentHarnessContracts.test.js app/src/imIntegration.test.js`

本次执行 97 项：96 通过，1 个现有模型配置引导文案断言失败（`app/src/agentHarnessContracts.test.js:641` 期待“配置大模型供应商”，工作区已有 AgentWebView 文案修改）。新增 6 项记忆测试及 7 项上下文工具测试全部通过；真实 Cordis 实例覆盖插件注册、保存、新会话召回、隔离、隐藏工具时不召回、遗忘和停用。

代码已接入产品预设和打包必需文件清单；未制作发布包、未替换已安装桌面应用、未执行真实供应商模型对话验收。现有工作区的账号、引导页等未提交改动未被本次任务改写。
