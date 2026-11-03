# Harness managed 409 与生图模型恢复（本地候选）

工作区：`codex/managed409-image-model-recovery`，基线 `68d47fa4c`。本轮未提交、安装或发布；用户现有数据未清理，未知请求未重放。

## 已实现

- 生图“下次生成”表单与批量表单在设置加载、模型目录变化、旧草稿/历史任务恢复后自动选择已配置模型。已配置且仍有效的选择保持不变。切换时同步模型参数与连接版本校验，历史任务、原运行模型身份保留。没有可用配置时显示配置提示。
- 回查兼容服务端 `billing_request_id`，保留账号归属、编号格式校验，避免漏显计费编号。
- 本地模型代理将尚未开始推理转发的异常返回503“本次模型请求尚未发送”。真实上游响应头立即转发，避免把首个正文块的等待时间叠加在响应头等待上。已开始转发后的传输异常仍为409 unknown；部分响应断流不追加成功内容、不自动重发。该分类修复不能证明历史第二条请求未发送或未计费。

## 验证

- `node --test src/renderer/utils/aiImageModels.test.js`：12/12。
- `electron scripts/ai-image-model-electron-smoke.cjs`：真实 Electron renderer 中恢复旧草稿与历史任务、读取下拉框 DOM、刷新目录、批量表单、保留有效选择、无可用配置，均通过。隔离 userData、测试配置和本地服务；零付费调用。
- `node --test src/managedAccount.test.js src/managedFetch.test.js src/managedDiagnostics.test.js src/managedReasoning.test.js src/managedTextReceipts.test.mjs src/renderer/utils/aiImage*.test.js`：初次70/71；新增提前转发响应头测试后，broker/fetch/diagnostics 为36/36，receipt/image 为31/31，reasoning为4/5。失败项是基线已有菜单集成测试所需 DSH 已安装构建不匹配：初次缺依赖目录；连接本机现有依赖后，旧客户端已打补丁结构不符合 `patchManagedModelMenu` 的新锚点。对应测试与补丁文件均与基线逐字节一致，未修改共享 node_modules。其余4项 reasoning 用例通过。
- `npm run vite:build`：通过，既有 chunk 大小提示。
- `git diff --check`：通过。

## 原请求协查

已按用户授权联系本地 ModelJetty 的现有“ModelJetty 图片尺寸与回执配套发布协查”会话（`01a19c14-7754-7ac2-b1b8-9107a4758e28`）。服务端最终证据另行补入；不能将历史 unknown 标为已恢复，也未自动继续付费推理。


## 当前只读结论

- `d503c319-7008-473b-a7ff-313483beff22`：ModelJetty 记录 unknown，但 New API 已 settled，计费编号 `202611031004101612903198268d9d6ZK05kNyj`，2572 quota，约 ¥0.0375512（仅此请求，非整场会话合计）。上游 HTTP200 晚于客户端报错；Nginx499、下行0字节。客户端字段映射漏显不能用于推断编号写入时间。
- `51b001b3-e582-41c4-a7f1-d89a1eaf9e3f`：未查到账号服务记录；不能据此证明未受理或未计费。
- 原始断连发生在哪一网络段仍未确认；现有日志缺少足够客户端传输诊断。未伪造历史终态，也未重复原请求。
- ModelJetty 已导出实际生产镜像源码，独立候选补丁见 `/Users/xingyicheng/Documents/ChatGPT/中转/work/gemini-managed409-20261103/minimal-server-fix.patch` 与 `candidate-manifest.json`。本地 HTTP 复现旧行为和新行为、上游真实中断保留 unknown；服务端相关60项回归通过。数据库写入集成本轮未重跑（旧配置缺失、Docker停止），生产数据库只读核查已完成；未重启共享环境或发布生产。

ModelJetty 详细对账、复现、最小补丁及限制见[服务端协查记录](/Users/xingyicheng/Documents/ChatGPT/中转/docs/verification/gemini-managed409-2026-11-03/README.md)。该记录已经最终生产只读回查确认，生产镜像及请求原状态保持。

后续“响应丢失/网络初始断连”调查和准确安装版复现实验见[传输调查](transport-investigation.md)。
