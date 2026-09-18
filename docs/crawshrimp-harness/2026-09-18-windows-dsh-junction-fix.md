# Windows v0.2.1 智能体启动失败修复

> 历史阶段证据：本记录对应本轮性能和上下文优化之前的Windows修复版本，不能作为最终优化版本的验收通过证明。最终门禁见 `2026-09-18-final-review-and-local-merge.md`。

## 症状与根因

Windows 升级到 v0.2.1 后，智能体可能在再次启动时报 `RUNTIME_BOOT_FAILED`，底层错误为 `cannot resolve profile bundle "@xmanrui/dsh-im"`。

已核对 GitHub v0.2.1 的 Windows x64 EXE：插件包及其 `package.json` 确实存在于发布压缩包中。使用 Windows 11 ARM 测试虚拟机中的 Electron 43.1.0 x64（Node 24.18.0）复现：

1. `ensureWebProfile` 将用户 Web profile 的三个产品插件目录创建为指向安装目录的 junction。
2. 第二次调用对现有 junction 执行 `rmSync(path, {recursive:true, force:true})`。
3. 在该 Electron Windows 运行时中，递归删除会进入 junction 的目标，删除安装目录内插件内容。
4. 首次 DSH `web --dump-config` 返回 0；第二次返回 1，堆栈与用户截图一致。

受影响的三个目录：`@xmanrui/dsh-im`、`crawshrimp-product-bridge`、`crawshrimp-slots`。

## 源码修复

`web-rpc-client.mjs` 及 staging 的链接替换逻辑先用 `lstatSync` 判断链接；对 symlink/junction 使用 `unlinkSync`，只对真实旧目录保留递归删除。失效的升级遗留 junction 也通过 `lstatSync` 识别。

新增 Electron-as-Node 回归测试，覆盖现有 junction、失效 junction、旧的实体插件目录、连续三次 profile 初始化、安装文件及用户自定义依赖保留。普通 Node 测试不能替代这一 Electron 测试。

## 已损坏安装的恢复

只改启动代码不能找回已经被删除的插件，因此制作了 v0.2.1 专用补丁：

- 三个插件完全取自正式 v0.2.1 Windows 安装包。
- Worker 文件相对正式包只包含本次 junction 修复。
- 包内含文件 SHA-256 清单和使用说明。
- 不修改用户 `.crawshrimp` 数据目录。

补丁位于 `artifacts/windows-dsh-boot-20260918/crawshrimp-harness-v0.2.1-windows-startup-fix.zip`。

使用方法：完全退出抓虾（含托盘），解压补丁，将其中的 `resources` 文件夹合并复制至安装目录，选择替换同名文件；不要删除原 `resources` 文件夹。默认安装目录为 `%LOCALAPPDATA%\Programs\crawshrimp-harness`。之后启动并再完全退出、启动一次。

## 验证

- 31 个定向测试通过，包括 Electron profile 重启、Worker、staging 与 after-pack。
- CI 测试收集检查通过，新 Electron 回归自动纳入 app 测试。
- Windows 实机虚拟环境：修复前 `web --dump-config` 首次成功、二次报相同错误；应用补丁至已损坏的测试安装后连续两次成功。
- Windows Electron 回归覆盖的三次初始化通过，三个插件文件及用户依赖保留。
- Windows 实际 Web Host 连续三次完成启动、cookie 认证和 `crawshrimp-standard` 会话创建；本地 MCP 使用测试服务，未调用模型或真实业务工具。首次未提供 MCP 服务时启动超时，补齐测试服务后通过。
- 将补丁应用至损坏测试安装后，289 个运行时文件逐一 SHA-256 回读匹配。
- ZIP 完整性检查通过；SHA-256：`2cc9b97f5ceaaff6a855f527b5dbf452bc1b8ace3d002120bb1fb16fa9e1a88a`。

证据保存在 `artifacts/windows-dsh-boot-20260918/`。测试环境为 Windows 11 ARM 上运行 x64 Electron，未连接用户出错的那台电脑。未创建 Git commit、push、tag 或正式更新发布。
