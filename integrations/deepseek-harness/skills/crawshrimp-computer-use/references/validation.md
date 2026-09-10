# 验证记录 · 2026-09-10

本地开发包已完成当前可用环境的回归：macOS 26.5.2 / Apple Silicon / Python 3.12.13；UTM 4.7.5 的 Windows 11 25H2 ARM64 / Python 3.12.10 AMD64 模拟运行。Windows x64 实机未测。

## 已通过

- 两端各 38 项单测：协议、唯一 selector、保护字段、身份/坐标、去重/未知结果、跨进程锁、UTF-16、短引用、探测/诊断/profile、流程恢复、焦点合同、JSON 读写竞争、启动失败清理、异步焦点读回。技能 quick_validate 通过。
- Mac 自建窗口 12 项真实回归：后台 AX 中文/emoji 读写与按钮操作、常驻指针同进程同位置、另一进程前台保持、compact/probe/profile、实际借焦点点击与输入并归还、多步恢复、非空截图、系统事件流模拟接管且 unknown 不重发。
- Windows 自建窗口 12 项真实回归：相同的协议/流程/指针与读回路径，实际 UIA/Win32 后台读写，真实鼠标点击触发 EN_SETFOCUS，物理 Unicode 输入，焦点借用与归还；另用独立 fixture 进程切换前台模拟接管，确认停止且不抢回焦点/不重发。该项不是真人物理键鼠接管证明。
- 真实 TextEdit：后台 AX 多行中文/emoji 读回、另一进程前台保持、重复不投递、常驻提示和截图。最新共享代码改动后已重新执行完整 Mac fixture 回归；TextEdit 专项使用此前已通过记录。
- 真实记事本 11.2501.31.0 ARM64：UIA 观察、RichEdit 原生后台赋值、多行中文/emoji 读回（原生 CR 段落）、另一进程保持前台、重复不投递、常驻反馈、非空截图。
- Windows 新版彩色 🦐 banner：真实 HWND 截图，操作/等待状态均显示；前台 HWND 与系统鼠标位置不变；结束后 HWND 全部销毁。Windows 使用透明玻璃样式，未实现系统背景模糊/液态折射。
- 两端最终 feedback 状态均 stopped，所有自有 fixture 退出。截图逐张人工视觉审阅。Win32 测试 fixture 默认字体不显示 emoji 图形，但精确 Unicode 读回通过；记事本与新版 banner 均已显示虾形图标。
- 浏览器桥接此前已验证发现及 --help 透传；DOM/CDP 复用已有技能，本轮没有浏览器页面专项回归。

## 回归中修复

Windows 冷启动超时及孤立 HUD、文件读/原子替换的短暂占用、UIA 标准编辑器/按钮自行激活窗口、焦点激活异步读回、测试输入焦点保存与归还后焦点判据、RichEdit 动态 name 与段落格式。Mac 修复过 AXEnabled/数值桥接、IME 接管误判与窗口层级更新竞态。所有重新运行均为独占本地 fixture 或唯一测试文档，没有重发未知业务动作。

## 未覆盖

Windows x64 实机、Windows 10、原生 ARM64 Python；Mac Intel/旧 macOS；多 DPI/多显示器/RDP/UAC 等完整矩阵；真人物理输入接管；微信业务发送；Harness 内集成、安装包和 Windows ARM 上运行 Harness。UIA provider 可能激活应用，不能将几个应用的通过扩大为全部应用后台保证。未购买或激活 Windows。

## 复核

```bash
python3 scripts/setup.py
python3 -m unittest discover -s tests -v
python3 tests/smoke_desktop.py --focus --out /path/to/new-empty-run
# macOS: 仅操作本任务新建测试文档
python3 tests/smoke_textedit.py --out /path/to/new-empty-textedit-run
# Windows: 不存在其他 Notepad 进程时，创建唯一命名的本地测试文档
python tests/smoke_notepad.py --out C:\new-empty-notepad-run
```

Windows 必须在登录用户的交互桌面运行，不能以 guest-agent 的 SYSTEM/session0 结果替代桌面验收。运行期间人为切换焦点会按设计中断。记事本可能自动保存并在下次启动恢复测试标签页，测试文档路径记录在报告中。

## 后续阶段文案与主题专项

新增共享文案配置、真实阶段报送、6 秒中性等待轮换、60 秒阶段过期和 token 冲突保护；当时两端支持 glass/navy 主题（随后按用户选择，Mac 已固定 glass）。Mac 26 使用无染色 NSGlassEffectView，测试脚本已移除所有衬板。

本轮共 47 项单元/合同测试通过；Mac/Windows 的阶段专项与两种主题真实显示检查通过。Windows 完整桌面输入回归在初始焦点条件未满足时被系统拒绝，本轮未重新跑通，原有 12 项通过记录属于前一版。主题选择、触发规则见 feedback.md。

## 2026-09-10 停止按钮最终回归

- 两端各 55 项单元/合同测试通过，Swift 最终编译通过。
- 两端各 12 项完整桌面回归通过。Windows 本次测试准备在系统拒绝程序前台激活时，对可见、确认未遮挡的自有 fixture 标题栏正常点击获得前台；生产 focus lease 的约束和断言未放宽。
- 原生停止按钮实际鼠标点击：Mac glass、Windows glass/navy 均验证非激活、持久取消、正在等待的自有工作进程回收、窗口退出、禁止已取消目录重启。
- 真实输入中停止：500 字符请求在 Mac 324 / Windows 10 字符处停止，后续读回不再变化，unknown 回执不会重发。字符数量取决于当次输入与点击时序，不是固定性能指标。
- Mac 最终只保留用户选择的系统透明玻璃。Windows 默认为中性深灰透明合成，仍可选深蓝；Windows 不宣称拥有系统背景模糊或液态折射。
- Windows 环境仍为 Windows 11 ARM64 + AMD64 Python，不替代 x64 实机及更广 DPI/RDP/UAC 矩阵。
