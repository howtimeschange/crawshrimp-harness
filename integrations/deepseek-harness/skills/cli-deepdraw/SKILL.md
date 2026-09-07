---
name: deepdraw-cli
description: Use when the user asks to call the DeepDraw (深绘) open platform OpenAPI — query merchants/categories/field templates/products, create or update DeepDraw products, or prepare product content packages. Every call supports dry-run; write/paid interfaces require an explicit plan and user authorization before execution.
---

# DeepDraw CLI(深绘开放平台 CLI)

## 内置运行时
- 本地路径:`skills/cli/DeepDrawCLI`(可用 `CRAWSHRIMP_CLI_ROOT` 覆盖 CLI 根)。
- 抓虾 Harness 安装包已包含编译后的 `dist/` 与生产依赖；不要让最终用户执行 `npm install` 或 `npm run build`。部分 API 的 Java SDK bridge 仍以该命令实际返回为准。

## 调用方式
```bash
cd <CLI_ROOT>/DeepDrawCLI
ELECTRON_RUN_AS_NODE=1 "$CRAWSHRIMP_NODE_EXECUTABLE" dist/cli/main.js call <api-name> --json
ELECTRON_RUN_AS_NODE=1 "$CRAWSHRIMP_NODE_EXECUTABLE" dist/cli/main.js call <api-name> --dry-run
ELECTRON_RUN_AS_NODE=1 "$CRAWSHRIMP_NODE_EXECUTABLE" dist/cli/main.js plan <操作>
```

## 使用场景
- 读取商家、类目、字段模板、商品资料;
- 创建/更新深绘商品(走 Java SDK bridge 的 entity mapping);
- 商品内容包整理为结构化摘要(供 AI agent 消费);
- 所有 `dp.*` 接口注册于 `src/core/api-registry.ts`。

## 安全契约
- 低风险只读接口 dry-run 后可执行;
- 写入、付费、慎用接口必须先生成执行计划,用户明确授权后才允许执行;
- 不直接拼签名、不绕过 CLI 直接触发付费接口。
