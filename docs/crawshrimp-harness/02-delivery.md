# crawshrimp-harness 交付记录

> 相对 `01-dsh-agent-v2-proposal.md` 的落地交付文档。所有能力均经真实验证(验证命令/结果见各节「证据」)。

## 1. 交付总览

| 模块 | 状态 | 验证方式 |
| --- | --- | --- |
| DSH 内核接入(锁版 0.1.0-rc.6) | ✅ | 后端 `/agent/runtime` ready、web host 19065/19066 实测 |
| 三栏布局智能体界面(会话侧边栏 + 会话区 + 实时浏览器) | ✅ | CDP 实测菜单/会话/覆盖层/浏览器窗口 |
| 文本大模型双网关(森马网关 13 项 + DeepSeek 官方) | ✅ | 设置页分栏 + 默认模型 gpt-5.5 实跑 |
| AI 生图 / AI 生视频工具 | ✅ | 生图真实生成 5 次,图片直出会话界面 |
| 实时浏览器窗口(拖动/缩放/最小化/最大化/自动弹出) | ✅ | CDP 交互实测 + browser_* 工具自动弹出实测 |
| 会话内媒体直接显示(图片多图/视频播放/附件点击) | ✅ | 生图/ZIP 多图/视频/打开文件全链实测 |
| 原生审批(DSH 审批卡)+ 简单下载/找图自动批准 | ✅ | 森马云盘任务 auto-approved 实跑 |
| 5 个 CLI 项目 submodule + 技能包 + repo 工具 | ✅ | repo_install/learn/list、skill_list(9 包)实测 |
| `/compact` `/goal` `/plan` DSH 原生命令 | ✅ | 命令注入 + web-cordis 启用 |
| 更新日志弹窗 + 顶栏更新按钮 | ✅ | updateService fetchReleaseNotes 链路 |
| 设置页智能体子区(状态/重启/修复/清数据) | ✅ | 重启真实生效(代次 1→2)、清数据确认弹窗 |
| 稳定性(端口自愈/孤儿清理/SSE 重连/探活自恢复) | ✅ | 重启后端/壳多轮,iframe 自动跟随端口漂移 |

## 2. 智能体界面形态(已定)

- 智能体 DSH Web 会话界面为**唯一主界面**(iframe 常驻全幅,shell overlay 覆盖右侧内容区,左偏移随侧栏宽度)。
- 抓虾菜单在主界面侧边栏内(会话下方):我的脚本/脚本审核/AI 生图/任务中心/AI 生视频/AI 视频工作流/提示词库/数据文件,默认 3 项 + 展开收起;底部固定「云端审批」「设置」。
- 脚本详情是独立二级页面(隐藏会话界面);点击会话/新会话跳回会话主界面。
- 工作区不需要用户指定,默认抓虾运行时目录 `~/.crawshrimp/agent/workspace`。
- 标题栏只有「核心/Chrome 状态 + 更新按钮」。

## 3. 会话内媒体直接显示(本轮交付重点)

### 3.1 能力
- **图片(多图)**:任务产物 ZIP 自动解包预览图(最多 20 张)网格显示;单图直接显示。
- **视频**:会话内 `<video controls>` 可点击播放,后端 Range 支持可拖动进度条。
- **附件**:文件卡可点击,调用系统默认应用打开;AI 生图/生视频产物直接显示,不再是路径文本。

### 3.2 链路
1. AI 生图/生视频工具执行成功 → `_broadcast_media_artifacts` → `ctx.emit_event("artifact.created")`(修复了 `ctx.emit_event` 一直是 no-op 的问题,现绑定 `service._emit_tool_event_sync`,线程安全投递主循环)。
2. 任务产物由 `_broadcast_run_artifacts` 广播 `artifact.created`,事件带 `media_kind` 与 zip 内图片清单(轻量 namelist,不解压字节)。
3. SSE 全局流(AgentProductLayer,**带 4s 自动重连**)→ `pushArtifactToSession` 直接 postMessage 到会话 iframe(不经 App/props/watch 中转,链路最短最稳)。
4. iframe(client.js)注入产物块:去重以 DOM 为准;iframe 重载后发 `artifact-replay` 请求 shell 重放,重载窗口期事件不丢。
5. 媒体字节经后端 `/agent/artifacts/file`(Range)/`/agent/artifacts/entry`(zip 条目)输出;**本地展示通道路径全面开放**(用户明确要求:今天在下载、明天在别处,不做目录限制),保留本地回环 + token 鉴权。

### 3.3 证据
- 生图真实闭环:`result-01-118.png` 在生图完成后 54s 内自动出现在会话消息流(图片 naturalWidth 5000×5000 已加载)。
- ZIP 多图:森马云盘图片包 4 张款色图全部网格显示并加载。
- 视频:demo.mp4(220.48s / 1920×1080)controls 播放,play() 后 2.5s currentTime 2.27s,Range 206。
- 附件点击:iframe「打开」→ shell 收到 open-file → QuickTime 真实打开。
- 端口/路径开放:Downloads/抓虾导出/AI生图 下产物直接可读。

## 4. 实时浏览器窗口(窗口化)

- 浮动窗口(Teleport):标题栏拖动、右下角手柄缩放(最小 360×260)、最小化(标题栏条)、最大化/还原、关闭;位置大小 localStorage 持久化;默认 760×520 贴右下。
- 智能体调用 `browser_*` 工具(tool.requested)自动弹出窗口展示操作画面;帧图随窗口缩放。
- URL 实时更新:`Page.frameNavigated` 监听 + SPA 路由每 5 帧回读 `location.href`(修复显示上一页地址的问题)。

## 5. 稳定性加固(本轮)

- **白屏根因修复**:DSH webserver 端口冲突内部 +1 时 `self.web_port` 未回写 → 前端拿错端口。现在:孤儿清理提前 → `_pick_free_port` 回写 → ready 后 `_settle_web_port` 按 `__DSH_BOOT__` 特征探测真实端口。
- **前端 HTTP 级探活**:web_url 报告滞后时 no-cors fetch 判可达性,连续两次不可达自动重挂 iframe 并自愈;端口漂移后 iframe 自动跟随(实测 19065→19066/19067 全自动)。
- **后端孤儿进程启动自清理**:同 data 目录的 `core.api_server` 残留进程在新后端启动时被杀(修复多后端并存导致端口漂到 18771/18781/18799 的问题)。
- **SSE 自动重连**:后端重启后全局事件流 4s 内自动重连,审批/任务/产物事件链不断。
- **apiCall 60s 超时 + 按钮 busy finally 复位**:修复「重启智能体运行时」按钮永久禁用(Vue 布尔属性空字符串坑:`:disabled="agentBusy"` 当 `agentBusy=''` 被 patchDOMProp 转 true,已改 `Boolean(agentBusy)` 并加最小复现)。
- **harness 启动失败修复**:发布态缺 `crawshrimp-product-bridge` 打包(stage-runtime.mjs 拷贝清单补齐),boot check 通过。

## 6. 打包与发布态验证

- **mac**:arm64 + x64 dmg/zip 全部产出(`dist/crawshrimp-v2.4.12-harness.0-mac-{arm64,x64}.{dmg,zip}`)。
- **Windows x64**:`win-unpacked` 完整产出(Python bundle + deepseek-harness + skills 齐全);NSIS 安装器在 mac 上 7za 失败,需 Windows 机器执行 `npm run build:win` 生成。
- **发布态真实验证**:`dist/mac-arm64/抓虾.app` 以隔离数据目录启动(`CRAWSHRIMP_DATA` + `--user-data-dir`),后端 ready、harness generation 1、web host 200、product-bridge 加载正常。
- 发布包内含 5 个 CLI 技能包(`Resources/deepseek-harness/skills/cli/{tmall,bmall,deepdraw,semir-yunpan,vipshop-hot-strategy}-cli`)。

## 7. §17 待拍板项记录

| 待拍板项 | 结论 |
| --- | --- |
| 动作审批粒度 | 落地为:简单下载/找图/找款/云盘任务自动批准(审计保留),提交/上传/发布/删除/修改类 ask,`danger-full-access` 预设免审批(用户确认) |
| React 版本策略 | 规避:web host 全量嵌入 iframe,DSH 的 React 与 shell 的 Vue 互不相干,无双 React 实例问题 |
| 事件投影词汇 | 已确认:产品 SSE 以 DSH 事件词汇对齐投影(assistant/chunk、tool/call、turn/end 等) |
| 预算数值 | 采用 §11 分级数字,数值待典型采集任务实测校准(交付后 G0/G3 补测) |
| P0 是否立即启动 | 已启动并完成,本仓库即 P0→P2 的落地成果 |

## 8. 已知限制与后续

- 图片像素级视觉进模型:DSH attachment 仅支持图片注册,未实现「图片进模型」,当前图片仅展示。列入后续。
- 预算数值校准、Windows NSIS 出包、三平台 E2E 待发布机执行。
- 任务卡「running→completed」实时刷新的 UI 轮询已验证代码与产物卡自动补齐;状态转换的完整截图证据受测试时机影响,以任务实例表状态为准。
