# 托管上下文与能力复用：修改和真实界面验收

日期：2026-10-22（Asia/Shanghai）。分支：`codex/v0.5.0`。本次未发布，未覆盖工作区已有手机连接/中继等修改。

## 修改

- `core/managed_models.py`：托管文本模型上下文预算最低 1,000,000；保留目录中更大的预算。输出预算独立处理，优先使用目录元数据，其次使用模型能力登记；DeepSeek Flash/Pro 映射官方能力，默认 maxTokens=393216。未知模型输出预算仍为 8192，避免把上下文长度当作输出请求。无效/布尔/负数元数据回退，不影响既有供应商与凭证隔离。
- `core/agent/cordis_config.py`：业务任务先 skill_list 发现 CLI/skill、tasks_search 搜索抓虾脚本，按需 task_describe、skill_read 和 enable_tools；优先复用已存在能力，只有缺失或不能满足才读抓虾浏览器技能自行探查。移除“所有网页任务先读通用浏览器技能”的竞争入口，保留 CDP、会话隔离与审批边界。当前会话已发现的能力直接复用，不反复列全量清单。
- `tests/test_managed_models.py`：验证托管模型预算通过真实能力查询、provider payload 和 DSH pi-ai 配置生成链路，不被重新降到 64K；覆盖目录更大预算和非法元数据。

预算是 Harness 本地声明的会话额度，不表示每个上游模型都经过 100 万 token 满窗压力测试。本次真实测试确认托管 DeepSeek 接受修改后的请求且界面显示 1M，没有做填满上下文的长文本压测。

## 自动检查

- `venv/bin/python -m pytest tests/test_managed_models.py tests/test_agent_context_optimization.py -q`：8 passed。
- `venv/bin/python -m pytest tests/test_llm_model_discovery.py tests/test_agent_service_utils.py -q`：30 passed。
- `git diff --check`：通过。
- 默认 persona 6193 UTF-8 字节，保持既有 <6500 字节约束。

## 真实界面走查

使用现有 v0.5.0 Electron 开发窗口（5177），通过设置中的“修复核心服务”加载修改。该操作会关闭开发实例的手机直连，已提前告知；没有更改生产安装或线上服务。

从真实界面点击“新建会话”，保留工作区内修改权限和托管 DeepSeek Flash，输入：

> 帮我打开森马云盘，随便找个有下载权限的款，把完整图包下载到当前工作区的 qa-yunpan-20261022 目录，核对完整性并展示下载结果。不要覆盖已有文件。

提示中没有指定 CLI、skill、脚本搜索或实现步骤，路由由默认 prompt 引导。任务从界面发送，未通过后端 API 注入。此次使用既有有效登录态，未复测登录过期/多标签错配故障。

会话：`session-5b95d3a9-e0cd-4db6-a304-10e1f9e3eb93`，标题“森马云盘图包下载与校验”。

| 检查 | 实际结果 |
| --- | --- |
| 真实路由 | crawshrimp-managed-openai / managed-deepseek-flash |
| 上下文额度 | request/context=1000000；界面面板显示 1M |
| 能力发现 | 3.247 秒 skill_list；3.281 秒 tasks_search |
| 专用技能 | 6.480 秒读取 cli-semir-yunpan/SKILL.md |
| 执行路径 | CLI 查询目录、确认单文件下载权限、整包下载及校验；没有 browser_* 探索 |
| 最终状态 | 界面“已完成，用时 3分41秒”；日志 turn/end=completed |
| 工具调用 | 44 次，含 39 次 bash；无溢出结束 |
| 上下文使用 | 最终界面约 7% |
| 下载结果 | 款 285426203011，所选云盘目录内 44 张 JPG，42,656,297 字节 |
| 校验结果 | 44/44 SHA1 和大小一致、44/44 可解码、缺失与额外文件为零 |
| 用户可见交付 | 回答中列出核对结果、报告及 JSON 清单链接，示例图入口；右侧产物列表显示三个产物 |

还从右侧点击了 JPG 产物，AX 界面确认进入真实文件预览标签并出现图片元素（含缩放、系统打开、定位控件）。后续截图时界面回到了会话结果页，因此保存的 `04-integrity-result.png` 是核验结果截图，不冒称为图片预览截图。

独立复核本地 44 个文件：重新计算 SHA1/字节数并与产物清单里的云端值比较，且用 Pillow 实际解码全部图片；全部通过。清单的 generated_at 不作为计时证据，所有时长取原始 session 事件。

## 证据

- [首次复用 CLI](qa-2026-10-22-session-routing/01-cli-first.png)
- [真实界面的 1M 上下文面板](qa-2026-10-22-session-routing/02-context-1m.png)
- [任务完成界面](qa-2026-10-22-session-routing/03-yunpan-completed.png)
- [44/44 核验结果界面](qa-2026-10-22-session-routing/04-integrity-result.png)
- [会话计时与工具统计](qa-2026-10-22-session-routing/yunpan-metrics.json)
- [独立文件复核](qa-2026-10-22-session-routing/file-verification.json)

运行产物位于当前工作树 `.codex-tmp/v050/data/agent/workspace/qa-yunpan-20261022/285426203011/`；核对报告、清单位于该 workspace 根目录。没有把商品原图复制进代码仓库文档目录。

## 结论与保留问题

本次请求的上下文配置和能力复用提示已生效，真实用户界面发起的下载、校验、结果收尾与产物展示流程已完成。对比原新版本样本的 101 次调用、约 13 分钟活动时间，本次为 44 次、3分41秒；由于款、体积、登录态和校验范围不同，这不是严格同条件提速倍数。

“任选款”仍发生了较多目录搜索与候选比较，39 次 bash 尚有精简空间；本次没有声称所有反复行为被根治。CLI/浏览器标签绑定、过期登录快速失败、后台通知去重与满窗压缩恢复没有在本次修改中处理。界面还显示了工作树其他并行工作的变更摘要，不能把该摘要当成本下载任务编辑这些文件的证明。
