# 可恢复流程与应用档案

## 多步流程

`flow --plan plan.json --run-dir ./work/cu-run` 预览结构，任务已授权后加 `--execute`。最多 30 步，操作只有 `observe / wait / act`，计划不执行嵌入脚本。所有 act 均需独立 expect。等待只轮询读回，最多 30 秒；单次后端调用有独立超时，因此墙钟耗时可能更长。

下面的窗口 ID 和 selector 必须替换为当前观察值：

```json
{
  "flow_id": "local-draft-001",
  "window_id": 123,
  "steps": [
    {
      "id": "draft",
      "op": "act",
      "action": {"kind": "set_value", "selector": {"automation_id": "cu-input"}, "text": "本地草稿 🦐"},
      "expect": {"selector": {"automation_id": "cu-input"}, "property": "value", "equals": "本地草稿 🦐"}
    },
    {"id": "evidence", "op": "observe"}
  ]
}
```

每步从当前窗口身份重新观察，action_id 由 flow_id + step_id 稳定生成。请求、收据和 `flows/FLOW_ID/checkpoint.json` 一同保存。动作不能指定旧 snapshot/ref；请求一旦保存，就不会因恢复而重新生成。

- `verified_flow`：每个步骤都取得指定证据，business_success 仍为 false；提交/送达需业务证据。
- `waiting`：只读步骤未达到期望，可以用原计划、原目录继续等待。
- `unknown`：写步骤出现异常或未验证。原计划重跑返回现有检查点，不重发该写，也不运行后面的步骤。先从应用取得结果证据。
- 已验证步骤在恢复时跳过。改变已有 flow 的计划会拒绝；不能用新 ID 掩盖未知副作用。

恢复不是自动事务回滚，也不是外部应用的 exactly-once 保证。确认依赖状态仍然适用后再继续任务。

## 显式应用档案

```bash
python3 /path/to/scripts/computer_use.py probe --window 123 --out ./work/probe.json
python3 /path/to/scripts/computer_use.py profile record --probe ./work/probe.json --snapshot /absolute/observation.json --out ./work/app-v1.json --note '本次实际观察到的能力'
python3 /path/to/scripts/computer_use.py profile match --probe ./work/new-probe.json --profile ./work/app-v1.json
```

档案保存平台、应用身份和版本、可唯一定位的控件提示、能力路线、来源证据。只在用户授权的项目工作中显式写入；文件已存在会拒绝覆盖。可选 `--receipt` 只接受与该观察绑定的 verified_control 收据，并标注为控件证据。

版本/身份不匹配或版本未知返回 `stale`；匹配只返回 `compatible_hint`，从不自动应用。新任务必须重新发现窗口、端口和控件。档案不存可重用坐标/窗口句柄，也不写入全局记忆。不要在 note 中记录凭证或私密内容。

## 探测与故障恢复

`probe` 提供当前版本、语义树完整性和候选路线。Mac 读取应用字典、有限深度查找嵌套 Chromium、当前进程族监听端口以及相同 bundle 的安装副本；Windows 查看进程族端口和文件版本。只有观察到的应用端口才进行有限 GET 检查，且禁止代理和重定向；`--no-cdp` 可完全跳过端口请求。

发现 sdef 只证明命令存在，发现 CDP 只证明当前端点响应。仍需确认命令语义和确切任务页面，随后复用现有浏览器 skill。探测不启动应用、不重新登录、不打开调试端口、不切换隐藏页面。
