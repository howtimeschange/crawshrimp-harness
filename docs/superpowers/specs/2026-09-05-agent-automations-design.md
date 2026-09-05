# Harness 智能体自动化设计

| 项 | 内容 |
| --- | --- |
| 文档 ID | agent-automations |
| 日期 | 2026-09-05 |
| 状态 | 已确认，待编写实施计划 |
| 范围 | Crawshrimp Harness 本地桌面端 |

## 一句话

自动化的主实体是一个持久化的智能体目标：用户说明要做什么、何时做，以及在什么条件下做。Harness 可以在固定时间启动一次受控的 Agent Turn，也可以按持久检查点循环执行“观察、判断、行动、验证、等待”。适配器、脚本、Chrome CDP、文件和 AI 服务都是 Agent Turn 可调用的执行能力，而不是自动化本身。

## 背景

当前 Harness 已有两类可复用基础：

- 任务执行底座：Adapter、Task Instance、产物、运行记录、APScheduler、任务通知和本地 SQLite。
- 智能体底座：AgentService、DSH/MCP、会话、审批、工具调用、脚本草稿和脚本发布。

现有 task_schedules 绑定 adapter_id、task_id 和参数，适合固定脚本或固定任务的每日/每周执行；它不能表达“到点后重新理解一个业务目标、选择或生成执行方法”的智能体任务。本设计新增 Automation Controller，不把智能体自动化伪装成 Task Schedule。

## 目标

1. 用户能在智能体对话中用自然语言创建、编辑、暂停、恢复、立即运行和归档自动化。
2. 支持定时自动化和周期循环自动化；每一轮均运行一个受控 Agent Turn，能调用现有 Harness 与 Crawshrimp 能力。
3. 每个自动化可选择隔离上下文或继承创建它的会话。
4. 缺少能力时，智能体可为当前运行创建、校验和使用临时脚本；临时脚本不会自动发布为共享资产。
5. 循环可配置、可编程：观察结果经无副作用的条件程序判定后，才进入受控行动与验证。
6. 运行、产物、失败、重试、通知和人工复核都有可读回的证据。

## 非目标

- 不将旧 task_schedules 自动迁移为智能体自动化。
- 不提供云端常驻调度、跨机器派发或远程 Execution Target。
- 不在任务错过后静默补跑。
- 不让定时任务自动发布共享 Adapter 或可复用脚本。
- 不将能操纵网页的任意 JS Runner 脚本用作条件判断程序。
- 不复制或移植一整套 OpenClaw Gateway；只吸收“持久调度器唤醒 Agent Turn”的产品模型。

## 锁定决策

| ID | 决策 | 锁定值 |
| --- | --- | --- |
| D1 | 定时主体 | Automation，而不是 Adapter Task 或脚本 |
| D2 | 执行模型 | 定时触发或循环轮次均创建一次 Agent Turn |
| D3 | 上下文 | 每个 Automation 显式选择 isolated 或 inherited |
| D4 | 缺少能力 | 可自动创建并校验仅本次有效的临时脚本 |
| D5 | 脚本沉淀 | 验证成功后建议用户显式沉淀；绝不自动发布 |
| D6 | 调度位置 | 首版本机 Harness 后端；仅后端运行时可触发 |
| D7 | 错过计划 | 记为 missed，不静默补跑；用户可立即补跑 |
| D8 | 并发 | 同一 Automation 默认单飞；重叠触发记为 skipped_overlap |
| D9 | 授权 | 自动化保存自己的授权包；不继承会话的临时全权限 |
| D10 | 旧功能 | 旧 task_schedules 继续作为固定脚本任务的兼容功能 |
| D11 | 自动化类型 | scheduled 为固定时刻触发；loop 为完成后等待的闭环周期 |
| D12 | 条件 | 观察 facts 经纯条件程序决定分支；条件程序无副作用、可测试、可版本化 |
| D13 | Program 适用范围 | loop 必须绑定 Program；scheduled 可绑定条件 Program，也可在授权范围内直接执行目标 |

## 架构

~~~text
Agent 对话
  │ automation.create / update / pause / run / program_test
  ▼
Automation Controller ──持久化──> SQLite automation tables
  │                              ▲
  │ 定时唤醒、循环重入、恢复       │ run history, checkpoints and links
  ▼                              │
APScheduler / Loop Rearmer        │
  │ due scheduled run / next cycle│
  ▼                              │
Context Resolver ──> AgentService / DSH Worker / MCP
                              │
                              ▼
      Observer → facts → Condition Program → Agent Action → Verifier
                              │
                              ▼
             Automation Run、检查点、产物引用、通知
~~~

### 组件职责

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| Automation Controller | 定义、调度注册、循环重入、幂等领取、并发、重试、取消和状态投影 | 浏览器或业务动作 |
| Context Resolver | 解析隔离或继承会话，构造本次运行的限定上下文 | 选择业务执行步骤 |
| Observer / Condition Runtime | 收集结构化 facts，运行无副作用条件程序，产生分支与证据 | 直接改变网页、文件或外部系统 |
| AgentService 和 MCP | 运行 Agent Turn，执行现有工具、审批和审计链路 | 保存调度事实 |
| Automation Run | 关联本次 Agent Run、Task Instance、临时工作区、产物和通知 | 复制原始产物或任务日志 |
| 现有 Task Instance | 继续作为 Adapter/任务层的权威运行记录 | 成为智能体自动化定义 |

APScheduler 只是可重建的本机唤醒器。SQLite 中的定义和运行记录才是权威状态；进程启动时 Controller 从 SQLite 装载启用的 Automation 并重新注册。

## 数据模型

### agent_automations

每条定义至少包含：

- automation_uid、title、objective_prompt、enabled、archived、created_at、updated_at。
- automation_kind：scheduled 或 loop。scheduled 保存 schedule_kind（at、every 或 cron）、计划值、timezone 和计算出的 next_run_at；cron 使用五段标准表达式，every 保存首次锚点。
- loop_policy：cycle_interval、最大轮数、最长存活时间、连续失败熔断阈值、完成条件和当前 checkpoint 引用。loop 的下一轮仅在上一轮验证完成后计算。
- context_mode：isolated 或 inherited；继承模式还保存 source_session_id 与 source_runtime_session_id。
- model_policy：可选模型和推理等级覆盖；未设置时使用该会话或系统默认。
- execution_policy：授权的能力、工具范围、超时、最大重试次数和通知策略。
- active_program_version_uid：当前生效的观察器、条件、分支行动和验证程序版本。loop 必填；scheduled 未设置时按 objective_prompt 直接执行，设置后先经 Program 判定。
- last_run_uid、last_status、last_error、last_triggered_at，仅作列表投影；详细事实仍来自 run 表。

时区必须显式存储为 IANA 名称。创建界面默认 Asia/Shanghai，但显示并保存该值，不能依赖运行机器的隐式时区。

### agent_automation_program_versions

每个 Automation Program 版本保存可审计的配置：观察器声明、facts schema、命名条件、分支行动、验证要求、checkpoint schema 和创建来源。更新条件或分支时创建新版本；正在运行的 Run 固定使用启动时的版本，新版本从下一次触发或下一轮开始生效。

条件程序的规范输入是版本化 config、facts、checkpoint 和 now；规范输出是 matched_branch、reason、evidence_refs、checkpoint_patch 和可选的 loop_decision。它不得直接调用网络、Chrome CDP、磁盘、子进程或外部通知。

### agent_automation_runs

每次计划发生都创建一个 Run，包含：

- run_uid、automation_uid、trigger_kind（scheduled、loop 或 manual）、trigger_at、cycle_seq、started_at、finished_at、attempt、idempotency_key。
- status：queued、running、retry_scheduled、completed、failed、skipped_overlap、canceled、missed 或 needs_review。
- program_version_uid、agent_session_id、agent_run_id、task_instance_uid、temporary_workspace_ref。
- execution_policy_snapshot、checkpoint_before、checkpoint_after、facts_summary、matched_branch、result_summary、error_code、error_message、notification_status。

Controller 在领取前持久化 trigger_uid，并以 automation_uid 与 trigger_uid 生成 idempotency_key，再由数据库唯一约束保护。scheduled 的 trigger_uid 是计划时间桶；loop 是预先领取的递增 cycle_seq；manual 是用户本次请求 UID。无论 APScheduler 重复回调、应用重启或用户重复点击，Controller 只允许同一个触发有一个权威 Run。可重试错误在这个 Run 内增加 attempt 并更新状态，不创建第二个父 Run；execution_policy_snapshot 让审计能准确还原当次实际使用的授权。

### agent_automation_run_links

此表只保存对既有 Task Instance、Agent Run、任务产物和临时脚本验证结果的引用。它不复制数据、不复制文件，也不成为另一套审计系统。

## 调度和生命周期

1. 用户在 Agent 对话中表达目标、频率或循环周期、条件和行动。Agent 补足必要参数后调用 automation.create；创建卡片回显类型、计划或周期、时区、上下文模式、条件、授权包和下次运行时间。
2. Controller 保存定义、注册 APScheduler，并在自动化中心显示状态。
3. 到点或周期届满后，Controller 原子领取 trigger_uid。如果已存在运行记录则直接返回；如果该 Automation 有 running Run，则新增 skipped_overlap 记录。
4. Context Resolver 创建运行上下文，Controller 启动 AgentService 的 Agent Turn。
5. Agent 可调用正常 MCP 工具，并可把本次底层执行关联到 Task Instance。
6. Controller 汇总运行结果、产物、通知结果和下次执行时间。
7. 暂停、归档或取消会取消未开始的触发；取消运行还会向关联 Agent Run 和 Task Instance 发送停止请求。at 类型在其 Run 进入终态后自动停用，但保留定义和完整历史。

本机 Harness 未运行时没有执行者。启动时，Controller 识别错过的计划或循环轮次并记录 missed，不自动追赶。用户可以在自动化中心选择立即补跑。

### 周期循环生命周期

loop 是“完成后再等待”的尾随周期，而不是固定时钟上的 every。一个 loop Run 完成时依次执行：

1. Observer 使用授权的 Adapter、临时脚本或只读 Agent 工具读取外部状态，产出结构化 facts。
2. Condition Runtime 将 facts、上一 checkpoint 与当前时间输入当前 Program 版本，选出至多一个优先级最高的分支。
3. 未命中行动条件时，写入 checkpoint_after 并静默等待下一轮；命中时，Agent 按该分支的 objective 和授权包执行。
4. Verifier 读取业务结果。只有验证通过时才提交动作相关 checkpoint；不能验证时进入 needs_review。
5. Controller 根据完成条件、最大轮数、最长存活时间和熔断状态决定 completed、paused、needs_review 或 next_cycle_at。

任何一轮没有完成前，Loop Rearmer 不注册下一轮。连续可重试失败使用退避；达到熔断阈值时暂停 loop 并通知用户，绝不无限重试。

## 上下文模式

### isolated

每次运行使用独立会话标识，概念形式为 automation:<automation_uid>:<run_uid>。它只携带：

- Automation 的目标、计划、授权包和显式参数；
- 最近的结构化运行摘要和必要的产物引用；
- 本次运行的临时工作区。

它不携带普通聊天的隐式上下文，也不污染创建自动化的人工会话。

### inherited

运行绑定创建时记录的 Agent Session 和运行时会话。它可以使用该会话已有对话上下文，但必须通过会话队列串行化：若用户或其他 Agent Turn 正在该会话运行，自动化等待受限时间；超时则记录 skipped_overlap，而不是与交互 Turn 并发抢占上下文。needs_review 仅用于需要用户决定权限或业务范围的情况。

两种模式都使用 Automation 的 execution_policy；继承上下文不等于继承创建会话当时的权限。

## 可配置条件与 Automation Program

用户可在对话中表达“当 XXX 时怎么怎么样”，例如“库存低于安全线且近七天有销量时，生成补货单并通知采购；连续三轮满足才执行，之后二十四小时内不重复”。Agent 把自然语言编译为 Program 草稿，而不是把解释性文本留给下一轮自由发挥。

~~~yaml
observations:
  - id: inventory
    source: adapter:store-inventory
  - id: sales
    source: adapter:store-sales
config:
  reorder_point: 20
conditions:
  - id: restock
    when:
      all:
        - "facts.inventory.available < config.reorder_point"
        - "facts.sales.last_7_days > 0"
        - "consecutive_matches(restock) >= 3"
        - "cooldown_elapsed(restock, '24h')"
    then:
      objective: "生成补货清单并通知采购负责人"
      allowed_capabilities: [read_browser, write_workspace, notify_dingtalk]
verification:
  required: true
checkpoint:
  last_available: facts.inventory.available
~~~

上例中的 when 字符串只用于展示；保存时必须解析为受限、可解释的规范 AST，不能在运行时 eval。Program 支持比较、布尔组合、数值和时间计算、集合判断、变化量/趋势、连续命中、去抖和冷却；Agent 可以按用户要求生成和修改这些条件。复杂逻辑由多个命名条件和优先级分支组合，不允许任意页面 JS、Node/Python 命令或网络访问混入条件层。

保存或启用 Program 前，Agent 必须调用 automation.program_test，向用户展示至少一组事实样本、命中的分支、不会命中的分支、拟执行行动和 checkpoint diff。只有条件测试通过，且行动分支拥有相应 execution_policy，Program 才能启用。

条件命中只决定“是否进入哪一个行动分支”；它不授予行动权限。行动 Agent 仍受该分支和 Automation 授权包共同限制，所有网页/文件/外部操作仍经过既有审计和结果验证。

## 授权包与人工复核

Automation 创建时保存最小的执行授权包，例如：

- 读取已登录网页、读取本地输入和浏览器观察；
- 指定 Adapter 或受限的 MCP 工具集合；
- 下载和写入选定的本地工作区；
- 指定通知渠道；
- 为本次运行创建并使用临时页面脚本。

在授权范围内，计划运行不逐步等待人工确认。若 Agent 想调用未授权工具、改变业务影响面、发送未授权外部消息、发布共享脚本或执行其他范围外动作，Controller 不允许它以后台审批阻塞的方式继续等待。该 Run 转为 needs_review，记录拟执行动作、原因、影响和证据；用户扩展授权后显式重试。

现有 MCP 审批链路需要识别来自 Automation Controller 的、范围受限的授权上下文。不得通过全局关闭审批或复用会话级 full access 实现无人值守。

## 临时脚本

临时脚本属于一个 Automation Run：

1. Agent 在该 Run 的临时工作区生成所需文件或页面脚本。
2. 系统进行脚本合同和包结构校验。
3. 条件允许时，执行无业务副作用的页面/数据验证。
4. 通过后可仅在该 Run 中运行；验证、日志和产物引用挂回 Run。
5. Run 结束后清理临时工作区；保留脚本摘要、校验结论和运行证据。

脚本合同校验通过不等于业务成功。无法验证登录、目标页面合同或所需权限时，必须进入 needs_review，不能把静态校验当成自动化成功。验证成功后，运行详情可以提供“沉淀为复用脚本”的显式入口；该入口走现有 script_publish 审批和复核流程。

## 失败、重试和通知

| 情况 | 系统行为 |
| --- | --- |
| 浏览器短暂断连、模型限流、可识别网络错误 | 在 execution_policy 的次数内退避重试，保持同一 idempotency_key |
| 未登录、页面合同失效、授权不足、临时脚本验证失败 | 进入 needs_review，不盲目重试 |
| 超时 | 取消 Agent Run 与下游 Task Instance，记录失败证据 |
| 用户取消 | 状态为 canceled，停止子运行并保留日志/产物引用 |
| 同一任务重叠 | 状态为 skipped_overlap，不并发执行 |
| 应用离线错过 | 状态为 missed，用户可立即补跑 |
| loop 连续失败到熔断阈值 | 暂停 loop，通知并等待用户恢复或修改 Program |

默认通知失败、needs_review 和最终结果。通知本身失败不能覆盖业务运行的最终状态，必须单独记录 notification_status。

## 用户体验

### 对话入口

对话是主入口。用户可说“每个工作日 8:30 检查店铺库存，异常发我钉钉”，也可说“每三十分钟持续检查库存；低于安全线且近七天有销量时补货，处理后验证并继续监控”。Agent 应补齐缺失的类型、频率或循环周期、条件、时区、上下文和授权信息，再创建 Automation。创建成功后返回结构化卡片和管理入口。

### 自动化中心

在任务中心增加独立的“自动化”页签，而不把它混入固定脚本任务：

- 列表：类型、名称、目标摘要、下次运行或下一轮、上下文模式、最后结果和启停状态。
- 详情：定义、授权包、计划或循环策略、Program 版本、当前 checkpoint、最近运行、Agent/Task/产物引用和错误证据。
- 操作：立即运行、暂停、恢复、编辑、复制、归档；needs_review 可扩展授权后重试；loop 可查看条件测试和熔断原因。
- 频率：提供自然语言/预设的每日和每周编辑；高级编辑器支持 at、interval、cron 和显式时区。loop 额外配置完成后间隔、完成条件、最大轮数和失败熔断。

固定 Task Schedule 留在原有任务语境中，并明确标示为“固定任务定时执行”。

## MCP 与 API 边界

Agent 可见的 Automation MCP 工具至少覆盖：

- automation.list、automation.get、automation.create、automation.update。
- automation.pause、automation.resume、automation.archive、automation.run_now。
- automation.runs、automation.retry_review 与 automation.program_test。

工具参数和 API 采用同一个规范化定义，创建和编辑均返回完整的 Automation 视图。Agent 不直接操作 APScheduler；所有调度变更都通过 Controller 写入 SQLite 后再刷新注册。

桌面端通过现有 Electron IPC 与 FastAPI 访问相同的 Automation API。前端不自行计算 next_run，也不保留第二份调度状态。

## 验收

### 单元验证

- at、every、cron 与 IANA 时区的解析和 next run 计算。
- 进程重启后的启用定义恢复。
- 幂等领取、单飞并发和 missed 处理。
- loop 尾随间隔、完成条件、最大轮数、检查点提交和连续失败熔断。
- 条件 DSL 的比较、趋势、连续命中、去抖、冷却、优先级和样本测试。
- 两种上下文的解析、继承会话队列和超时。
- 授权包拦截与 needs_review 结果。
- 临时工作区与取消后的清理。

### 服务集成

- 立即运行和到点触发均创建一个真实 Agent Run。
- loop 可在真实观察结果中命中、跳过和执行分支，并且只有验证后更新 checkpoint。
- 运行能关联 Task Instance、产物和通知，并从 API 读回。
- 可重试错误退避；不可重试错误不被重复执行。
- 取消会传播给 Agent Run 与底层任务。

### 桌面端验收

从自然语言创建定时或周期循环自动化后，用户能在自动化中心查看、暂停、立即运行、测试条件、查看 checkpoint 和打开本次产物。一次缺失授权的运行必须展示 needs_review，扩展授权并重试后才能继续；不会出现无记录的后台动作。

## 实施边界

首版实现 Automation Controller、SQLite 存储、定时与周期循环恢复、Automation Program/Condition Runtime、检查点、Automation MCP/API、AgentService 上下文接入、临时脚本运行域、自动化中心和覆盖上述行为的测试。云端常驻执行、跨机编排、外部事件触发、自动脚本发布和旧 Task Schedule 迁移留在后续独立设计中。
