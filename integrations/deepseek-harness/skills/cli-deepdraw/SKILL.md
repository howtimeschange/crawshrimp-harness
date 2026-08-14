---
name: deepdraw-cli
description: Use when the user asks to call the DeepDraw (深绘) open platform OpenAPI — query merchants/categories/field templates/products, create or update DeepDraw products, or prepare product content packages. Every call supports dry-run; write/paid interfaces require an explicit plan and user authorization before execution.
---

# DeepDraw CLI(深绘开放平台 CLI)

## 位置与安装
- 本地路径:`skills/cli/DeepDrawCLI`(可用 `CRAWSHRIMP_CLI_ROOT` 覆盖 CLI 根)。
- 运行时:Node 20+,部分能力走 Java SDK bridge(见仓库 `java/`)。

## 调用方式
```bash
cd <CLI_ROOT>/DeepDrawCLI
npm install && npm run build
deepdraw call <api-name> --json        # 调用已注册 dp.* 接口
deepdraw call <api-name> --dry-run     # 只检查参数,不发请求
deepdraw plan <操作>                    # 生成执行计划(写入/付费接口必须)
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
