# membership-sso 合并到本地 main · 2026-11-04

合并输入：main `105d26815` 与 `codex/modeljetty-membership-sso` `b4bdd4e39`。保留两个父提交，未推送、打tag或发布。

分支含长期记忆、ModelJetty会员SSO及managed断流修复三个提交。main已有前两项的后续完善版，因此冲突文件沿用main，保留注册入口、权益刷新、模型恢复、runtime/account session隔离、模型参数/预算、图片编辑及较新的长期记忆实现。合并实际新增managed文本SSE终止校验、unknown诊断分类、失败JSON的request_id、测试与原验收证据，以及README长期记忆说明。

main原已保留账单ID并提供有界只读trace路由；新增request-trace账号action复用该路由的owner/session、白名单、身份及不刷新token校验，不采用旧分支直接调用api的实现。新broker测试夹具补齐main当前会员与模型available合同。UI、Python配置及runtime打包冲突全部保留main版本，应用版本仍为0.4.11。

验证：

- 14个相关Node测试文件合跑：84 pass、0 fail、0 skip，覆盖合并后的broker/provider、断流、取消、只读trace、账号、目录刷新、会话记忆、文本/图片回执、模型权限与reasoning。
- Python managed_models / llm_gateway：43 pass、另4 subtests pass。
- 相邻模型菜单检查最初发现本地node_modules未应用现有main补丁；执行项目既有patch-runtime-dependencies后复核通过，未更改已跟踪runtime源码。
- git diff --cached --check通过；没有启动已经停止的共享fixture/PG、模型付费请求或部署。

在main的既有干净工作树完成合并，原项目目录中的icon修改和其他未跟踪内容保持原样。
