# 会员分支第一阶段真实 UI 走查 — 2026-10-21

## 范围与结论

对 Harness 与 ModelJetty 的 `codex/modeljetty-membership-sso` 工作区做真实界面走查，保留原有未提交改动。新增修复均为本地代码；没有提交、发布、支付、发额度、注册账号或模型生成请求。此报告不是生产上线或全部风险清零证明。

最初检查指定 browserfix 客户端，观察到非本轮操作导致的重启、模型选择与输入变化后停止操作该实例。后续使用 `.codex-tmp/membership-stage1/会员走查.app`，bundle id `com.crawshrimp.stageoneqa`，空数据目录 `.codex-tmp/membership-stage1/data`，core 18879、renderer 5183。该包装测试 app 显示 v1.0.0，不是产品版本变更。ModelJetty 使用 5174 dev:live。未触碰 /Applications 正式客户端。

## 修复与复测

| ID | 实际问题 | 本轮修复 | 证据/复测 |
| --- | --- | --- | --- |
| UI-01 | 未登录选 Plus，登录后跳到 /console，丢失套餐选择 | AppContext 登录完成时保留当前 /console 路径及参数 | 从退出状态重新选 Plus、登录，URL 保持 view=membership&plan=plus，显示 ¥99/¥120 确认及禁用支付；06 截图 |
| UI-02 | 官方服务已连接，图片/文本设置却显示未配置，官方图片显示接口未填写 | 连接徽标计入官方 provider；官方文本显示账号已连接；官方图片说明无需 Key | 未登录空目录仍显示未配；登录后图片/文本均已配，官方项无需 Key；11、13 截图及原生 AX |
| UI-03 | 市场→设置→返回后常驻 iframe 导航变空白 | 常驻 iframe 不再 display:none/visibility:hidden；设置由不透明覆盖层展示，并以 inert/aria-hidden 禁止后台交互和辅助访问 | 最初 visibility 隐藏修复未解决，已替换；最终生图→设置→返回、市场→设置→返回均导航持续可见；14、15 截图 |
| AUTH-01 | 回调关闭监听后同一连接后续请求访问 server.address().port，产生 null port 未处理异常 | 在监听成功时固定 callbackOrigin，后续请求不读取关闭后的 address | 实际日志记录 TypeError；desktop.test 使用真实 TCP 连接连续发送 callback 与 favicon，验证 200/400；账号回归通过 |

AUTH-01 不等于下面的令牌端点间歇问题已修复。

## 真实 UI 覆盖

- 空目录首次启动欢迎页、BYOK 选择页、其他供应商配置入口、空白 Provider 编辑取消、返回设置与返回工作区。没有保存任何 Key，没有点击连接付费测试。
- 桌面取消 OAuth：等待态退出并恢复登录按钮。浏览器取消授权：客户端显示“登录未完成，请重新发起”。之后欢迎页发起真实 OAuth，既有测试账号确认后自动进入工作区。
- 新登录原生目录读回 19 个文本、3 个图片模型；文本菜单实际展开全部 19 项，切换 GPT-6 Astra 后选中值更新，没有发送消息。
- 图片工作台显示 3 个官方图片模型；切换 Nano Banana 后张数变为禁用的 1，未开始生成、未重试历史失败队列。
- 账号菜单→套餐用量：读取真实 Key 额度，刷新完成后更新时间更新。末次观察可用 ¥95.71、累计 ¥4.29、上限 ¥100；同账号有其他活动，金额是观察时快照，不能归因于本轮。明确显示 Key 额度不等于账户余额及缺少周期重置/按日明细。
- 独立设置页隐藏后台会话导航，返回原市场/生图视图；官方图片与文本设置状态修复见上表。
- 市场发现页实际读到列表；“我的发布”返回该测试账号的空列表，未显示登录错误。未发布、安装、评分或修改市场内容。
- 官网 Plus/Pro/Free 选择、订阅确认、切换、URL 参数保留；Plus ¥99 含 ¥120，Pro ¥299 含 ¥360；Free 一次性 ¥3/7 天。支付和体验领取按钮禁用。无效 plan 显示“未找到该套餐”。
- 注册界面明确显示“平台注册暂未开放”，注册提交禁用。已有账号登录保持原套餐意图。
- 用量记录真实读取、调用明细打开/关闭，展示计费与性能字段；没有导出用户记录。
- 390×844 浏览器视口验证订阅确认及调用详情；确认页 documentWidth=innerWidth=390，无横向溢出。官网套餐另以 390×844 实际页面 iframe 查看（不是 mock，也不是手机硬件实测）。临时视口已重置。

## 验证命令

- Harness `npm run vite:build --prefix app`：通过；现有大 chunk 提示仍在。
- Harness `node --test app/src/renderer/utils/managedUsage.test.mjs`：2 通过。
- ModelJetty `npm run build --prefix web`：通过；现有大 chunk 提示仍在。
- ModelJetty `HARNESS_ROOT=/Users/xingyicheng/Documents/crawshrimp-harness npm test --prefix account-service`：最后运行 19 通过、0 失败、0 跳过，包含连续回调 HTTP 回归。
- ModelJetty web `check:client`、`check:console`、`check:usage`、`check:usage-export`：通过。
- 两仓 `git diff --check`：通过。
- 私有构建/测试日志：Harness `.codex-tmp/membership-stage1/`，ModelJetty `work/membership-20261021/stage1-*`。

## 残留问题和未覆盖项

1. 独立客户端前两次成功确认授权仍以“登录未完成”结束；一次隔离诊断记录 `ResponseBodyError / OAUTH_RESPONSE_BODY_ERROR`。之后新授权成功。没有捕获前两次的具体 error_description，无法证明根因和修复，第二阶段需审查令牌交换、过期/重复回调和并发状态。不得以最终成功覆盖此前失败。诊断只输出错误类型，没有打印令牌。
2. 旧运行态初见只有 3 个文本模型；本轮期间其他活动更新了目录刷新实现及测试。最新独立客户端确认 19+3，但刷新实现不归为本轮新增修复；第二阶段应审查当前完整工作区差异。
3. 没有新增付费生成；历史生文/生图、GPT 桥接修复和 Gemini 工具回放证据见同目录 `modeljetty-onboarding-verification-2026-10-21.md`、`modeljetty-model-regression-2026-10-21.md`、`gemini-tool-failure-2026-10-21.md`。历史 DeepSeek 39 秒延迟未复现，不能声称清零。
4. 新账号公开注册、首次旧账号绑定/迁移、支付、发额度、续费、真实订阅履约、全部模型逐个生成、Windows/Linux/手机硬件、完整安装包签名发布均未验证。本轮不开放这些能力。
5. 市场只覆盖既有测试身份的读取兼容；未覆盖旧 Supabase 身份冲突或新绑定的生产写路径。

## 截图

证据目录：`qa-2026-10-21-membership-stage1/`。主要文件：04 首次启动、06 登录保留套餐、07 拒绝授权、08 成功登录、09 市场账号、10 用量刷新、11/13 官方配置、12 手机套餐、14 返回市场导航、15 生图模型切换；02/03/05 为套餐确认与手机详情。01 为早期用量界面快照，不作为刷新完成证据。

## 第二阶段

第一阶段走查与本地修复已收束，保留上述未解决风险。第二阶段应读取本报告和检查点，使用用户指定的 gpt-6-astra / medium，对两仓整个会员分支全面 code review、修复及回归。会话 ID 创建后记录于检查点及本节。

## 第二阶段交接

已创建独立代码审查聊天 `01a15eb2-7468-7252-b5ae-53336c5a413d`，使用 `gpt-6-astra` / `medium`，继续两个仓库的全面审查、修复与回归。
