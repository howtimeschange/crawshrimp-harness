# 内置 DWS、深绘 CLI 与目录发现

## 本次版本

- DWS：GitHub 官方仓库 `DingTalk-Real-AI/dingtalk-workspace-cli` 当前最新稳定发布 `v1.0.61`，CLI 输出提交 `50eb73a0`。各平台下载地址及官方 SHA256 固定在 `integrations/deepseek-harness/dws-release.json`。
- 深绘：`skills/cli/DeepDrawCLI` 从 `26fcc77` 更新至 `7c23f0130f3f4ba72e7c950cc1108a942deb3289`，源码基线与用户提供的独立本地目录及 GitHub main 一致，包含巴拉字段规则和状态型上新流程。随后按用户提供的 Listingify vendor JAR，将原 CLI 与子模块工作区的 SDK 同步升级至 1.6.25（本地提交 `72c2536dfca7955c118e6805041e19eb3b2066e4`，原 CLI 与子模块共用该提交；远端仍为上述源码基线）；package.json 仍为上游的 0.1.0，以 gitlink 判断版本。

## 运行方式

开发启动与安装包构建都执行 Harness staging。DWS 只下载目标平台二进制，先核验 SHA256，再解压、保留 LICENSE/NOTICE 并生成 runtime.json。缓存位于 build-staging/dws-cache；不运行 npm 全局安装器、不安装全局 skill、不自动登录或建立订阅。

| 运行时入口 | 用途 |
| --- | --- |
| CRAWSHRIMP_SKILL_ROOT | 当前内置 skill 的绝对目录 |
| DSH_BUNDLED_SKILL_DIR | DSH 原生发现使用同一内置 skill 目录 |
| CRAWSHRIMP_CLI_ROOT | 已构建的内置 CLI 目录 |
| CRAWSHRIMP_DWS_EXECUTABLE | 当前平台 DWS 的绝对可执行路径 |
| DINGDING_ME_AGENT_DWS_BIN | 供未来个人消息 Agent 接入复用的同一 DWS 路径 |
| PATH | 前置内置 DWS 的 bin，避免调用用户机器上的旧版 |

`skill_list` 返回 skill 的 root/roots、全部包名及优先排列的 SKILL.md 入口，同时返回 cli_root/clis，包括路径、运行入口、运行时、ready 状态和对应 skill。目录扫描跳过 CLI 依赖树，避免 node_modules 挤占技能发现结果。DSH 原生 skill-filesystem 也显式绑定内置目录。

开发态优先使用 build-staging 内刚构建的 CLI；发布态使用 Resources/deepseek-harness/skills/cli。工作目录可以是任意用户工作区，路径支持中文和空格。

订货商城 CLI 同步修正两个打包问题：pnpm 改用可搬迁的 hoisted 生产依赖布局；打包时修正 Commander 的正常帮助/版本退出被误报为失败。业务错误仍返回失败，未修改上游子模块源码。

## 验证

- 干净 `stage-runtime.mjs --force` 通过，包含 Web profile 配置启动检查。
- Harness 定向测试：87 项 Node、32 项 Python 通过；原生 provider 可发现并读取 21 个内置 SKILL.md。
- 原深绘 CLI 与内置子模块在 SDK 1.6.25 下各 245 项测试通过（无跳过），lint、build、隔离配置的 doctor 检查通过；含全部五个 Java bridge 编译与尺码备注回归。
- 真实 Electron-as-Node DSH Host + 独立测试会话：原生 skill 目录发现、MCP skill_list/skill_read、原生 Bash 的 `dws --version` 与本地 `chat message list` schema 调用通过。模型响应使用本地确定性测试服务，MCP 测试服务复用真实目录读取函数；没有调用线上模型或钉钉业务接口。
- 通过 afterPack 的真实复制函数将 skill/CLI 搬到含中文、空格的临时 Resources 目录，执行六个 CLI 的 help/version；可使用下方命令重新验证。
- DWS macOS ARM64 已原生运行；macOS x64 已通过 Rosetta 运行；Windows x64 下载已校验官方 SHA256，并验证 PE x86-64 文件及目标元数据。Windows 实机执行、最终签名安装包及发版不在本次验收证据中。

```bash
node integrations/deepseek-harness/scripts/stage-runtime.mjs --force
cd app
npm run test:builtin-clis
```

CLI smoke 使用内置 Electron/Python 和独立临时 HOME，不登录、不读取业务数据、不发送消息。深绘 Java SDK 接口另需可用 JDK，调用前按内置 skill 执行 config doctor --dry-run；入口验证不代表所有远端业务接口均已授权或验收。

## 后续升级

DWS 升级需从官方最新稳定 Release 同步版本、目标平台 SHA256 及同版本 dws-skills.zip，保留 skill 顶部的抓虾运行时说明和 LICENSE/NOTICE。不要只更新二进制而留下旧 schema 使用指南。深绘等子模块升级后必须更新父仓库 gitlink、重新 staging，并运行搬迁 smoke；不能凭开发机器上的全局 CLI 判断内置版本。

## SDK 1.6.25 同步

原始 JAR：`/Users/xingyicheng/Documents/Listingify/vendor/deepdraw-sdk/dop-sdk-1.6.25.jar`。
SHA-256：`3f57e6229b2b76ea633cf60f268d3db9691bc4b112c5d91d7aaf6c61229010f6`。

原 CLI（`/Users/xingyicheng/Documents/深绘 CLI`）与内置 `skills/cli/DeepDrawCLI` 同步替换 SDK、doctor 必需文件名、当前版本/校验文档和测试，移除 1.6.24 JAR，避免 wildcard classpath 加载竞争版本。历史 PDF 的 1.6.24 版本记录继续保留。

JAR 比较：120 个 class 名称与公开 API 签名一致，只有 Product.class 字节码变化；尺码校验解析去掉 `*备注` 后缀。新增离线回归验证所有五个 Java bridge 编译、不同备注的重复尺码被识别，以及 SDK 校验值与唯一版本。原有巴拉增量限制保留，未据此放开线上写入。

暂存目录曾因合并旧的 integration skill CLI 副本而残留 1.6.0 JAR。staging 现在先清空生成的 CLI 目标目录，再复制权威 `skills/cli` 树；保留旧源码目录不动。搬迁 smoke 新增检查 SDK 版本唯一且 SHA256 与权威源码一致，避免 help 成功却加载错误 JAR。

最终验证：原 CLI、内置子模块与 darwin-arm64 暂存副本的 SDK 均唯一为 1.6.25，SHA256 一致；版本文档、源码及 dist/cli/run.js 字节一致。干净 staging 与 Web profile 启动检查通过，随后缓存检查为 up to date；六个 CLI 搬迁 smoke 全部通过，深绘实际 Electron 入口的隔离 doctor 全部检查通过。原 CLI 与子模块 114 个文件全量比对一致。已按用户要求创建本地 Git 提交；未打安装包、未推送 Git、未做线上业务写入。
