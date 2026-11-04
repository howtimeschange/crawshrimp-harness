# Harness managed provider 协查 · 2026-11-04

结论：**现有 managed 文本调用的本地维护候选 ready**。不表示已发布，也不代表主服务最终 Linux 镜像验收完成。主会话已明确 native Apps / Bot 执行联合循环属于延后功能，不是本次维护发布阻断；本项目没有新增或打包这类能力。

## 收尾：主会话最终结论回读

已只读回读主项目 `docs/verification/release-ready-2026-11-04/README.md`：维护候选**本地 ready，未部署**。该页记录最终Linux核心40/40零skip（含SSE clean-incomplete）、实际完整入口三客户端PKCE/refresh/撤销与主锁交接通过；Harness相邻联合回归43/43零skip，旧合成账户补Plus权益，诊断SSE夹具补DONE。详细证据由主项目 `linux-core.tap`、`linux-bootstrap-results.json`、`candidate-manifest.json` 持有；本次仅回读总报告，没有重跑或把这些计入Harness自行执行的测试数量。

主会话确认共享fixture、PG、测试容器及专用Colima均已停止。本Harness协查保持 **ready、五个最终候选原请求全部completed、无本协查在途**；没有继续测试、提交或部署。服务全套仍有121项skip，不能泛化为所有能力验收通过。accounts维护候选不携带Harness客户端部署，后续生产切换仍需主会话按授权执行；延后Apps/Bot范围保持不变。

## 最终候选复验

主会话升级共享fixture后，已重新读取更新后的私有配置，并在 `work/release-ready-20261104/candidate/src` 最终候选上重新执行 `joint-pg.mjs`：**6 pass / 0 fail / 0 skip**（五个实际场景）。该候选包含服务端 SSE clean-incomplete 修复；来源清单为主项目 `work/release-ready-20261104/candidate-source-manifest.json`。本次仍只跑既定 valid-complete / downstream-close 路径，没有改变共享故障模式。

最终又逐一 GET 五个原请求的PG-backed trace：**5 completed、0 in_progress、0 unknown**，原 billing ID 全部一致。本 Harness 复验请求已无在途；没有对其他协查账户/服务的全局在途状态作推断。原ID重复POST均409且每次重复前后上游派发总数不变。证据 `joint-pg.tap` / `joint-pg-results.json` 已更新为这次最终候选结果，不再指向旧fixture运行。

主会话已反馈两项旧desktop/catalog夹具补齐 `plan:plus` 后，其相邻回归 **43/43、零skip**（含installed managed-stream-retry）；这是主会话提供的结果，下面历史62pass/2fail保留为当时调查记录，不再列为未解决项。无需继续验证延后的Apps/Bot。

## 补充：生产基线候选的真实 PostgreSQL 联合验收

主会话随后提供了其独占隔离夹具，仅使用 `crawshrimp-desktop` 分配给 Harness 的合成 owner。已完成 **实际 Harness broker / installed pi-ai → 实际 ModelJetty HTTP 服务（生产基线 + 两文件断连候选）→ loopback 上游 → 实际 PostgreSQL 请求行回查**。不是内存 store，也没有以静态源码断言替代调用。

`joint-pg.mjs` 共 **6 pass / 0 fail / 0 skip**（一个父测试和五个场景）：普通非流式 JSON、正常 SSE、收到 delta 后关闭下游、installed provider 正常完成、installed provider 在 delta 后取消。两次主动断连均在刚取消后读到原请求 `in_progress`，随后只读轮询原 ID 变成 `completed`；`billingRequestId` 始终与原响应头一致。五个场景各只有一次 broker inference fetch；重复原 POST 均返回409，上游控制端只读快照确认派发总数在重复前后完全相同。trace 只有四个白名单字段。

证据：`qa-2026-11-04-managed-provider/joint-pg.tap`、`joint-pg-results.json`；可复跑命令：`HARNESS_JOINT_FIXTURE=<主会话0600私有夹具JSON> node --test docs/crawshrimp-harness/qa-2026-11-04-managed-provider/joint-pg.mjs`。脚本只从私有文件读取凭证到内存和临时0600会话文件，结束删除临时目录；证据不含 token。只 GET 控制端、没有改变全局 mode，没有 refresh/revoke 任意账户，没有停服务或PG。首轮和最终计数增强复跑合计十次合成原请求，真实付费模型调用为零。故障截断/408/409/5xx仍由上面的本地provider回归及主服务自己的故障回归覆盖，没有调整共享上游来重复故障测试。

## 补充：服务侧 SSE 完成合同对齐

主会话通知并在 owning source `account-service/src/inference-relay.mjs` 核对后，broker 已补上 Responses 终止事件必须含非空字符串 `response.id` 的条件；缺失、空值、null、数值 ID 均纳入回归。正常终止仍同时要求完整 SSE 帧和正常 HTTP EOF。重新运行本地回归 **40/40**，当前源码 ModelJetty HTTP 合同 **9/9**，零 skip。

合同差异提醒：broker 是有界终止标记观察器，单行/帧约64KiB之后跳过内容观察，随后仍可识别终止事件；服务端新增 parser 则对 malformed JSON、error/failed/incomplete、终止事件之后的额外 data、EOF残留和超8MiB事件作更严格的 unknown 判定。broker 不独立复刻这些完整结构检查；当前架构中这些响应须先经过更严格服务端，服务端异常关闭会使 broker/provider 报错且不重发。不要将 broker 的标记观察结果单独当作账单状态依据，回查仍以服务端原 request ID 的存储状态为准。

之前共享 PG fixture 尚未加载主会话最新“缺协议终止标记→unknown”修复；它的 valid-complete 联合链证据保持有效，但**不宣称共享PG已验收最新clean_incomplete故障修复**。该故障应由主会话的最终Linux/PG候选验收覆盖。

## 本地修复

1. **P1 · 截断流被误判成功。** 真实 installed pi-ai → broker → loopback HTTP provider 路径中，Chat Completions 收到文本及 `finish_reason: stop`，但连接在 `[DONE]` 前干净 EOF，修复前 runtime 报 `done`。新 broker Transform 在完整 HTTP EOF 时要求完整 SSE 终止事件：Chat 的 `[DONE]`、Responses 的 `response.completed` 且 status=completed、含非空字符串 response.id；不满足则破坏响应、让 provider 返回 error，不重发 POST。修复前反例保存在 `baseline.tap`。观察器按行/帧最多保留约 128 KiB 临时文本，不持久化输出，不 tee、不另读响应，不改变正常数据字节；大内容事件跳过观察后仍可识别后续终止事件。仅用于这两个文本端点，不影响非流式 JSON 或图片路径。
2. **P2 · 原账单身份在 broker 丢失。** 转发已校验的 `X-Oneapi-Request-Id`（1–64 位字母、数字、下划线、连字符），仍由主服务证明其来自原 owner-scoped 存储。broker 保留自己的原 `X-Request-Id`；headers 前失败返回的 409 JSON 也携带 `error.request_id`。
3. **P2 · 408/409/5xx 诊断误标 rejected。** broker 现在归为 unknown；普通明确 4xx 仍 rejected。成功 SSE 只有在完整消费且终止事件满足时才标 completed。
4. **补齐只读回查入口。** 现有账号 action 接受 `run('request-trace', {requestId})`，严格校验 ID 后仅 GET `/account/requests/<id>`，使用当前账户凭证；不重发原付费请求，不恢复输出，不增加模型重试。主服务仍负责 owner/scope 隔离和白名单 DTO。没有新增 UI 或跨账户 journal。

## 重试、超时和关闭审查

- `core/agent/service.py` 的 managed 两种 provider 均明确 `retryPolicy.maxRetries=0`。已通过真实配置生成器、installed pi-ai adapter 与 installed retry plugin 验证，无 retry/retry-started 事件。底层 SDK 调用也由现有 adapter 显式禁用自动重试。
- `core/llm_gateway.py` 对 managed 辅助调用只允许一次传输/输出校验，不自动换模型或计费来源；现有 Python 回归通过。
- broker 每次请求只调用一次 inference fetch，600000ms deadline 不触发重发。实际 provider timeout（测试缩短至40ms）已验证只发生一次上游 POST；没有等待十分钟来模拟 broker 固定 deadline。
- 浏览器/SSE 订阅断开不等于重新发模型请求。provider 取消、delta 后断开、logout 关闭 broker 均已动态验证只有一次 POST；没有将 cancel 改为模型重放。
- broker pipe 的下游取消可关闭对 ModelJetty 的响应读取；主服务本轮修复负责独立读完原上游。真实合同联调确认取消后原请求 completed，真实上游截断则 unknown。
- request ID 由 broker 为每次新的受理生成；它不是自动重试许可。调用方应使用原 ID 做只读回查，不以新 ID 猜测或自动重放未知结果。

## 运行验证与证据

证据目录：[qa-2026-11-04-managed-provider](qa-2026-11-04-managed-provider/)。所有 provider、账户、token 均为本地合成夹具，无真实付费模型、购买、生产读写、commit、push 或部署。未接管主会话独占的 PostgreSQL 55442，也未启动共享数据库/Docker。

| 验证 | 结果 | 实际边界 |
| --- | --- | --- |
| `node --test app/src/managedInferenceStream.test.js app/src/managedAccountInference.test.js app/src/managedDiagnostics.test.js app/src/managedConnectionTiming.test.js` | 40 pass / 0 fail / 0 skip | installed pi-ai 两种协议 → 真实 broker → loopback HTTP 上游；正常完成、408/409/500/502/503、headers 前断连、timeout、delta 后物理截断、干净 EOF、finish-only、取消、logout；SSE 分块/UTF-8/CRLF/多行/大帧与只读回查。见 `local.tap` |
| `HARNESS_ROOT=<Harness> node --test <ModelJetty>/account-service/test/managed-stream-retry.test.mjs` | 1 pass / 0 skip；6 次合成模型 POST | 实际配置生成器、已安装 provider、adapter classifier 和 retry 插件，验证零重试 |
| `MODELJETTY_SERVICE_ROOT=<ModelJetty>/account-service node --test docs/crawshrimp-harness/qa-2026-11-04-managed-provider/service-contract.mjs` | 9 pass / 0 fail / 0 skip | 真正 createService/OIDC AccessToken 认证 → Harness broker → 真正 loopback HTTP 上游；完成、取消、截断、400/403/408/409/500/502；原 request/billing ID、trace DTO 白名单、其他 owner 不能读、duplicate ID不再次派发。使用隔离内存 store，**不声称 PG 持久化验收**。见 `service-contract.tap` |
| `venv/bin/python -m pytest -q tests/test_managed_models.py tests/test_llm_gateway.py` | 36 pass，另4 subtests pass | ephemeral routing 与 managed 辅助调用不重试。见 `python.txt` |
| ModelJetty desktop / OAuth / catalog / retry 相邻合跑 | 62 pass / 2 fail / 0 skip | 两个旧桌面夹具的合成账户未设当前所需模型权益，实际 inference 403，见下文。见 `modeljetty-desktop.tap` |
| 同样新 Harness 回归以 `HEAD:app/src/managedAccount.js` 替换加载 | 2 个叶子反例失败 | finish-only 被当 done；billing header 为 null。仅运行时 loader 替换，不覆盖工作树。见 `baseline.tap` |
| 同两项相邻 desktop/catalog 使用 HEAD broker | 同样 2 fail，40 pass | 确认旧夹具 403 在修复前同样存在。见 `adjacent-baseline.tap` |
| Node syntax / `git diff --check` | 通过 | 仅本地源文件 |

## 主会话待办与非本项目阻断

- **历史问题，主会话已修复并反馈43/43通过：** ModelJetty `test/desktop.test.mjs:16`、`test/catalog-refresh-desktop.test.mjs:14` 初始化合成账户只有 walletEnabled，当前 membership gate 对它们测试的模型要求额外权益，导致分别在 inference 断言期待200处得到403。同一测试文件中也会导入运行 `service.test.mjs`，所以合跑计数包含这些导入测试，不能相加当作独立能力。建议主会话给夹具设置明确 plan/paid access，保留真实 membership gate；Harness 没有修改 ModelJetty 文件，也没有放宽鉴权。
- 原待提供的 PG 持久化 + broker 联合回路现已补齐，见本报告开头；fixtureNeeds 为空。内存 store 合同回归仍保留其原测试边界，不与新增真实 PG 验收混淆。
- 最终不可变 Linux candidate、生产镜像/签名、切换与回滚仍归主会话；本次仅本地修复验证。
- native Apps plugin / app-task-http 联合循环依主会话澄清排除于本轮，不为关闭 skip 引入新功能。

## 变更与并发保护

本次仅修改 `app/src/managedAccount.js`，新增 `managedInferenceStream.js` 及两个相邻测试文件，和本报告/证据。开始时已有 icon 改动、大量未跟踪 QA/设计/CLI 文件，过程中出现其他协作目录变更；均未 stage、恢复、清理或提交。没有修改 ModelJetty 源码。按授权仅额外写入它的 `work/release-ready-20261104/coordination/harness.json` 供主会话读取。
