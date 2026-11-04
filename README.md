# Crawshrimp Harness / 抓虾智能体

**[访问抓虾 Harness 官网 · 查看介绍与下载](https://harness.crawshrimp.com/)**

Crawshrimp Harness 把抓虾桌面应用与 DeepSeek Harness（DSH）组合成一个本地优先的电商运营智能体。DSH Web 会话是唯一主界面；抓虾提供任务、Adapter、文件、浏览器 CDP、媒体、审批和审计能力。

本仓库是独立的 Harness 开发线，不是上游 `crawshrimp` 发布仓的 README 镜像。当前桌面版本为 **0.4.12**，DSH 依赖族精确锁定在 `@deepseek-ai/dsh@0.2.1-rc.2` 与 `@xmanrui/dsh-im@4.11.0`；升级时必须重新验证 Web Profile/RPC、插件和 hash 类名。

## 合作交流与赞助

欢迎联系作者，交流本地 AI 智能体、电商任务编排与浏览器、文件和 Office 工作流，探讨工具接入、场景落地和项目合作，或赞助支持 Harness 持续开发。

使用微信扫描下方二维码添加好友，备注「抓虾 Harness + 合作 / 交流 / 赞助」即可。

<a href="https://crawshrimp.com/wechat-qr.jpg">
  <img src="https://crawshrimp.com/wechat-qr.jpg" alt="作者的微信联系二维码，用于抓虾 Harness合作交流与赞助联系" width="280" />
</a>

## 个人账号与云端边界

Harness 面向个人本地使用，本地功能免登录。个人账号通过 ModelJetty 网页授权登录（OIDC + PKCE），可使用账号已开放的官方模型、查看套餐与额度，以及访问脚本市场；也可以配置自己的模型供应商与 API Key。模型可用性、上下文预算和用量以服务端目录与记录为准。

登录会话通过系统加密保存，账号登录不授予远程执行权限；本地 DSH 权限审批继续生效。请求中断后可以按原请求编号只读核对状态，未知结果不会自动重发。长期记忆保存在本机，工作区、全局与历史账号记忆保持各自范围；当前版本面向桌面使用，跨设备能力继续在后续版本开发。

## 当前形态

- 内置本地长期记忆：跨会话召回、中文/款号检索、带来源的保存与纠正、过期过滤和遗忘；详见 [长期记忆设计与使用](docs/crawshrimp-harness/2026-10-21-long-term-memory.md)。
- 会话文件工作区支持持久标签、双栏比较、连续 Office / PDF 阅读及预览状态恢复。
- 会话浏览器支持内嵌和浮窗预览、鼠标键盘输入；设置页支持查看与恢复归档会话。
- 设置页支持管理内置和自定义供应商的模型列表；DeepSeek 和 GLM 支持发现上游模型后选择导入。
- 普通定时任务复用固定会话及其当前模型、工具与权限；任务中心支持直接调度已安装脚本。
- 默认安装包采用轻量 Office 运行时，首次需要原生预览、转换或字体资源时按需下载并校验。
- ModelJetty 官方模型与自备 Key 模型分别路由；账号切换或官方模型不可用时，不静默切换到其他计费来源。
- 本地长期记忆支持查询、保存、纠正和删除；文件产物保存会话内版本快照，超出快照限制时明确提示并提供经过校验的原文件入口。
- 图片和 PDF 预览在隐藏时释放图片资源或文档 Worker，保留缩放与阅读位置；后台资源轮询降低频率。
- Electron 44.7.0 主进程启动 FastAPI、托管 Chrome 和 Node Worker。
- FastAPI 默认监听 `127.0.0.1:18765`；冲突时在 `+1..+100` 内漂移。
- MCP 网关使用 `API + 200`；DSH Web host 使用 `API + 300`，并按 `window.__DSH_BOOT__` 特征回查真实端口。
- Vite 开发服务器默认 `5173`；Electron 调试 CDP 为 `9223`；托管 Chrome CDP 为 `9222`。
- SQLite 保存产品投影和审计，DSH JSONL 保存模型会话真值。
- macOS arm64/x64 可构建；Windows unpacked 可在 macOS 验证，NSIS 安装器应在 Windows 构建机生成。

## 版本记录

仅展示最近三个版本；历史版本见 [GitHub Releases](https://github.com/howtimeschange/crawshrimp-harness/releases)。

### v0.4.12

- 兑换或账号权益变化后自动刷新官方文字与生图模型，无需重新登录；恢复生图表单中的可用模型及兼容参数。
- 校验官方文字流式响应的完成标记，中断时保留原请求与计费追踪编号，支持只读核对，避免重复提交。
- 同一文档合并展示、内容未变复用版本，草稿保留最近 10 个不同内容版本，保护终稿和用户上传原件。
- 增加快照用量提示与清理后重试，明确区分当前原文件和历史副本；过滤 Office 过程图片，清理过期过程缓存并改善资源列表布局。

完整说明见 [v0.4.12 发布说明](release-notes/v0.4.12.md)。

### v0.4.11

- 国内 IP 优先腾讯云 COS、海外 IP 优先 GitHub；检查和下载失败自动切换备用源，并校验同一版本的 SHA512。
- 更新说明跟随下载源读取，固定到待下载版本，支持备用源回退。
- 未登录时，各入口先进入油画欢迎页，再打开 ModelJetty 授权；登录成功回原页面并保留会话与草稿，老用户不再重复进入首次引导完成页。
- 正式版自动同步 COS，完整验证成功后清理旧安装包；GitHub 保留历史版本。

完整说明见 [v0.4.11 发布说明](release-notes/v0.4.11.md)。

### v0.4.10

- 修复应用恢复焦点时后台检查版本与下载确认冲突，导致误报“当前没有可下载的桌面更新”的问题。
- 自动检查保留已发现版本、下载进度、任务等待与安装准备状态；下载前仍可手动检查最新版本。
- 补充更新竞态、下载进度与安装状态回归。更新继续沿用已有安装路径和用户数据目录。

完整说明见 [v0.4.10 发布说明](release-notes/v0.4.10.md)。

发布渠道为本仓库 GitHub Release，提供 macOS Apple Silicon / Intel 和 Windows x64 安装包及自动更新元数据；国内优先腾讯云 COS，海外优先 GitHub。

```mermaid
flowchart LR
    U["用户"] --> E["Electron + Vue shell"]
    E --> I["DSH Web iframe\n唯一会话主界面"]
    E --> A["FastAPI\n产品 API + SSE"]
    A --> DB["SQLite\n产品真值与审计"]
    A --> W["Node Worker"]
    W --> D["DSH runtime\nElectron-as-Node"]
    D --> M["MCP Gateway"]
    M --> T["Task Instance / Adapter"]
    M --> C["Chrome CDP 9222"]
    E --> B["实时浏览器窗口\n按 grant.tab_id 绑定"]
```

## 产品约束

这些规则属于当前产品合同，维护时不要退回旧实现：

1. DSH Web 会话 iframe 常驻全幅；抓虾菜单注入会话侧边栏，其他页面显示为右侧 overlay，脚本详情是独立二级页面。
2. DSH 会话权限是审批真值。策略为 `never` 时抓虾侧自动批准并保留审计；策略为 `ask` 时使用 DSH 原生审批卡，不自造审批浮层。
3. `fs_read` / `fs_list` 全盘只读免审批；`browser_navigate` 自动执行不审批；`fs_write`、`fs_exec` 和风险任务受 DSH 权限策略控制。
4. 简单下载、找图、找款类任务自动批准，但上传、发布、删除和修改类任务不因名字相近而放行。
5. 智能体创建的脚本必须是抓虾 Adapter 包：`manifest.yaml` + 页面 JavaScript async IIFE，外层返回 `{ success, data, meta }`。草稿、隔离测试和发布三道入口都会拒绝不合规内容。
6. 图片、视频和附件出现在 DSH 消息流末尾；上传入口是 composer 原生加号改造的 `📎`，旁边保留 `@` 命令按钮。
7. 实时浏览器只聚合当前会话各 run 已绑定且仍存活的 `grant.tab_id`，一个页面一个窗口；活跃窗口置顶，页面关闭后自动清理。

## 权限与审批

| 操作 | 默认行为 |
| --- | --- |
| 本机文件/目录读取 | 全盘只读，免审批 |
| 写文件、执行命令 | 服从当前 DSH 会话权限；`ask` 显示原生卡，`never` 自动批准 |
| 浏览器观察、验证、请求捕获 | 已绑定 tab 内执行 |
| 浏览器导航 | 任意 `http(s)`；自动执行，不触发额外审批 |
| 凭证字段输入 | 默认阻断；用户明确授权并给出指令后可由智能体填写，审计记录脱敏 |
| 提交、上传、发布、支付、删除等点击 | 原生审批卡 |
| 简单下载、找图、找款 | 自动批准，审计保留 |

审批等待使用独立有界 executor，不占用 asyncio 默认线程池。DSH Web 多会话通过 runtime-session → run 映射和请求级 MCP context lease 绑定，未知会话不会回退到“最近一次运行”，并行会话不会共享一个全局工具上下文。审批通过后更新的 grant 会在 lease 释放前写回 run 级缓存，因此下一次工具调用不会恢复旧授权。跨会话审批提示以 SQLite pending 列表定时校准，终态、后端重启或 SSE 中断都不会留下幽灵卡片。

## Adapter 创作与发布

最小包结构：

```text
my-adapter/
├── manifest.yaml
└── collect.js
```

页面脚本示例：

```js
;(async () => {
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const data = [{ query: params.query || '', title: document.title }]
  return {
    success: true,
    data,
    meta: { has_more: false },
  }
})()
```

发布链路：

```text
创建完整 Adapter 草稿
  → 合同与 manifest schema 校验
  → DSH 原生发布审批
  → 安装到 review-<hash> 隔离命名空间
  → 在正式 TaskRunner 中真实测试
  → 测试后包哈希锁定
  → 人工批准发布
  → 正式 Adapter 事务安装 / 失败回滚
```

隔离测试不会覆盖同名生产 Adapter。首次智能体发布前会保存用户原包的长期基线。

## 附件与媒体

- 上传文件硬上限：200 MB；复制采用 1 MB 流式分块，并在复制过程中再次检查大小。
- `attachment_read` 解析上限：50 MB；附件只能被所属会话读取。
- 模型图片：PNG、JPEG、WebP、GIF；单张最多 8 MB，每轮最多 5 张。
- Excel：单文件 50 MB、解压后 256 MB、最多 10,000 个 ZIP 条目、32 个 sheet、100,000 行、512 列、2,000,000 个 cell。
- ZIP 媒体预览：单条目解压上限 64 MB；图片清单最多 20 条。
- 可执行安装文件按扩展名和 magic bytes 拒绝。

媒体 URL 不包含主 API token。前端先用认证 header 申请短期 HMAC capability；签名绑定 HTTP route、规范化文件路径、ZIP entry 和过期时间，只能读取 `/agent/artifacts/file` 或 `/agent/artifacts/entry`。

## 安全边界

- 本地 API 仅监听 loopback，默认要求 `X-Crawshrimp-Token`。
- token 从当前运行数据目录的 `api-token` 读取；不要把值写入文档、URL、命令历史、截图或 Git。
- preload 和开发 bridge 只允许访问 `127.0.0.1` / `localhost` 的 `18765..18865`，且不接受 query token。
- 浏览器观察会隐藏 password 及 name/id/autocomplete 命中凭证特征的输入值；网络请求 URL、body、审批摘要和工具结果都会脱敏。
- 仓库工具以用户明确给出的 HTTP(S) Git URL 为准，不做 DNS 公网性拦截；仍拒绝嵌入账号密码的 URL，仓库名只能是单个安全目录段。
- 第三方 README、源码和注释一律按不可信资料处理，不提升为系统或技能指令。

## 开发环境

要求：

- macOS 或 Windows
- Python 3.10+
- Node.js `^22.19.0 || >=24.0.0`
- Chrome

安装：

```bash
python3 -m venv venv
venv/bin/pip install -r core/requirements.txt
npm --prefix integrations/deepseek-harness ci
npm --prefix app ci
```

启动两个终端：

```bash
# 终端 1：FastAPI
bash dev.sh

# 终端 2：Vite + Electron
npm --prefix app run dev
```

`dev.sh` 会从运行数据目录读取或创建 API token，但不会打印其值。需要手工 curl 时，在 shell 变量中读取 token 并使用 `X-Crawshrimp-Token` header；不要回显变量。

数据目录默认由 `core.runtime_paths` 解析，常见位置为 `~/.crawshrimp`，也可用 `CRAWSHRIMP_DATA=/absolute/path` 显式指定。主要内容：

```text
crawshrimp.db
config.json
api-token
adapters/
agent/
├── attachments/
├── workspace/
├── harness-sessions/
├── runtime-workdir/
└── published-baselines/
```

## 验证

```bash
# Python 全量回归
venv/bin/python -m pytest tests/ -q

# Electron / renderer / 构建脚本测试
npm --prefix app test

# 前端生产构建
npm --prefix app run vite:build

# DSH 生产闭包 staging + Electron-as-Node boot check
npm --prefix app run stage:harness

# 空白与补丁检查
git diff --check
```

真实交付还需要：

- 从当前数据目录读取 token 后 curl 验证 `/health`、`/agent/runtime`、SSE cursor、媒体签名、附件会话绑定和脚本隔离测试。
- 用 Electron CDP `9223` 检查主 frame 与 DSH iframe；iframe 重载后必须重新创建 isolated world/context。
- 检查 DSH iframe 常驻、菜单注入、`📎` / `@`、媒体消息流、跨会话隔离、审批策略和 tab 窗口清理。

## 构建

默认桌面安装包是轻量版：保留 Office 生成能力和锁文件，但不内置完整 LibreOffice 运行时。首次需要预览、转换或原生字体资源时，客户端会按 `runtime-locks/office-assets.json` 下载并校验 Office 资源，写入用户数据目录缓存；缓存命中后，同一锁文件版本可离线继续使用。仅使用内置 Python 库的文档生成任务无需先下载 LibreOffice。

```bash
# 仅 Vite
npm --prefix app run vite:build

# staging DSH + macOS 双架构安装包
npm --prefix app run build:mac:ci

# Windows（NSIS 推荐在 Windows 构建机运行）
npm --prefix app run build:win
```

需要完全离线、安装包内置 Office 原生运行时时，显式打开 full bundle：

```bash
CRAWSHRIMP_BUNDLE_OFFICE=1 npm --prefix app run build:mac:ci
CRAWSHRIMP_BUNDLE_OFFICE=1 npm --prefix app run build:win
```

`stage-runtime.mjs` 使用独立 `package-lock.json` 生成生产依赖闭包，并执行禁用能力检查与 Electron-as-Node boot check。不要把开发期 `.spike-*`、运行数据、token 或构建缓存提交到 Git。

Office 运行时发布模式见 [Office Runtime On Demand](docs/crawshrimp-harness/office-runtime-on-demand.md)。

## 桌面自动更新

独立仓库 `howtimeschange/crawshrimp-harness` 的正式版先发布 GitHub Release，再由 CI 将完整安装包同步到腾讯云 COS。国内下载入口见 [官网下载页](https://harness.crawshrimp.com/download)。安装包保持原始字节、签名与 SHA256/SHA512 校验信息，GitHub Release 保留作为原始来源与回退。

替换发布的 v0.4.10 起，国内 IP 优先腾讯云 COS、海外 IP 优先 GitHub；更新检查或安装包下载失败时切换备用源。已安装旧版 0.4.10 的用户须手动覆盖安装本次包，或通过 GitHub 更新到 v0.4.11 才能获得双源能力。所有下载继续验证原始签名与 SHA512。COS 只保留最新正式版，GitHub 保留历史版本。本仓构建不发布到 `https://updates.crawshrimp.com/`，也不刷新主项目 `desktop-latest`。

同步流程、补传当前正式版与权限配置见 [腾讯云 COS 发布镜像](docs/tencent-cos-release-mirror.md)。

升级不需要卸载旧版：

- Windows 使用 NSIS 在原安装路径就地更新；未签名构建可能显示 `Unknown Publisher`。
- macOS 的应用内更新使用 ZIP/ShipIt；DMG 只用于首次安装、覆盖安装或应用内更新失败后的手动 fallback。
- 运行数据、Chrome profile、任务缓存和配置保存在系统用户数据目录，应用替换不会删除这些内容。
- 普通退出不会偷偷安装；下载完成后由用户点击 `重启安装` 才进入安装流程。

主界面把更新动作放在标题栏。进入具体脚本视图后，侧边栏保持展开，侧边栏底部默认只显示当前版本；只有检测到可用更新时才显示 `更新`。

## 目录

```text
app/                              Electron main、preload、Vue shell
core/agent/                       DSH 产品编排、MCP、SQLite、CDP、合同
integrations/deepseek-harness/    锁版 runtime、Worker、host/client 插件、skills
adapters/                         内置抓虾 Adapter
tests/                            Python 回归与安全/运行时合同测试
docs/crawshrimp-harness/          提案、交付、媒体和维护交接
SPEC.md                           v1 规范与 v2 Harness 增补
```

## 维护文档

- [Office 运行时按需下载与 full bundle 构建](docs/crawshrimp-harness/office-runtime-on-demand.md)
- [交接与 code review 结论](docs/crawshrimp-harness/04-codex-handover.md)
- [会话内媒体实现与踩坑](docs/crawshrimp-harness/03-media-in-chat-handover.md)
- [交付能力与验证证据](docs/crawshrimp-harness/02-delivery.md)
- [DSH Agent v2 提案与实现落账](docs/crawshrimp-harness/01-dsh-agent-v2-proposal.md)
- [产品规范](SPEC.md)

## License

[Apache-2.0](LICENSE)。版权与第三方声明见 [NOTICE](NOTICE)。
