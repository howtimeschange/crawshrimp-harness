# DSH 能力在抓虾界面的可达性核查

日期：2026-09-28。范围：当前工作区、锁定 DSH 0.1.2-rc.1 的实际依赖代码、Web profile 和产品覆盖层。静态入口审计，不代表已安装版本的逐项交互验收，也不涵盖其他 DSH 版本/CLI 独有功能。包含本次未发布的归档恢复改动。

## 结论

抓虾通过 `crawshrimp-slots/lib/client.js:444` 隐藏整个 `.hHd-Xa_settingsArea`，但抓虾 SettingsPage 只迁移了部分功能。需补齐一般用户偏好和运行诊断；明确禁用的能力应单独做产品决策。

## 缺少抓虾界面入口

| 功能 | DSH 原入口及能力 | 抓虾现状 | 建议 |
|---|---|---|---|
| 会话内容字号 | 通用设置 / 字号大小 | 外观目前只有主题 | 外观 / 会话显示，优先补 |
| 繁忙时 Enter 行为 | 通用设置；Enter 排队或插话，Cmd/Ctrl+Enter 使用另一行为 | 无偏好入口；不代表排队/插话功能消失 | 会话 / 输入偏好，优先补 |
| 新会话默认权限 | 通用设置 / 权限 | 会话输入框仍可改当前权限；缺少全局默认入口 | AI 能力 / 智能体 / 默认权限，保留确认机制 |
| 对话显示模式 | 通用设置 / Normal、Compact；控制已完成轮次过程内容 | 无模式入口，另有抓虾工具折叠覆盖层 | 外观 / 会话显示；需验证与抓虾折叠逻辑共存 |
| 界面语言 | 通用设置 / Language | 无统一语言切换；抓虾自身文案主要中文 | 整个产品一起国际化，不能只切内嵌 DSH |
| 插件清单与运行状态 | 插件 / 插件列表；全局与会话插件、启用/停用、条件启用、等待依赖、启动失败、搜索 | 抓虾仅显示运行时整体状态 | AI 能力 / 智能体 / 运行诊断，优先补；开放市场不是该清单 |
| 命令执行参数 | 插件配置 / 终端；命令超时、单流输出字节上限 | 无设置入口 | 智能体 / 高级执行设置；实际可写项依赖 Host 发布的 namespace |
| 工具调用并行数 | 插件配置 / Agent 循环 | 无设置入口 | 智能体 / 高级执行设置；同上，读回确认生效 |
| 子代理模型选择策略 | 插件配置 / Subagent；允许 Agent 选择模型、授权模型集合与推理强度 | 文本模型网关不等同于授权子代理模型策略 | 智能体 / 子任务模型策略；影响新会话 |
| 打开运行时配置文件 | 设置标题栏 / 打开配置文件（依赖部署提供 document controller） | 数据目录选择不等于打开 DSH 设置文件 | 支持诊断入口，先展示路径/导出诊断，不必直接开放任意修改 |

插件配置卡片按部署实际发布的设置域出现；上表确认存在上游 UI 且没有抓虾入口，不声称所有卡片当前都可写。

## 明确禁用或隐藏，非单纯漏迁

| 功能 | 证据与边界 |
|---|---|
| Agent 预设选择、复制、删除、默认预设、创造模式 | `profile/web/cordis.patch.yml:12-28` 固定 crawshrimp-standard，排除 shipped/user roots，禁用 ui-agent-preset；slots 还隐藏 Hero 预设座位。不应仅恢复按钮，否则与部署策略冲突。 |
| 轨迹视图 | `scripts/compact-chat.mjs:98-109` 只保留 conversation.view 的 chat，过滤 trajectory。可考虑在高级诊断里提供。 |
| 对话中的系统提示词/上下文注入记录 | `crawshrimp-slots/lib/client.js:403` CSS 隐藏 context/system-prompt 节点。记录隐藏不等于执行时不使用；会话日志导出不是原位查看的完整替代。 |
| 原生网页搜索/抓取及搜索设置 | 产品 preset 的 tool-web disabled；运行时补丁另禁用重复 Web 工具。上游插件页的搜索 Key、地址、次数上限不能直接搬入，否则可能配置了不参与当前执行的服务。 |
| Codex / Claude Code 专用子代理通道 | 产品 preset 对相应工具 disabled；普通 spawn/fork 子代理仍存在。属于执行配置策略，不是设置弹窗隐藏导致。 |

## 已覆盖，不应算成缺失

- 系统/浅色/深色主题：抓虾设置 / 外观。
- 模型供应商、Key、接口、模型列表、上下文和输出上限：抓虾设置 / AI 能力 / 文本大模型。并非承诺所有 DSH 高级 YAML 字段逐项等价。
- IM 机器人配置：抓虾设置 / IM机器人，使用独立嵌入面板；该面板隐藏 DSH 导航，仅展示 IM 内容。
- 当前会话权限和模型切换：会话输入区域仍保留。
- 会话日志导出：DSH 原按钮隐藏，抓虾资源面板/桌面导出链路已有替代。
- 会话搜索、重命名、分叉、归档：仍在会话区域。
- 归档恢复：本次新增抓虾设置 / 存储 / 已归档会话，尚未发布。不要将它描述为当前锁定 DSH 原本就有的恢复设置页。

## 关键源码索引

相对仓库根目录：

- `app/src/renderer/views/SettingsPage.vue`：menuGroups、ai-agent 面板、模型编辑器。
- `integrations/deepseek-harness/crawshrimp-slots/lib/client.js`：设置隐藏、IM 特殊嵌入、预设隐藏、上下文隐藏、日志按钮替代。
- `integrations/deepseek-harness/scripts/compact-chat.mjs`：工具折叠、轨迹入口过滤。
- `integrations/deepseek-harness/profile/web/cordis.patch.yml`：固定预设与权限配置。
- `integrations/deepseek-harness/profile/web/agent-presets/crawshrimp-standard/agent.cordis.yml`：子代理与 Web 工具策略。
- `integrations/deepseek-harness/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml`：当前 Web UI 模块组成。
- 上述 `node_modules/@deepseek-ai/` 下 `dsh-client-ui-theme/lib/client.js:1494-1516`、`dsh-client-locale/lib/client.js:1399`：外观/字号/语言设置。
- `dsh-client-ui-conversation/lib/client.js:15983`、`dsh-client-ui-chat/lib/client.js:8139`、`dsh-client-ui-permission-presets/lib/client.js:472`：输入行为、显示模式、默认权限。
- `dsh-client-ui-settings-plugins/lib/client.js:1628-1818`：插件配置卡片与注册。
- `dsh-client-ui-settings-plugin-inventory/lib/client.js:534-570`：插件清单与状态。
- `dsh-client-ui-settings-general/lib/client.js:639`：打开配置文件入口。

建议先补字号、输入偏好、默认权限、插件诊断四项，再评估高级执行参数。所有新入口必须位于抓虾设置页，并使用运行时公开服务写入和读回；仅把 DSH 组件注册到被隐藏的 settings.section 不算完成。
