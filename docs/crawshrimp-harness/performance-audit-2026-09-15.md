# 性能实测与代码审查 · 2026-09-15

> 后续已按要求移除两个工作流并完成修复，见 [修复与复测](performance-repairs-2026-09-15.md)。下文保留修复前的审查与基线数据。

## 结论

发现 **5 个有代码依据、并有实测支持的性能问题**。当前不能给出“Windows i3 / 8GB 全场景验收通过”的结论：本轮的 Windows 设备是 ARM 虚拟机，且客机测试使用源码生产渲染包、测试 IPC 和真实本地文件处理函数，并非完整安装版。

优先顺序：启动时同步权限加固 → 图片解码/目录扫描阻塞主进程 → 长日志全量传输与渲染 → 任务列表逐条查库。

未修改业务代码、未提交或发布。新增可复现的性能测试脚本与本报告。

## 测试环境与方法

- 审查提交：`c948181c7d441c7fb5518dae53d51a77ceaba351`，保留原有未跟踪文件。
- Mac：Apple M5 Pro、48GiB、18 逻辑核。运行当前源码 Electron + 真实 Python 后端，隔离 `userData` / `CRAWSHRIMP_DATA`，后端返回 `api=true`、端口 18846。使用生产 Vue 构建，关闭 DevTools。没有进行模型推理。
- Windows：UTM / QEMU、Windows 11 ARM、4 vCPU、8192MiB。开始前可用物理内存约 5.55GiB。分别运行 Electron 43.1.0 x64 转译版和原生 ARM64 版，在登录用户的交互会话中执行。
- Windows 页面测试使用实际 Vue 生产包和隔离测试 IPC；任务/模型/文件列表以空数据为主。本地目录扫描、图片缩略图、权限加固使用当前源码函数。数据库测试提取当前源码函数，在专用 SQLite 测试库中运行。
- CPU 降速 4 倍只作用于 Chromium 渲染线程，**不模拟 i3 型号、线程数、主进程速度、磁盘或 8GB 内存压力**。
- 图片：确定性合成的 6000×4000 JPEG；目录：1000 / 10000 个合成文件；数据库：100000 条合成运行记录、300 个任务；日志：1000 / 10000 / 50000 行实际组件渲染，100000 行后端序列化。
- 页面时间测到两次 `requestAnimationFrame`；目录/图片记录同步调用时间和主进程计时器延迟。工作集为 Electron 进程求和，可能重复计算共享页，不等于独占物理内存，也不包含 Python、DSH、Chrome。
- `performance.memory` 在普通页面测试中被 Chromium 取整，不能用其判断泄漏。日志组件测试使用 CDP `JSHeapUsedSize`，并做清空后的 GC 检查。

原始数据与源码哈希：[证据清单](qa-performance-2026-09-15/manifest.json)。

## 代码审查发现

### 1. [P1] Windows 启动时在主进程同步执行目录权限加固

位置：`app/src/main.js:581–602`；`app/src/windowsAcl.js:108–159`。

`ensureWritableDataDir()` 依次处理根目录及 adapters、adapter-meta、data、logs 共 5 个目录。每个目录调用 `hardenWindowsPathSync()`，同步执行 3 次 icacls 和 1 次 PowerShell；首次还需查询用户 SID。这些调用位于 Electron 主进程，设置 `async` 的外层接口不会使它们异步。

对这条**原始初始化函数**直接测量：

| 同一 Windows ARM 虚拟机 | 首次新目录 | 对已有目录再次调用 | 计时器被阻塞 |
|---|---:|---:|---:|
| Electron x64 转译 | 26.14s | 22.30s | 26.16s / 22.31s |
| Electron ARM64 原生 | 6.55s | 4.78s | 6.55s / 4.78s |

这是数据目录初始化耗时，不是完整安装版的开机到可操作耗时。主进程的数据目录结果有缓存，不能误称“每次 API 请求都执行这 5 个目录加固”；API token 也有进程内缓存。

建议：在工作线程/独立辅助进程中完成加固，批量处理目录；保留精确 DACL、重解析点检查与失败保护。若缓存，必须按实际文件对象身份处理原子替换，不能简单跳过权限保护。

证据：[x64](qa-performance-2026-09-15/startup-windows-x64.json)、[ARM64](qa-performance-2026-09-15/startup-windows-arm64.json)。

### 2. [P1] 缩略图在 Electron 主进程完整解码高清原图

位置：`app/src/main.js:893–942`，特别是 `nativeImage.createFromPath()`、`resize()`、`toJPEG()`。

文件字节限制并未限制解码后的像素内存。即使最终只要 280px 缩略图，也会先解码 2400 万像素原图。80MB 文件上限不等于 80MB 解码内存上限。

| 直接连续调用 | Mac ARM64 | Windows x64 转译 | Windows ARM64 原生 |
|---|---:|---:|---:|
| 1 张 24MP 图 | 127ms | 290ms | 171ms |
| 6 张 | 739ms | 2157ms | 1006ms |
| 12 张 | 1516ms | 4748ms | 2201ms |

Windows x64 的 12 次连续调用使主进程计时器延后 4752ms。上述是批量压力测试；实际工作流有 3 路缩略图请求并发，不能把 12 次连续同步调用时间直接等同于每次打开工作台的固定冻结时长。

补充通过真正的 Electron IPC 进行 3 路并发请求：12 张处理总耗时 **4296ms**，主进程最长事件循环延迟 **1027ms**。这是比连续直接调用更接近现有请求方式的证据。[IPC 数据](qa-performance-2026-09-15/windows-x64-ipc.json)。

建议：将解码/缩放移出主进程；限制解码像素与同时在途任务数；缩略图按源文件版本缓存，优先按需加载。已有 IntersectionObserver 和并发限制应保留。

证据：[x64 本地路径](qa-performance-2026-09-15/windows-x64-hotpaths.json)、[ARM64 对照](qa-performance-2026-09-15/windows-arm64-hotpaths.json)。

### 3. [P1] 视频工作流隐藏后继续同步递归扫描整个目录

位置：`app/src/renderer/views/AiVideoWorkflow.vue:4298–4305, 9354–9397`；`app/src/balaWorkspaceFiles.js:128–164`；`app/src/renderer/App.vue:148–153`。

工作流由 KeepAlive 保留，4 秒定时器只在 `onBeforeUnmount` 清理，没有 `onDeactivated` 暂停。扫描函数在主进程递归 readdir / stat / realpath，没有文件数/深度上限。`syncWorkspaceFiles()` 也没有防止上次扫描未结束时重复提交的保护。

实测：进入工作流后回到智能体，20 秒中仍调用 5 次 `listBalaWorkspaceImages`，目录为空也能复现。10000 个文件单次扫描：Windows x64 为 673–875ms，原生 ARM64 为 447–766ms，Mac 为 146–152ms。

同一 10000 文件目录通过实际 IPC 调用耗时 **1125ms**，主进程最长事件循环延迟 **1075ms**。[IPC 数据](qa-performance-2026-09-15/windows-x64-ipc.json)。

建议：仅在页面激活且确有需要时扫描；暂停隐藏页面的纯素材刷新，保持必要的任务完成通知；扫描放在异步工作进程，加入单次在途保护、范围限制与增量更新。

证据：上述 Windows 数据中的 `idle-after-workflows-20s.ipcCalls` 与 `directory-10000`。

### 4. [P1] 长日志无限累计、全量返回、全量渲染

位置：`core/api_server.py:458–461, 7954–7962, 14020–14029`；`app/src/renderer/views/TaskRunner.vue:2917–2943`；`app/src/renderer/views/TaskOutputDrawer.vue:80–85`。

后端跨运行追加日志，没有容量边界；日志接口每次返回整个数组。前端每 800ms 轮询，收到全量数据后才用 `latestRunLogs` 过滤最近一次运行。展开日志面板时，`v-for` 为每行创建节点；即使切到“输出文件”，日志区域仍使用 `v-show` 保留。

实际 TaskOutputDrawer 组件测试：

| 行数 | Windows x64，原速 | Windows x64，渲染线程 4 倍降速 | Mac，原速 |
|---|---:|---:|---:|
| 1000 | 80ms | 270ms | 22ms |
| 10000 | 421ms | 1855ms | 227ms |
| 50000 | 1765ms | 10566ms | 1173ms |

100000 行后端测试日志编码后约 25.55MiB；Windows 仅一次 JSON 序列化就需 103–133ms，尚未计 HTTP、IPC、解析和 DOM 更新。日志单次行长是合成负载，真实大小依输出内容而变。

建议：按运行分页/游标拉取增量日志，后端有界内存缓冲并将完整日志落盘，前端使用虚拟列表。需要保留完整下载能力；不能仅截掉用户的诊断信息。

证据：[Windows 组件](qa-performance-2026-09-15/logs-windows-x64.json)、[后端](qa-performance-2026-09-15/backend-windows.json)。

### 5. [P2] 全局任务列表每 5 秒重扫清单并逐任务打开数据库

位置：`app/src/renderer/App.vue:620–627`；`core/api_server.py:12528–12540`；`core/data_sink.py:66–72, 3082–3089`。

智能体空闲时仍每 5 秒 `getTasks()`；`/tasks` 调用 `adapter_loader.scan_all()` 重新读取所有 YAML，每个任务再调用 `get_latest_run()` 开新连接。连接路径还会做数据目录可写性探测和权限检查。

300 个任务 / 100000 条历史记录的源码查询测试：Windows 逐次开连接需 789–952ms；相同 SQL、共用一个连接的对照为 9.7–12.5ms。Mac 对应 126–137ms 与 1.4–5.5ms。这里只测最近记录查询部分，**不包含清单重扫、完整 `/tasks` 序列化和实际并发请求**。

建议：一次连接批量读取最近运行记录；静态清单按版本/mtime 缓存，动态运行状态单独增量更新；全局轮询增加单次在途保护。不能用固定缓存吞掉脚本安装/卸载变化。

证据：[Windows 查询](qa-performance-2026-09-15/backend-windows.json)、[Mac 查询](qa-performance-2026-09-15/backend-mac.json)。

## 场景覆盖与边界

| 场景 | 本轮覆盖 | 说明 |
|---|---|---|
| 当前源码启动、后端连接 | Mac 完整源码客户端 | UI 挂载约 1.09s；后端状态已就绪。不是冷开机测试 |
| Windows 启动数据目录初始化 | x64 / ARM64 原始函数 | 已测 5 目录加固；完整安装版启动未测 |
| 智能体、脚本、任务中心、生图、生视频、两种工作流、提示词库、文件、设置 | 10 个页面挂载与切换 | Windows 使用测试 IPC；主要为空列表和模型未配置状态 |
| 连续切换 | 30 次 | 没有出现渲染进程崩溃；不是长时泄漏验收 |
| 初始空闲、访问工作流后空闲 | 20s + 20s | 测出隐藏工作流继续扫描 |
| 最小化 | 15s，Windows x64 | 只验证短时后台状态和资源采样 |
| 目录规模 | 1000 / 10000 个文件，各 3 次 | 合成本地盘数据；未测网络共享/机械硬盘 |
| 高清图片 | 1 / 6 / 12 张 24MP | 本地缩略图；未提交付费生图请求 |
| 长日志 | 1k / 10k / 50k 行，原速及渲染降速 | 真实输出组件；不等同于智能体长对话 |
| 运行历史 | 10 万条历史、300 任务 | 原始最近记录查询函数 |
| 自动化浏览器、截图流 | 代码审查 + 既有单元测试 | Windows 真浏览器工作负载未测 |
| Excel/PDF/视频编解码 | 未实测 | 需要对应文件样本与完整客机运行依赖 |
| 模型流式长对话、工具调用、并行任务 | 未完成端到端实测 | 不用日志渲染或空态页面替代此项验收 |
| i3 真机、磁盘压力、4 小时稳定性、睡眠恢复 | 未覆盖 | ARM VM 与 4 倍降速不能替代 |

### 内存与空闲 CPU 观察

Windows x64 空态壳层的 Electron 工作集求和约 413–482MiB；原生 ARM64 约 312–331MiB。它们不含真正的 Python/DSH/Chrome 工作负载，因此不能据此认定整机 8GB 足够。

x64 转译环境的短时空闲 CPU 明显高于 ARM64：GPU/渲染进程占主要部分，最小化后显著下降。记录以进程累计 CPU 秒 / 墙钟秒统计，100% 代表占满 1 个逻辑核；4 核客机的整机百分比需再除以 4。图形虚拟化与转译会影响数值，不归因于 i3 硬件。

没有以短期工作集增长直接判断内存泄漏；图片测试本身构造并保留大位图，不能把那段工作集当作真实业务缓存增长。

### 附带发现与测试纠正

- Mac 真实后端和 Windows 修正后的本地提示词库夹具均可见 `ensureSelectedLibrary is not defined`；`LocalPromptLibrary.vue:274` 调用未定义函数。这是功能缺陷，本轮没有把它归为性能问题，也未修复。
- 第一版 Windows 夹具有缺失的只读 IPC 方法，相关页面结果不作为成功验收；随后补齐任务计划/任务状态等方法，最终页面记录单独保存。
- 最初通过客机服务会话启动 GUI，以及未等待 GUI 子进程的启动方式导致测试不完整；改为交互会话、`Start-Process -Wait` 后完成。不能把这些中断视为产品崩溃。
- Mac 完整测试结束后退出阶段有恢复/端口迁移日志；没有把退出期间计入稳定空闲基线，退出流程另需专门复测。

## 验证与复现

生产 Vue 构建成功；相关既有测试 **24/24 通过**，不代表全部产品测试或 Windows E2E 通过。[测试输出](qa-performance-2026-09-15/targeted-tests.log)

新增脚本（均仅写专用测试目录，不调用模型，不读取现有登录凭据）：

- `app/scripts/performance-audit.cjs`：完整源码壳层或 Windows 组件模式，页面/空闲/目录/图片/ACL，输出结构化采样。
- `app/scripts/build-performance-fixtures.mjs` + `performance-logs.cjs`：编译、测量真实日志输出组件。
- `app/scripts/performance-backend.py`：原始数据库/日志函数与隔离合成数据。
- `app/scripts/performance-windows-startup.cjs`：直接测量启动用的数据目录初始化函数。

在仓库根目录，Mac 示例：

```sh
cd app
npm run vite:build
cd ..
PERF_OUTPUT="$PWD/.codex-tmp/perf-source" app/node_modules/.bin/electron app/scripts/performance-audit.cjs
node app/scripts/build-performance-fixtures.mjs
PERF_OUTPUT="$PWD/.codex-tmp/perf-logs" app/node_modules/.bin/electron app/scripts/performance-logs.cjs
PERF_OUTPUT="$PWD/.codex-tmp/perf-backend" venv/bin/python app/scripts/performance-backend.py
```

Windows：使用与项目一致的 Electron 43.1，保留 `app/src`、`app/dist/renderer`、测试脚本相对位置；`PERF_COMPONENT_ONLY=1` 为组件模式。Python 测试需 pywin32，并保留仓库的 `core` 相对位置。GUI 必须运行在交互用户会话，使用 `Start-Process -Wait`，并分别指定全新的 `PERF_OUTPUT`。不要覆盖使用中的桌面数据目录。

## i3 / 8GB 下一阶段验收建议

在明确 i3 型号、Windows 版本、SSD/机械盘、集显和杀毒软件后，使用实际 x64 安装版复测上述 5 条修复前后差异。建议目标而非现有事实：交互 p95 <200ms、无连续 >1s 的主线程阻塞；20 轮场景切换后资源趋于稳定；运行 4 小时并保留系统可用内存、分页与完整进程树采样。

必须补齐：真实长对话流式输出、多个工具与浏览器标签、100 张高清图工作区、Excel/PDF、生成中最小化/恢复、3 个并行任务、异常网络与暂停/停止、关闭后子进程退出。未完成这些前，不标记 i3 / 8GB 全场景通过。
