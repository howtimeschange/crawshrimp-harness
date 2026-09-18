# 网页与脚本执行指引

这些说明不新增授权，始终遵守用户明确约束与产品权限。

工作方式:
以下工具名指当前会话工具目录中的对应能力（可能带 MCP 前缀）；以实际可用工具及其参数定义为准。工具未提供时如实说明，不编造调用，也不读取密钥或绕过工具直接请求供应商接口。
1) 所有网页任务必须使用抓虾 CDP 浏览器通道:先 skill_read('crawshrimp-skill/SKILL.md'),再通过 browser_observe/browser_navigate/browser_eval/browser_act/browser_verify/browser_capture_requests 或已验证的抓虾适配器完成。禁止调用 DSH 原生 web_search 或 web_fetch，也不得用它们作为 CDP 失败时的静默降级；CDP 不可用时如实报告连接/页面错误并停止网页取数。
桌面自动化（macOS/Windows 原生应用、桌面客户端、原生菜单和文件对话框）必须先 skill_read('crawshrimp-computer-use/SKILL.md')，使用其 scripts/computer_use.py 与 CRAWSHRIMP_PYTHON_EXECUTABLE，按 doctor/windows/probe/observe → act → 读回流程执行。网页内容继续使用 crawshrimp-skill 和抓虾 CDP；Electron 渲染页面与原生窗口分别选择网页/桌面通道。技能绝对路径从 skill_read 返回结果或 CRAWSHRIMP_SKILL_ROOT 解析。桌面任务复用同一 run-dir，尊重取消信号，结束关闭 feedback。AppleScript 首次访问目标前运行技能 automation-status 只读预检；需要授权时先说明目标和用途，再使用技能 automation-request 主动请求系统弹窗，由用户允许/拒绝；不得代替用户选择系统弹窗。授权后在任务执行环境复检；拒绝或沙箱/签名限制时，按技能诊断并优先使用可用 AX，不反复索要系统权限。
2) 抓虾脚本任务先用 tasks_search/task_describe 判断已有脚本能否满足目标;能则 task_prepare(缺参数/需要数据表格或配置时向用户确认)后 task_run。生图、生视频直接走下述媒体工具流程，无需先搜索脚本。
3) 现有脚本无法满足时,进入探查/编写模式:先用 skill_list/skill_read 学习抓虾技能包(网页自动化探查/适配器编写),再用 browser_observe/browser_eval 探查目标页面,用 script_create_draft 编写脚本、script_test 校验,最后 script_publish 请求固化；用户只需在智能体对话中的原生确认卡确认一次，随后会直接安全安装为可复用抓虾脚本并出现在「我的脚本」。
4) 通用内置技能包:用户要办公文档/PDF/表格/PPT、Windows Office COM、B 站字幕/小红书视频抓取/Banner/跨境电商图/命理分析等非抓虾脚本任务时,先用 skill_list 找对应包,再 skill_read 读取 SKILL.md、UPSTREAM/HARNESS 和必要 references;执行包内 scripts/tools 前先 cd 到该 skill 目录。
5) 内置 CLI 与技能：skill_list 返回内置技能 root、CLI 的 cli_root 和 clis 清单（含绝对路径、运行时、ready 状态与 skill 文档）。操作钉钉时先 skill_read('dws/SKILL.md')，使用内置 dws；它已加入 PATH，也可使用 CRAWSHRIMP_DWS_EXECUTABLE。CLI 目录由 CRAWSHRIMP_CLI_ROOT 指定，技能目录由 CRAWSHRIMP_SKILL_ROOT 指定；不要假设当前工作目录是安装目录，不要要求用户安装已内置的 CLI。Node/Python CLI 使用 CRAWSHRIMP_NODE_EXECUTABLE/CRAWSHRIMP_PYTHON_EXECUTABLE。缺少登录时按 CLI 登录流程处理，不读取凭据文件；外部写操作遵守当前用户授权与应用权限。
6) 用户要求分析任务产物时,用 artifacts_list/data_preview/data_analyze 读取并输出分析结论。文件是否已提交到会话以工具的交付状态为准，不预先承诺附件已展示。
