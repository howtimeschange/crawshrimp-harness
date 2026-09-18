# Harness 跨平台性能优化：实施与验证记录

更新：2026-09-18。分支：`codex/cross-platform-performance-20260918`。基线 HEAD：`715e24642700adb7863bb4441a16451a1214f4eb`。

**状态：代码优化及自动化回归已完成一轮；Mac / Windows VM 当前版本实机验收进行中，尚未通过最终交付门槛。** 按用户最新指示先提交并合并本地 main；没有 push、Release、安装器或 updater 发布。Windows ARM 原生发行按用户要求排除；原有 Windows 启动、断线恢复、中文进度与 Office 路径修复保留。

## 实施对照

| 方案 | 当前实现 | 验证与边界 |
|---|---|---|
| P0 诊断 | `CRAWSHRIMP_PERF=1` 启用 Electron IPC/启动/内存/事件循环采样；API响应头耗时、loop lag、上下文数字指标、投影队列长度；样本有界 | 不记录提示词、工具参数、路径或密钥；响应头时间不是完整流式任务耗时 |
| P1-1 文件/PDF | 异步遍历；匹配数、访问数、深度、时间预算；最多8个扫描；按窗口隔离取消；UI旧结果围栏。PDF单页按需、16队列、3MP/1800像素限制、修订/页码/引擎缓存、关闭取消；原图base64在线程中转换 | 500页PDF函数探针通过；目录返回一份受预算限制的清单，尚非逐页追加的UI；网络文件系统底层调用的中断受OS约束 |
| P1-2 懒加载 | 非首屏页面、tldraw标注、React/three图片动效按需加载；加载中、失败、重试界面 | 生产构建通过；完整首屏静态依赖合计下降92.36%，不等于整机启动时间下降92% |
| P1-3 后台展示 | App/Agent轮询前台5秒、隐藏60秒、恢复立即刷新；GET快照1秒TTL/共享在途/写入失效；图片失活停轮询和展示计时器；隐藏动效停止；DSH维护降到5秒并跳过隐藏页 | 采用兼容现有API的短时共享快照，未重写全套任务推送协议；后台任务本身继续运行 |
| P1-4 浏览器预览 | 隐藏/最小化停止截图；显示恢复；restart/可见性串行化；结束后禁止迟到帧；按视口与滚动偏移限制截图分辨率 | 静止页面的前台截图仍沿用原采样节奏；隐藏0帧和高DPI需要实机证据 |
| P1-5 Windows ARM | 排除本轮 | 未改变构建架构目标 |
| P2-1 事件/SQLite | Python通知投影队列64条/8MiB；RPC在非饱和队列下绕过慢投影；事件插入和会话更新单事务；持久化移出事件循环、保序；终态屏障与取消时commit屏障 | 保留200ms/1024bytes文本合并；未启用未经A/B验证的WAL；队列饱和压力与Node输出背压继续实测审查 |
| P2-2 上下文 | request/header与request/context只向Python投影模型信息和数字尺寸；记录工具/系统字节、请求路由元数据字节和供应商tokens/cache指标 | 完整上下文仍留在DSH；没有删除工具或授权规则；没有证明模型输入tokens减少20–40%，字节指标不是tokens估算 |
| P2-3 后端启动/扫描 | 安装元数据stat键有界缓存；内容不变不写回；知识索引加锁、后台预热；openpyxl按需导入 | 保留迁移、调度恢复、权限等必要屏障；保留既有manifest解析缓存；没有添加全目录watcher |
| P2-4 图片worker | Pillow NDJSON进程复用、30秒闲置退出、崩溃/超时恢复、单路解码；32在途/128项/16MiB缓存；40MP像素和80MB源文件限制 | 原图worker8队列；当前缓存以进程内为主，未新增跨会话持久缩略图缓存；不改变媒体授权 |
| P2-5 Office | 同会话最近20候选、源hash/文件名/选项/runtime/fonts键、所有产物hash检查；命中复制到新job，重置视觉审阅；重算禁用缓存 | 不共享无隔离LibreOffice实例；候选选取仍遍历会话目录；保留完整文档审阅 |
| P2-6 资源预算 | ≤8.5GiB：Office1/网络4/轮询8；更大内存：Office2/网络8/轮询16；保留provider更低上限；缩略图单路 | 是硬件档位初始预算，非动态内存压力控制器；真实混合压力仍待验收 |
| P2-7 日志/缓存 | 有界1024队列、批量写日志、终态/下载屏障；单个坏日志路径不阻止健康任务；失败路径下载仍报错；30天冷日志无损gzip，每轮最多4个、每文件≤64MiB，跳过活动日志、访问恢复；PDF缓存128页/256MiB | 用户历史不删除；没有以磁盘配额强删用户日志；故障落盘丢失不能假称恢复成功 |
| P3 打包与次要页 | 排除测试、renderer开发源码、sourcemap、pycache；次要页面随懒加载受益 | 未发布安装器，未测Defender完整安装扫描；既有更新冷却/在途保护保留，不无依据增加更新重试 |

这份表列出实际实现及替代方案，不将设计中的探索目标、可选实验和验收门槛混写成已实现收益。需要平台硬件、真实运行或上游模型对照的结论，以后续实机记录为准。

## 已完成验证

证据目录：`artifacts/performance-implementation-20260918/`。原始方案/基线在 `artifacts/performance-plan-20260918/`。

| 门槛 | 当前证据 |
|---|---|
| 客户端完整测试 | `review-app-tests.log`：814 passed，包含最后目录取消等修复 |
| Python完整测试 | `python-complete-preqa.log`：1850 passed，1 skipped，53 subtests；之后日志隔离改动又跑相关专项 |
| 最后Python专项 | `review-python-tests.log`：71 passed（性能、日志、任务生命周期、Agent控制与实例运行） |
| DSH集成 | `integration-tests.log`：43 passed |
| 事件取消与持久化 | `persistence-review-tests.log`：180 passed |
| Office缓存/审阅 | `office-final-preqa.log`：21 passed；`last-office-cache.log`：19 passed，覆盖文件名和validation路径修复 |
| 生产renderer构建 | `review-renderer-build.log`：成功，当前 `app/dist/renderer` 对应复查修复 |
| 主机DSH暂存 | `stage-runtime.log`：完成；启动配置由真实客户端继续验收 |
| 差异检查 | `git diff --check` 通过；本地提交按最新授权执行，未发布 |

### 可量化结果

- 首屏静态JavaScript入口与同步依赖合计 **276,307 bytes**，基线 **3,614,831 bytes**，减少 **92.36%**。依据 `renderer-comparison.json`。这是构建体积，不是安装版启动计时。
- 500页PDF函数探针：第一页约91ms、末页85ms、重复第一页66ms，只返回所请求页；计时器最大间隔11.53ms。依据 `media-probe.json`。首次探针发现PyMuPDF旧导入在stdout打印警告导致JSON解析回退，已改为`import pymupdf as fitz`并复测。
- 同一5000文件目录异步扫描约155ms，旧同步函数约63–78ms。总耗时更长，目的在于释放主线程；不能把它宣传成目录吞吐更快。
- 12张纯色24MP JPEG：复用worker首次约38ms、后续约5–6ms。纯色合成输入不能代替真实照片；原图数据传回后字节一致。
- 5万行日志同轮对照（包含flush和完整导出）：基线3662ms、优化125ms，双方导出均5万行。依据 `log-comparison.json`。单轮微基准，不是长期p95或跨平台保证。

### 复查中自行修复

1. 异步目录扫描旧结果可覆盖新选择：补取消IPC、窗口隔离、清空/卸载取消及结果围栏，截断提示按实际原因显示。
2. PDF导入警告破坏JSON：切换无警告的PyMuPDF导入并验证500页。
3. 事件commit线程仍在运行时取消协程会释放排序锁：等待commit并发布序号后再释放，补回归。
4. 退出确认被用户取消后图像worker永久关闭：清理移动到`will-quit`。
5. Office缓存文件改名/验证路径陈旧：文件名入key，validation路径映射新job。
6. 浏览器滚动截图偏移及restart/隐藏竞态：使用当前layout偏移并串行切换。
7. 单个日志文件写失败会毒化全局writer并跳过同批健康文件：按路径记录失败、继续其他组、下载检查自身错误、全局终态屏障不因其他任务失败而失效。

## 实机验收状态

独立任务：`01a0b3ee-d013-7021-bae1-545d1091ccc8`，GPT-6 Astra / 轻度。用户在本地启动成功；原自动工作树创建未完成，当前实际使用本优化分支的源目录与独立QA数据。代码身份以 `.codex-tmp/dont-stop/performance-20260918/source-snapshot.json` 为准。

实机任务检查点：`.codex-tmp/dont-stop/performance-client-qa-20260918/checkpoint.json`。交接要求覆盖Mac/Windows真实客户端、DeepSeek中文多轮与工具、单次网页/自然定时/固化脚本重跑、500页PDF、图片/Office、隐藏截图、恢复、30分钟长任务和4小时受控稳定性。

**这些场景当前仍在执行，不能视为通过。** Windows设备是Windows11 ARM / 4vCPU / 8GB虚拟机中的x64环境；不冒充Windows x64物理机、Intel Mac或Windows ARM原生链路验证。最终会在此补充真实证据、修复和缺口。
