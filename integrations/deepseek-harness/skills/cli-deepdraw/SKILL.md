---
name: deepdraw-cli
description: Use when the user asks to use DeepDraw (深绘) OpenAPI, query merchants/categories/templates/products, prepare product content or local payloads, or run the Balabala (巴拉巴拉) listing workflow with imports, field/size review, scoped publishing and readback. Remote writes and paid interfaces require a plan and user authorization.
---

# DeepDraw CLI(深绘开放平台 CLI)

## 内置运行时
- 本地路径:`skills/cli/DeepDrawCLI`(可用 `CRAWSHRIMP_CLI_ROOT` 覆盖 CLI 根)。
- 抓虾 Harness 安装包已包含编译后的 `dist/` 与生产依赖；不要让最终用户执行 `npm install` 或 `npm run build`。部分 API 的 Java SDK bridge 仍以该命令实际返回为准。
- `skill_list` 返回 CLI 的实际绝对路径和 ready 状态。执行前读取 `<CLI_ROOT>/DeepDrawCLI/AGENTS.md`，按需读取 README.md 和 docs/reference/deepdraw-openapi.md；这些文件与 CLI 同版本打包。
- 当前内置提交：`72c2536dfca7955c118e6805041e19eb3b2066e4`，基于上游 `7c23f01` 升级至 SDK `dop-sdk-1.6.25.jar`（与原深绘 CLI 一致）；不要通过 package.json 的 `0.1.0` 判断源码是否最新。

## 调用方式
```bash
cd <CLI_ROOT>/DeepDrawCLI
ELECTRON_RUN_AS_NODE=1 "$CRAWSHRIMP_NODE_EXECUTABLE" dist/cli/main.js --help
ELECTRON_RUN_AS_NODE=1 "$CRAWSHRIMP_NODE_EXECUTABLE" dist/cli/main.js call <api-name> --dry-run
ELECTRON_RUN_AS_NODE=1 "$CRAWSHRIMP_NODE_EXECUTABLE" dist/cli/main.js call <api-name> --execute --plan
ELECTRON_RUN_AS_NODE=1 "$CRAWSHRIMP_NODE_EXECUTABLE" dist/cli/main.js product payload --input draft.json --stage create --pretty
```

PowerShell 调用时先设置 `$env:ELECTRON_RUN_AS_NODE='1'`，再使用 `& $env:CRAWSHRIMP_NODE_EXECUTABLE dist/cli/main.js --help`。
Java SDK 接口先执行 `config doctor --dry-run` 检查 Java/Javac 和 SDK；CLI 已内置不代表当前机器已具备 JDK。

## 巴拉上新流程
- 优先使用 `balabala import/template/review/sync/override/plan/publish/readback` 状态型流程。参数以当前 `--help`、AGENTS.md 和 README.md 为准，不使用已禁用的旧 `--input` 远端入口。
- 本地商品 payload、资料导入和审查不等于远端发布成功。真实模板来自本次 `dp.trade.fields`；品牌/租户/商户的规则不可混用。
- 明确 `--mode test|production` 和唯一 `--spu`；测试目标必须在配置中精确授权，不能仅凭 `-test` 后缀放行。
- 发布前生成计划并核对字段、颜色、尺码、SKU、主/平台尺码表；production 必须传入已审阅且仍匹配当前内容的 `--plan-hash`。
- `dp.product.update` 是覆盖式更新，不能用小 patch 替代完整资料；尺码表/颜色/SKU 变更不能走普通标量增量。
- 用户明确授权后才能发布，随后必须资源回读。HTTP 200/10200 不等于已保存或上架；写入响应未知时禁止直接重放。

## 使用场景
- 读取商家、类目、字段模板、商品资料;
- 创建/更新深绘商品(走 Java SDK bridge 的 entity mapping);
- 商品内容包整理为结构化摘要(供 AI agent 消费);
- 所有 `dp.*` 接口注册于 `src/core/api-registry.ts`。

## 安全契约
- 低风险只读接口 dry-run 后可执行;
- 写入、付费、慎用接口必须先生成执行计划,用户明确授权后才允许执行;
- 不直接拼签名、不绕过 CLI 直接触发付费接口。
