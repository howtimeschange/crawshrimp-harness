# 个人账号与云审批弃用

Harness 是个人本地 AI 智能体。本地会话、文件、浏览器、模型密钥、任务和权限审批继续由本机管理。账号不是使用本地功能的前置条件，也不授予任何远程任务执行权限。

## 云审批边界

- 移除设置页的云审批 / 任务机，以及云提示词同步入口；历史嵌入页面只显示弃用说明。
- 后端不再启动云任务机，忽略旧 `machine_enabled`。控制器本身也拒绝启动。
- 旧 `/cloud-approval/status` 返回静态弃用状态，不探测网络、不读取机器凭证。
- 旧注册、启动、配置、同步和云提示词接口返回 HTTP 410；停止接口保留。
- 旧配置与本地数据库不删除；配置 API 不再返回或接受云审批配置。
- `cloud/approval-workbench` 和底层云模块保留作历史源码；不应作为 Harness 产品模块恢复。远端服务未关闭，避免影响其他产品。

## 账号配置

发布者配置 `app/src/accountConfig.json`，只使用 Project URL 和 publishable key（兼容 anon key），绝不能填 service_role 或 secret key。开发时支持 `CRAWSHRIMP_SUPABASE_URL`、`CRAWSHRIMP_SUPABASE_PUBLISHABLE_KEY` 覆盖。没有配置时不初始化 Supabase 客户端。

Supabase 控制台：

1. Auth 开启邮箱注册，保持邮箱确认。配置适用于正式用户的 SMTP；内置邮件服务的收件人和发送速率限制不适合作为公开产品邮件方案。
2. URL Configuration 将 `http://127.0.0.1:18941/auth/callback` 加入允许重定向列表。回调仅监听本机，使用 PKCE；验证等待十分钟，可取消，不开防火墙或公网端口。
3. 需要访客身份时开启 Anonymous Sign-Ins。匿名注册只在用户主动选择后发生，不随应用启动自动创建。公开放量前应配置并接入服务端要求的人机验证；客户端不会绕过 CAPTCHA。
4. Google 等第三方登录需要对应供应商的 OAuth 应用配置。服务端配置成功后，在 `providers` 添加 `google`，界面才展示该入口。匿名绑定 OAuth 还需启用 manual identity linking。
5. 只使用 Auth 时不需要业务表、Storage、Worker 或 Data API。账号功能不会自动上传或同步任何本地数据。

## 登录与持久化

所有 Auth 请求在 Electron 主进程中使用官方 Supabase JS SDK。Renderer 通过受信 IPC 发起限定操作，只获得 `{ id, email, anonymous }`，不能读取 access/refresh token。SDK 会话和 PKCE verifier 使用 Electron safeStorage 加密，项目隔离，文件写入为原子替换、0600 权限；安全存储不可用时拒绝登录，不降级为明文。

支持邮箱密码登录、注册确认、找回密码、邮件验证码验证，以及系统浏览器 PKCE 回调。匿名身份绑定邮箱先验证邮箱，再设置密码，保留同一 user ID。登录已有账号与合并访客数据是不同流程，本期不自动合并。

退出账号只清除本地登录凭证，不删除本地会话或文件。SDK 尝试远端 local-scope sign-out，网络失败时仍清理本地状态；已签发 access token 的服务端有效期由 Supabase 管理。匿名退出前界面提示身份可能无法恢复。

## 验证范围

本地回归覆盖旧配置不启动任务机、旧 API 拒绝访问、凭证不出现在账号状态中、加密存储、匿名绑定次序、错误脱敏和 PKCE 回调。线上邮箱送达、供应商 OAuth、匿名开关及真实身份持久化需要在创建的 Supabase 项目上另外验证，不能以 mock 测试替代。

## 2026-09-11 接入记录

- 已创建免费项目 `crawshrimp-harness`，Project ref `wibahwajgldwjjtkvtbo`，区域 `ap-southeast-1`（新加坡）；控制台显示 Healthy。
- 已保存 Site URL 和唯一 redirect URL：`http://127.0.0.1:18941/auth/callback`。
- 线上 `/auth/v1/settings` 回读：邮箱与匿名登录开启，允许注册，邮箱确认保留；Google 尚未启用。
- macOS Electron 使用正式 SDK 与项目完成一次匿名账号创建；加密存储后重建服务，恢复同一 ID，再通过服务端 `getUser()` 校验成功。测试账号 ID：`c7ed6d22-7f41-473f-b416-654ff4259293`。UI 验收后已退出该测试身份，远端测试用户记录保留，未执行管理员删除。
- 后续已按用户要求启动并多次重启完整源码开发客户端，实际检查 DSH、核心服务、浏览器连接及账号菜单跳转；临时独立验收窗口已关闭。没有打包或发布安装器。
- Resend 发信域名 `auth.crawshrimp.com` 已验证。Cloudflare 新增 `resend._domainkey.auth` TXT、`send.auth` SPF TXT 和退信 MX；保留主域名原有收件与网站记录。
- Supabase 自定义 SMTP 已启用：`smtp.resend.com:465`，用户名 `resend`，发件名称「抓虾」，发件邮箱 `noreply@auth.crawshrimp.com`。用户亲自创建并保存仅限该域名 Sending access 的凭证；密钥不入库。
- 注册确认与密码找回邮件均在 Supabase 保存了中文验证码模板，正文使用 `{{ .Token }}`。Confirm email 保持开启。
- 服务端 Auth 日志确认真实注册请求和注册验证码验证成功，找回邮件请求与 recovery 验证也成功。两次设置新密码返回 HTTP 422，原因是新旧密码相同；客户端已修正错误映射，不能把这两次失败记为密码重置成功。
- Google OAuth 仍未配置。不同新密码提交成功、旧密码失效与新密码重新登录的真实流程仍需验收；本地测试桩覆盖该流程，不替代线上验收。

## 账号界面与流程

- 左下角统一账号菜单，整合设置、桌面更新和核心 / 浏览器状态；宽度跟随侧栏，紧凑行高、毛玻璃背景，支持折叠侧栏与键盘操作。
- 未登录时只显示「登录 / 注册」。登录、注册和找回密码使用独立居中弹窗；设置中的账号页展示首字母头像、账号名、邮箱、账号类型和退出登录。
- 注册为“发送验证码 → 验证并完成注册”，待验证邮箱由主进程绑定；错误验证码不产生已登录 UI。注册接口异常返回自动确认会话时，客户端拒绝继续。
- 找回为“注册邮箱 → 邮件验证码 → 两次输入新密码 → 返回登录”，支持 60 秒后重发。临时验证会话不显示为正式登录，设置密码成功后清除本地会话，要求新密码登录。
- 新旧密码相同显示明确提示并保留验证进度；表单错误不再提供误导性的清除本机登录状态操作，去掉 Electron IPC 错误前缀。
- 本轮账号服务 12 项测试通过，覆盖加密存储、注册确认、验证码错误、恢复流程、新旧密码校验、会话清理和 PKCE 回调；Vite 构建通过。
