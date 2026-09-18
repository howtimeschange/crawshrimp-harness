# 定时任务示例与执行指引

以下说明不新增授权，用户限制与执行策略始终生效。

由 Automation Controller 创建自动化。用户会用自然中文表达意图；你应直接理解并调用本工具，不能要求用户提供 JSON。

对于“今天/明天/几点/三分钟后”等相对时间，先调用 automation_current_time 读取实时上海时间（不要根据训练数据或本工具描述猜测日期），再换算成带 +08:00 的未来 ISO-8601 时间；若用户给出的时间已过去，先追问或提出新的未来时间，不能创建已过期任务。

不要为了猜字段而调用 fs_read、fs_list、fs_exec、browser_*、script_* 或 repo_*，也不要读取/修改任何文件。本工具的合同已经完整给出。

调用参数只有 values 对象。所有自动化至少填写：
- title：用户可见标题；objective_prompt：到点后智能体要做什么；automation_kind：scheduled 或 loop；context_mode：isolated 或 inherited；execution_policy：本次运行允许的工具集和限制。有明确条数、字段、交付要求时，用 execution_policy.verification_schema（JSON Schema）固化这些结果条件，例如 required=["verified","records","user_message"]、records 的 minItems/maxItems 及每条 required 字段。验证提交必须完整满足条件。
- 一次性定时（例如“今晚 22:47 提醒我”）：automation_kind="scheduled"；schedule={"kind":"at","value":"未来 ISO-8601 时间","timezone":"Asia/Shanghai"}；context_mode="isolated"；enabled=true。此场景不需要 Program。
- 固定周期任务（例如“每小时同步”“每天汇总”）：automation_kind="scheduled"；schedule={"kind":"every","interval_seconds":3600,"timezone":"Asia/Shanghai"}（每天填 86400）。这是默认快路径，无需 Program、无需 automation_program_test；持续执行直到用户暂停。
- 周期性条件闭环（例如“连续三次低库存才处理”）：才使用 automation_kind="loop"；loop_policy 包含 cycle_interval_seconds/max_cycles/failure_threshold；必须携带受限 program。先用 automation_program_test 对代表性 facts/checkpoint 校验条件和 checkpoint，再把该工具返回的 program_test_proof 原样放进 values；没有这份短时证明不能保存或启用 Program。

对于固定周期同步：如用户给了已授权页面，最多先 browser_observe 一次以识别页面；只有同步对象确实不明确时才问一个合并式问题。默认将中文摘要通过 automation_record_verification 发回创建对话，不创建 archive.md、不读写历史文件、不调用 skill_list 或扫描源码。默认策略只授予 browser_observe 和 automation_record_verification；权限按用户确认的任务动作配置，不要添加用户没有提出的禁止项；模型填错的失败草案可以纠正，不代表用户拒绝授权。用户明确要求筛选、查询、翻页时，应授权对应 browser_act；要求 CSV 时，应授权 fs_write；要求独立回读时同时授权 fs_read。工作区内保存文件使用 local_write 风险，不属于外发消息。若用户明确要求“新增对比”，才授予 automation_state_get：先读取小型 last_snapshot，再在 automation_record_verification 的 result.state 中写回新的 last_snapshot（最大 16 KiB）；不要读取或整体重写历史归档。若用户明确要求保存归档或展开页面，再单独申请所需权限；回执必须如实说明是否写入了文件。

创建成功后立即向用户确认标题、周期、时区和最小权限；除非用户明确要求“立即运行”或“验收首轮”，不要调用 automation_run_now、不要等待。若用户要求首轮计入 loop 的 max_cycles，调用 automation_run_now 时传 count_toward_max_cycles=true；若用户明确要求等待验收，使用 automation_wait_run（最多 60 秒），不要用固定 sleep。等待自然周期时使用 automation_wait_next，传上次 run_uid 作为 after_run_uid；出现后再用 automation_wait_run。

若某项 MCP 工具在普通对话中原本需要确认，execution_policy 除 toolset 外还必须显式填写 allowed_risks（仅可为 read_only、local_write、external_write、destructive）。两者缺一不可：toolset 限定具体工具，allowed_risks 限定这次允许无人值守的风险类型。不要为普通提醒填写风险授权。

无副作用的本地确认任务应明确限制 execution_policy：toolset 仅为 ["automation_record_verification"]，allowed_risks 为空，并将 allow_browser、allow_filesystem、allow_network、allow_external_messages、allow_script_publish 全部设为 false。不要为这类任务增加网页、文件、外部消息、外部服务或脚本发布。

创建阶段一次确定具体授权范围：目标网页、要执行的动作、文件保存位置，以及是否需要对外通知。用户已明确要求的操作即为授权，不要重复确认；缺少影响执行的信息时合并成一个问题。只在新增超出已确认范围的操作时再次确认。不要为所有任务默认填一组 allow_*=false；未涉及的权限开关可以省略，精确 toolset 和 allowed_risks 始终生效。矛盾草案不会保存，也不会把模型填错的 false 锁成用户禁令，可以按已确认需求纠正后重试。

allow_external_messages 专指向外部收件人或渠道发送消息（例如邮件、钉钉、Webhook），不代表禁止联网或网页筛选翻页。当前会话回执 automation_record_verification 不属于外发。任务需要外发时，在创建阶段确认渠道、收件人和内容；未要求外发时不要添加消息工具或 external_write 风险。网页采集需要 allow_network=true（如果填写此开关）；仅访问本地页也不是断网。不要把“不外发消息”翻译为 allow_network=false。

权限开关必须是布尔值，用户明确的 false 仍是约束。命令/脚本执行无法保证网络或外发等细分限制；保存 CSV 优先用 fs_write。禁止外发的定时任务中 browser_eval/browser_verify 只允许无副作用读取；下拉框筛选使用 browser_act(action="select", selector="...", text="选项文字或值")，查询与翻页使用 click。

示例：用户说“今天 22:47 给我做一次本地验收提醒，到时只确认已完成，不访问网页或文件”，应创建标题“本地自动化验收提醒”的 isolated 一次性 scheduled Automation，使用 Asia/Shanghai 的未来 at 时间和上述无副作用策略。创建成功后只用返回结果向用户确认标题、运行时间、时区和安全限制。
