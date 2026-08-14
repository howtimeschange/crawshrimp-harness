# crawshrimp-harness 交接文档(Codex 接手)

> 生成时间:2026-08-14 深夜。本轮工作:对今天全部领先 commit 做 code review、修复发现的问题、更新提案/SPEC、总结遗留。
> 必读顺序:本文件 → `03-media-in-chat-handover.md`(媒体展示踩坑)→ `02-delivery.md`(交付清单)→ `01-dsh-agent-v2-proposal.md` §18(实现修订)→ `SPEC.md` §11-15。

## 1. 本轮(2026-08-14)完成清单

30+ commit,主线功能(全部实测过):

1. DSH 内核智能体(锁版 0.1.0-rc.6)三栏界面:会话侧边栏(抓虾菜单注入)+ 会话区(DSH web host iframe 全量嵌入)+ 实时浏览器浮动窗口。
2. 设置页智能体子区(状态/重启/修复/清数据);DeepSeek 官方网关;自动更新+更新日志弹窗。
3. AI 生图/生视频工具 + 会话内媒体直接展示(图片多图/视频播放/附件点击,消息流内)。
4. 附件上传:composer 原生加号按钮改造(📎)+ 旁开「@」命令;拖入/粘贴;`attachment_read` 供模型读取。
5. 全局权限放开:fs_read/fs_list 全盘读;fs_write/fs_exec 审批卡;browser_navigate 任意 http(s)。
6. 脚本创作硬性规范(抓虾适配包)+ 双闸门(审批卡 + 审核页「先测试后审批」,页内嵌 TaskRunner 真实运行)。
7. dont-stop 技能 submodule 装入(11 个技能包)。
8. 稳定性:端口自愈/孤儿清理/SSE 重连/探活自恢复/backendController 容忍重试。
9. 任务卡/任务中心中文任务名 + 审批卡中文人话(各型专属文案)。
10. 附件→任务参数桥接(file_excel 自动解析,attachment_id 或本地路径)+ 三个工具 bug 修复(task_wait/data_analyze/fs_exec/ParamType 枚举)。
11. 实时浏览器多窗口:按页面(tab)绑定,一个页面一个窗口,活跃置顶、级联排列、流独立。

## 2. 本轮 code review 已修复的问题

| 级别 | 问题 | 修复 |
| --- | --- | --- |
| high | zip 条目解压前未检查大小(zip bomb OOM) | `getinfo().file_size` 先检查,>64MB 413 |
| high | Range 后缀区间 `bytes=-N` 解析错误(返回前 N 字节) | 按 RFC 7233 正确实现(实测 206/1000B) |
| high | master API token 进媒体 URL(query),任意路径读取放大 | 派生专用媒体 token(仅 /agent/artifacts/*),master 不进 URL |
| high | test-install 覆盖同名生产适配器、reject 误删生产版 | 安装前快照 `.review-backup`,拒绝恢复,批准弃快照 |
| high | postMessage 无 source 校验(任意内嵌页面可冒用特权通道) | AgentWebView/AgentProductLayer 校验 `event.source === iframe.contentWindow` |
| high | 上传无大小上限 + `Array.from(buffer)` 内存放大 | 200MB 上限 + 直接传 Uint8Array + main 异步写 + tmp 注册后清理 |
| high | backendController 容忍重试不覆盖 initial-probe 分支(仍立即换端口) | initial 分支对 ready 后端失败落入容忍循环 |
| medium | fs_exec 审批展示 300 字符截断与实际执行不一致 | 完整命令进审批卡与审计 |
| medium | 双上传按钮(旧 .cs-attach-btn + 原生按钮改造) | 只保留原生按钮改造路径 |
| medium | document 级 drop/paste 全局拦截 | 限 composer 区域(`closest('.wSkVaW_composerSeat')`) |
| medium | 媒体块重试 setTimeout 无限累积 | 最多 6 次 |
| medium | 浏览器窗口 minimize/maximize 状态互斥缺失 | minimize 清 maximized;unmount 清理 drag/resize 监听 |
| medium | agentBrowser 双 WebSocket 竞态、pending 永不 resolve | starting 串行 + onclose reject 全部 pending |
| medium | SSE live id 恒 0 | 内存单调 seq(与 db 持久化 seq 解耦) |
| high | task_wait `await` 同步返回值 / data_analyze bytes 进文本预览 / fs_exec uuid 未 import | 已修(f55e8c6) |
| high | task_prepare 的 ParamType 枚举匹配失败致附件桥接静默失效 | 已修:str(enum.value) 归一(f55e8c6) |
| high | 上传表格跑任务「输入行数 0」流程断点 | 已修:附件桥接 + attachment_read 暴露 local_path + PERSONA 指引(f55e8c6) |

验证:877 pytest 全过;媒体端点 media token 200;后缀 Range 206;test-install→reject 循环干净无残留。

## 3. 遗留问题(Codex 接手,按优先级)

### 高优先级

1. **审批等待占用默认线程池**:`_ds_native_approval` 用 `run_in_executor(None)` + urlopen 阻塞最长 ~14.5 分钟/审批,多个并发审批会耗尽默认 executor,拖死 `to_thread` 的其他调用。建议:专用有界 ThreadPoolExecutor 或异步短超时轮询。
2. **ctx.active_run 单全局槽**:web UI 影子 run 与 API run 并发时会互相覆盖,`_emit_tool_event_sync`/`request_approval` 可能把事件/审批归属到错误会话。建议:per-session active_run 字典 + 全局互斥(当前仅 classic 串行,影子 run 绕过)。
3. **test-install 在「生产运行时」执行**(有意的产品决策:审核页与正式脚本界面同一运行环境,真实副作用)。若同名适配器有定时任务,测试期会跑草稿代码。已做快照恢复,但「测试=生产执行」的事实需向用户明示或后续隔离命名空间。
4. **媒体 token 仍是静态的**(派生自 master),长期有效;建议升级为短期签名 token(HMAC path+expiry)。路径本身按用户要求全面开放(用户明确接受)。
5. **`_execute_plan` 的 `future.result(timeout=60)`**:超时后协程仍在主循环跑,实例可能照样启动,agent 收到「失败」却实际执行(重复副作用风险)。建议:超时改为「启动中」状态并回查实例,而不是判失败。

### 中优先级

6. `_settle_web_port` 探测窗口最坏 ~231s(文档写 15s),且端口范围内可能命中别的实例;建议绑定 worker 自身进程事实或缩短上限。
7. `_cleanup_orphan_backends` 按「命令行含 core.api_server + 环境含 data 目录」直接 SIGKILL,未验证父进程存活;多实例共存(发布态+开发态同 data)会被误杀。grep 防自杀守卫形同虚设(比较的是 PID 列)。
8. `_pick_free_port` TOCTOU(bind 检查后关闭再让 uvicorn bind),全失败时返回占用端口;MCP 端口在 cleanup 之前 pick,顺序不一致导致不必要漂移。
9. `_broadcast_run_artifacts` 在事件循环上同步做 zip namelist + SQLite,大 zip/慢盘会阻塞;建议 to_thread。
10. 审核页 TaskRunner 卸载时不停止运行中的测试任务(点「拒绝」时任务可能还在飞,Windows 卸载会失败留下孤儿适配器);建议拒绝前停止运行中的测试实例。
11. 审核页只显示 manifest.yaml 全文,任务脚本文件(真正执行副作用代码)不可见;建议详情返回全部适配包文件。
12. 附件 inbox 绑定「最近更新会话」(含已归档),上传时机与当前显示会话可能不一致;建议支持显式 session_id 传递。
13. preload apiCall 60s 全局超时:AbortError 原文透出给用户,超时后服务端可能已完成(重试双执行);建议可感知错误文案 + 长操作白名单。

### 新增遗留(最近迭代引入)

21. **多窗口浏览器与任务的绑定是「全部页面快照」**:browser.activity 广播 9222 全部 page tabs,窗口跟随「浏览器全局页面集合」而非「会话级页面子集」;多会话并行时,会话 A 操作会连带为会话 B 的页面也开窗口。若要严格按会话绑定,需产品侧维护「会话/任务 → tab」映射(grant.tab_id 已有雏形)并在广播中只带本会话 tabs。
22. **tab 关闭后窗口残留**:页面在 Chrome 中被关闭后,广播快照里消失,但 shell 的窗口列表只在下次广播时收缩(窗口会短暂保留,流在 ws 断开后停);可加轮询 tabs 快照清理僵尸窗口。
23. **附件表格解析大小上限未显式声明**:_read_local_excel 全量解析,超大 xlsx(>1GB)可能内存压力;建议限制行数/文件大小并明确报错。
24. **审批卡跨会话可见性**:审批卡挂在发起工具调用的会话界面,用户在别的会话看不到;需要「全局审批提示」(现有:会话标题会变为「等待审批」)。

### 低优先级(顺手可做)

14. `clear_agent_data` 清 12 张投影表但保留 attachments 物理文件/已发布适配器/workspace 草稿。
15. `tool_attachment_read` 无大小上限直接 read_bytes(大附件 OOM);先查 DB size。
16. `_broadcast_media_artifacts` 事件缺稳定 artifact_id(前端去重弱);同名文件不同目录无法区分。
17. repo_install 的 `name` 参数未清洗(路径穿越),`_safe_repo_url` 缺 IPv6/十进制 IP/DNS rebinding 防护。
18. 浏览器窗口 frame-meta 显示 `undefined×undefined`(帧 payload 无宽高)。
19. AgentProductLayer 里 `emit('artifact-show')` 无消费者(死代码,已保留为扩展点)。
20. 图片进模型未实现(DSH attachment 仅注册展示,模型视觉未接)——用户已知。

## 4. 环境事实(交接必备)

- 后端 token:`77d7cb1e26ac5dd64ac44ba7dd58afea38a7c807273a655fcde27fae3a2884f5`(data 目录 api-token)。
- 数据目录:`~/.crawshrimp`;dev 壳:vite 5173 + Electron CDP 9223;后端 18765,MCP +200,web host +300(漂移时按 `__DSH_BOOT__` 探测)。
- 验证方式:CDP 9223 主 frame + iframe isolated world(iframe 重载后 context 失效需重建);don't stop 循环:实现→自测→修复→复测→带证据。
- 打包:mac 双架构 dmg/zip 已产出;win-unpacked 可用,NSIS 需 Windows 机器(`npm run build:win`)。
- 关键 hash 类名(锁版 0.1.0-rc.6):侧栏 `.hHd-Xa_root`、会话列表 `.qDHVXG_list`、消息列表 `.Md3f7G_column`、滚动容器 `.wSkVaW_scrollBody`、输入框 `.wSkVaW_composerSeat/.wSkVaW_composerStack`、加号按钮 `.uV2eYG_add`、发送 `.uV2eYG_primary`。升级 DSH 需全部核对。

## 5. 交接文档索引

- `01-dsh-agent-v2-proposal.md` §18:提案对实现的落账。
- `02-delivery.md`:能力清单与证据。
- `03-media-in-chat-handover.md`:媒体展示 10 坑。
- `SPEC.md` §11-15:v2 增补(架构/权限/脚本规范/媒体展示)。
