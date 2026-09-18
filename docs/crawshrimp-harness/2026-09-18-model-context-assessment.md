# 模型上下文缩减评估

2026-09-18；只读探查，未修改运行中的模型配置或工具集合。当前分支 `codex/cross-platform-performance-20260918`，Mac/Windows实机验收仍由独立Astra任务执行。

**结论：值得优化，主要对象是全量工具schema与常驻业务说明；不是把已经按需读取的技能正文再做一次懒加载。建议列为P1成本/冷启动体验优化，先小范围A/B，再决定是否动态加载工具。不能仅凭2.1万输入token认定首答慢全部来自上下文。**

## 当前运行证据

只读解码本次Mac开发客户端的DSH持久会话日志，按完整Zstandard帧读取；只保存名称、数字和字段形状，未复制提示词原文、用户内容或密钥。此样本验证相似量级，不替代历史Windows简单计算那一次的原始测量。

| 指标 | 结果 |
|---|---:|
| 第一条模型回复对应inputTokens | 20,378；没有单独报告cacheReadTokens |
| 下一条模型回复输入 | 211未命中 + 20,608缓存读取 = 20,819；缓存占98.99% |
| 请求头序列化总量 | 79,344 bytes |
| 工具schema | 93个，61,076 bytes，约占请求头字节77% |
| 抓虾MCP工具 | 64个，逐工具JSON合计29,828 bytes |
| DSH原生工具 | 29个，逐工具JSON合计31,154 bytes |
| system | 18,089 bytes（JSON口径） |
| 其中产品persona | 12,600 UTF-8 bytes，在system中出现1次 |
| 首请求前额外注入 | system-prompt快照598 bytes；time-context快照291 bytes |

字节占比不是token占比，供应商还会重新序列化tools/messages；没有以字符除4冒充真实token测量。首轮usage未返回cache字段，不能据此断言供应商绝无内部缓存；后续有明确命中字段。

工具体积中：定时自动化16个工具约11.7KB，`automation_create`单个5,469 bytes，其中description 5,227；`workflow`4,014，`bash`3,264，`str_replace_editor`3,102。图片/视频/Office/仓库工具合计18个约7.6KB。简单问答也携带这些定义，存在合理的缩减空间。

技能情况：已安装的`dsh-tool-skill`只默认注入名称和封顶摘要，完整正文通过`skill`读取；抓虾另有`skill_list/skill_read`发现入口。本次实际样本首请求前没有`skill-catalog`消息，system也没有`available_skills`块。因此没有证据支持“2.1万主要来自全部技能正文”。

## 推荐实施顺序

1. **先缩短常驻业务说明与冗长工具描述。** 核心中文输出、工具真实性、权限/用户约束、浏览器通道和交付规则保持。新用户引导的长示例、Office/生图/自动化的细节可移至相关领域指引。`automation_create`的权限语义不能简单删掉；优先整理重复解释与示例，实际约束由服务端schema/校验保留。保持工具名称、参数契约、排序与稳定前缀。收益较低风险，也最便于对照。
2. **再实验按领域激活工具。** 常驻通用读写/计算、技能和工具发现入口；浏览器、Office、媒体、自动化、仓库、复杂多代理能力按任务启用。以会话/任务为单位稳定激活，避免每轮抖动schema破坏缓存。找不到能力时必须可发现、加载后下一轮真实注册，不能只向模型展示工具说明却没有可调用schema。当前DSH原生工具与MCP工具都有成本，不能只裁MCP。
3. **技能优先维持现有懒读取。** 有大量目录时再缩短摘要、按领域搜索；不用先把所有skill隐藏，也不额外付出一轮模型调用只为判断简单算术属于哪个领域。

DSH存在`ctx.tools.restrict(filter)`与工具呈现扩展，但作用域工具有自己的可见性语义；不是修改MCP `tools/list`一处即可完成。PTC/run_code虽能把原生schema换成一个工具，仍会注入SDK说明，并不自动等于小上下文。不建议未经完整验收直接切换。

## 成本与延迟判断

冷请求、频繁新会话、缓存不稳定或不支持缓存的端点，缩减固定输入的收益最直接。暖请求应分别计算缓存与未命中的费率；样本约99%命中，不能把2.1万全按未命中价格计费。模型排队、网络、推理输出、工具执行和应用本地延迟仍应分别计量。

工具发现若新增一轮模型往返，可能抵消减少prefill的收益；一次性问答尤其明显。优先在无需新增模型调用的前提下瘦身；冷/暖样本交错测试，同模型/端点/参数，报告首个可见输出、最终完成、请求轮数、输入/cache/output与总费用。不要从一轮样本承诺快多少秒或省多少比例。

A/B建议：当前标准版、仅说明瘦身版、领域激活版；覆盖简单计算/中文多轮/附件、单次网页、自然定时、固化脚本、Office、长任务。每类先10次配对筛选，再扩大有收益方案。**可先以简单任务固定输入减少30%作为试验门槛，非已实现收益**；必须同时不增加错误工具选择、不绕过授权、不损害定时/脚本与中文进度，实际总费用和延迟也要改善。

## 现有性能改动的准确边界

`worker/context-metrics.mjs`精简的是DSH→Python的事件投影，完整模型上下文仍由DSH发送，因此此前优化没有减少模型输入token。

诊断还需要避免两处误读：当前`request/context`只有provider/model/contextWindow，92 bytes不代表全部历史大小；`service.context_metrics`用update合并usage时，缺失的cache字段可能保留上一个请求的值。因此本评估以同一条持久`assistant/message.usage`读数为准，后续A/B应绑定request/step并重置缺失字段。此处仅记录问题，没有在并行QA过程中修改源码。

## 证据与入口

- `artifacts/context-assessment-20260918/inspect-context.cjs`：只读数值提取脚本。
- `artifacts/context-assessment-20260918/numeric-inventory.json`：请求头、工具大小、逐回复usage。
- `artifacts/context-assessment-20260918/tool-groups.json`：按能力分组的工具字节。
- `core/agent/cordis_config.py:64`：产品persona。
- `core/agent/mcp_gateway.py:2962`：MCP工具注册。
- `integrations/deepseek-harness/profile/web/agent-presets/crawshrimp-standard/agent.cordis.yml`：当前全能力预设。
- `integrations/deepseek-harness/node_modules/@deepseek-ai/dsh-tool-skill/README.zh.md`：技能目录和正文加载语义。
- `integrations/deepseek-harness/node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js:1145`：input/cache互斥计数映射。
