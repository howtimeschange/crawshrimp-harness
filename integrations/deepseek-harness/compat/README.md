# 抓虾 DSH 选择性兼容登记

基线 `205500eead7bf72fa1a9b90df8287c41feed894a`；运行时保持 DSH 0.1.2-rc.1、dsh-im 4.11.0。参考官方 dsh-v0.1.5-rc.1（183f08e9c6dde7e36cd2318eaee70b0da08fb35e），不覆盖新版完整运行时。

## 本次范围与移除条件

| 编号 | 入口 | 策略与验证 |
|---|---|---|
| C00 | manifest.json、baseline.json、apply.mjs | 精确版本、唯一锚点、幂等校验；运行时生成 compat-report.json。暂存指纹包含全部 scripts 与 compat，避免新增补丁未触发重新暂存 |
| C01 | backports/index.mjs → dsh-mcp-client | 完整拉取前检查重复 continuation cursor；失败保留旧工具。A→A、A→B→A、正常多页、传输中止均覆盖 |
| C02 | backports/index.mjs → dsh-client-ui-conversation | 按钮与普通 Enter 共用旧版 resolveSubmitMode 和 keyboard.submit；保留停止、快捷键、命令、IME 路径；忙时文案反映加入队列／立即引导 |
| C03 | app/resources/DocumentPreview.vue、PdfPreview.vue | Markdown 表格和代码块、代码高亮与复制、PDF 翻页／缩放／文本选择；保留 OfficePreview、系统打开和定位 |
| C06 | staticPreview.js、core/agent/preview_resources.py | DOMPurify + CSS AST，空 sandbox + CSP；本地相对图片／样式／字体；后端 realpath 目录约束、资源类型白名单、8 MB 单文件；前端 64 资源／24 MB 总量 |
| C09 | 实机验收报告 | 按复现结果修复；不新增第二套重连管理，不盲目替换消息流与滚动实现 |

C01/C02 只在运行时具有同等能力且定制回归通过后移除。C03/C06 是 Vue 产品功能，不能因为升级 DSH 就删掉。没有数据库迁移，不修改聊天／附件历史格式。

## 定制保留清单

`baseline.json` 登记关键文件的基线 SHA-256；变更不等于丢失，需要结合以下行为验收：

- 产品品牌、中文、侧边栏入口、任务中心、脚本、生图与浏览器产品层。
- allow-all 与待审批卡的两步控制，IM 自然语言模型控制、权限回写、渠道选择。
- 原生 Web 工具和 Computer Use、工作区探测、工具执行策略、自动任务及回执修复。
- DeepSeek Flash 默认模型、配置模型目录、推理恢复、货币文本不误判数学、时间上下文。
- compact-chat、历史搜索重试、图片签名媒体、附件路径适配与文件交付。
- Office 原文件／页图／视觉审计、文档交付状态与内置 Office 技能。
- Session follow 的快照与增量衔接、产品会话资源、浏览器页状态、独立会话恢复。

历史 patch-runtime-dependencies.mjs 保持原有编排。新增兼容补丁先全部预检，再执行历史补丁，最后对当前文件重用变换，防止覆盖同一 bundle 中的定制；任何锚点或版本失配直接失败。干净暂存验证不能用已有 node_modules 的测试替代。

## 验证命令

```sh
node integrations/deepseek-harness/scripts/patch-runtime-dependencies.mjs
node --test integrations/deepseek-harness/compat/compat.test.mjs
node --test app/src/sessionResources.test.js
venv/bin/python -m pytest tests/test_preview_resources.py tests/test_session_resources.py -q
npm --prefix app run vite:build
node integrations/deepseek-harness/scripts/stage-runtime.mjs --force
```

浏览器端使用本地 PDF worker、CMap、字体与 WASM；Vite 复制 PDF.js 的许可证及资源，不使用 CDN。UI 延迟加载文档组件，文本最多 256 KB，高亮最多 64 KB，超过时显示纯文本并提示截断。HTML/Markdown 预览不执行脚本、不加载外网资源、不跳转链接；CSS @import、表单、嵌入式子页面、音视频与内联 SVG 不参与静态预览，保留“系统打开”入口。

上游源码只作为行为参考（官方仓库 MIT 许可）；新增回移植的源码路径、适用版本及移除条件逐项记录于 manifest.json。
