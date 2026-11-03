# Free 赠金账号登录、兑换与模型热更新实测 — 2026-11-03

本轮按用户明确授权，启动隔离开发客户端，联动ModelJetty创建专用普通测试账号与一张¥10余额码，通过真实网页密码登录、真实OIDC/PKCE授权和真实兑换完成走查。未替换当前正式安装客户端、未发布生产服务、未发模型推理；真实赠金/测试额度只在独占QA账号内。

## 真实结果

| 层次 | 兑换前 | 兑换后 |
| --- | --- | --- |
| 账号 | newapi:14 / Harness兑换专用QA1103，Free | 同一账号，仍为Free |
| 额度 | ¥5.00赠金、消费0 | ¥10兑换成功，总余额¥15.00、消费0 |
| paidModelAccess | false | true |
| 官方可用目录 | 10文字+1生图，仅Gemini | 19文字+3生图，22/22可用 |
| 本地账号会话/broker | 初次成功登录状态 | accountSessionEpoch及broker地址/凭据指纹不变，未重新登录 |
| 目录版本 | modelsRevision1 | modelsRevision2，后续检查保持2 |
| 实际DSH | ready，generation2 | 自动更新为ready/generation3，后续不再反复重启 |

浏览器真实兑换操作号：`5bfff0e5-75c6-45f4-8fb2-764d6856910b`。只提交一次。页面明确显示“¥10.00已加入永久额度”、余额¥15.00，兑换历史恰一条。服务端按该操作号、原码与账号核对唯一到账、码redeemed、消费日志/推理账本/账号推理请求/Key用量均0，见[最终账务回执](redemption-final-public.json)。赠金原值保持，未重算或重置旧用户账号。

## 实际界面走查

1. 开发实例使用独立Electron userData、数据目录、后端18847、renderer5187、CDP9247。原正式应用与账号未退出或替换。
2. 新建专用QA账号后，使用Chrome访客资料正常输入账号密码，登录官网，再从开发客户端完成官方OIDC/PKCE授权。初始准备环境期间一条链接过期，回调拒绝连接；未兑换/扣费，改用新的明确登录流程完成。后续兑换阶段没有再次登录。
3. 登录后实际DSH iframe ready；打开真实模型菜单，只有Gemini新/旧型号，未开放GPT与DeepSeek。
4. 在该QA账号网页兑换中心提交唯一余额码一次，页面出现成功、金额和上述兑换编号；不重复提交。
5. 返回开发客户端后实际模型菜单出现DeepSeek Flash/V4 Pro、GPT6.1 Sol/GPT6 Astra/GPT6 Luna等。未点击目录手动刷新、退出登录或重启客户端来使权限生效。自动目录事件使DSH generation2→3，既有安全空闲重启路径生效。
6. 打开真实AI生图工作台，自动选中已配置官方GPT Image Flare；下拉中同时存在Sunburst与Nano Banana。无“所选模型已移除”或未配置Key提示。未点击生成。
7. 后续本地runtime/settings回读保持ready/generation3、modelsRevision2，确认不是每次检查都重启。

原始敏感凭据、完整兑换码、OAuth code、broker token不进入本目录。公开读回结果见[客户端快照](client-readback.json)；完整码仅在ModelJetty受保护的0600私密交接文件中保存，已用状态有服务端审计。测试输入用本机临时复制控件完成，未把密码或完整码显示在聊天/日志中；该辅助工具已关闭并恢复剪贴板。

## 走查中修复的环境问题

共享开发node_modules中的Electron实际为43.1.0/Node24.18.0，虽package声明44.7.0，真实DSH原生loader不支持该运行时指纹。未覆盖共享依赖：为本隔离实例独立安装Electron44.7.0/Node24.21.0，并按项目lockfile安装、补丁自己的DSH0.2.1-rc.2依赖后，真实Web Host启动成功。没有将fixtures的成功当作DSH已运行证据。

## 当前保留的环境

开发客户端窗口“抓虾开发验收”保持运行，renderer `http://127.0.0.1:5187/`，后端18847；独立私密profile/data位于本worktree `.codex-tmp/dont-stop/redeem-model-refresh/live-dev/`。不要把该目录、账号凭据或已使用码打包提交。Vite与Electron进程为本轮拥有，非当前正式应用。未commit/push，未安装发布。

发码遵循 [ModelJetty余额兑换码技能](/Users/xingyicheng/.codex/skills/modeljetty-redemption-code/SKILL.md) 的单次发行/回读流程；本次真实代兑换来自用户明确测试授权。
