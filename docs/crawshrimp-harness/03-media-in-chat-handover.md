# 会话内媒体与附件交接

> 更新时间：2026-08-15。目标是让图片、视频和附件像消息一样出现在 DSH 对话信息流中，而不是放在 composer 旁边。

## 当前链路

```text
任务/AI 产物
  → artifact.created（SQLite seq + 全局 SSE）
  → AgentProductLayer 按 runtime session 缓存
  → 安全 postMessage 到当前 DSH iframe
  → crawshrimp-slots 插入 .Md3f7G_column 末尾
  → iframe 重载后 artifact-replay 重放最近 12 条
```

- 单图直接显示；ZIP 图片最多 20 张，以网格展示。
- 视频使用 `<video controls>`，文件端点支持 RFC Range 和 `bytes=-N`。
- 普通附件显示文件卡，点击后由 Electron shell 调用系统默认应用。
- AI 直接产物使用稳定 `media-<hash>` ID；任务产物沿用数据库 artifact ID。
- 跨会话产物只缓存到所属 runtime session，切换会话时重放，不注入错误会话。

## 上传与模型输入

- DSH composer 原生加号被改造成 `📎`；旁边新增 `@` 命令按钮。
- 文件选择、拖入和粘贴都必须发生在 composer 区域，不能 document 级全局拦截。
- shell 上传时显式携带 `runtime_session_id`；后端把附件复制进受控目录并绑定产品 session。
- PNG/JPEG/WebP/GIF 且不超过 8 MB 的图片转为 DSH image block；每轮最多 5 张。
- 非图片或超限图片仍作为附件提示进入文本，不会被伪装成视觉输入。
- `attachment_read` 再校验附件属于当前 run 的产品 session，跨会话 ID 会拒绝。

## 媒体 capability

媒体 URL 不携带主 API token。流程是：

1. preload 用认证 header 调用 `POST /agent/artifacts/sign`。
2. 后端确认目标文件或 ZIP entry 存在。
3. 返回短期 HMAC capability，签名绑定 `v2 + route + expiry + path + entry`。
4. 无 header 的 GET 仅可访问 `/agent/artifacts/file` 或 `/agent/artifacts/entry`。

签名不能从 ZIP entry 切换到完整文件、不能改 path/entry、不能调用签名端点、不能延长 expiry。

## 已踩过的 10 个坑

### 1. 插入节点选错

`.wSkVaW_scrollBody` 同时包含消息区和 `.wSkVaW_composerSeat`。对 scrollBody 直接 `appendChild` 会把媒体放到输入框之后并挤压布局。正确节点是消息列 `.Md3f7G_column`。

### 2. iframe 重载期间事件丢失

postMessage 发给正在替换的 window 会静默丢失。shell 必须按 runtime session 缓存产物，client apply 后主动发送 `artifact-replay`，DOM 未就绪时最多重试 6 次。

### 3. 内存去重导致“有记忆无 DOM”

iframe 重载会丢 DOM，但旧 JavaScript set 可能仍在。当前以 DOM `data-*` 标记为最终去重依据，shell 同时保留稳定 artifact ID。

### 4. 动态 lazy image 不触发

cross-origin iframe 动态插入 `loading=lazy` 可能一直不加载。媒体图片使用 eager，保留 `decoding=async`。

### 5. Vue props/watch 链不稳定

父 ref → props → 子 watch 在 HMR/iframe 重载组合下曾不触发。现在 SSE consumer 直接定位唯一 AgentWebView iframe 并 postMessage，不走多层 Vue 响应式中转。

### 6. postMessage 信任边界

发送使用 iframe 当前 origin；接收同时验证 `event.source === iframe.contentWindow` 和精确 `event.origin`。其他 overlay/iframe 不能冒用打开文件、上传或切换会话通道。

### 7. 跨会话上传串线

文件选择器完成时用户可能已经切换会话。选择动作捕获原 runtime session，注册与回填提示都按该 session 排队；当前会话不匹配时不写 composer。

`currentRuntimeSessionId` 不能同时承担“本地已读取”和“已通知 shell”两个语义。附件重放会先读取持久化 session；若共用变量，后续 publish 会误判为已上报，shell 永远拿不到当前会话。当前用独立 `lastPublishedRuntimeSessionId` 去重上报。

### 8. 图片“注册了”不等于进模型

只插入附件文本不会给模型像素。当前实现把受支持图片转为 `{type:'image', mediaType, data}` 并通过 `session.prompt(..., 'queue')` 排队；Worker 也验证 MIME 和文件大小。

### 9. 大文件和 ZIP bomb

上传 200 MB、解析 50 MB、模型图片 8 MB；ZIP preview 单条目 64 MB。读取 ZIP entry 前先检查 `ZipInfo.file_size`，不能先 `read()` 后判断。

### 10. Range 与 token 泄露

后缀 Range `bytes=-N` 必须返回最后 N 字节；媒体 URL 不能放主 API token。当前用 route/path/entry/expiry 绑定的短期签名，并设置 `Cache-Control: no-store`。

## 复现检查

1. 上传一张支持的图片，确认 composer 有附件提示且 DSH prompt 包含 image block。
2. 在会话 A 产生图片，切到会话 B，确认 B 不出现；切回 A 后重放。
3. 让 iframe 重载，确认 `.cs-artifact-block` 重新出现在 `.Md3f7G_column`，没有重复。
4. 对视频请求普通 Range 和 `bytes=-N`，确认 206、`Content-Range` 与字节内容正确。
5. 篡改媒体 capability 的 route/path/entry/expiry，确认 401；有效签名确认 200。
6. 上传超限、伪图片、可执行文件和跨会话 attachment ID，确认明确拒绝且无残留临时文件。

升级 DSH 时必须重新核对 `.Md3f7G_column`、`.wSkVaW_scrollBody`、`.wSkVaW_composerSeat/.wSkVaW_composerStack`、`.uV2eYG_add` 和 `.uV2eYG_primary`。
