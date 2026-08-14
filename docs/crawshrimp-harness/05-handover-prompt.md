# 交接 Prompt(给 Codex / 下一位接手者)

你是 crawshrimp-harness 项目的新任维护者。工作目录:`/Users/xingyicheng/Documents/crawshrimp-harness`。
这是一个「抓虾桌面应用 + DeepSeek Harness(DSH)内核智能体」的融合项目:Electron 43.1.0(main)内嵌 FastAPI 后端(端口 18765,回退 +1..+100)+ Node Worker + DSH harness(Electron-as-Node,锁版 @deepseek-ai/*@0.1.0-rc.6),前端 vite 5173 + Electron 窗口(CDP 9223),托管 Chrome CDP 9222(网页自动化)。

## 必读文档(按顺序)

1. `docs/crawshrimp-harness/04-codex-handover.md` —— 完成清单 + 已修复 + 遗留问题(24 项分级,高 5 / 中 8+新增 4 / 低 7)
2. `docs/crawshrimp-harness/03-media-in-chat-handover.md` —— 会话内媒体展示 10 坑(消息流插入位置/iframe 重载丢事件/lazy 不触发/Vue props 响应性异常等)
3. `docs/crawshrimp-harness/02-delivery.md` —— 能力清单与证据
4. `docs/crawshrimp-harness/01-dsh-agent-v2-proposal.md` §18 —— 提案对实现的落账
5. `SPEC.md` §11–16 —— 架构/权限/脚本规范/媒体/多窗口等 v2 增补

## 关键环境事实

- 后端 API token:`77d7cb1e26ac5dd64ac44ba7dd58afea38a7c807273a655fcde27fae3a2884f5`(curl 带 `X-Crawshrimp-Token` 头)
- 数据目录:`~/.crawshrimp`(SQLite crawshrimp.db + config.json + adapters + agent/attachments/workspace)
- 端口:API 18765、MCP=API+200、DSH web host=API+300(漂移时后端 `_settle_web_port` 按 `__DSH_BOOT__` 特征自愈)
- 验证手段:CDP 9223 主 frame + iframe isolated world(iframe 重载后 context 失效需重建);后端日志 `/tmp/electron.log`(dev 壳);pytest `venv/bin/python -m pytest tests/`(877 项基线)
- DSH hash 类名(锁版 0.1.0-rc.6,升级 DSH 必核对):侧栏 `.hHd-Xa_root`、会话列表 `.qDHVXG_list`、消息列表 `.Md3f7G_column`、滚动容器 `.wSkVaW_scrollBody`、输入框 `.wSkVaW_composerSeat/.wSkVaW_composerStack`、加号按钮 `.uV2eYG_add`、发送 `.uV2eYG_primary`
- 打包:`npm run build:mac:ci`(mac 双架构已产出);win-unpacked 可用,NSIS 需 Windows 机器

## 你必须遵守的产品决策(不要推翻)

1. 智能体 DSH Web 会话界面是唯一主界面(iframe 常驻全幅);抓虾菜单注入会话侧边栏;其他菜单切右侧 overlay;脚本详情是独立二级页面。
2. 权限模型:fs_read/fs_list 全盘读免审批;fs_write/fs_exec/browser_navigate 放开但经 DSH 原生审批卡(允许一次);用户明确「最多需要人审批」。
3. 脚本规范硬性约束:一切脚本必须是抓虾适配包(manifest.yaml + 页面 JS async IIFE 返回 {success,data,meta});草稿/测试/发布三关拒绝不合规脚本。
4. 审批:DSH 原生审批卡(非自造浮层);简单下载/找图类任务自动批准(审计保留);审批卡内容必须中文人话。
5. 会话内媒体(图片/视频/附件)在消息流内展示(消息列表末尾),不上输入框旁模块;上传入口是 composer 原生加号按钮改造(📎)+旁开「@」命令按钮。
6. 实时浏览器:多窗口、按浏览器页面(tab)绑定、一个页面一个窗口、活跃置顶、级联排列。

## 遗留问题处理优先级(详见 04 文档)

高(5):① 审批等待占用默认线程池(改专用有界 executor/异步轮询);② ctx.active_run 单全局槽并发覆盖(改 per-session 字典+互斥);③ test-install 在「生产运行时」执行(快照已做,考虑隔离命名空间);④ 媒体 token 静态(升级短期签名 token);⑤ _execute_plan future 60s 超时弃协程(改「启动中」回查)。
新增(4):⑥ 多窗口按「全局页面集合」而非「会话级子集」绑定(利用 grant.tab_id 雏形);⑦ tab 关闭后窗口残留(加快照轮询清理);⑧ 附件解析大小上限未声明;⑨ 审批卡跨会话可见性(会话标题已变「等待审批」,可加全局提示)。

## 工作方式

- 用 don't stop 循环:实现 → 自测 → 修复 → 复测 → 带证据交付;不要停在分析。
- 验证要真实:curl 实测端点、CDP 实测 UI、pytest 回归;改完跑 `venv/bin/python -m pytest tests/ -q` 必须 877 项全过。
- 提交信息用中文、按模块分 commit;文档三件套(交接/提案/SPEC)随功能同步更新。
