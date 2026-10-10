# 供应商模型管理与回归记录 · 2026-10-10

## 本次改动

- 森马海外 OpenAI 默认地址统一为 `https://ai-aigw.semir.com/overseas-openai-codex/v1`，覆盖前端默认值、后端配置、路由和 DSH Web profile。已有显式地址仍按保存值读取。
- 五个内置供应商与自定义供应商均支持模型新增、名称和 ID 编辑、删除、批量 ID 编辑；内置供应商支持恢复预设。预算和推理协议可以逐模型设置。
- 供应商弹窗拆分为“连接配置”和“模型管理”两个 Tab；模型管理采用左侧模型列表、右侧参数详情，并适配窄窗口。
- 新增 `ai.llm.builtin_provider_models`，作为各内置供应商保存后的完整模型列表。未设置供应商键时使用预设，空数组停用该供应商全部模型。公开设置返回只读预设列表 `ai.llm.builtin_provider_model_defaults`。
- 模型列表贯通目录、默认模型选择、会话选择、供应商路由与 DSH 运行时；删除模型后不再出现在目录中。新模型继续使用所属供应商的连接与凭证，未登记模型仍不能通过会话 API 选择。
- 新增 `POST /agent/providers/{provider_id}/discover-models`，支持 DeepSeek 和 GLM。优先读取当前地址的 `/models`；GLM 接口不支持或未返回有效目录时读取官方 `llms.txt` 对话模型目录。鉴权、限流和服务错误直接呈现，不以文档回退掩盖。发现结果只预览，由用户选择导入；草稿 Key 不保存，带 Key 请求不跟随重定向。
- DeepSeek、GLM 新型号的产品 ID 映射到上游 wire ID；GLM FlashX 可发现并导入，未加入固定预设。
- 移除“支持图片”和“支持工具”两个手工勾选项。旧能力标记不再隐藏模型、阻止选择或丢弃图片；工具默认提供，图片直接交给当前上游。上下文、输出预算与推理协议仍由程序管理。

这两个能力勾选项是本轮模型编辑界面新增的，最终实现已移除；原有内部 metadata 早已存在。当前运行时声明图片输入是为了避免 SDK 丢弃附件，不表示每个上游模型都能识图。DeepSeek V4 Pro 当前直接接收图片，原有按 text-only 声明触发的 Flash 视觉桥接不再触发。

## 验证结果

- 后端相关测试合计 227 项通过，另有 4 个 subtests；前端 utility 测试 18 项通过。
- Vite 生产构建通过，输出使用临时目录；Git diff 格式检查通过。
- 旧 `supports_tools: false`、`input_modalities: ["text"]` 的内置和自定义模型仍可选中，图片仍进入运行时；未知模型仍拒绝，预算仍保留。
- 实际目录共 29 条模型路线，18 条有测试凭据；文本、图片、工具往返共 54 个场景，定向补测后 47 个通过。另 11 条缺少凭据，未调用上游。
- 全模型测试复用开发客户端实际安装的 PiAiAdapter、供应商配置解析、图片附件转换和思考协议。工具测试包含函数调用、无副作用本地 echo 和结果回传后的第二轮回答；图片要求读出随机编号和图形，HTTP 200 不计作识图通过。

| 路线 | 文本 | 图片 | 工具往返 |
|---|---|---|---|
| 森马海外：GPT-6.1 Sol、GPT-6 Sol/Luna、GPT-5.6 Sol/Terra/Luna、GPT-5.5、Gemini 3.1 Pro Preview、Gemini 3.5 Flash | 通过 | 通过 | 通过 |
| 森马海外：GPT-6 Astra | 403 | 403 | 403 |
| DeepSeek 官方 Flash | 通过 | 通过 | 通过 |
| DeepSeek 官方 V4 Pro | 通过 | 未读对随机编号 | 通过 |
| GLM 5.3 Flash | 通过 | 通过 | 通过 |
| GLM 5.3、5.2 | 通过 | 400，仅接受 text | 通过 |
| 自定义 DS OpenAI、DS-A Anthropic（相同 Flash wire ID） | 通过 | 通过 | 通过 |
| 自定义森马测试 V4 Pro | 通过 | 未读对随机编号 | 通过 |

GPT-6 Astra 持续返回 `model_not_allowed`。GLM 5.3/5.2 的失败请求实际含一个 `image_url`，上游返回 400/1210，并声明 `messages.content.type` 仅接受 text。Pro 请求中的图片已发送，但回答未通过内容校验。GPT-5.6 Sol/Luna 的初始超时和 429 已通过定向补测；Gemini 初始额外测试曾出现 503，正式适配器三个场景通过。GLM 5.3 FlashX 额外测试的文本、图片、Function Calling 均通过，未保存到客户端配置。

开发客户端现场验证了 GPT-6.1 Sol 文本和图片，后台 Run 均 completed；同窗口用户现场发送的 DeepSeek Flash 图片轮也已读回 completed。全模型矩阵由实际适配器执行，并未逐个通过 UI 发送。

测试 Key 未写入客户端配置、源码或报告；临时 QA 模型未保存。未实测的路线为森马海外 Anthropic 两款及森马国内 OpenAI 九款。

## 交接材料

- 完整回归报告：`.codex-tmp/model-acceptance-20261010/regression/report.md`
- 原始及补测结果：同目录 `results.json`，保留首次限流、超时和失败证据。
- 上述证据目录被 Git 忽略，保留在本机，不纳入提交。
- 原有三个 spike 配置的 URL 改动与其他无关脏文件保留，未纳入本次提交。开发客户端保持运行，用户正在现场操作。
- 本次为本地提交，不包含 push、打包或发布；主会话接手后可继续评审并处理上游权限或能力限制。
