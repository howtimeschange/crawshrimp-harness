# 会员第二阶段代码审查与回归 — 2026-10-21

> 后续补修：本报告下方列出的图片并发、代理限流和进程内计数缺口已完成本地修复。Pro 图片并发按当前 plans.json 为 2、总并发 3。以 ModelJetty `docs/verification/membership-admission-review-2026-10-21.md` 的 30 项回归与共享 PostgreSQL 约束为最新结论，未部署生产。历史 OAuth/DeepSeek 事件仍不虚报根因。

两仓当前分支均为 `codex/modeljetty-membership-sso`。审查以实际工作区（含未跟踪源码）为准，保留第一阶段及并发模型目录/防重试修改。没有 commit、push、部署、付款、发额度、公开注册、市场写入或新增付费模型调用。此报告是本地审查交付，不是上线批准或零风险声明。

## 本轮修复

| ID | 问题及影响 | 修复与证据 |
|---|---|---|
| S2-A1 | login 在 discovery await 前没有互斥；两个并发调用可打开两个浏览器并互相作废 | 同步启动锁；本地真实 OAuth HTTP 测试并发发起两次，只有一次成功、一次打开浏览器 |
| S2-A2 | callback 收到后立即清空 pending，令牌交换/资料加载中可重启登录；取消时迟到 hydrate 可留下本机登录态 | 保留交换等待态；取消清除本机 session/profile/broker；generation 校验监听启动、URL 创建及成功消息。延迟 `/account/me`，验证拒绝重复登录、取消后无 user/descriptor/成功提示，再发起新登录成功 |
| S2-A3 | refresh/hydrate 共享 Promise 跨 generation，旧操作 finally 可清掉新操作引用；刷新还读取可变化的 session | 切换时分离在途引用，finally 仅清自身操作；刷新捕获原会话。目录并发/登出晚响应回归仍通过 |
| S2-A4 | logout 忽略非 2xx 撤销响应；原“最多 10 分钟失效”忽略有效 refresh token | 检查 HTTP 状态，显示“云端会话未确认撤销”；503 注入后仍确认本地已退出且提示不误报 |
| S2-P1 | Python 调用省略 model_id、最终路由为官方模型时，字符串前缀判断漏掉防重试；视频文案输出校验可另发付费请求 | 按最终 route.model_id 阻止重试/后续 fallback，官方视频文案限制一次校验尝试；覆盖 JSON、文本、视频传输错误和非法输出，每种只调用一次 |

本轮修改产品源码仅 `app/src/managedAccount.js`、`core/llm_gateway.py`；回归补充 `tests/test_managed_models.py` 与 ModelJetty `account-service/test/desktop.test.mjs`。其余已有产品改动是审查对象，不归为本轮新增。

## 审查覆盖及结论

- Electron：issuer HTTPS/loopback 限制、PKCE/state/nonce、公有客户端、加密存储、刷新与取消/退出、固定 callbackOrigin、host/path/state 校验、broker 能力令牌与 Origin 拒绝、流转发和未知结果不重发。第一阶段 pipelined callback/favicon 回归保留。
- 目录：`refreshCatalog` 60 秒 TTL、并发合并、更新保留 broker 地址/令牌、目录不变不写盘、失败保留旧目录、退出晚响应隔离。Python 托管描述文件限制 loopback/权限，不进入持久 BYOK 配置；公开设置去除本机能力令牌。
- 服务端：OIDC provider/存储适配、账号绑定、上游 Key 作为单一计费权威、请求 ID 防重放、模型/协议白名单、现有额度与人民币汇率来源、市场身份映射/普通 JWT/RLS、授权 origin 检查、checkout fail-closed。未执行部署脚本或数据库迁移。
- 前端：App.vue 常驻 iframe 的 inert/aria-hidden 与覆盖层；文本/图片托管状态、隐藏编辑入口、BYOK 保存时排除托管配置；首次引导、账号/用量事件；AppContext `/console` 查询参数保留；官网套餐与订阅确认读取共享定义、支付/体验领取禁用，区分账户余额、Key 上限和未来套餐权益。
- 并发防重试改动：DSH managed provider maxRetries=0、图像自动重试限制、broker 未知结果 409；账户服务测试包含真实安装适配器的断流/502/部分输出故障注入，不访问真实模型。Python 默认路由漏洞见 S2-P1。

## 验证

- `HARNESS_ROOT=/Users/xingyicheng/Documents/crawshrimp-harness npm test --prefix account-service`：19 通过，0 失败/跳过。最终日志：ModelJetty `work/membership-20261021/stage2-account.log`。
- `CRAWSHRIMP_DATA=/tmp/crawshrimp-stage2-tests venv/bin/python -m pytest tests/test_managed_models.py tests/test_modeljetty_integration.py tests/test_llm_gateway.py tests/test_image_providers.py -q`：76 通过，4 subtests 通过。
- Node managedUsage/市场 identity：4 通过；dialogAccessibility：3 通过。
- Harness `npm run vite:build --prefix app`、ModelJetty `npm run build --prefix web`：通过，现有 chunk 大小告警仍在。
- ModelJetty `check:client`、`check:console`、`check:usage`、`check:usage-export`：通过；JS 语法和两仓 `git diff --check` 通过。
- 原生：仅重启 `com.crawshrimp.stageoneqa` 隔离实例，恢复既有账号与 managed-gpt-6-astra 选择；真实读取 Key 额度，设置返回后导航仍可用。21:49:57（上海）快照为可用 ¥95.70、累计 ¥4.30、上限 ¥100，不归因于本轮消费。辅助访问证据 `.codex-tmp/membership-stage2/native-usage.txt`。没有发送消息或生成图片。最终取消/启动边界修复后再次重启并确认账号恢复，见 `.codex-tmp/membership-stage2/native-final.txt`。
- 测试过程自纠正：系统 Python 缺 mcp，换仓库 venv 后通过；延迟资料 fixture 初版等待被自身 gate 阻塞，改为先检查重复登录拒绝再取消/放行后通过。macOS 直接启动测试包装 app 无窗口，使用其原有显式入口参数启动成功。未修改正式客户端。

## 尚未闭合的风险

1. **历史 OAUTH_RESPONSE_BODY_ERROR 未定位。** openid-client 的该类型表示 OAuth 错误响应，不等同于通用断网。第一阶段没有保留具体 OAuth error；本地成功与上述竞态修复均不能证明它们就是历史原因。现新增只含错误 code 和 allowlist reason 的诊断，不记录响应正文、令牌或个人资料；没有自动重试 code exchange。下一次自然失败应使用该诊断与服务端关联调查。本轮没有重新做生产网页登录故障复现。
2. **历史 DeepSeek 39 秒未解决。** 原记录显示延迟主要在模型服务前，但没有同请求分段追踪。并发报告 `ModelJetty/docs/verification/harness-latency-e2e-2026-10-21.md` 的 Luna 重试修复与有限模型样本不构成 DeepSeek 因果证明。继续使用现有默认关闭的 broker 分段计时；本轮不新增付费复现。
3. **商业权益仍是预览。** 未实现/验证支付、赠额隔离、月度周期、到期/续费履约；实际调用仍依赖既有 Key。服务端当前总并发为 free/plus 1、pro 3，未单独执行未来套餐的图片并发 1 约束；售卖前必须补齐。部署初始化脚本设置既有账户 enrollment 开启，不能直接执行并假定仍为仅预绑定测试账号。此轮未核实或改变线上开关。
4. 账号服务登录尝试限流按 socket remoteAddress 计数，当前反向代理下会共享 loopback 桶（12 次/分钟）；多用户上线前须设计可信代理客户端地址与账号级限流。请求并发计数为进程内；多实例部署尚未验证。
5. 原生本轮验证的是会话恢复、额度读取与导航；最新取消/重入及撤销失败边界以隔离 HTTP 故障注入为证据，未在生产人为制造故障。公开注册、首次账户绑定、旧市场身份冲突、Windows/Linux、手机硬件、安装包签名不在本轮通过项内。

## 交接

第二阶段本地审查/修复/回归已交付，保留上述风险。checkpoint 位于 `.codex-tmp/dont-stop/modeljetty-membership/checkpoint.json`，`followup_review.stage2` 保存本轮状态与证据。下一步是自然 OAuth 失败的关联诊断和售卖前权益/并发/限流设计；未经另行授权不部署或进行付费复现。
