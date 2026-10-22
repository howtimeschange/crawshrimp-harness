# 最小诊断审批方案（仅准备，未实施）

目标：在下一次自然出现的 OAuth 400 或 Tiered 慢请求中，区分客户端连接、账号服务准入、远端首响应/首段文字。历史原因不能靠部署补回。本方案不产生测试模型请求，不设置后台轮询或第三方遥测。

## 已有能力：复用，不重复部署

2026-10-21 16:16 UTC 只读核查：生产账号服务仍为 `20261021-review1`；`service.mjs/server.mjs/store.mjs` 三文件 SHA-256 均与本地一致。证据：`.codex-tmp/dont-stop/oauth-latency-20261021/existing-production-diagnostics.json`。

| 位置 | 已确认可复用 | 当前不足 |
| --- | --- | --- |
| Harness 本地源码 | 请求 UUID；OAuth 状态/错误枚举；authMs、headersMs、首字节、正文终态；有界 SSE 首段文字观察 | 正式发行客户端未包含本轮改动；成功连接耗时未拆出；当前输出器没有本方案的容量/保留策略 |
| 生产账号服务 | 转发并回显推理 X-Request-Id；持久化请求状态；并发准入代码 | 不记录 OAuth 内部原因、准入和上游分段；最近 500 条日志未见这些字段；Docker json-file 无显式大小上限 |
| Nginx | 时间、路径、HTTP 状态；已找到两次 token 400 | 现为普通 access.log，没有 requestId/request_time/upstream_response_time |
| New API | 原生产消费日志有 use_time、frt；本地上游代码有独立 X-Oneapi-Request-Id 与 request_id/upstream_request_id | 既有脱敏导出未保留 ID，当前生产 ID 完整性尚未验证；不可假设它沿用客户端 UUID |
| sub2api | 现有日志最近 500 行已看到 request_id、latency_ms；现有日志 10MiB×3 上限 | 本次未确认逐请求排队时长；本地上游源码有 Gemini 用户/账号等待逻辑，但本地 checkout 不等于当前生产镜像 |

**第一阶段不改 Nginx、New API、sub2api，不做 schema 迁移。** 先复用既有 New API FRT/use_time 与 sub2api ID/总耗时，避免为了已有指标重复上线。既有日志的保留配置不在此次改动范围。

## 拟批准范围：一个服务小版本 + 一台受控客户端

### A. ModelJetty 账号服务（需要单独批准上线）

代码位置：`account-service/src/service.mjs`、`store.mjs`、`server.mjs`，新增独立 `diagnostics.mjs` 及本地测试。

1. `service.mjs`：仅在 `/oidc/token`、已有文本推理路由增加固定字段记录；用临时随机 campaign UUID（关联标签，不是凭据）限定本次受控客户端。服务端只接收与诊断配置相同的 `X-Harness-Diagnostic-Run`，它绝不参与授权、限流或模型权限判断。其他用户请求不增加诊断记录，标签不转发给上游模型。监听 oidc-provider 的 `grant.error` / `server_error`，根据锁定版本已知错误描述**精确匹配后只输出固定枚举**：`code_not_found`、`code_expired`、`code_consumed`、`redirect_mismatch`、`pkce_failed`、`client_mismatch`、`refresh_invalid`、`other`。不输出描述原文，不解析/保存 token 请求体，不补查授权码或凭据数据库。OAuth 的 coarse error 同时记录；未匹配原因必须为 other。
2. 请求入口、上游响应头、流结束/中断三个阶段最多各一条。测量 authMs、bodyReadMs、admissionMs、upstreamHeadersMs、upstreamFirstByteMs、upstreamFirstTextMs、totalMs 和固定终态。
3. `store.mjs`：只加可选计时回调，分别测 poolAcquireMs、advisoryLockWaitMs、admissionQueryMs。当前准入超限是立即 429，并没有账号服务的模型作业队列；不能把 admissionMs 全称为“模型排队”。不改事务、锁、去重或超限行为。
4. 记录关联映射：客户端 UUID → 本次账号服务事件 → New API 响应的 `X-Oneapi-Request-Id` 指纹；若出现 `X-Upstream-Request-Id` 也只记指纹。后续在授权只读查询中对已有服务端 ID 用同一 SHA-256 截断128位算法比较。上游 ID 缺失时记录 missing，不改上游部署来强行补齐。本地测试先验证实际 header 名和映射，不以本地源码推断生产已有字段。
5. `server.mjs` 接入默认关闭的输出器。沿用容器既有 `/tmp` tmpfs，在 `/tmp/harness-diagnostics/` 写独立诊断文件，不往无上限的 Docker stdout 增加逐请求日志；不增加挂载、端口、凭据或权限。部署只滚动/重启该单实例账号服务，可能有短暂维护窗口，不能承诺零停机。上线前先做本地模拟回归及备份，确认无在途未知推理后执行。

### B. Harness 受控客户端（本地加载；不等于发布 Harness）

沿用 `app/src/managedAccount.js`、`managedDiagnostics.js`。现有 OAuth/正文/SSE 诊断已完成本地回归与真实 OAuth 验证；另外拟增加：

- 与服务端相同的有界本地输出器；只在受控测试 app 启用。同一个 campaign UUID 仅随发往已配置 ModelJetty origin 的目标请求传递，不写入授权URL，也不发给其他域名。普通安装包若需要使用，必须另行构建、发行，不能称本地源码已经覆盖所有用户。
- 通过**当前 Electron/Node 实际支持的只读网络诊断事件**关联该请求的新连接总耗时、请求发送点与连接复用状态。先用本地夹具证明并发请求不会串线，不替换 dispatcher/代理/DNS/TLS 配置，不开启 NetLog 全量抓包或 DEBUG。
- 只读事件若只能给出“DNS+TCP+TLS 合计”，就记 connectionMs；连接复用记 reused，不伪造 dnsMs/tlsMs。若当前版本不能可靠关联，则标 unavailable，第一阶段不得宣称已拆出连接耗时。
- SSE firstTextMs 表示首段可见文字，排除心跳和元数据；检查64KiB后停止、最多保留16K字符不完整帧，始终不保存文字。不支持/达到上限明确标记。零新增自动重试。

现有受控 app 已登录。本地加载新版只重启该隔离实例，不主动退出或重新授权；若正常刷新失败，先核实结果，不重放未知交换。此方案不附带新的付费验证。

## 固定字段、禁记字段与保留

允许：UTC 时间、单调时钟相对毫秒、服务版本、campaign UUID、客户端请求 UUID、上游 ID 指纹、固定路由类别、目录内模型枚举（仅文本）、HTTP 状态、允许的 content-type、授权码/刷新 grant 类别、OAuth 固定原因枚举、已知传输错误码、上述阶段耗时、连接复用/缺测标记、成功/拒绝/中断/取消终态、日志丢弃计数。

**禁止**：Authorization、Cookie/Set-Cookie、code/state/nonce/PKCE、access/refresh/id token、Key、密码、请求/响应 body、提示词/模型输出/工具参数、任意 URL 或 query、原始 headers、IP、邮箱/姓名/账号ID、余额/账单、任意 exception message/stack/error_description。不以“调试需要”打开第三方库 DEBUG。日志字段采用白名单构造，不做整对象序列化后再删字段。

拟定硬限制（客户端/账号服务各自独立）：

- 默认关闭；显式 `HARNESS_DIAGNOSTICS_UNTIL=<UTC>`，最远24小时，启动校验拒绝超限；不得滚动延长。仅记录固定路由，最多3条/请求，每条≤1KiB。
- 异步内存队列≤64KiB；当前文件2MiB+轮转文件2MiB，总≤4MiB，文件0600/目录0700；每分钟最多120条，累计最多4000条。满额停止记录，不阻塞、不拒绝、不重试业务请求，标记覆盖缺口。
- 到期关闭并删除**本轮新增诊断文件**，依靠进程内一次性到期清理，不创建 cron、监控任务或外部轮询；重启时先检查旧文件到期。账号服务 tmpfs 重启会丢失记录，需在获准只读取证时提前导出脱敏文件；导出副本同样24小时保留，不自动上传。
- 写失败/背压即停诊断，保留固定丢弃计数，不回退到无限 stdout，也不改变业务结果。关闭开关立即停止新记录；不删除既有业务日志。

## 可区分的原因与不能承诺的部分

- **OAuth 400**：客户端 ID、状态/格式 + 服务端固定内部原因，能区分 provider 实际报告的过期、已消费、redirect不符、PKCE不符等；若存储已清理过期记录，provider 只报告 code_not_found，则不能进一步推断是过期还是从未存在；未知原因仍 other。返回HTML/边缘拒绝、未到账号服务的请求不会误报成 invalid_grant。不会为诊断强制兑换旧 code。
- **Tiered**：客户端连接耗时（可用时）、账号服务入口与认证、DB池/锁/准入、上游headers/首字节/首段文字能分别对比。客户端先收到心跳而文字迟到，与连不上服务、准入耗时高会呈现不同记录。
- **仍有限制**：New API FRT含其内部等待和上游首响应，sub2api总耗时不能证明其排队长度；供应商内部排队和推理也不可直接区分。若证据把慢点定位到 sub2api 内部，才另提第二阶段针对用户槽/账号槽等待和发往供应商时间的最小补丁，**不包含在本次上线授权内**。成功 DNS/TCP/TLS 细分也不在首阶段承诺范围。
- 时钟跨机器可能有偏差；用同请求 ID和每跳单调时钟持续时间，不把客户端与服务器绝对时间直接相减当精确网络耗时。

## 性能门槛、观察与回滚

预期成本：每请求少量时钟读取及至多3条小JSON；启用SSE观察只检查前64KiB，不 clone/tee 全流，不改变背压/重试/超时。性能尚未实测，不能宣称零开销。实施前本地模拟压测门槛：诊断开/关同夹具 p95额外延迟≤5ms，稳定RSS增量≤8MiB，取消/中断/日志盘满/格式异常/并发关联测试全部通过；未满足不得部署。

观察仅由正常登录/刷新及用户自行发起的模型请求触发，不安排探测或新增付费调用。慢点阈值：首段文字>10秒（没有文字时按headers/total>10秒），OAuth 任意非2xx作为事件候选。首次得到一个完整失败/慢请求及一个自然正常对照后停止；或24小时/4000条/容量上限任一先到即停止。遇业务延迟/错误率异常、敏感字段或关联串线，立即关闭，不继续收集凑样本。

回滚先关闭诊断开关；需要回退代码时，在核实无在途未知请求后恢复上一账号服务镜像。无schema/业务状态迁移，不恢复旧数据库或重放请求。客户端关闭诊断并恢复隔离包装入口；正式客户端不受影响。现有新旧账号服务发布备份流程沿用，不在本次方案中执行。

**建议用户批准的具体范围**：实现并本地验证以上A/B；通过门槛后，只上线账号服务诊断小版本并在现有隔离客户端加载，按正常流量观察最多24小时。不修改Nginx/New API/sub2api、不发布Harness、不新增模型调用、不引入第三方遥测。本文件仅方案，当前未执行这些实施/上线/观察动作。
