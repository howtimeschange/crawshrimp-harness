# Gemini 工具调用中断排查与修复（2026-10-21）

会话：session-173600df-266b-4755-8eb4-77f7f926c21e。

## 原因

不是生成图片到一半失败：第一轮 Gemini 生图已经完成。后续浏览器任务在第 3 轮第 4 步、第 4 轮第 5 步停止。客户端收到 HTTP 200 流，但结束原因是 content_filter；工具调用仅以未完成内容出现，没有正式 tool_calls。

回放第一个失败上下文复现。上游 sub2api 同时记录 MALFORMED_FUNCTION_CALL。New API 的 Gemini 转换器默认将不认识的结束原因映射为 content_filter，因此该错误文案不能据此解释为用户内容违规。真正的问题是模型未生成合法工具调用。未将中途内容当成可执行调用，也未绕过内容安全拦截。

## 已上线修复

账号服务增加 scopeGeminiTools：仅对 Gemini 请求，读取正式 enable_tools 调用对应的工具结果，根据最后一份 crawshrimp-tool-domains-v1 清单过滤未启用的抓虾 MCP 工具。原回放 95 个定义缩小为 49 个，保留全部对话、通用工具和已启用工具。不根据用户文本、无关工具结果或猜测的任务领域过滤。失败或无效的清单不覆盖有效状态；其他模型不变。

原上下文在全量工具下可复现格式错误；采用实际启用工具集后恢复正式调用。该修复减少了触发因素，不保证上游模型永远不生成格式错误。New API 通用错误映射尚未修改，其他来源的 content_filter 仍需依据上游真实原因判断。

生产账号服务：/opt/modeljetty/accounts/releases/20261021-gemini-tools。服务器端生效，无需重装客户端。

## 验证

- 9 项账号服务/OAuth/客户端 broker/工具域回归测试全部通过，0 跳过。
- 第一处原上下文经正在运行的 Electron broker → 生产账号服务 → ModelJetty：HTTP 200、5616ms、finish=tool_calls，合法 bash 调用参数。
- 第二处原上下文同一路径：HTTP 200、4140ms、finish=tool_calls，mcp__crawshrimp__browser_observe，参数 {}。
- 回放只检查模型输出，不执行返回的 bash 或浏览器工具，不触碰云盘文件。
- Gemini 其他型号、工具别名、required 模式未解决原问题；这些实验未作为线上修复部署。未添加自动付费重试或静默切换模型。
- 修复前后证据保存在 ModelJetty ignored work/gemini-tools-20261021，含原始用户上下文，不对外发布。
- 未提交、推送或发布桌面安装包。
