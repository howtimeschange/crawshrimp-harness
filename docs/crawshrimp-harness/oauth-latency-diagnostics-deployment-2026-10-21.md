# OAuth / 模型耗时诊断部署验收

用户已明确批准账号服务限定诊断上线及受控客户端加载。此次没有发布正式 Harness、改变 Nginx/New API/sub2api、购买额度、创建凭据、启用支付、发起模型请求或建立后台监控。

## 部署事实

- 新版本：`20261021-diagnostics1`；旧版本：`20261021-review1`。
- 生效：2026-10-21 16:37:19.710 UTC。
- 固定自动截止：2026-10-22 16:37:15.638 UTC；重启不会延长。
- 诊断标签：`bd50f331-c736-406a-8be2-264f3418bb9e`。
- 新镜像 SHA256：`486b98f6aa74aa38f27742f47c8c6e3f26fd94cfdc6290b58f312976d5f7c212`。
- 旧镜像 SHA256：`a444be864652c3b694d5ebcc2262ff34b8d80a7911e80bd2d9a5a3502fc9efc8`。
- 线上容器源码逐文件匹配已测试 manifest。切换前核对 compose、源码、当前版本及在途请求；排空后无 unknown/in_progress。保留数据库备份，不恢复或重放请求。
- 健康正常，checkoutEnabled=false / trialEnabled=false。其他容器 ID、Nginx 文件哈希、前端版本未变化。推理记录计数前后均 completed=90、upstream_rejected=3、validation_only=3。

## 实现与限制

账号服务 `src/service.mjs`、`store.mjs`、`server.mjs` 接入独立诊断模块；客户端 `app/src/managedAccount.js` 接入相同有界写入器及被动连接观测。只接收本次诊断标签和 UUID 请求 ID，限定 token 及文本推理接口。无业务请求重试，观察失败不抛入业务流。

每端仅 events.jsonl、previous.jsonl、state.json 三个文件，合计上限小于 4MiB；单条 1KiB，内存队列 64KiB，120 条/分钟、最多4000条。目录0700/文件0600，拒绝符号链接；写入异常关闭诊断，无 stdout 回退。固定截止时停止并删除诊断文件；正常退出也清理，启动时拒绝过期配置。客户端强制终止或系统断电时无法执行清理，下一次启动会清理过期文件；采集权限不会延长。服务器文件位于现有 /tmp tmpfs，容器移除时消失。

白名单只有时间、随机关联 ID、固定路由/阶段/状态/错误枚举、耗时和上游关联 ID 的截断哈希。禁止 token、code、verifier、state、Cookie、Authorization、账号标识、IP、原始 URL/头/body、对话正文及任意异常字符串。解析 SSE 仅在内存有界观察首个可见文本事件，不落正文。

可区分 OAuth HTTP400 的已知拒绝类别（code不存在/过期/已用、redirect或PKCE不匹配等；无法分类为other），以及客户端认证/正文/连接、账号服务池等待/锁等待/准入、上游响应头/首字节/首文本阶段。连接观测只提供可信的合并建连耗时或复用标记，不能拆分全部 DNS/TCP/TLS；供应商内部队列仍不可见。跨机器时钟存在偏差，按请求 ID 关联并使用各端单调耗时，禁止直接相减墙钟时间。

## 可复现验证与线上证据

证据目录：`.codex-tmp/dont-stop/oauth-latency-20261021/rollout/`。

- `gate-final.log`：62项通过，0失败/跳过，含真实本地 OAuth400、错误映射、并发隔离、连接复用、正文/SSE观测、失败不重试、PostgreSQL准入并发回归。
- `electron-tests.log`：实际 Electron Runtime 的16项诊断测试通过；之后额外标签隔离测试通过（`campaign-test.log`，10项）。
- `image-smoke.log`：实际发布镜像在无网络/无凭据隔离容器中验证截止自动清理、主动关闭及敏感字段过滤。
- `performance-final.json`：同一内存SSE夹具40组预热后配对样本，P95增量0.139ms，RSS增量约2.55MiB。此为本地诊断开销，不是线上模型延迟保证。
- `activate.log`：切换、健康及状态计数核验；`source-manifest.json` 为线上源码比对基准。
- 受控客户端 `会员走查.app` 已加载本次标签/固定期限，移除了原临时无界 console 捕获。界面确认个人账号、核心运行、发送按钮禁用，没有发送消息。
- 2026-10-21 16:40:37 UTC 正常启动会话刷新：请求 `3cdadf70-6d84-436a-958b-a82deac53293`，客户端 HTTP200 / JSON / reused / headers274ms / body完成275ms；服务端同请求 HTTP200 / completed / 101ms。双方 dropped=0，服务端文件0600。证据无需包含凭据或账号内容。

本地复现命令（PostgreSQL仅为独立临时测试库，不接生产）：

```sh
TEST_ACCOUNT_DATABASE_URL=postgres://postgres@127.0.0.1:55439/membership_review CRAWSHRIMP_MANAGED_TIMINGS=1 HARNESS_ROOT="$PWD" node --test app/src/managedDiagnostics.test.js app/src/boundedDiagnostics.test.js app/src/managedConnectionTiming.test.js app/src/accountAuth.test.js .codex-tmp/dont-stop/oauth-latency-20261021/rollout/test/*.test.mjs
```

## 关闭和回滚

- 立即停止当前账号服务诊断：`docker kill --signal=SIGUSR2 accounts-account-service-1`。该信号由线上 server.mjs 的 handler 处理，仅关闭/清理诊断，不停止业务。关闭逻辑已在实际镜像隔离测试；未为测试而关闭线上本次采集。进程重启在截止前会重新按配置采集；若要求跨重启永久关闭，应移除 diagnostics.env 中两个非敏感开关并在无在途请求时重建账号容器。
- 客户端关闭受控 app 会清理；若要保持禁用，移除该 QA wrapper 的两个 HARNESS_DIAGNOSTICS 环境变量再启动。正式客户端未改配置。
- 手动回滚脚本：`/var/backups/modeljetty/20261021-diagnostics1/rollback.py`，执行 `python3` 加该路径。已语法验证，旧镜像/compose/旧release存在；未实际回滚健康生产。
- 脚本先检查当前版本、compose哈希及无在途/不确定请求，排空后恢复旧compose和current链接，仅重建account-service。任何并发变更或不确定请求均停止待人工核查。数据库不恢复、不删除、不重放。
- 备份目录含 `compose.before.yaml`、旧image/release标记、操作状态及受保护的 `accounts-before.dump`；数据库备份只留服务器，不下载或展示。

## 下一次自然复现

在上述固定期限内正常使用受控客户端。出现问题时先记 UTC 时间和客户端诊断 requestId；用标签+requestId 匹配账号容器 `/tmp/harness-diagnostics/` 与客户端 `.codex-tmp/membership-stage1/user-data/account/diagnostics/`。上游已有ID经相同 SHA256 前32hex匹配现有上游日志，无法匹配时明确标为缺证。正常样本与异常/慢样本齐备可自动提前停止采集；不重放计费请求，不新增后台任务。

诊断上线通过不等于历史故障修复。历史两次 token400 缺原始拒绝原因；Luna首次存在重试等待但首次失败原因未证实；Tiered剩余延迟仍无历史分段证据。等待自然复现是外部证据缺口，不是测试失败或权限拒绝。
