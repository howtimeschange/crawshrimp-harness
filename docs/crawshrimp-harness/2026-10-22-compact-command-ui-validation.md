# 命令分组折叠验收（2026-10-22）

分支：codex/v0.5.0。

DSH rc.2 的 web 默认 transcript 模式为 detailed：运行中的 process group 直接显示成员。Harness iframe 不具备 dshDesktop，因此走到了这个默认值。持久运行时补丁将默认值改为 standard，复用原生分组、展开收起、键盘可访问性与运行状态；保留用户明确保存的显示偏好，不替换原生 renderer。普通正文仍是分组边界。

## 验证

- `node --test app/src/compactChat.test.js`：5/5 通过，包括原生补丁幂等性、上游锚点变更失败、保留已保存模式。
- `git diff --check`（本次两个代码文件）：通过。
- 在真实 Electron 抓虾界面打开「森马云盘图包下载与校验」，展开完成过程后，每组显示灰色单行摘要；点击一组「执行了命令」后可查看 4 条命令及中间思考。
- 刷新界面载入补丁后，新建「界面折叠验收测试」，单独执行 pwd、sleep 15、printf。运行中看到单行「正在运行命令 · Wait 15 seconds」，未铺开命令和思考；24 秒完成。
- 完成后打开过程，点击「执行了命令」展开命令及思考，再次点击收起，详情消失。正文分隔的命令仍各自成组。

证据：
- [运行中](qa-2026-10-22-session-routing/05-command-live.png)
- [展开](qa-2026-10-22-session-routing/06-command-expanded.png)
- [收起](qa-2026-10-22-session-routing/07-command-collapsed.png)

截图写入发生在测试轮次期间，因此 DSH 的工作区变更检测把验收截图也显示在结果中；该图片由验收操作保存，并非测试模型写入。

本次没有发布安装包。
