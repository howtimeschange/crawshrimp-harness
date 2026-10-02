# 会话资源与浏览器预览修复验收

2026-10-02；分支 `codex/dsh-file-preview-p1`，基于 `46b24f60cf541f62fa2e7eddcb2cb0585ccbc57d`。交付范围为当前分支的一个本地 Git commit；未 push 或发布。

## 修复及读回证据

| 问题 | 修复后的行为 | 实际验收证据 |
| --- | --- | --- |
| 收起面板丢失排队的 mouseup/keyUp | 隐藏、失焦与销毁时释放远端输入，后端按顺序处理，不依赖已清空的本地持键状态；正常 mouseup 的 capture loss 不误释放键盘修饰键 | 按下确认延迟 500 ms，返回资源列表后远端依次收到 `mousedown/mouseup` 和 `keydown/keyup`，mini 继续持有 stream |
| sessionBrowserPages 测试驱动失效 | 读取完整 script setup，并使用当前工作区依赖，覆盖关闭页面和跨会话迟到响应 | 原先六个失败测试恢复；完整 app 收集入口 878/878 通过 |
| 静态页 mini 展开缺少首帧和状态 | 每个 target 共享最近帧、连接状态及 URL；新消费者直接获得缓存；停止后清除缓存，启动未确认时交接仍共用队列 | 展开前后远端帧数均为 1，完整面板有 1 张图片并显示“已连接” |
| 收起资源面板归零 iframe 滚动位置 | 用保持布局的隐藏方式和 inert 收起外层面板，同时退出主会话布局占位 | HTML、Markdown 的 scrollY 均为 500→500；聊天区域宽度 770→1400；隐藏面板为 inert |
| 隐藏音视频继续播放 | 切标签、切会话及收起时暂停媒体，保留 currentTime；重新显示不自动播放 | 音频暂停及重新显示时均为 1.226709 s；切会话也暂停；视频收起后 paused=true |
| SPA 无重绘路由变化地址不更新 | 主 frame 导航事件及 URL 轮询独立推送 metadata，不改变连接或错误状态 | 地址为 `about:blank#without-paint`，远端、后端和界面一致，帧数仍为 1 |
| 验收中新发现的浮窗刷新按钮被缩放手柄遮挡 | 为浮窗右下角手柄预留空间 | 真实鼠标点击刷新成功；模拟不支持 screencast 时收到 2 张截图，stream 保持 active |

普通点击和 1.5 倍页面缩放点击均到达正确坐标；浮窗收起时隐藏，展开后恢复；渲染端 pageerror 为空。

## 验证

```sh
node scripts/test-collection.mjs run app
# tests 878, pass 878, fail 0

node --test integrations/deepseek-harness/compat/file-workspace.test.mjs
# tests 2, pass 2, fail 0

cd app
npm run vite:build
# built successfully; existing large-chunk warning remains

cd ..
node docs/crawshrimp-harness/qa-2026-10-02-resource-lifecycle/electron-smoke.cjs
# passed=true, Electron 43.1.0, errors=[]

git diff --check
# passed
```

Electron 验收使用真实源码组件、Electron IPC、agentBrowser 后端和隔离 Chrome CDP。会话资源清单和媒体路径由本地确定性夹具提供，没有运行模型任务或业务网站。它验证本次 UI 与输入链路，并不代表完整 DSH 服务或生产验收。

Chrome/Electron 使用新的临时 profile，Vite 使用空闲严格端口 51048、Chrome CDP 使用 51007；进程在验收结束后关闭。没有操作现有开发客户端、5173/9224 服务，原有未跟踪文件保留。

`.codex-tmp/dont-stop/dsh-preview-acceptance/checkpoint.json` 保持原值，SHA-256 为 `667f6dd20fa8e905c822a214bf420e690de08dedc9a671d650a25cd74857dc40`。

此前原生 select 镜像限制和未定位的偶发 DSH iframe 空白，没有作为本次六项已证实缺陷解决或验收。

## 保存的材料

- [可复现 Electron 脚本](electron-smoke.cjs)（macOS；可通过 `PLAYWRIGHT_MODULE` 指定 Playwright 安装位置）。
- [全部实际读回数据](electron-results.json)。
- [静态首帧和路由地址](01-static-route.png)。
- [收起后恢复阅读](02-restored-reading.png)。
- [浮窗及刷新按钮](03-floating-browser.png)。
