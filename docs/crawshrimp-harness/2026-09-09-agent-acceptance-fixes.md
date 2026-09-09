# 智能体验收问题汇总与修复复测报告

汇总2026-09-09前三轮开发客户端验收及用户截图确认的问题，去重为15项。历史问题与本次修复状态分开记录；最终以真实运行、文件/数据库回读和必要回归测试判定。

| ID | 优先级 | 问题/验收目标 | 当前状态 |
|---|---|---|---|
| A01 | P1 | 网页会话独立标签与明确绑定 | 已修复；真实复测通过 |
| A02 | P1 | about:blank本地标签处理执行 | 已修复；真实复测通过 |
| A03 | P2 | 冲突去重及业务结论证据约束 | 已修复；真实复测通过 |
| A04 | P2 | 主动停止正确标记取消 | 已修复；复测通过 |
| A05 | P2 | 自动化不覆盖默认模型推理等级 | 已修复；真实复测通过 |
| A06 | P2 | 最终回答投影排除推理块 | 已修复；真实复测通过 |
| A07 | P2 | 运行模型审计使用会话真实模型 | 已修复；真实复测通过 |
| A08 | P2 | R$货币文本渲染 | 已修复；真实复测通过 |
| A09 | P2 | 缺Key供应商及模型隐藏 | 已修复；真实复测通过 |
| A10 | P1 | 周期结果自动送达源会话 | 已修复；复测通过 |
| A11 | P1 | 自动化禁止擅自放宽权限与只读网页采集 | 已修复；复测通过 |
| A12 | P2 | 完整结果验证与可审计补正 | 已修复；复测通过 |
| A13 | P2 | 等待下一次定时触发 | 已修复；复测通过 |
| A14 | P2 | Renner统计口径核验与结论 | 已修复；复测通过 |
| A15 | P2 | 产物去重与任务卡终态同步 | 已修复；复测通过 |

A09已在上一轮实施并通过54项测试、干净staging和真实菜单复测，本轮保留并做整体验证。余额不足是已恢复的环境阻塞，不计为产品缺陷。Renner统计口径和任务卡延迟原属待核验观察，本轮也纳入闭环，不能未经证据直接认定源数据错误。

历史证据：

- 第一轮：`.codex-tmp/real-agent-scenarios-20260909-1036/REPORT.md`
- 第二轮：`.codex-tmp/real-agent-scenarios-20260909-qa2/REPORT.md`
- 第三轮：`.codex-tmp/real-agent-scenarios-20260909-qa3/REPORT.md`

执行checkpoint：`.codex-tmp/dont-stop/acceptance-fixes-20260909/checkpoint.json`。本次仅授权本地修复与复测，不包含Git提交、推送或生产发布。

## 已完成修复及证据

| ID | 根因与修复后的行为 | 验证证据 |
|---|---|---|
| A01 | 原生会话每轮绑定全局第一个网页；改为首次导航新建本会话页面、会话级持久化精确 tab ID，显式 new_tab 可另开；页面关闭后保留失效绑定，不回退其他页面 | 两个真实会话分别绑定 Quotes `9EA9675C69D5A4E848043F2C3CDD710C` 与 Books `4AD9770E2F61063FB05751F68831AD57`；自动化沿用 Quotes 绑定；`test_acceptance_fixes.py` 覆盖跨轮复用和关闭页面 |
| A02 | 网页就绪检查排除了 about:blank；仅亚马逊本地标签任务显式允许空白文档，保留普通网页就绪保护 | 实际任务 `d39883681514428597199849c7507077` 完成；3 个单页 PDF/FNSKU 匹配、3 行 XLSX、ZIP 完整性均独立回读；`labels-readback.json` |
| A03 | 模型把同订单冲突数量当不同明细累加，且夸大未知数据下的结论；加入主键/粒度、冲突排除、缺失非零和结论证据约束 | 无纠正历史的新会话重放原始 6 行订单场景：X1 冲突排除、X2 非法数量排除、X3 缺价格排除、X4 pending 排除、X5=-20；交付 `qa4/order_regression_zh.md`。这是本次真实模型回归结果，不代表提示词可保证所有未来推理正确 |
| A04 | aborted 被映射为 failed；改为 canceled，正常中断/运行时中断仍为 interrupted，真实错误仍为 failed | 生命周期回归通过；真实点击Stop显示已停止，canceled且无错误，见最终验收表 |
| A05 | 后台选模型调用原生全局默认写入接口；改走已有的会话选模并保留默认设置接口 | 两轮实际 scheduled 后 settings 仍为 `DeepSeek official / deepseek-v4-flash / high`；`recurring-first-readback.json` |
| A06 | 文本提取接受 reasoning block，block-end 又重复 text-delta；只投影 text，流式阶段忽略 block-end 重复全文 | 真实网页最终回答的产品消息为 910 字符正文，未包含思考块；合成混合内容/生命周期回归通过 |
| A07 | 原生 run 使用 runtime generation 的默认模型作为审计值；改由实际 request/header.config 及 assistant provenance 写入，并持久化会话选择 | 两个新真实会话与 run 均记录 `crawshrimp-deepseek-official / deepseek-v4-flash`；单测覆盖请求头在没有答案时仍更新模型，未知时不伪填默认值 |
| A08 | 内联数学解析把 R$ 当数学起始符；运行时补丁让 R 后的 $ 保持货币文本，保留正常数学分隔符 | 真实最终回答显示完整 `R$ 19,90 - R$ 199,90`；数学/转义/幂等补丁测试通过 |
| A09 | 模型目录没有按当前供应商对应凭证过滤；按各 provider 的 live key 解析结果隐藏整个空组，含自定义供应商 | 上轮 54 项测试、干净 staging、真实菜单仅显示已配 DeepSeek；本轮保留修复并再次完成共享测试与 staging |
| A10 | 回执限制只支持 at；扩展到每个 scheduled run，保持 durable ID 幂等/重启恢复。本轮又实测发现只回传摘要及忙碌后乱序，追加从 accepted verification 渲染完整 records、按先后顺序发送的修复 | 首次两轮执行完成、两份摘要回执送达、默认 High 保留；`recurring-first-readback.json`。完整有序回执已复测通过，见最终验收表；历史摘要回执保留为修复证据 |
| A11 | 被拒绝的创建请求可撤销先前明确 false 的约束重试；在同一活动 turn 保留约束下限，删除/改 true 都拒绝；保留通用代码执行的 fail-closed 校验，明确只读网页使用 browser_observe | 实际周期仅含 browser_observe + automation_record_verification，filesystem/network/external_messages/script_publish 均 false；2 轮成功。原生工具越权/缺绑定/重定向等安全回归通过 |
| A12 | verified=true 缺少完整性合同，终态再次提交会被静默忽略；新增创建时 verification_schema，未通过时记录拒绝并允许本 turn 补齐；已完成结果补正必须带原因、留旧版审计、不改已提交 state、不重新执行业务 | 1/3 条记录被拒绝、3/3 完整记录通过、无原因补正被拒绝、有原因保留历史；真实周期定义固化恰好3条及4个必需字段 |
| A13 | 只能等待已存在的 run，导致固定 sleep/反复查询；新增 automation_wait_next，使用运行/时间游标等待自然触发，最长60秒，不创建运行 | 实际周期会话使用 wait_next → wait_run → pause，首次两轮均为 scheduled；单测确保不调用 run_now |
| A14 | 解析器从任意商品列表选择最大 totalNumRecs，可能误选辅助列表；改为主内容结果列表、歧义时明确失败；商品结果数不能直接称 SKC、销量或库存，导出增加统计口径与来源 | 合成主列表229、辅助列表8831案例取229；主内容歧义拒绝；真实Renner 0.2.1版5列导出已通过，见最终验收表。历史8831尚无证据判定为源站错误，不将该数直接列为已证实错误 |
| A15 | 产物以不同来源的 artifact ID 去重，同一路径可重复；任务轮询仅覆盖最后4张可见 running 卡 | 同会话按路径优先匹配产物；iframe 不再把工具 call ID 作为同路径重复渲染条件；轮询所有本会话非终态任务并在 Agent 结束时刷新，避免并发轮询；真实标签产物卡复测及路径同名不同目录单测 |

## 长任务完整交付

复用已经完成的 60 本书与 4 次观察文件，没有重新采集这些数据。真实客户端重新计算行数、缺失值、分组统计并做一次源站页面抽查，生成并回读 `agent/workspace/qa4/final_acceptance_report_zh.md`。这一轮覆盖“已有长期执行证据 → 分析 → 最终报告 → 文件交付”的收尾链路，不把报告重写伪装成又跑了一次11分钟采集。

本轮另加的销售例子最初没有明确ID是订单还是明细，因此模型先按明细理解；补明订单粒度后保留更正记录。A03是否通过以其后**独立新会话、明确按 order_id 去重、重放原6行数据**的结果为准。

## 代码与构建验证

- 主回归：281 passed（`gate6-python.log`，涵盖服务、浏览器运行器、自动化控制器和网关）。
- 完整回执/审计补充后共享回归：233 passed（`final-shared-python.log`，范围与前项有重叠，不能相加当独立用例总数）。
- 相邻 Python 回归：49 passed、1 skipped（`adjacent-python.log`；跳过原因：仓库未提供该项真实亚马逊样本文件；本轮另用3页合成PDF完成客户端真实全链路验证）。
- 相邻 Node 回归：59 passed（`adjacent-node-v2.log`）；新增货币/产物/脚本/选模测试批次11 passed（`gate4-node.log`）。
- Renner口径变更专项：`renner-scope-gate.log`。
- 两次干净 staging 成功、Web profile config check OK（`staging.log`、`staging-v2.log`）。
- Vite构建通过（`vite-build.log`）；有体积告警，未进行打包/发布。

所有上述日志位于 `.codex-tmp/dont-stop/acceptance-fixes-20260909/`。真实核心服务重启后端口会变化，不能把旧18766/19069当当前地址；每轮均以客户端和 desktop.log 的实际 ready 地址核对。

## 最终真实客户端验收结果

| 链路 | 实际结果与独立回读 |
|---|---|
| 长任务最终报告 | 60本书与4次监测已有数据完成统计核验、源页抽查、中文报告生成及交付；`reports-readback.json` 保存文件SHA-256。没有重跑已完成采集 |
| 冲突订单原场景 | 全新会话第一次回答即排除冲突X1，已知有效记录小计−20；缺失退款等情况单列，不再宣称480或无依据的下限 |
| 单次网页 → 周期 → 自然触发 → 源会话结果 → 暂停 | 同一定义 `dd6872052c824896a7c15b339263366f` 完成两轮最终复测：`f6a6ca626a2a464cbce8f8c5f956e7a7`、`95f2400c5b094bc5b6173e20fc190d78`；间隔59.994602秒；每轮3条的全部字段逐项存在于源会话回执；两份回执按时间先后送达；enabled=0。见 `recurring-final-readback.json` |
| 自动化权限与默认模型 | 完整执行过程中工具仅browser_observe与automation_record_verification；禁止标志保留false；默认Flash/High未被后台任务覆盖 |
| 主动停止 + 实际模型审计 | 真实选择已配Pro并开始长回答，点击停止后界面显示“已停止”，run=`run-web-6ed674805c58` 状态canceled、model=deepseek-v4-pro、error_code为空；随后恢复Flash/High。见 `stop-pro-readback.json` |
| 模型可用性菜单 | 最终客户端菜单只有DeepSeek官方组及Flash/Pro/Vision三项；未配凭证的其他内置和自定义组不显示 |
| Renner新版脚本 | 本地适配包升级0.2.0→0.2.1，解决同版本已安装副本被保留而源码修复未生效的问题；新Excel有5列和2行，半身裙66/儿童鞋8831，价格带、统计口径、来源URL均回读通过，见 `renner-final-readback.json` |
| 产物/任务卡 | 标签脚本和Renner脚本均显示可打开产物及任务终态；同路径跨事件ID去重，文件名相同但目录不同不误合并；已完成任务不因离开最后4张可见卡而停留running |

Renner升级后的首次请求遇到源站 `ERR_HTTP2_PROTOCOL_ERROR`，执行器在脚本入口停止且未产出结果；确认失败边界后一次重试成功。该环境错误没有被算作调度器故障，也没有用旧Excel替代新版验收。附带修复了任务诊断遗漏：task_status/task_wait现在从持久化summary/runs提供脱敏error_message，避免只有“config/failed”而迫使智能体遍历日志。

回执还有两项恢复补充：周期回执纳入重启恢复；源会话长时间忙碌、超过短期重试窗口后，转为空闲会重新排队送达。排队不会在Worker事件读取循环内等待Worker自己的RPC，从而避免自锁。对应 `receipt-reader-gate-v2.log` 与 `final-diagnostics-gate.log`，并随最后一次核心刷新加载。

最后一轮补充修正了结构化回执中裸URL与中文分隔符连写造成的链接目标错误：来源字段使用明确的Markdown自动链接边界。13:14通过客户端“修复核心服务”加载后，复用同一定义自然触发 `ebfd57123dcf4dc6888e2a31b2bb790f`（13:16:10），运行completed、回执delivered；3条名言的全部字段逐项回读一致。客户端AX实际显示3个来源链接目标均为 `quotes.toscrape.com/`，中文“；观察时间”在链接外。见 `final-link-smoke-readback.json`。本次实际端口为后端18768、DSH19069。

最终回读确认本轮及前轮的3个测试自动化均已暂停、next_run_at为空；默认模型仍为DeepSeek官方 / deepseek-v4-flash / High。

## 最终质量门禁与交付边界

- 最终Python受影响回归：**334 passed，1 skipped**（`final-python-v3.log`，包含最后来源链接边界断言）。跳过项缺少仓库真实亚马逊样本；本轮合成3页PDF实际客户端拆分/Excel/ZIP交付已通过。
- 最终Node受影响回归：**104 passed**（`final-node.log`），包括会话选模默认保护、回执桥、模型可用性、货币解析、产物身份和两个既有脚本。
- 合计最终测试批次**438项通过、1项跳过**；之前中间批次与此有重叠，不重复累计。
- 干净staging及Web profile检查通过；Vite构建通过；`git diff --check`通过。
- 仅本地实现、开发运行时刷新与真实客户端验收。没有Git提交、推送、打包发布或生产部署；保留其他既有工作区改动。
- 余额/凭证问题属于原验收的环境阻塞；充值后已完成报告收尾与单次网页转周期的完整链路，不能把此前阻塞归因于调度器。
