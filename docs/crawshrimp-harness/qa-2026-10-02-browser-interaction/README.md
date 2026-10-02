# AI 浏览器交互与连续画面流验收

日期：2026-10-02；分支：`codex/dsh-file-preview-p1`。仅源码开发客户端与本地提交，不涉及安装包、发布或推送。

## 实现与体验范围

侧栏原先每 800ms 调用一次 `Page.captureScreenshot`。本次优先使用 `Page.startScreencast` 接收浏览器合成器推送的 JPEG；800ms 定时器只更新尺寸、地址信息。不支持 screencast 时仍可回退到原截图路径。

侧栏可以点击、双击、悬停、拖动、滚动和输入文字，支持编辑快捷键、粘贴、输入法提交。坐标按实际显示图片映射，黑边不接受点击。输入只发给当前画面的 target，并校验渲染窗口归属；不重试未确认的输入。关闭、失焦或切换布局时释放已按下的鼠标和按键。

顶部增加“在原生浏览器中操作”，通过 CDP 恢复并选中同一 Chrome 窗口与标签页，不新建标签、不复制 URL。所有顶部操作按钮均有悬停名称。

侧栏仍是画面流，并非原生网页控件。现有浏览器由独立 Chrome 进程托管，其页面无法直接搬进 Electron 的 `WebContentsView`；要实现侧栏原生嵌入，需要同时迁移浏览器创建、会话 profile 与 Agent 的 CDP 连接。当前原生入口保留已有页面状态，供需要完整浏览器行为的操作使用。

## 真实客户端环境

- 仓库 Electron：`app/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`，加载 `app/src/main.js`。
- Vite：`http://127.0.0.1:5173/`；本次隔离浏览器：CDP 9224。
- 数据：`/private/tmp/harness-real-dev-20260930/data`；userData：`/tmp/harness-real-dev-20260930/user-data`。
- 验收会话：本地文件预览验收测试。未重放模型任务。
- 本地确定性测试网页：`http://127.0.0.1:18869/`，源文件见 `demo.html`。
- 鼠标和键盘操作通过实际 Electron 预览面板执行，远端 Chrome DOM 只用于结果回读。测试输入法使用 Chromium `Input.imeSetComposition`，不是人工输入法候选窗的完整验收。

## 已验证

`final-checks.json` 记录 22 项检查：点击、双击、悬停、中英文与 emoji、全选替换、退格、Tab、按钮回车、文本框换行、拖动、黑边忽略、滚动及滚动后点击、复制与粘贴、输入法只提交一次、浮窗与最大化点击、拒绝其他渲染窗口输入、切换布局释放 Shift、原生窗口尺寸变化后的坐标映射、链接跳转与地址更新。预览未报告输入错误。

原生入口的实际按钮点击恢复了最小化窗口；再次读回得到相同 windowId `1298119608` 和 targetId `008EE8D810D04E1EED9635C4C2A014BD`。页面仍只有一个，输入框内容“粘贴测试🙂中文”保留，见 `native-results.json`。按钮点击后 Electron 主窗口失去焦点、同一远端页面保持焦点，见 `native-focus.json`。这里只验证页面状态延续，没有重新做业务网站登录验收。

3 秒 requestAnimationFrame 动画期间，收到 294 帧并解码 294 帧，约 98 帧/秒；到达间隔中位数 10ms、95 分位数 11.8ms，见 `extra-results.json`。这是本机、该测试网页下的短时帧率，不代表所有页面都达到相同速度，也不等同于点击到画面的端到端延迟。

截图：`01-click-type.png`、`02-scroll.png`、`03-ime-and-layout.png`、`04-native-tooltip.png`、`05-navigation.png`。源码客户端重新启动后复核了同一 target 的原生入口，见 `final-client.json` 与 `06-final-client.png`。

## 验收中保留的问题

- HTML 原生 select 菜单不能可靠显示在画面流中。本次通过预览键盘操作未改变选项，不能认定该场景通过；完整系统菜单操作应走原生浏览器入口。
- 既有 DSH iframe 会话界面再次出现空白，资源面板的 `visible` 变为 false，画面流随之暂停。刷新外层客户端恢复了同一会话和画面，随后完成窗口尺寸与跳转检查。重新启动源码客户端时也遇到空白，通过刷新外层界面、选择验收会话、刷新画面恢复。此问题不在本次修改中宣称修复，也不能据此认定整个会话界面已经稳定。
- 原生入口验证主要针对 macOS 本机；其他系统未做桌面验收。

## 自动检查

以下 94 项检查全部通过：

```sh
node --test app/src/browserInput.test.js app/src/browserPreviewCapture.test.js \
  app/src/renderer/utils/browserInput.test.js \
  app/src/renderer/utils/browserPreviewStreams.test.js \
  app/src/sessionResources.test.js app/src/agentHarnessContracts.test.js
```

`app` 目录下 `npm run vite:build` 通过，保留现有大 chunk 提示。`git diff --check` 通过。
