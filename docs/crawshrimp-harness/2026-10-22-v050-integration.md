# v0.5.0 本地集成与走查

分支：`codex/v0.5.0`。从本地 main 创建，分别 merge 两个功能分支，保留提交历史。

## 纳入基线

- main：`3ce1ad163`，ModelJetty 模型接入。
- codex/dsh-runtime-v021：`457792310`，含 DSH rc.2、长期记忆、Python 回归修复、PTC 工具适配与性能记录。
- codex/modeljetty-membership-sso：`607179a97`，会员 SSO、首次引导、用量、限时诊断。

合并无文本冲突。app/package.json 及锁文件版本更新为 0.5.0。
两项旧界面契约测试更新为会员版账号/BYOK 引导及托管模型配置状态；保留供应商导航、配置写入和权限相关检查。

## 验证

- 桌面完整回归：987 passed，0 failed。
- Python 运行时、托管模型、ModelJetty、网关、图片供应商相邻回归：258 passed，4 subtests passed。
- 前端 Vite 构建通过；既有大 chunk 提示仍在。
- 运行时 staging 完成。
- 实际 Electron 开发窗口显示欢迎引导，核心服务运行中；后端 health HTTP 200。
- 未执行付费模型生成、支付、发布或推送。完整业务走查由用户继续。

## 当前开发环境

独立工作区：`/Users/xingyicheng/.codex/worktrees/harness-v050/crawshrimp-harness`。
Vite：127.0.0.1:5177；API：127.0.0.1:18815；浏览器 CDP：9235。
独立数据及 Electron profile 位于 `.codex-tmp/v050/`，首次使用需登录账号或配置自己的模型。
启动日志、测试日志和进程 PID 也在该目录；不提交运行数据或凭据。
开发环境复用本机已有 Python venv 和 Office 资源；Node 依赖为独立副本，CLI 子模块按提交版本检出。

历史 OAuth 间歇失败与上游慢响应不因本次集成而视为已解决。其他平台、签名安装包与商业支付未在本轮验证。
