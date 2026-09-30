# 真实开发客户端文件预览走查

2026-09-30，分支 `codex/dsh-file-preview-p1`。使用真实 Electron 主进程、preload、完整 App、原生 DSH 会话、源码 Python 后端与实际 DeepSeek 模型调用完成走查。没有替换会话页面、注入测试产物或使用 QA 后端。开发客户端保持打开。验收时改动未提交；收尾按用户要求在当前独立分支创建本地 Git commit。未推送、发布或替换安装包。

## 最新界面调整

- 取消侧栏浮动文件交付卡：删除实时事件、会话恢复及任务完成轮询中的卡片创建路径，同时保留资源更新和会话图片展示。
- Office 预览删除“共 N 页 / 打开 Word、PPT、Excel”的重复按钮条，统一使用上方工具栏的“系统打开”。视觉检查状态保留。
- HTML/Markdown 预览删除固定的技术说明行。原静态预览处理与 iframe 隔离继续生效。
- 按钮统一尺寸和悬停说明、PDF/Office 连续滚动、HTML 会话文件链接打开侧栏均已在真实客户端验证。

## 启动与真实链路

复用当前仓库已运行的 Vite `http://127.0.0.1:5173/`。独立 Electron userData 与运行数据位于 `/tmp/harness-real-dev-20260930/`，仅复用已有开发模型配置，不打印或保存到验收目录。启动器只设置隔离 userData 后加载原 `app/src/main.js`；业务代码、IPC 和网络端点均为原实现。

源码后端 `http://127.0.0.1:18766` 的 `/health?probe=1` 返回 `runtime.kind=source`，scripts_dir 指向本仓库，owns_backend_instance=true。原 DSH Web 为 `19066`、MCP 为 `18966`，开发浏览器 CDP 配置为 `9224`。未操作已安装客户端及独立复审的服务/窗口。

通过原生输入框发送验收请求，模型真实执行 28 次工具调用，生成中文路径 HTML、Markdown、CSV、两页 DOCX、两页 PDF 和页图。后端 Run 状态为 completed；文件在磁盘回读并记录大小与 SHA-256。Office 最终交付事件记录 visual.status=passed、reviewed=[1,2]、delivery.status=final，DOCX 哈希与真实文件一致；并非仅引用模型的回答。

## 实际验证

| 场景 | 结果与证据 |
|---|---|
| 原生会话 HTML 文件链接 | 实际点击会话中的文件按钮进入统一侧栏；标题、3015 元、明细与内联样式显示，原文包含 doctype；[截图](qa-2026-09-30-deepseek/harness-p1-real-dev/03-native-html-link-preview.png) |
| 按钮尺寸和说明 | 所有当时可见的面板/文件工具栏图标操作均为 28×28px 且有 title；真实鼠标悬停说明出现；[结果](qa-2026-09-30-deepseek/harness-p1-real-dev/html-and-buttons.json) |
| PDF 连续滚动 | 两页同时保留在滚动结构中，鼠标 wheel 后 scrollTop=921，第二页画布显示；无下一页按钮；[截图](qa-2026-09-30-deepseek/harness-p1-real-dev/05-real-pdf-scroll-page-two.png) |
| Office 连续滚动 | 两页预览存在，wheel 后 scrollTop=991，第二页图片显示；[截图](qa-2026-09-30-deepseek/harness-p1-real-dev/07-real-office-scroll-page-two.png) |
| Office 重复按钮条移除 | office-controls 数量为 0，文档内部无按钮，上方系统打开数量为 1；[截图](qa-2026-09-30-deepseek/harness-p1-real-dev/06-real-office-no-duplicate-bar.png) |
| HTML 固定说明行移除 | 正常预览没有该说明行；[截图](qa-2026-09-30-deepseek/harness-p1-real-dev/08-real-html-no-banner.png) |
| Markdown / CSV | 原生会话链接打开，Markdown 显示 3015，CSV 表格显示 1188 等明细；[截图](qa-2026-09-30-deepseek/harness-p1-real-dev/09-real-csv-grid.png) |
| 交付卡取消及刷新恢复 | 真实交付事件与刷新后均无浮动交付卡；页面重新加载保留 5 个文件标签、HTML 预览且无固定说明；[结果](qa-2026-09-30-deepseek/harness-p1-real-dev/reload-and-other-files.json)、[截图](qa-2026-09-30-deepseek/harness-p1-real-dev/10-real-reload-restored.png) |

最终相关 Node 检查 **120 passed、0 failed、0 skipped**；Vite 构建通过，仅原有大 chunk 提示；`git diff --check` 通过。本轮新增界面调整没有改生产 Python 逻辑。提交前将两处“交付卡”工具文案改为“会话产物”，相关 Python 交付检查 3 passed。

观察到一次开发会话 iframe 根容器为空，但后端仍健康；整页刷新后恢复，随后重新加载验收通过。未稳定复现，原因尚未确定，不将其写成已修复缺陷，也不据此重放模型或工具动作。刷新时取消旧 PDF 请求产生的 ERR_ABORTED 单独保留。

证据目录：[harness-p1-real-dev](qa-2026-09-30-deepseek/harness-p1-real-dev/)。包括真实后端 Run/工具/交付事件及文件哈希、资源回读、原生会话最终回答、桌面截图和最终 Node/构建记录。早前独立组件的 PPT/XLSX、拖放、双栏、浏览器验证保留于[上一轮报告](2026-09-30-deepseek-p1-followup-ui-acceptance.md)，本次真实会话没有再次生成 PPT/XLSX，也未进行安装包验收或超长文档压力测试。
