# 系统提示词与参考图生图改动

## 行为变化

- 由抓虾 persona 统一身份，关闭重复开场；移除业务会话中的集成源码路径和 HMR/构建指导，Web 上下文只保留实际 URL 与页面观察边界。
- 明确文字生图、参考图改图、首帧生视频、先图后视频的工具用法与参数边界。工具不可用时不编造调用，状态未知时不盲目重复提交。
- 文件交付规则随回传工具注册，先检查自动交付状态。图片、视频工具返回实际 artifact_ids 与 requires_file_return，区分生成、提交和用户端展示。
- image_generate 新增 reference_image_paths 与 reference_attachment_ids，支持当前会话附件和原生聊天图片的只读路径。最多 10 张 PNG/JPEG/WebP，每张 20MB；校验实际图片内容、路径与附件会话归属。
- 识别原生聊天附件无扩展名文件的真实 MIME；参考图字节进入供应商 image 数组。每次调用创建独立生图任务，防止配置互相覆盖或沿用历史参考图。
- 包含依赖的 Key 选择逻辑：未指定档位时可用 4K 配置承接小尺寸请求，显式档位不切换，配置错误仅返回配置状态。
- 运行时提示词补丁支持全新安装与重复运行，并在 IM bundle 中生效。

## 验证

暂存内容导出到独立目录验证：

- 后端：184 passed，3 subtests passed（参考图、图片服务、1XM 客户端、Agent runtime）。
- Node：51/52 passed。唯一失败是 `LLM provider settings save provider rows directly and keep the compact settings page` 的 provider.logoImage 断言；用 HEAD 原版测试复核也失败，属于已有设置页问题。
- MCP 工具列表中的两个新增参数均为可选字符串数组。
- 本轮此前已完成 clean staging 与 Web profile config 检查。

## 授权真实服务测试

通过后端 tool_image_generate 使用两张商品正面参考图调用 gpt-image-2，显式选择 4K Key 档位：

- 8 个供应商任务完成，未重新生图；7 张为 2880×2880，详情页为 2160×3840。
- 7 次工具调用正常返回下载产物。1 次代理下载发生 IncompleteRead，被工具归为 GENERATION_FAILED；从同一任务的已有原图 URL 恢复下载，8 张均已解码与检查。
- 下载过慢、下载错误与生成失败混淆尚未修复。本次不表示聊天 UI 的自动展示已验收。
- AI 素材局部存在重绘，不能视为实拍细节或精确商品参数证明。

Key 仅在测试进程中使用。图片、私有运行数据和测试凭据不纳入提交。
