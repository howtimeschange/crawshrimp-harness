# ModelJetty × Harness 实际回归（2026-10-21）

## 范围与实现

文本供应商以普通列表项显示在 DeepSeek 官方下方，分 GPT / DeepSeek / Gemini，使用 ModelJetty 原项目 SVG。图片供应商 GPT Image / Nano Banana 位于配置列表最前。支持 19 个文本模型 ID 与 3 个图片模型 ID。

GPT 使用 `/v1/responses`；DeepSeek、Gemini 文本使用 `/v1/chat/completions`；GPT 图片使用 Images API；Nano Banana 使用 `/v1beta/models/:generateContent` 与 Bearer 鉴权。默认模型同时保存供应商 ID，避免同名模型误走其他网关。

影响范围：设置列表/编辑保存、配置持久化、默认模型路由、DSH 流式会话/工具、普通文本与多模态适配器、文生图与参考图输入、图片任务缓存及回显。

## 真实客户端结果

使用当前源码启动真实 Electron、Python 后端和 DSH，隔离测试数据目录。原用户配置未修改。非 mock 设置页验证：

| 流程 | 结果 |
|---|---|
| GPT gpt-6-luna 中文会话 | 成功，显示“欢迎使用 ModelJetty，抓虾随时为你效劳。” |
| Gemini gemini-2.5-flash-lite 会话 | 成功，流式完成 |
| DeepSeek deepseek-flash 会话 | 成功，显示中文欢迎语 |
| GPT Provider 保存 | 成功，Responses 协议保留，运行时同步重启 |
| Nano Banana Provider 保存 | 首次发现 IPC clone 错误；修复响应式对象序列化后保存成功，密钥与协议读回一致 |
| Flare 文生图 | 成功，PNG 1536×1024 |
| Sunburst 文生图 | 成功，PNG 1536×1024 |
| Nano Banana 文生图 | 成功，JPEG 1024×1024 |
| Nano Banana 参考图编辑 | 成功，保留虾与纸船并换成浅绿色背景 |
| Flare 参考图编辑 | 阻塞：sub2api 内部通道返回 429“API key 额度已用完” |

GPT 图片请求 1024×1024，但供应商实际返回 1536×1024；尺寸服从不是已通过项。结果文件已解码检查，UI 任务与缓存已核对。

生图任务 `1aa93faec4374cbd970e64bcb9cc114b`：4 个完成队列、1 个失败队列。失败请求来自通道 2（Codex via sub2api），服务端日志确认 `/v1/images/edits` 0–13ms 返回 429。客户端既有重试执行 3 次，未人工重发。未调整内部通道配额。

## 其他验证

前序已通过：10 个 Gemini 文本 ID 的真实适配器调用；GPT / Gemini 的 pi-ai SSE 工具调用；GPT / DeepSeek 普通适配器与三种生图协议。

本轮复跑：87 pytest + 4 subtests；19 个 llmSettings JS 测试；10 个 aiImageModels JS 测试；Vite build；git diff --check。构建仅有既有大 chunk 提示。

## 服务端精准规则

Cloudflare `ModelJetty API client compatibility` 已保存为仅匹配 api.modeljetty.com 的 `/v1/` 和 `/v1beta/`，仅关闭 Browser Integrity Check。默认 Python UA：v1beta 带 Key 200、无 Key 401；v1 无 Key 401；范围外 `/api/status` 仍为原防护行为。API 鉴权与其他防护保留。

## 账号、费用与证据

测试账号 `harness_20261021`，初始测试额度约 ¥100，有限额 Key 有效期 30 天。最终对账：消费 ¥1.802808，余额 ¥98.197191，用户/Key/日志一致。凭据只在 ModelJetty `work/secrets/harness-test-20261021.json`，不进入仓库。

证据目录：`/Users/xingyicheng/Documents/ChatGPT/中转/work/harness-integration-20261021/`。关键文件：`harness-ui-report.json`、`billing-report.json`、`image-edit-error.json`、`edge-after.json`，以及 `harness-*.png`。图片缓存位于该目录的 `harness-data/ai-image-cache/`。

未发布安装包、未提交/推送代码。剩余验收项：上游内部额度恢复后，从真实客户端重新验证 GPT 参考图编辑；不应据此宣称所有图片能力均通过。

## 补充：智能体会话直接生图（11:14）

真实新会话中，用户自然语言指定 ModelJetty Nano Banana 2；DeepSeek Flash 智能体查询模型并调用 `mcp__crawshrimp__image_generate`，model=`custom-modeljetty-gemini/gemini-3.1-flash-image`，count=1。工具返回 ok=true，run_uid=`18dd725a53f14620aa8222932e2d05a0`。图片直接展示在会话“本轮生成的图片”，侧栏产物计数为 1；本地 JPEG 1024×1024 可解码，大小 340615 字节。智能体未要求用户转到生图工作台，也未只返回提示词。证据 `agent-image-chat-report.json`、`harness-agent-image-chat.png`。最终消费 ¥2.0765726，余额 ¥97.9234264，账单一致。此项验证 Nano Banana 会话链路；GPT 内部通道配额阻塞仍保留，未重复请求。

## 1XM 停服下架

按用户要求移除全局默认配置中的 1XM 地址/Key、设置页供应商卡片、模型下拉选项与 API/IM 模型目录。旧配置在读取和保存时剔除，旧环境变量不再进入运行时。历史任务保留原模型身份，重新生成必须选择有效供应商；智能体省略模型或使用无前缀旧模型时明确要求先查询 image_models，不再默认使用 1XM。其他自定义供应商的旧异步协议保留兼容，但不再作为新增选项提供。

真实 Electron 已重启确认设置页及下拉列表均无 1XM；/settings 无旧配置分支，/ai-image/models 返回9个有效供应商模型。50项后端测试通过；补充智能体默认模型保护后36项供应商测试通过；10项前端模型测试和 Vite build 通过（既有 chunk 提示）。证据 retire-1xm-readback.json、harness-no-1xm-settings.png。未打包发布。
