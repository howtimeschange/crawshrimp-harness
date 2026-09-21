# 推理等级兼容修复与森马网关验证

日期：2026-09-21。范围：本地源码、运行时补丁与网关测试；未发布安装包。

## 行为

- 切换 Provider / 模型时不继承启动配置里的旧档位；旧会话在组装请求前校验已保存的档位，仅遇到 `UNSUPPORTED_REASONING_EFFORT` 时恢复 Default，并写入会话模型选择事件。鉴权、模型不存在等错误仍正常报出。
- 菜单根据精确的 Provider + 模型能力生成，能力变化后不再显示旧的无效档位。新选模型使用 Default；主动选择当前模型不支持的档位仍会被严格校验拒绝。
- Default 不主动发送推理控制参数，Off 发送 DeepSeek `thinking.type=disabled`，Low / High / Max 发送 `thinking.type=enabled` 和对应的 `reasoning_effort`。
- 已保存的官方 Default / Off 在重启后保留；首次配置官方模型仍默认 High。
- 自定义 Provider 每个模型可选择默认、DeepSeek 协议或 OpenAI `reasoning_effort`，勾选供应商支持的档位；未配置时不根据模型名称推断能力。当前可选推理配置用于 OpenAI 兼容协议。

## 网关实测

使用用户授权的凭据，仅保存在测试进程内存；文档和代码不保存凭据。测试提示词为 `Reply only OK.`，输出预算 256 tokens。

| 路由 | 模型 | Off | Low / High / Max | 非法档位 |
| --- | --- | --- | --- | --- |
| `/bailian-codingplan/v1` | `deepseek-v4-pro` | 200，无思考内容 | 全部 200，返回思考内容及正文 | 400，明确拒绝 |
| `/bailian-codingplan/v1` | `deepseek-v4-flash` | 200，无思考内容 | 全部 200，返回思考内容及正文 | 400，明确拒绝 |
| `/bailian-codingplan/v1` | `deepseek-v4.1-flash` | 200，无思考内容 | 全部 200，返回思考内容及正文 | 400，明确拒绝 |
| `/bigdata/v1` | `deepseek-v4-pro` | 未验证 | High 返回 403 | 未验证 |

`/bigdata/v1` 的无推理参数基线请求也返回 403、空响应体，不能据此判断其推理能力。用户随后确认该路由是 Key 问题，要求不再排查；本次以已连通的内置森马国内网关为验收范围。两条路由的 `/models` 均返回 404，因此使用 Chat Completions 实测。

能力配置只对确切的 `https://ai-aigw.semir.com/bailian-codingplan/v1` 路由及上述三款模型启用；修改内置 Base URL 不会继承这项验证结论。不根据短回答的 token 数推断三个等级的实际推理质量。

## 验证

- Python：`venv/bin/python -m pytest -q tests/test_reasoning_compatibility.py tests/test_llm_gateway.py tests/test_agent_runtime_hardening.py`，185 项通过。
- JavaScript：79 项通过，覆盖模型选择、旧会话恢复、菜单渲染和点击、配置保存、打包 YAML 路由限制、真实序列化器和完整 pi-ai 适配器请求参数检查。
- `node integrations/deepseek-harness/scripts/patch-runtime-dependencies.mjs` 执行成功；补丁可重复应用。
- `npm run vite:build`（app 目录）通过，存在既有大 chunk 提示。
- 未进行 Windows 安装包安装验收，未提交、推送或发布。
