# ModelJetty 模型回归排查（2026-10-21）

## 已修复并上线

GPT-6 Luna 的 429 并非测试账号余额不足。New API 测试用户和用户 Key 均有余额；内部 sub2api 桥接 Key 留有 1 USD 测试上限（已使用 1.00923274）且已到期。已移除内部测试上限和过期时间，恢复 active，保留 group、Docker 子网白名单和历史用量。未修改客户余额、充值或重置消费。

通过独立 GET 回读配置，再经过 OAuth → Electron 本机 broker → 账号服务 → New API → 模型实测，GPT-6 Luna 返回成功（当前运行客户端 2.605 秒，前一轮独立 OAuth 测试 7.097 秒）。内部桥接用户自身仍有独立余额，需运营持续关注该余额；本次没有擅自增发余额。

官方目录原先硬编码 3 个文本 + 3 个图片模型，现扩展至后台当前支持的 19 个文本 + 3 个图片模型。GPT 文本使用 Responses，DeepSeek/Gemini 文本使用 Chat Completions，图片保留各自协议。展示仍与用户 Key 可用模型取交集；新建 managed Key 权限从同一个目录生成，避免名单不一致。已有受限 Key 不自动扩大权限；本测试 Key 本来未限制模型。

服务器版本：`/opt/modeljetty/accounts/releases/20261021-models`。真实登录后回读 19 text / 3 image。现有运行客户端在重启后刷新目录。并未对所有新增型号逐一发起付费生成，目录可用不代表全部能力均已实测。

## DeepSeek 慢请求：已定位范围，尚未确认彻底修复

原导出会话首个问候请求约 39.1 秒才出现文字，41.1 秒结束。匹配 New API 原始计费日志：18986 输入 tokens，35 输出 tokens，服务端处理约 1 秒，首响应 371ms；标题请求也在到达服务端之前等待约 30 秒。主要延迟位于模型服务之前，不能据此认定 DeepSeek 推理慢。

本轮完整 system + 原 95 个工具定义对照测试约 1.9–2.2 秒；通过用户当前运行的 Electron broker 请求约 4.037 秒（首字节 3.560 秒）。未复现原 39 秒等待，无法进一步确定是当时网络建连、凭证刷新还是客户端调度。没有用缩短上下文或关闭推理掩盖问题；推理默认修改尝试未部署，已撤销。

## 验证

- `HARNESS_ROOT=/Users/xingyicheng/Documents/crawshrimp-harness npm test --prefix account-service`：7 通过、0 失败、0 跳过。
- 真实 OAuth、客户端 broker、生文、服务目录读回通过。
- `git diff --check` 通过。
- 未提交、推送或发布桌面安装包。
- 私有详细证据位于 ModelJetty `work/model-latency-20261021/` 与 `work/membership-20261021/`。不包含在公共交付中。
