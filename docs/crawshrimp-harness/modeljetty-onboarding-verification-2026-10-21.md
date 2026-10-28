# 账号接入与首次启动页验证（2026-10-21）

分支：`codex/modeljetty-membership-sso`。本记录区分本地代码验证、真实模型调用和生产能力；未提交、推送或部署。

## 欢迎页

实际探查 Open Design 桌面版：首屏选择登录/注册或 API Key，登录等待有重开网页与取消，自备 Key 进入单独配置流程。新欢迎页采用双栏、暖白背景、绿色主按钮和原创湖面小舟画作；首次缺少模型自动展示，跳过后可重新进入。

BeUI 参考：
- https://beui.dev/components/motion/button ：Stateful Button 的等待状态、轻微按压反馈。
- https://beui.dev/components/motion/action-swap ：状态文案切换。
- https://beui.dev/components/motion/morphing-modal ：步骤过渡思路。

BeUI 为 React/Motion 组件，本页为 Vue：仅参考交互模式，采用 Vue Transition 与 CSS 实现，未复制 React 组件或引入新运行时。启用 reduced-motion 时禁用动画。原创画作由图像生成工具制作，随应用打包，不依赖远端图片。

验证：Vite 构建通过；原有大块体积警告仍存在。对话框焦点工具 3 项测试通过。Computer use 操作实际 Vue 组件的本地 IPC fixture，验证首页、等待态、取消、自备 Key、返回、跳过与重新进入；560×720 iframe 视口下隐藏画作、保留全部操作。此项不等于安装包中的网页登录全流程已验收。

## 账号与模型

- 真实 HTTP OAuth 服务测试及桌面账号模块测试：3 项通过，覆盖 code exchange、显式授权、重复请求、撤销，以及并发状态读取下仅初始化一次 broker。
- Python `tests/test_managed_models.py tests/test_image_providers.py tests/test_ai_image_service.py`：77 passed，3 subtests passed。
- 真实测试链路：现有测试账号 → 本地 PostgreSQL/OIDC 账号服务 → 桌面 managedAccount 模块的 loopback broker → ModelJetty 真实上游。测试脚本使用安全存储替身；生产 Electron 使用 OS safeStorage。
- 生文请求 `bf40a05c-d09b-4096-ad9c-980eaf0f68dd`：DeepSeek Flash，正文“抓虾联调成功”，18 tokens，finish_reason=stop。
- 生图请求 `651d2ba3-7eff-4a51-86bb-021eeedd42d7`：Nano Banana 2，真实 JPEG 1024×1024，已打开目视核对。
- 首个生文请求 `c9037fc9-8095-4796-bc8b-a2a902402054` 为 HTTP 200、正文为空，记为未通过。修改请求为关闭思考并提高输出上限后执行新的生文验证，没有重发生图请求。
- 两轮调用分别回读了调用前后额度；结束时退出账号并确认本地状态清除。

原始脱敏报告及图片：ModelJetty 仓库 `work/membership-20261021/real-managed-report.json`、`real-managed-text-report.json`、`managed-shrimp.jpg`。禁止提交同目录的凭据、运行时能力文件或数据库密码。

## 尚未完成

套餐价格页已实现 Free / Plus ¥99 / Pro ¥299，但购买、赠送额度自动发放、原生订阅权益兑现尚未开放。账号服务仅绑定已有测试账号；生产注册/充值仍关闭。VPS 没有修改，网站没有上线。完整 Electron 安装包网页登录流程、安全存储、生产会员开通及支付尚未验收，不能将本记录视为商业上线验收。

## 生产登录上线与真实客户端补验（2026-10-21，替代此前未部署结论）

用户明确授权先上线登录服务。账号中心已部署至 `https://modeljetty.com/oidc`，套餐页为 `https://modeljetty.com/plans`。此前预览页使用模拟 IPC，不能证明桌面授权成功；已增加预览提示并改为打开真实网站。真实客户端默认 issuer 和官方推理代理路径已修正。

生产采用现有 ModelJetty VPS 上独立账号服务及 PostgreSQL；应用仅监听回环地址，由现有 Nginx 转发 `/oidc/`、`/account/`、`/authorize/interaction/`，原 New API 路由保留。容器健康，首页、套餐页、OIDC discovery、原 `/api/status` 均返回 200，未认证 `/account/me` 返回 401。Python 默认 User-Agent 的请求曾收到边缘 403；curl 与实际浏览器/客户端验证通过。

真实隔离 Electron 客户端（真实 preload、OS safeStorage；独立用户数据）验证：

- 欢迎页点击登录，打开系统浏览器正式授权页；现有测试账号登录并确认，回调成功，客户端显示账号。
- 修复登录后运行时模型目录未刷新问题，官方 `managed-deepseek-flash` 加载成功。
- 生文返回「网页登录后的官方生文联调成功」。生产请求 `7ac18fe4-2fae-43b0-a010-b129df059114` 状态 completed。
- 生图使用官方 Gemini 3.1 Flash Image，1K、1:1、1 张；橙色小虾坐在绿色荷叶上，奶油白背景，已打开图片目视确认。生产请求 `8ecb09cf-b13c-4c85-8f2d-c19096915be5` 状态 completed。
- 完全退出并重启隔离客户端后，账号与官方模型自动恢复。
- 点击退出登录后返回欢迎页；本机 managed-model-session.json 数量为 0，生产 OIDC 数据无 Grant/AccessToken/RefreshToken，仅保留浏览器 Session 和一条旧 Interaction。
- 最新前端构建通过（保留已有 chunk size 提示），git diff --check 通过。未重复发送付费生成请求。

证据在 `.codex-tmp/dont-stop/modeljetty-membership/production-image-success.png` 与 `production-logout-success.png`。

部署目录 `/opt/modeljetty/accounts`，网站版本 `/var/www/modeljetty/releases/accounts-20261021`。数据库备份 `/opt/modeljetty/accounts/backups/accounts-verified-20261021.dump`（私有权限）。回滚时恢复 `backups/nginx.before` 到站点配置，按 `backups/frontend.before` 恢复网站符号链接，执行 nginx -t 后 reload；保留账号数据库卷及密钥，避免授权记录丢失。

边界：桌面端为独立分支的本地联调版本，尚未发布公开安装包。公开注册、支付、套餐自动履约仍关闭；现有用户首次自动绑定模型密钥路径未在生产新用户上验证。此次验证使用已绑定测试账号，不能替代上述商业流程验收。
