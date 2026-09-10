# 执行协议 · v2 能力扩展（JSON schema_version 仍为 1）

## 观察

`observe` 默认返回 compact 视图：`platform / window / elements / image / preview / snapshot / full_evidence / diagnostics`，并将 JSON、原图保存到 run 目录。窗口身份由 `id + pid + process_started + executable` 组成。macOS 坐标为逻辑点；Windows 为 DPI 感知后的物理像素。

完整控件格式：`ref / selector? / role / name / automation_id / class_name? / enabled / focused / protected / actions / value? / rect?`。常用标准 role 是 `button / text_field / text_area / checkbox / combobox / menu_item / text / window`；其他原生 role 原样返回。不要假设两个平台具有完全相同的控件结构。

树最多 500 个节点；Windows 12 层，Harness macOS 32 层（覆盖 Electron 嵌套页面），macOS 另有遍历时间限制；`truncated` 时拒绝语义写，避免误判唯一匹配。Windows UIA 遍历不可用时尝试 Win32；控件没有相应 Pattern 就不声称支持。JSON 中 `value` 不存在表示不可读，不等于空字符串。

## 动作请求

请求来自本地 UTF-8 JSON 文件，不经过 shell 拼接，不解释 Python/JavaScript 代码。

```json
{
  "action_id": "draft-input-001",
  "snapshot": "/absolute/path/to/run/observations/SNAPSHOT_ID.json",
  "kind": "set_value",
  "selector": {"role": "text_field", "automation_id": "observed-id"},
  "text": "中文输入测试 🦐",
  "expect": {
    "selector": {"role": "text_field", "automation_id": "observed-id"},
    "property": "value",
    "equals": "中文输入测试 🦐"
  }
}
```

`snapshot` 使用刚返回的绝对路径，Windows 路径在 JSON 中用 `/` 或转义 `\\`。示例 selector 必须替换成实际观察值。

| kind | 参数 | 行为 |
|---|---|---|
| `set_value` | selector、text | 绝对赋值，控件必须提供可写 Value |
| `invoke` | selector | AXPress / UIA Invoke；不自动降级点击 |
| `click` | point | 窗口内点击，要求前台及无遮挡 |
| `type` | text | 单行 Unicode 字面文本追加，不使用剪贴板 |
| `key` | key | 显式按键，见下 |
| `scroll` | point、delta | 滚轮步数，正为向上，范围 -100..100，非零 |

支持按键 `ENTER ESC TAB BACKSPACE DELETE LEFT RIGHT UP DOWN HOME END SELECT_ALL COPY PASTE`。后三项分别映射 Mac Cmd / Windows Ctrl；COPY/PASTE 会使用用户剪贴板，只在任务需要时使用。

坐标必须明确单位，禁止按数值猜测：

```json
{"x": 0.4, "y": 0.6, "space": "normalized"}
```

`normalized` 在 [0,1) 内；`window` 是窗口内部坐标；`image` 是**原截图**像素，依据观察记录中的宽高换算。若模型看的图经过缩放，应使用归一化坐标，不把缩放图像素冒充原图像素。窗口移动/缩放或观察超过 120 秒均要求重新观察。位置在负坐标显示器是合法的，不用主屏尺寸裁掉副屏。

## 状态与重试

- `preview`：未执行；预演只校验协议、窗口与控件，最终门禁在动作发生前再次检查。
- `verified_control`：期望的控件属性已读回一致，**仍不是业务成功**。
- `executed_unverified`：已投递，缺少验证或验证未通过，退出码 2。
- `unknown`：执行期间错误、超时或中断，可能部分生效；退出码 2。
- `refused`：执行前协议/状态校验拒绝，退出码 2。后端投递阶段发生的拒绝保守记为 `unknown`。
- `error`：输入、依赖等错误，退出码 1。退出码 0 表示当前命令完成，不等于任务完成。

动作收据在 `run/actions/ACTION_ID.json`。相同 ID、相同请求只返回原收据；不同请求复用 ID 会拒绝。不得更换 run 目录躲开去重。该机制防止本工具重投，并非外部应用的事务或全局 exactly-once 保证。

每个动作持有用户级 OS 文件锁（POSIX flock / Windows byte-range lock），进程退出由系统释放；不删除锁文件，不用“检查后写普通文件”实现互斥。

`expect` 支持唯一 selector 的 `value / name / enabled / focused` 精确比较。执行后最多轮询约 5 秒，每个底层调用另有 25 秒硬超时。无目标、属性不可读不算 false 成功。文件存在或截图变化均不自动提升为业务成功；任务成功证据由应用适配器定义。

单独复核：

```bash
python3 /path/to/scripts/computer_use.py verify --snapshot /path/to/snapshot.json --check /path/to/check.json
```

check 文件内容就是 `expect` 对象；这里读取当前状态，不重复动作，也不改写原动作收据。

## 精简观察、短引用与诊断

compact 默认显示最多 50 条可操作或可读值控件，名称/值最多 160 字符；`omitted`、`*_truncated` 明确标注裁剪。`--limit` 支持 1..150。完整观察始终保存，精简视图不是唯一性判断的数据源。

`view --snapshot PATH --query 关键词` 只筛选已有证据，不重新读取桌面；需要新鲜状态时重新 `observe`。`ref: "e3"` 可替代 `selector`，两者不可同时传入；仅支持语义动作，后端仍重新检查唯一 selector。跨 snapshot 的 e3 不是同一控件保证。

缩略图只为快速阅读，`image` 坐标始终指原图；缩略图上的坐标使用 `normalized`。`diagnostics` 提供错误分类、恢复建议及 `auto_retry:false`，不自动切换控制通道重发动作。

## 显式焦点租约

物理动作可以加入 `"focus":"borrow"`，默认 `require`。收据的 `dispatch.focus_report`（异常时在 `backend_error.focus_report`）记录 requested、borrowed、restored、user_takeover、duration_seconds 和 hud_shown。只有 borrowed=true 且 restored=true 才表示确实发生借用并成功归还；requested=true 本身不证明借用。

结束时尝试归还原窗口与鼠标，用户接管后不归还；崩溃、强杀、目标销毁时只能尽力清理。提示条申请从捕获排除，但不保证所有录屏工具都隐藏它。控件 `focused` 表示该控件的焦点状态，仍应结合 `foreground` 区分全局前台。

完整多步计划与恢复规则见 [流程与应用档案](workflows.md)。

Windows UIA 的 `focused` 是当前全局键盘焦点状态。借焦点归还原窗口后，被测输入框 `focused=false` 属正常结果；要验证点击落点，可读回应用持久状态或明确观察归还前的控件事件，不能用归还后的 focused=true 同时要求另一个窗口前台。输入内容可能同时充当控件 name；赋值后的 expect 应使用稳定 automation_id 或唯一 role，避免以旧内容定位。
