# 会话内媒体展示(图片/视频/附件)问题交接文档

> 目标效果:AI 生图/生视频/任务产物的图片、视频、附件,**像消息一样出现在对话信息流里**(不是输入框底部的独立模块)。
> 状态:2026-08-14 已修复并实测验证(见「当前实现」);本文档记录过程中踩过的坑,供后续维护/Codex 接手参考。

## 当前实现(已修复)

链路:`ctx.emit_event("artifact.created")`(后端广播,带 media_kind + zip 内图片清单)→ SSE 全局流(AgentProductLayer,4s 自动重连)→ **AgentProductLayer 直接 postMessage 到会话 iframe**(不经 App/props/watch 中转)→ iframe(client.js)把媒体块插入 **`.Md3f7G_column`(消息列表)末尾** → 像一条消息出现在信息流;发新消息后块存活(React 重渲染不清理外来节点,已实测)。

- 图片:单图直接显示;ZIP 多图网格(后端 `/agent/artifacts/entry` 流式解压单条目)。
- 视频:页内 `<video controls>` 播放(`/agent/artifacts/file` 支持 Range,可拖动进度)。
- 附件:文件卡点击 → shell `openFile`(系统默认应用)。
- iframe 重载/端口漂移后:client.js apply 时发 `artifact-replay` 请求,shell 重放最近 12 条媒体消息;去重以 DOM 为准。

## 踩坑清单(修复过的)

### 1. 插入位置:块出现在「输入框底部、挤压对话框」
`.wSkVaW_scrollBody` 有**两个子节点**:消息视图区(`Md3f7G_root → Md3f7G_scroll → Md3f7G_column`,消息项在 column 里)与 **`.wSkVaW_composerSeat`(输入框)**。最初 `scrollBody.appendChild(block)` = 插到 composerSeat **之后**,于是块出现在输入框底部并挤压布局。**正确位置:`.Md3f7G_column`(消息列表)末尾**。类名是 hash,锁版 `@deepseek-ai/*@0.1.0-rc.6` 固定,升级 DSH 需核对。

### 2. iframe 重载窗口期事件丢失
后端重启/端口漂移时 iframe 会重挂;postMessage 到「正在重载的 window」直接丢。解决:① shell 缓存 sentArtifacts,client.js apply 后发 `artifact-replay` 请求重放;② renderArtifactShow 在 column 未渲染时 2.5s 重试;③ 去重以 DOM 为准(内存 set 会在页面重载后造成「有记忆无块」)。

### 3. 动态注入图片 lazy loading 不触发
cross-origin iframe 里动态插入的 `loading=lazy` 图片不加载(naturalWidth 恒 0)。已改 eager + `decoding=async`。

### 4. Vue props/watch 响应性异常(已绕开)
「App ref 更新 → 父组件重渲染 patch 子组件 props → 子组件 watch 不触发」:手动 watch(同一 props 对象)能触发、直接赋值 props 能触发,唯独父 patch 路径不触发(flush:'sync' 也无效,且现象随 HMR 状态变化)。**最终方案:绕开该链**——AgentProductLayer(SSE 消费方)直接 `document.querySelector('iframe').contentWindow.postMessage(...)`。教训:iframe 通信不要走多层 Vue 响应式中转。

### 5. React 19 受控 textarea 的 CDP 键入不稳定
测试自动化里 `native setter + input 事件` 时灵时不灵(React 状态未感知)。不影响产品功能,仅测试脚本需多次重试或改用真实键入。

### 6. 后端双实例竞态,run 被标 interrupted
`restartBackend` 与 backendController 的 respawn 竞态产生双后端;新实例「启动自清理」杀掉正在跑任务(审批等待中)的实例,`_recover_on_startup` 把非终态 run 标 `AGENT_DISPATCH_INTERRUPTED`。已修:controller 对「已 ready 后端」的瞬时 validate 失败先容忍重试(4 次)再杀进程。

### 7. 端口漂移与 web_url 报告滞后
API/MCP/web host 端口在重启时漂移;DSH webserver 在首选端口被占时内部 +1。已修:孤儿清理提前 → `_pick_free_port` 回写 `self.web_port` → ready 后 `_settle_web_port` 按 `__DSH_BOOT__` 特征探测真实端口;前端 HTTP 级探活(no-cors fetch)连续两次不可达自动重挂 iframe。

### 8. ctx.emit_event 一直是 no-op
`mcp_gateway.ctx.emit_event` 在 service 里只绑了 `lambda: None`,生图产物广播从未发生。已绑定 `_emit_tool_event_sync`(run_coroutine_threadsafe 投递主循环,异常经 done-callback 记录)。

### 9. 图片进模型(未解决)
DSH attachment 服务仅支持图片注册(PNG/JPEG/WebP/GIF),「图片像素进模型」未实现,当前图片仅展示。若要做:DSH attachment 协议 + provider 视觉适配,或产品侧把图片转给模型。

### 10. 智能体读不到项目文件(已放开)
`skill_read` 仅技能目录、DSH fs 工具被 disabled → 智能体读不到 `sdk/ADAPTER_GUIDE.md`。已加 MCP `fs_read/fs_list`(全盘读)+ `fs_write`(写经审批卡);适配器最小契约放进技能包 `crawshrimp-adapter-skill/references/script-contract.md`。

## 验证方法(可复现)

1. 智能体生图或提交森马云盘找款任务 → 完成后图片自动出现在会话消息流(不是输入框旁)。
2. 手动验证:`iframe.contentWindow.postMessage({__crawshrimp:'artifact-show', artifact:{...}, urls:{...}}, '*')` → 检查 `.cs-artifact-block` 在 `.Md3f7G_column` 内、图片 naturalWidth>0、发新消息后块仍存活。
3. 后端:`/agent/artifacts/file?path=...&token=...`(Range 206)、`/agent/artifacts/entry?path=zip&entry=...&token=...`(图片 200)。
