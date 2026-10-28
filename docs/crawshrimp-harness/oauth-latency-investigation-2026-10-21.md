# OAuth 偶发错误与模型慢响应排查（2026-10-21）

## 结论与验收状态

**部分完成，历史故障根因仍未证实，不按“已修复”验收。** 本轮修复客户端的诊断缺口，验证错误分类和无自动重试边界；获用户后续批准后，已完成真实刷新及重新联合登录。没有通过再次成功登录或快速返回来宣称历史故障消失。

工作分支 `codex/modeljetty-membership-sso` 已有大量未提交修改；本轮保留它们，仅修改 `app/src/managedAccount.js`，新增 `managedDiagnostics.js`、对应测试及本文；另更新 ignored 的隔离测试 app 包装入口以启用诊断。未修改独立 `dsh-runtime-v021`，未部署、发布、提交、购买额度、新建凭据或扩大权限。Harness 根及祖先未找到适用 AGENTS.md；已阅读 ModelJetty AGENTS.md 和 dont-stop 技能。

## 根因证据与边界

1. 本机 `oauth4webapi` 的 `checkOAuthBodyError` 在 HTTP 状态不符合预期、响应为包含 OAuth error 的 JSON 时抛出 `OAUTH_RESPONSE_BODY_ERROR`。因此这个码本身不是 DNS/TLS 故障，也不等于 JSON 解析失败。真实 OIDC 库本地夹具已复现 `400 invalid_grant` 同码；这**不能证明**历史两次也是 invalid_grant。旧记录最初没有保留这两次的完整状态、错误原因和关联 ID，本轮读取的 stage1/stage2 runtime 日志也没有可匹配的该错误记录。
2. 原 DeepSeek 39 秒记录的既有报告显示上游处理约 1 秒、首响应 371ms，范围在上游到达前；仍不能把差额归因于某个特定客户端、凭证刷新、DNS、TLS 或代理队列。
3. 原 UI 证据再次核对：Luna 总耗时 15703ms、Tiered 13482ms；复测和独立链路明显更快。原数据缺少同时覆盖 UI 调度、broker、服务端准入与上游首 token 的统一关联，不能证明冷启动或上游排队。
4. 当前公开 discovery 探测于 `2026-10-21T15:53:33.904924Z`：HTTP 200、JSON；curl 累计 DNS 0.000079s、connect 0.000351s、appconnect 1.258841s、首响应 1.931496s、总 1.931628s。**环境存在代理**，这些数值只说明本次 curl 路径，不能用于推断历史故障或 Electron 的 DNS/TLS。最初沙箱网络探测退出 7；获得执行许可后的只读探测成功，没有绕过服务端认证。

## 本轮变更

- OIDC discovery/token/refresh 使用可注入的同一 fetch 包装器，补齐此前 OAuth 请求不经过现有 fetcher 的可测性缺口。
- OAuth 失败记录时间、生成的请求 ID、固定路由类别、HTTP 状态、允许的响应类型、允许的 OAuth 错误枚举及 `error/error_description/error_uri` 字段的类型。绝不记录字段值、任意字段名、URL 查询、响应 body、Cookie、Authorization、code、token、提示词或输出。
- `CRAWSHRIMP_MANAGED_TIMINGS=1` 时，新增 `[managed-network-timing]`，记录 headersMs、firstByteMs、totalMs、消费/中断/取消状态和允许的传输错误码。原 `[managed-inference-timing]` 的请求 ID、authMs、bodyReadMs 保持，可按同一 ID 关联。
- 观察实际被消费的流，不 clone/tee 全量响应，不缓冲内容、不增加重试或更改超时。诊断关闭时保持原 Response 对象；开启时返回同字节流的 Response。日志接收器异常不改变正常请求结果。
- 首字节并非首 token；后续新增有界 SSE 观察：Responses `response.output_text.delta` 与 Chat Completions `delta.content` 的首段可见文字记录 firstTextMs，不把心跳、元数据、推理或工具事件算作文字。未观察到文字或达到 64KiB 检查上限会明确标记，最多保留 16K 字符不完整帧，不保存/输出文本。它仍不是 tokenizer 级逐 token 计时。headersMs 包含网络及远端等待，**没有虚构成功请求的 DNS/TLS、服务端排队或上游推理分段**。本地生成的 ID 需要服务端同时保存才能实现跨端闭环，本轮没有部署服务端日志变更。

## 可复现验证

以下命令在仓库根执行。需要 127.0.0.1 回调端口的测试已获执行许可；最初沙箱 EPERM 属环境限制，放行本地端口后通过。

```sh
node --test app/src/managedDiagnostics.test.js app/src/accountAuth.test.js
```

19 通过、0 失败、0 跳过。覆盖延迟响应头、延迟 body、DNS/连接错误分类、流中断、取消、日志脱敏、关闭诊断保持响应对象、日志接收器异常，以及真实 OIDC 库 `400 JSON invalid_grant` / `502 HTML` 各一次交换。

```sh
CRAWSHRIMP_MANAGED_TIMINGS=1 HARNESS_ROOT="$PWD" node --test \
  /Users/xingyicheng/Documents/ChatGPT/中转/account-service/test/desktop-oauth-errors.test.mjs \
  /Users/xingyicheng/Documents/ChatGPT/中转/account-service/test/desktop.test.mjs \
  /Users/xingyicheng/Documents/ChatGPT/中转/account-service/test/catalog-refresh-desktop.test.mjs \
  /Users/xingyicheng/Documents/ChatGPT/中转/account-service/test/managed-stream-retry.test.mjs
```

13 通过、0 失败、0 跳过。诊断关闭时同组也 13 通过。使用本地模拟 OAuth/账号/模型，不产生付费调用。验证回调登录、取消/迟到响应边界、目录刷新、未知结果 409、缺失/中断流不重放。最后一次小改动仅补充非 JSON 错误的诊断元数据，由新增真实 OIDC 502 测试覆盖。

`node --check app/src/managedAccount.js`、`git diff --check` 通过。未重打包或替换正式客户端；后续已在既有隔离 Electron 包装 app 中通过真实 OAuth，详见下节。SSE 首段文字扩展只做本地夹具验证，没有新的付费模型调用。

## 后续授权后的真实验收与历史关联

用户在主聊天明确允许“受控测试客户端使用现有账号重新联合登录”。先核查无在途任务/登录，再关闭并启动原 `会员走查.app`；测试用 renderer 5183 已停止，重启本地 Vite 后恢复。一次无窗口启动进程经 PID 核对后停止并从终端启动以捕获日志，没有操作正式客户端。隔离 backend 的旧端口占用按既有机制切换，登录后出现一次 session follow 1006 随后自行恢复；未将它冒称为历史慢响应根因，也未修改独立 Python 工作树。

- 2026-10-21 16:03:45 UTC：真实 discovery 200，1242ms；既有会话刷新 token 200，340ms；账号与目录均 200，各约 257ms。
- 16:06:47.789 UTC 发起授权码交换，requestId `c7645d45-20e5-4b0d-a9e5-90c931a11fe4`：headers 856ms、首字节 857ms、完成 858ms，HTTP 200 JSON。后续账号 238ms、目录 235ms，均 200。
- 浏览器仅确认一次授权；原生 UI 恢复已登录、核心服务运行中，模型菜单可见 19 个官方文本模型。没有读取或导出会话凭据；没有发起模型请求、付款或部署。
- 本次捕获 OAuth 失败数 0，模型请求数 0。成功只验证本次流程和诊断，不证明历史间歇故障已经消除。
- 新 SSE 观察补齐后最终合并回归 **34 pass / 0 fail / 0 skip**，日志 `final-regression.log`。是在上述 19+13 测试上增加 2 项首段文字测试，覆盖心跳先到、拆帧、CRLF、超限和不含文本的流；无自动重试边界仍通过。

历史服务端只读检查使用既有 SSH 认证机制，未查看或传输凭据内容、未修改服务器：

- Nginx 当天 token 端点共有 32 次 200、2 次 400。两次 400 时间为 **12:44:47、12:51:26 UTC**，与历史授权时间窗吻合，是目前最强候选；普通 access log 没有客户端 requestId 或 OAuth body，不能进一步证明具体 `invalid_grant`、redirect mismatch、PKCE、过期或重复使用原因。
- Nginx 12:30:44、12:35:35、12:55:27、13:04:07 的模型接口均 200，与下表结束时间一致。12:30:29–34 首次失败窗口没有模型接口的完成记录；这不证明请求绝未到达其他边缘/代理层。
- 配置仅 `access_log /var/log/nginx/access.log;`，没有额外 request_time / upstream_response_time / requestId。本轮没有变更日志配置或部署。

| 样本 | 客户端 TTFT / 总耗时 | 客户端重试证据 | New API 候选 FRT / use_time |
| --- | --- | --- | --- |
| Luna 初次，turn 6，12:30:29.123 起 | 15593 / 15703ms | +5045ms `llm/retry`，+5501ms `llm/retry-started` | 1401ms / 2s |
| Luna 复测，turn 9，12:55:23.610 起 | 4313 / 4385ms | 无 | 1612ms / 2s |
| Tiered 初次，turn 6，12:35:22.461 起 | 13481 / 13482ms | 无 | 2370ms / 2s |
| Tiered 复测，turn 12，13:04:02.141 起 | 5391 / 5448ms | 无 | 3360ms / 3s |

每行按模型名、精确输入/输出 token 数和完成时间窗各匹配到一个 New API 候选；导出没有共享 requestId，所以明确标为候选。已查本地 New API 源码：`created_at` 是记录消费日志时的当前时间，不是接收时间；`use_time` 用 Unix 秒差计算，`frt` 是 FirstResponseTime−StartTime。不能把这些指标直接相减当作精确 DNS 或 TLS 耗时。

**已证实的延迟贡献**：Luna 初次等待包含一次失败尝试与约 456ms 重试等待，累计到第二次开始为 5501ms；这不是纯模型推理慢。既有官方两个 provider 的禁重试修复已经存在，本轮回归继续验证其边界，没有重新引入重放。首次失败的网络/应用原因和剩余等待仍缺证。Tiered 没有重试事件，不能套用 Luna 的解释。

## 诊断覆盖与剩余边界

| 阶段 | 目前证据 |
| --- | --- |
| 客户端请求前/凭证刷新 | 既有 broker bodyReadMs/authMs；真实刷新已验证 |
| DNS/TCP/TLS 成功分段 | **未覆盖于 Electron 请求**；只分类已知传输错误码，curl 代理探测不能替代 |
| 等待 HTTP 响应头 | headersMs，包含网络、远端准入与上游等待，不能继续拆分 |
| 首字节、首段模型文字 | firstByteMs；SSE 支持格式 firstTextMs，超限/不支持不伪造结果 |
| 正文完成、中断、取消 | totalMs 与 consumed/body-error/cancelled；按原流消费，不自动重试 |
| 账号服务队列/上游首响应 | 历史候选 New API FRT；缺少同 ID 的账号服务分段记录 |

重新登录许可阻塞已解除，真实验收已完成。**当前阻塞为历史观测信息缺失，不是等待用户再次登录确认，也没有被拒绝的操作或未知在途请求。** 所有不依赖新付费请求/生产变更的独立工作已完成。

继续定位需要故障自然复现时保留 UI dispatch、broker requestId/authMs/headersMs/firstByteMs/firstTextMs，再取得服务端同 ID 的接收、准入和上游首响应时间；若需新增生产日志配置或代码部署，另行授权。本轮没有批量试模型来替代观测，也不安排无人值守调用。

证据与续接状态：`.codex-tmp/dont-stop/oauth-latency-20261021/`。新增 `historical-correlation.json`、`server-window.json`、`server-oauth-history.json`、`live-diagnostics.jsonl`、私有原生成功截图 `live-login.png` 和 `final-regression.log`。原始源文件保持原位并记录哈希。checkpoint 当前为 blocked_external_evidence，不能把会话结束当作历史故障已修复。
