# 平台准备与边界

## macOS

```bash
python3 /path/to/crawshrimp-computer-use/scripts/setup.py
python3 /path/to/crawshrimp-computer-use/scripts/computer_use.py doctor
```

需要 Xcode Command Line Tools；Swift 编译产物只适用于当前构建架构，迁移机器后重新编译。推荐 macOS 14+，实际验收结果见 validation.md。

辅助功能用于 AX 和输入，屏幕录制用于截图。`doctor` 仅检查，不弹授权请求；授权主体由系统 TCC 归属决定，通常是运行代理的终端/宿主应用。缺失时说明具体权限，让用户在系统设置授予，必要时重启宿主。不要修改权限数据库。

AppleScript 先按 SKILL.md 的授权闭环执行 `automation-status --bundle-id`。检查不弹窗；需要申请时可由设置页用户按钮或智能体的 `automation-request --bundle-id … --purpose … --run-dir …` 通过可信宿主触发系统弹窗，允许/拒绝始终由用户选择；不要把 -10004/-1743 一律解释为用户未授权。

AppleScript 是 L0 的首选之一：先读取 `sdef /Applications/SomeApp.app`，确认命令语义，再以文件和 argv 调用 `osascript`。不要将用户文本拼接成 AppleScript 源码。例如，在已授权创建本地草稿的场景：

```applescript
on run argv
  tell application "TextEdit"
    make new document with properties {text:item 1 of argv}
  end tell
end run
```

调用 `osascript /path/to/create-draft.applescript '草稿正文'` 后，再从文档内容读回。此类应用专用脚本由任务适配器维护；不让通用动作入口执行任意脚本，也不自动重试。记录脚本哈希、传参范围和执行结果到本次任务日志。

L1/L2 使用小型 Swift JSON helper：AX 语义遍历、窗口截图、CoreGraphics Unicode。它补足 AppleScript UI 脚本的通用截图、坐标和非 ASCII 输入能力。没有使用 `keystroke "中文"`，也没有复制 WechatAGI 的剪贴板群发流程。

## Windows

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r C:\path\to\crawshrimp-computer-use\requirements-windows.txt
.\.venv\Scripts\python.exe C:\path\to\crawshrimp-computer-use\scripts\computer_use.py doctor
```

已有合适 Python 时可使用 `python scripts/setup.py --install-deps`。普通命令不自动 pip install，不更改系统 Python。

推荐 Windows 10/11、64 位 Python 3.10+。通过 pywinauto UIA 定位、读回；标准 Edit 和已识别的 RichEdit 使用 WM_SETTEXT 赋值，避免部分 UIA Value provider 主动激活窗口。`keyboard.send_keys` 属于键盘输入，**不是** WM_SETTEXT；后台写必须明确走 Value Pattern 或标准 Edit 赋值并读回。

UIA 运行在独立短命工作进程，避免目标 provider 挂住整个 Agent。DPI awareness 在加载 pywinauto 前设置；COM 由该进程中的 pywinauto 初始化，不把 UIA wrapper 跨线程缓存。

用户桌面须解锁，目标与代理权限相容。UAC 安全桌面、不同会话、RDP 断开/最小化可能造成输入/截图不可用；报告实际结果，不自行提权或“解锁”。PrintWindow 的返回成功不保证渲染内容有效，保留 `possibly_blank` 和 `content_verified:false`。

两端提供 `focus=require|borrow`。Mac 的显式借用通过有时限的 `osascript` System Events 激活目标，可能需要宿主的“自动化 → System Events”权限；使用 AX 归还具体原窗口。Windows 使用前台 HWND、低级输入 hooks 与非激活 Win32 提示条；系统拒绝前台切换就报告，不模拟 Alt、不修改系统前台锁定设置。

两端监视用户输入并在每个输入片段间检查焦点，接管后停止且不恢复旧焦点。不要把这个过程理解成操作系统事务：单个字符/点击可能已投递，未知收据不能重试。强制杀死进程时，焦点归还无法保证。

## 已验证的 Windows 语义路由

- `Edit`、`RichEditD2DPT`、`RICHEDIT50W`、`RichEdit20W`：仅对已观察为可写的 text_field/text_area，检查所属顶层 HWND、密码/只读样式后发送 WM_SETTEXT。真实记事本 11.2501.31.0 的 RichEditD2DPT 已后台验证；其余 RichEdit 类仍需应用实测。
- 标准 Win32 `Button`：仅普通/默认 pushbutton（BS_PUSHBUTTON/BS_DEFPUSHBUTTON）且有效原生 control ID，向父窗口投递 WM_COMMAND/BN_CLICKED。该通知不同于鼠标点击；读回业务状态才能确认效果。其他按钮使用 UIA Invoke。
- 其他控件使用 UIA Value/Invoke。provider 可能自行激活窗口；`foreground_trace` 区分提示层和应用调用导致的变化。不要承诺所有 UIA 操作都保持后台。
- RichEdit 的 UIA Value 可能以 CR 表示段落，即使输入是 CRLF。expect 仍做精确比较，由应用适配器基于已观察控件明确期望格式；不在通用协议中偷偷归一化。
- `type` 输入当前前台窗口中实际保留的输入焦点。窗口重新激活后，是否恢复原子控件焦点取决于应用；不要仅凭之前点过输入框就假设焦点仍在。

## CPU 架构与 Harness

本轮 Windows 11 25H2 ARM64 虚拟机使用 Python 3.12.10 AMD64、pywin32 AMD64、Pillow AMD64，通过 Windows 的 x64 模拟运行；被测记事本本身是 ARM64。这证明该组合的跨架构 UIA/Win32 路径可用，不能替代 Windows x64 实机验收。

截至本轮只读检查，Harness app/package.json 的 build:win 只准备 win32-x64，app/build.yml 的 Windows NSIS target 只包含 x64，没有配置原生 Windows ARM64 包。x64 安装包在 ARM 系统的完整运行还未验收。本技能不要求在虚拟机内运行完整智能体：宿主智能体可以把结构化请求交给客户机交互会话中的执行器；当前原生计划任务仅用于本地测试，不是产品化远程服务。
