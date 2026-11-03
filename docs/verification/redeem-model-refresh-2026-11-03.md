# 兑换后自动刷新模型权限 — 2026-11-03

本地候选位于 `codex/managed409-image-model-recovery`，延续已有本会话修复，未覆盖其他工作区。未commit/push、未安装到当前客户端、未发布服务端、未使用真实兑换码或发起付费推理。

## 问题与最终行为

Free新账号只有赠金、服务端仅允许Gemini时，客户端仍按服务端available字段展示和配置。网页兑换成功使服务端权限改变后，返回抓虾窗口立即强制刷新官方目录；窗口可见时每30秒检查一次（包含被其他窗口遮挡的情况）。隐藏/最小化时不轮询，恢复焦点后再检查。短时间重复焦点事件合并，旧读取进行中发生的新焦点会追加一次新读取，避免把兑换前结果当作兑换后结果。

原有链路有三处缺口：只有调用status/手动刷新时才检查目录；刷新目录后未发账号变更通知；智能体同步身份仅包含账号与broker epoch，同一账号的权益变化不会应用到DSH配置。

修复后模型目录成功原子写入runtime capability后才发布modelsRevision和通知。目录/权益实质未变时不增版本、不通知、不重启。文字模型配置、模型设置和生图共享目录随变化同步；运行时按账号+broker epoch+目录版本更新。正在执行的任务沿用既有ACTIVE_RUN保护，在空闲后更新。broker地址/凭据和账号会话身份无需更换。离线目录请求失败保留上次成功快照，下一次检查可恢复。权限以服务端判定为准，不根据赠金、余额或Free名称推断解锁。

生图目录订阅账号变化；异步设置读取采用最新请求及配置版本双重保护，旧赠金状态读取不能覆盖兑换后的目录，也不覆盖用户刚保存的配置。

## 修改范围

- `app/src/managedCatalogRefresh.js`：前台定时检查、焦点刷新、并发合并、离线与销毁处理；由main进程接入窗口focus和before-quit。
- `app/src/managedAccount.js`：实质变化生成modelsRevision，原子快照后更新内存状态并通知界面。
- `accountRuntimeSync.mjs` / `AgentWebView.vue`：同账号目录版本进入运行时同步身份，复用现有任务期间延后重启保护。
- `aiImageModels.js` / renderer入口：订阅账号变化，刷新生图供应商目录并防止异步旧状态回写。

## 验证

- 43项focused Node测试通过：账号目录与代理、焦点/定时检查、同账号运行时同步、共享生图目录。最终原子发布顺序调整后账号22项再次通过。
- 10项相邻Node回归通过：官方权限、内存broker账号归属、图片回执、文字回查、模型目录显示。初次内存测试缺隔离worktree的DSH依赖；临时只读连接现有依赖后1/1通过，未改共享依赖，测试后移除连接。
- 190项Python provider/runtime hardening回归通过。
- `npm run vite:build`通过（既有bundle大小提示），main及新模块语法检查、`git diff --check`通过。
- `electron scripts/redeem-model-refresh-electron-smoke.cjs`通过：真实Electron中挂载实际AgentWebView与AiImageWorkbench；使用真实managedAccount和目录检查器，经IPC传递变更，并读取Python真实`managed_models`适配层生成的配置。Free初始只有Gemini文字模型且无GPT Image官方选项；同账号模拟兑换后，focus检查解锁GPT/DeepSeek和GPT Image，账号epoch不变、不重新登录。前台poll同样可同步；不变/离线不重启；运行中延后应用，空闲后再更新。

Electron场景的服务端兑换结果、DSH重启RPC为隔离夹具；没有使用真实兑换码，没有启动真实DSH进程或在当前安装版模型菜单完成线上验收。实际Python配置适配层、Vue界面、目录代理和事件链已验证；生产/当前安装版效果需安装候选后验收。原有Python重启路径每次重新读取配置与官方providers，已做源码核对及相关回归。

复跑：

```sh
# repo root
node --test app/src/managedCatalogRefresh.test.js app/src/managedAccount.test.js app/src/renderer/utils/accountRuntimeSync.test.mjs app/src/renderer/utils/aiImageModels.test.js
# app directory
./node_modules/.bin/electron scripts/redeem-model-refresh-electron-smoke.cjs
```

本轮验证零付费调用；不改变权益判定和兑换服务规则。


后续已完成真实专用账号登录、真实兑换及实际DSH菜单验收，见[真实端到端走查](redeem-model-refresh-live-2026-11-03/README.md)。上文fixture限制保留作为先前验证层的说明，不再代表当前缺少真实走查。
