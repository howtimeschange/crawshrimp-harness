# 应用适配与经验沉淀

WechatAGI 提供的可借鉴经验是：平台路由、UIA/Win32 差异、真实控件等待、中文输入路径、串行队列、窗口失效后重新发现。微信联系人搜索、快捷键和发送判据都属于应用层，不进入通用内核。

每个可复用流程单独定义：

```yaml
app: example-editor
platform: Windows
version: observed-version
identity:
  executable: observed-path
surfaces:
  preferred: uia
  fallback: foreground-input
workflow:
  - observe target document
  - resolve unique edit control
  - set value
  - read value and inspect application state
completion:
  control: expected text matches
  business: saved document readback matches user-authorized path
unknown_result: re-observe; never resend automatically
```

这些是本次运行档案，不是需要安装的固定配置。记录 OS、应用版本、实际 selector、授权范围、失败与证据路径。窗口 id、坐标和端口不跨会话缓存；不要凭旧档案直接写。

微信发送流程至少分成“定位明确会话 → 核对标题/身份 → 填草稿 → 按已有授权发送 → 检查对应消息气泡及状态”。消息气泡出现只证明客户端呈现，是否服务端送达需应用提供的状态。发送结果未知时停止队列中该对象的重发，而不是循环按 Enter。

将验证过的流程做成专用脚本时，保留单步收据与稳定动作 ID；业务队列可复用 WechatAGI 的串行思想，但不能把函数没有抛异常等同于“发送成功”。本技能没有自动群发、图片剪贴板写入或微信特定坐标。
