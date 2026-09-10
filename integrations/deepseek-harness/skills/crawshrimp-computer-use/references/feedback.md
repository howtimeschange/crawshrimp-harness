# 任务期间常驻的视觉指针

指针是独立绘制的非激活、鼠标穿透窗口，不是系统光标。AX/UIA 后台赋值和按钮调用无需它提供输入；位置动画只是向用户解释操作位置。

实际 `act` 首次执行会启动当前 run 的显示进程，后续动作复用。指针停留在上次目标；新动作先移动，再显示执行提示和点击光圈；空闲时仍保留指针。任务完成或用户取消时调用：

```bash
python3 /path/to/scripts/computer_use.py feedback stop --run-dir ./work/cu-run
```

`feedback start/status` 用于显式提前启动和检查。状态记录在 `run/feedback/`；该目录的文件只传递视觉指令，不含任意脚本执行或系统输入接口。15 分钟没有新命令后自动关闭，避免宿主意外退出留下常驻提示。关闭只影响本次 run 的显示进程。

Mac 26 在对应 SDK/Swift 编译器可用时默认使用 NSGlassEffectView clear 原生液态玻璃，去除人为绿色染色；旧系统/旧编译器回退到中性 NSVisualEffectView。Mac 固定透明玻璃样式。Windows 提供中性透明与深蓝灰合成样式，不声称具有系统级背景模糊或液态折射。两端不创建背景衬板，尊重系统减少动态效果设置。

后台语义操作的 banner 与前台键鼠/借焦点的 banner 区分。显示窗口本身不激活、不接收键盘和鼠标，且不将用户鼠标移到动画位置。具体应用收到 AX/UIA 动作后可能自行弹窗或激活，这属于应用行为，应从前后台状态读回验证，不能宣称所有应用绝不改变焦点。

提示层默认请求从截图中排除，具体捕获工具可能不遵守。仅在本地视觉验收时通过 `CRAWSHRIMP_CU_FEEDBACK_CAPTURE=1` 将提示层纳入截图；不要用截图里看不到提示层来推断用户屏幕没有提示。

Windows banner 使用随包附带的彩色 🦐 PNG（Twemoji U+1F990，CC BY 4.0），代替原来的“虾”字占位；正在操作、借用焦点、空闲等待均复用同一图标。无需系统 emoji 字体或运行时联网，来源与完整许可见 THIRD_PARTY_NOTICES.md / assets/LICENSE-twemoji.txt。

## 阶段文案（2026-09-10）

文案统一维护在 `assets/feedback-copy.json`，两端读取同一份配置。当前共 9 类状态、11 组标题/副文案组合（7 个不同标题、11 句副文案）。

| 阶段 | 标题 | 副文案 |
| --- | --- | --- |
| background | 抓虾正在操作 | 后台操作 · 保持你的窗口焦点 |
| foreground | 抓虾正在操作 | 当前窗口操作 · 随时可接管 |
| borrowed | 抓虾正在操作 | 正在借用窗口 · 随时可接管 |
| idle | 抓虾任务进行中 | 稍等一下 · 等待下一步安排 |
| idle | 抓虾任务进行中 | 指针先歇一会儿 · 随时准备继续 |
| idle | 抓虾任务进行中 | 还在这里陪你 · 下一步就绪再出发 |
| thinking | 抓虾思考中… | 理一理刚刚看到的信息 |
| planning | 抓虾正在规划… | 把接下来的步骤安排妥当 |
| observing | 抓虾正在读取屏幕 | 看看窗口里有哪些新变化 |
| verifying | 抓虾正在核对 | 确认刚才的操作是否到位 |
| waiting | 抓虾正在等候 | 等待应用响应 · 不重复操作 |

普通 idle 每 6 秒更换一句中性等待提示，不自动轮播成“思考/规划/读取”。减少动态效果开启时固定显示首句。切换只更新现有 banner，保留指针位置与原有窗口。

Agent 在实际分析观察或规划动作前显式报告阶段：

```bash
python3 /path/to/scripts/computer_use.py feedback phase --run-dir ./work/cu-run --phase thinking
python3 /path/to/scripts/computer_use.py feedback phase --run-dir ./work/cu-run --phase planning
```

公开阶段为 `idle/thinking/planning/observing/verifying/waiting`。显式 phase 命令会在需要时启动当前 run 的提示层；`status` 返回当前阶段、标题、副文案和阶段 token。

提示层已启动时，`observe` 自动进入 observing，动作后的 expect 读回进入 verifying，flow 的 wait 进入 waiting。完成后仅清理自身阶段 token，避免较晚结束的读操作覆盖新阶段。单独读操作不会为了显示文案而新开提示层；提示失败也不改变动作收据或引发重发。

阶段自最后一次明确设置起 60 秒没有续报，就回到中性 idle；查询 status 和轮播不续期。长时间思考/规划应由 Agent 根据真实活动续报，不能用假心跳声称仍在工作。任务结束仍调用 feedback stop。

## 外观主题

默认 `glass`：Mac 26 为无染色的原生 clear glass，文字随系统外观调整；Windows 为中性透明合成回退。Windows 可选 `navy` 抓虾深蓝灰半透明底色，配白色文字；Mac 不读取此选项。右侧为停止按钮。

```bash
# 在启动本次提示进程前设置；仅影响当前 shell 及其子进程。
export CRAWSHRIMP_CU_FEEDBACK_THEME=navy
python3 /path/to/scripts/computer_use.py feedback start --run-dir ./work/cu-run
```

选择透明版时设为 `glass` 或不设置。已存在的 worker 保持启动时主题；切换需先 feedback stop，再启动，不会动态改动全局设置。

提示层本身只有圆角窗口；此前预览使用的矩形纯色背景是测试衬板，现已从测试脚本移除。新的预览直接截取真实桌面上的提示层，不创建衬板或遮挡用户窗口。

## 手动停止与取消协议

Mac 使用独立 64×32 的非激活按钮 NSPanel，主提示条及指针保持 `ignoresMouseEvents=true`。Windows 也只让独立按钮 HWND 接收鼠标，保留 `WS_EX_NOACTIVATE`，`WM_MOUSEACTIVATE` 返回 `MA_NOACTIVATE`；其余窗口仍使用透明/禁用样式。两端均在点击后持久写入当前目录的 `cancel.json`，不等待提示层锁。写入失败时按钮保持可用。

取消后工作进程优先协作退出：输入事件对/Unicode 批次之间检查，避免主动拆开按下与释放；父进程每约 50ms 检查并给予 750ms 清理窗口，随后仅终止并回收自己启动的卡住的工作进程。操作系统/应用中已排队的 AX、UIA、Win32 操作无法召回，因此回执保留 unknown。用户停止后不主动恢复系统鼠标或前台焦点。

状态查询返回 `cancelled`。标记永久保留，无自动解除。正常 `feedback stop` 不写取消标记。截图默认排除视觉层；验收模式需显式 `CRAWSHRIMP_CU_FEEDBACK_CAPTURE=1`。

实机专项：`python3 tests/smoke_stop.py --out <new-directory>`，实际鼠标点击 Mac 玻璃与 Windows 两种主题按钮，验证前台不变、取消信号、正在等待的工作进程终止、提示层退出及禁止重启。

Mac 主题已按最终选择固定为透明系统玻璃，不再提供深蓝选项；`CRAWSHRIMP_CU_FEEDBACK_THEME=navy` 只影响 Windows。
