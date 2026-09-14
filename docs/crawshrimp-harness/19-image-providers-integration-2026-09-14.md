# Harness 多供应商生图接入（2026-09-14）

已在 Harness 源码接入 1XM、沃卡、森马网关和自定义供应商配置。复用抓虾主项目本地供应商实现，保留 Harness 的对话生图、产物交付和原有工作台实现；未覆盖主项目其他修改。未提交 Git、推送、打包发布或部署云端。

## 设置与使用

设置 → AI 能力 → 图片模型供应商。固定供应商按地址、鉴权分组编辑；自定义供应商支持名称、Base URL、API Key、多个原始模型 ID，协议可选 OpenAI Images、Gemini 原生、1XM 异步任务。

原无前缀模型继续使用 1XM；沃卡和森马任务保存 `woka/gpt-image-2`、`semir/gemini-3-pro-image-preview` 等完整模型键。自定义任务保存 `custom-<id>/<原始模型ID>`，恢复或重试不切换供应商。缺配置明确报错，不借用其他供应商密钥。

已把用户提供的三个 Key 写入当前安装版 Harness 和已有源码客户端使用的本机数据配置，分别读回验证三个配置状态。验收客户端使用独立数据目录；源码、本文与脱敏验收文件不包含 Key。

## 对接协议

| 供应商 | OpenAI Base URL | Gemini Base URL | 鉴权 |
|---|---|---|---|
| 沃卡 | https://4.0.wk-best.com/v1 | https://4.0.wk-best.com/v1beta | GPT Bearer、Gemini x-goog-api-key，共用 Key |
| 森马 | https://ai-aigw.semir.com/overseas-image/v1 | https://ai-aigw.semir.com/overseas-image-gemini/v1beta | GPT Bearer、Gemini x-goog-api-key，分别配置 Key |

已重新获取并对照[沃卡文档](https://woka-api-docs.apifox.cn/8855157m0)。GPT 文生图使用 POST /images/generations JSON，编辑使用 POST /images/edits multipart；多参考图字段为 image[]。Nano 使用 POST /models/{model}:generateContent，文本与 inlineData 参考图，imageConfig 指定比例和分辨率。支持 OpenAI Base64/URL、Gemini inlineData 输出，缓存与导出复用本地图片服务。

内置每家三个模型：GPT Image 2、Nano Banana 2（gemini-3.1-flash-image-preview）、Nano Banana Pro（gemini-3-pro-image-preview）。

## 首轮协议真实调用

文生图先验证协议；参考图编辑通过 Harness 源码客户端的实际后端提交、保存任务、GET 读回、缓存并导出。使用生成的测试杯子作为参考图。没有使用业务商品或私人图片。

| 供应商 | 模型 ID | 文生图 | 参考图编辑 |
|---|---|---|---|
| woka | gpt-image-2 | 成功 / 26.5s | 断连，回执未知 / 60.7s |
| woka | gemini-3.1-flash-image-preview | 成功 / 12.9s | 成功 / 20.6s |
| woka | gemini-3-pro-image-preview | 成功 / 22.3s | 成功 / 43.6s |
| semir | gpt-image-2 | 成功 / 16.6s | 成功 / 24.0s |
| semir | gemini-3.1-flash-image-preview | 成功 / 15.1s | 成功 / 14.8s |
| semir | gemini-3-pro-image-preview | 成功 / 21.9s | 成功 / 26.8s |

- 文生图 6/6 返回图片；编辑 5/6 返回图片。每个成功输出均通过 Pillow 解码验证。
- 沃卡 GPT 编辑这次断连，后端已持久化 UNKNOWN_SUBMIT_RESULT，未重提。主项目之前有该接口成功记录，但本文不把之前的成功替代本次结果。
- 森马 GPT 未严格遵循请求尺寸：本次请求 1024×1024，文生图返回 1376×1143，编辑返回 1254×1254。没有静默裁剪或拉伸。
- 这些是有限样本调用结果，不代表长期稳定性或质量保证。

## 调用入口盘点

按执行路径计 10 条，包含复用关系；其中注册适配器生图任务 3 个。

| 路径 | 接入位置 |
|---|---|
| AI 生图工作台、批量、参考图编辑、重试与导出 | AiImageWorkbench.vue → ai_image_service.py |
| Harness 对话生图与后续图生视频 | MCP image_models / image_generate → generate_images_sync；IM 模型目录同步扩展 |
| AI 视频工作流改图/换脸/换背景/换装/换姿势 | AiVideoWorkflow.vue，统一模型目录与比例传递 |
| 巴拉 AI 视频助手换脸换背景任务 | bala_ai_face_background_generate，manifest + TaskRunner |
| 买家秀工作流与森马云盘买家秀任务 | buyer_show_ai_generate，模型识别和配置路由 |
| 天猫 AI 测图全链路及 Python CLI | tmall_ai_image_test_chain，统一客户端和 Base64 下载 |
| 云端审批派发本地任务机 | cloud_job_executors.py 复用统一本地服务 |
| 云端审批直接生图 | Worker OpenAI/Gemini 实现、在线选项、服务器环境变量 |
| Banner 内置技能脚本 | generate_1xm_image.mjs → image-generation/scripts/generate.py → 本机后端 |
| 电商生图内置技能脚本 | ecommerce-img-gen/scripts/generate_image.py → 同一本机后端 |

新 image-generation 技能提供模型发现及脚本入口。脚本使用 Harness 注入的本地 API 认证和运行端口，供应商密钥不传入命令行；两个旧脚本仍保留脱离 Harness 时的独立 1XM 使用方式。

云端直接执行需要单独设置 WOKA_IMAGE_API_KEY、SEMIR_IMAGE_GPT_API_KEY、SEMIR_IMAGE_GEMINI_API_KEY，可选覆盖对应 BASE_URL/GEMINI_BASE_URL。自定义供应商保存在本机，不上传本机 Key 或自定义配置到云端。本次只修改云端源码并本地验证。

## 失败处理

同步供应商每家共享最多 3 个正在提交的请求。明确的 429/临时 503 最多尝试 3 次，等待 1s、2s；鉴权、余额、模型不支持等拒绝不自动重试。超时、断连、502/504 保留未知状态，禁止直接重试该队列。买家秀外层不叠加同步接口的重试次数。批次保留已成功图片及失败计数。

## 首轮验收

- 独立 Electron 源码客户端 /health 确认 runtime.kind=source、scripts_dir 为 Harness 仓库、数据目录隔离。
- 原生界面验证三家供应商卡片与编辑表单、全部模型选项、自定义供应商保存和客户端生成结果展示。
- 自定义 OpenAI 本地协议服务验证真实客户端请求地址、原始模型 ID、鉴权与 n=1，结果图片实际显示。该项是协议模拟，未冒充供应商实测。
- Banner 与电商脚本分别通过自定义模型走真实本机后端并输出文件。
- 后端首轮 91 项（另 3 subtests）；扩展 API/买家秀/天猫/1XM/Agent 159 项；最终生图/模型目录/内置技能相关 118 项（另 3 subtests）。这些套件存在重叠，不相加宣称独立测试总数。
- 前端 77 项通过；桌面 Vite 构建通过。
- 云端 TypeScript、17 个测试文件 / 252 项测试、Vite 构建通过。
- git diff --check 与本次变更密钥扫描通过。

脱敏调用结果、构建与测试日志保存在仓库 .codex-tmp/image-providers-20260914。没有执行业务工作流的商品发布、上架或其他外部写入。首轮尚未运行聊天模型自动选工具的完整对话；后续真实入口验收见下节。IM 外部消息送达仍未实测。


## 第二轮：真实入口验收与修复

2026-09-14 使用隔离的源码 Electron 客户端、真实沃卡/森马供应商、实际注册任务和技能脚本进行验收。森马云盘首次返回 40106，用户重新登录后已重跑成功。测试使用合成图片和项目模板中的示例款号，没有使用真实订单或客户信息。以下为有限样本覆盖，不是八个入口与全部模型的笛卡尔积测试。

| 入口 | 实际执行方式与结果 | 证据标识 |
|---|---|---|
| Banner 内置脚本 | 真实执行 Node 包装脚本→Python 技能→后端；沃卡/森马 GPT Image 2 均输出图片 | `8ece0821e0f24d9da77dd2ef54bfc476`、`44ca172735c542e3964ef82a9a6d7834` |
| 电商生图内置脚本 | 真实执行 Python 包装脚本，沃卡/森马 Nano 2、Nano Pro 四种参考图编辑均输出图片 | `entry-acceptance/scripts.log`及对应 JSON/图片 |
| AI 生图工作台 | 原生 UI 点击生成、参考图二次编辑、两条批量生成、下载成功；沃卡 Nano 2。自定义供应商真实 401 后修正配置，对同一失败任务通过 API 重试成功，manual_retry_count=1 | 工作台 `873e1d6f851a4e2bbe782a3d3030608c`；重试 `587f6b9f04974f1988de42881d84a82c` |
| Harness 对话生图→图生视频 | 真实 LLM 调用 image_models→image_generate→read_image，森马 Nano 2 蓝杯图片在聊天工具组和资源区显示。后续真实调用 video_models→video_generate，首帧正确传入，返回 MISSING_CONFIG | 图片 `01aea709431144eeb5a8a8fe660f5ff5`；视频 `avj_20260914_200952_dd12` |
| AI 视频工作流改图 | 原生 UI 选择工作目录、打开图片、选择森马 Nano 2 换背景并生成，版本历史新增“大图修改1” | `55b38c77288a457ab62436f50b2dfbd4` |
| 巴拉 AI 视频助手 | 真实注册任务引擎完成换背景（森马 Nano 2）、换姿势（沃卡 Nano Pro）、换脸（森马 Nano Pro）、换装（森马 GPT Image 2） | `1ec49e5b46524f32b15e5fbc67d6c50c`、`c9b3375b955d4140a91807624d7947bc`、`7059f8663f604f56b875eed213ec37e9`、`1abbaf20a20f423da21452c5eb743bac` |
| 买家秀与森马云盘任务 | 登录恢复后，真实注册任务读取示例 Excel、云盘下载模拍/平铺、生图、输出 ZIP 与执行结果 Excel；沃卡 Nano 2。另以合成输入实测沃卡/森马生成与打包 | run_id=9；生图 `ce0af8b382fb4e2983394b50c215832b` |
| 天猫全链路及 Python CLI | CLI（森马 Nano 2）与注册任务（沃卡 Nano 2）均真实读取云盘素材，确认后生成并下载各1张，generated=1、failed=0，进入 pending_approval | CLI `20260914-195109-e6931c`；任务 `20260914-200853-5887f1` |

### 发现并修复的四个问题

1. 工作台二次编辑将 Base64 图片当成本地文件路径，报 File name too long / HTTP 500。修复参考图规范化，保留 data:image、HTTP、HTTPS 输入；同一原生界面重新生成成功，并目视核对背景变化及人物服装保留。
2. 内置生图技能在明确 HTTP 400 拒绝后仍轮询20分钟。现在明确4xx立即退出，返回错误和任务标识；响应丢失时仍查询原任务，不重复提交。真实缺配置调用由持续等待变为约0.05秒明确退出。
3. 天猫注册任务丢弃带供应商前缀的 model_id，错误回落至未配置的1XM。修复参数映射，保留沃卡、森马与自定义模型标识；重新完整执行注册任务及确认生图，实际使用沃卡成功。
4. 对话 video_generate 未传 provider/model，实际调用返回“不支持的 provider”。补充 video_models、工具注册、供应商与模型传递，以及缺配置时即时错误。重启后真实对话复验返回 MISSING_CONFIG，保留可追踪任务号。

### 产物与回归

脱敏证据目录：`.codex-tmp/image-providers-20260914/entry-acceptance/`。

- `acceptance-jobs.json`：本轮21条作业记录，其中18条 completed、20个图片文件，含尺寸、文件大小、SHA-256。其余包含失败/未知样本，不计作成功。天猫独立任务产物另行核对，不混入此统计。
- `verified-business-artifacts.json`：重新打开并完整解码天猫 CLI 与注册任务图片（均1024×1024），以及买家秀 ZIP 中的实际 AI 图片（896×1200）。买家秀执行表读回：模拍下载结果=已下载、平铺下载结果=已下载、生图结果=已生成。
- 买家秀交付：`entry-acceptance/buyer-full/真实验收买家秀.zip`，含真实生成图片与结果表。
- `regression.log`：API任务生命周期、图片服务、供应商测试124项通过，另3个subtests。
- `agent-regression.log`：Agent图片参考与运行时测试150项通过，1条依赖警告。
- `skills-regression.log`：内置技能与技能错误恢复测试13项通过。
- 以上套件不与首轮测试数量相加；本轮相关已跟踪代码 `git diff --check` 通过。

### 明确未通过或未覆盖的范围

- **图生视频尚未产出视频**：当前隔离客户端未配置视频供应商凭据；已验证首帧传递和缺配置错误，不能将此计作视频生成成功。
- **沃卡 GPT 参考图编辑首轮断连，提交结果未知**，保留原任务，未盲目重复提交。其他五种供应商/模型编辑组合成功。
- **森马 GPT 尺寸不严格遵循请求**，Banner请求1024×1024，实际1370×1148；未静默裁剪。
- 工作台重试实测的是同一后端重试 API，尚未点击原生重试按钮；视频工作流原生 UI 实测换背景，其他三种操作通过巴拉注册任务实测；买家秀与天猫通过真实注册任务/CLI执行，未宣称各页面所有按钮均已验收。
- 未完成外部 IM 消息送达实测、云端部署验收。天猫停在待审批产物阶段，未上传商品图、创建投放计划、上架或发送通知。
- 本次修改未提交 Git、推送、打包发布。
