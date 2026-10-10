# 定时任务示例与执行指引

以下说明不新增授权，用户限制与执行策略始终生效。

同一个自动化始终延续固定会话。isolated 表示任务专用会话，各次触发、重试、观察与动作都继续这一个会话；inherited 表示继续创建时的已有会话。每次触发仍保存独立 run 和验证证据。已有任务优先复用最近一次仍存在的执行会话，后续不再按 run 新建。

由 Automation Controller 创建自动化。用户会用自然中文表达意图；你应直接理解并调用本工具，不能要求用户提供 JSON。

对于“今天/明天/几点/三分钟后”等相对时间，先调用 automation_current_time 读取实时上海时间（不要根据训练数据或本工具描述猜测日期），再换算成带 +08:00 的未来 ISO-8601 时间；若用户给出的时间已过去，先追问或提出新的未来时间，不能创建已过期任务。

不要为了猜字段而调用 fs_read、fs_list、fs_exec、browser_*、script_* 或 repo_*，也不要读取/修改任何文件。本工具的合同已经完整给出。

调用参数只有 values 对象。普通 scheduled 自动化默认走会话权限模式，只需填写 title、objective_prompt 和 schedule；automation_kind 可省略或填 scheduled，execution_policy 可省略，Controller 会使用 permission_mode="session" 和 context_mode="inherited"。这表示到点后向创建它的固定会话提交一轮普通 Agent Turn，沿用该会话已经具备的模型、工具和用户预授权。用户明确要求“专用/隔离执行会话”时才填写 context_mode="isolated"，它仍是同一个固定专用会话连续执行。

需要独立收窄权限、loop Program、严格验证 schema 或兼容旧策略时，使用高级 scoped 模式：execution_policy.permission_mode="scoped"，并显式填写 toolset/native_toolset/allowed_risks/必要开关。有明确条数、字段、交付要求时，用 execution_policy.verification_schema（JSON Schema）固化这些结果条件，例如 required=["verified","records","user_message"]、records 的 minItems/maxItems 及每条 required 字段。验证提交必须完整满足条件。

- 一次性定时（例如“今晚 22:47 提醒我”）：automation_kind="scheduled"；schedule={"kind":"at","value":"未来 ISO-8601 时间","timezone":"Asia/Shanghai"}；enabled=true；默认不需要 Program、不需要 scoped 权限字段。
- 固定周期任务（例如“每小时同步”“每天汇总”）：automation_kind="scheduled"；schedule={"kind":"every","interval_seconds":3600,"timezone":"Asia/Shanghai"}（每天填 86400）。这是默认快路径，无需 Program、无需 automation_program_test；持续执行直到用户暂停。
- 已有脚本按时执行：写进 objective_prompt，例如“到点调用现有 script_run/task_run，参数为……，完成后汇报结果”。Controller 只负责按时提交普通会话 Turn，不直接假定脚本已成功；实际成败由到点后的工具调用和终态投影决定。旧 task_schedules 仍是固定 adapter/task/params 的直接兼容路径。
- 周期性条件闭环（例如“连续三次低库存才处理”）：才使用 automation_kind="loop"；loop_policy 包含 cycle_interval_seconds/max_cycles/failure_threshold；必须携带受限 program，并使用 scoped 权限。先用 automation_program_test 对代表性 facts/checkpoint 校验条件和 checkpoint，再把该工具返回的 program_test_proof 原样放进 values；没有这份短时证明不能保存或启用 Program。

对于固定周期同步：普通 session 定时不填写 toolset、allowed_risks、browser_url 等独立权限字段；把目标 URL、筛选条件、保存位置和交付方式写进 objective_prompt，到点后由固定会话沿用当前模型、工具和预授权执行。只有同步对象确实不明确时才问一个合并式问题。若用户明确选择 scoped 高级策略、loop Program 或旧白名单模式，才预授权 browser_navigate、browser_observe 和 automation_record_verification，并在 execution_policy.browser_url 保存用户约定的页面地址；导航是完成巡检所需的准备与恢复步骤，不必每次确认。提供地址并授权导航后，不要求用户事先一直打开标签页；任务可新建自己的页面，页面关闭后可恢复，不能选择其他会话的页面。

默认将中文摘要通过 automation_record_verification 发回创建对话。按目标配置足够完成任务的工具，包括必要的查询、翻页、文件保存、技能读取、命令执行和恢复步骤；不要让用户逐个猜工具名，也不要添加用户没有提出的禁止项。模型填错的失败草案可以纠正，不代表用户拒绝授权。筛选、查询、翻页、滚动若授权 browser_act，allowed_risks 必须包含 local_write；这里的 local_write 表示允许本地页面动作，不等于外发授权，外发仍需 external_write 且受 allow_external_messages 约束。CSV 保存授权 fs_write 与 local_write；独立回读授权 fs_read。当前会话回执与本地保存不属于外发。跨轮对比可授予 automation_state_get，并在验收的 result.state 写回小型 last_snapshot（最大 16 KiB）。用户约定了归档或报告时直接配置对应工具，回执如实说明是否写入文件。

创建成功后立即向用户确认标题、周期、时区、固定会话和约定权限；除非用户明确要求“立即运行”或“验收首轮”，不要调用 automation_run_now、不要等待。若用户要求首轮计入 loop 的 max_cycles，调用 automation_run_now 时传 count_toward_max_cycles=true；若用户明确要求等待验收，使用 automation_wait_run（最多 60 秒），不要用固定 sleep。等待自然周期时使用 automation_wait_next，传上次 run_uid 作为 after_run_uid；出现后再用 automation_wait_run。

若某项 MCP 工具在普通对话中原本需要确认，execution_policy 除 toolset 外还必须显式填写 allowed_risks（仅可为 read_only、local_write、external_write、destructive）。两者缺一不可：toolset 限定具体工具，allowed_risks 限定这次允许无人值守的风险类型。不要为普通提醒填写风险授权。

原生工具通过 execution_policy.native_toolset 单独约定，不填进 MCP toolset。例如文件读取 read/read_image/glob/grep/skill、写入 write/edit/str_replace_editor、联网 web_search/web_fetch、命令 bash/pwsh。文件工具受 allow_filesystem=false 限制，联网工具须 allow_network=true；读取须 read_only 风险，写文件须 local_write，命令须 local_write 和 external_write 风险及 allow_filesystem=true/allow_network=true。命令可执行通用代码，不能同时承诺禁止外发等细分限制；有这些禁止项时使用具体文件或网页工具。闭环观察阶段只保留读取型工具及网页恢复；动作分支通过 allowed_native_tools 与任务 native_toolset 取交集，未声明分支原生工具时不授予。只授权完成目标所需工具，子代理委托暂不支持定时权限继承。已约定工具和风险在后续各轮自动生效，不修改普通对话的访问模式。

无副作用的本地确认任务一般使用默认 session 模式，objective_prompt 写清楚到点只在固定会话中确认或提醒。只有需要兼容旧 scoped 策略或显式证明无工具时，才限制 execution_policy：permission_mode="scoped"，toolset 仅为 ["automation_record_verification"]，allowed_risks 为空，并将 allow_browser、allow_filesystem、allow_network、allow_external_messages、allow_script_publish 全部设为 false。不要为这类任务增加网页、文件、外部消息、外部服务或脚本发布。

创建阶段一次确定具体授权范围：目标网页、要执行的动作、文件保存位置，以及是否需要对外通知。用户已明确要求的操作即为授权，不要重复确认；缺少影响执行的信息时合并成一个问题。只在新增超出已确认范围的操作时再次确认。不要为所有任务默认填一组 allow_*=false；未涉及的权限开关可以省略，精确 toolset 和 allowed_risks 始终生效。矛盾草案不会保存，也不会把模型填错的 false 锁成用户禁令，可以按已确认需求纠正后重试。

allow_external_messages 专指向外部收件人或渠道发送消息（例如邮件、钉钉、Webhook），不代表禁止联网或网页筛选翻页。当前会话回执 automation_record_verification 不属于外发。任务需要外发时，在创建阶段确认渠道、收件人和内容；未要求外发时不要添加消息工具或 external_write 风险。网页采集需要 allow_network=true（如果填写此开关）；仅访问本地页也不是断网。不要把“不外发消息”翻译为 allow_network=false。

权限开关必须是布尔值，用户明确的 false 仍是约束。命令/脚本执行无法保证网络或外发等细分限制；保存 CSV 优先用 fs_write。禁止外发的定时任务中 browser_eval/browser_verify 只允许无副作用读取；下拉框筛选使用 browser_act(action="select", selector="...", text="选项文字或值")，查询与翻页使用 click，并确保 browser_act 对应的 local_write 风险已在 allowed_risks 中声明。

示例：用户说“今天 22:47 给我做一次本地验收提醒，到时只确认已完成，不访问网页或文件”，应创建标题“本地自动化验收提醒”的一次性 scheduled Automation，使用 Asia/Shanghai 的未来 at 时间，默认 session 权限和 inherited 固定会话即可。创建成功后只用返回结果向用户确认标题、运行时间、时区、固定会话和已约定的执行范围。
