---
name: bmall-cli
description: Use when the user asks to operate the Bmall/Semir Reabam ordering platform through its API — search products, check SKU/stock, plan orders, replenishment, order troubleshooting, export tasks, or controlled allowlist jobs. API-first with stable JSON output; writes require dry-run preview and explicit user authorization.
---

# Bmall CLI(Semir Reabam 订货商城 CLI)

## 内置运行时
- 本地路径:`skills/cli/bmall-cli`(可用 `CRAWSHRIMP_CLI_ROOT` 覆盖 CLI 根)。
- 抓虾 Harness 安装包已包含编译后的 `dist/` 与生产依赖；不要让最终用户执行 `pnpm install`、`pnpm build` 或下载 Node。

## 调用方式
```bash
cd <CLI_ROOT>/bmall-cli
ELECTRON_RUN_AS_NODE=1 "$CRAWSHRIMP_NODE_EXECUTABLE" dist/cli.js --help
ELECTRON_RUN_AS_NODE=1 "$CRAWSHRIMP_NODE_EXECUTABLE" dist/cli.js manifest --json
ELECTRON_RUN_AS_NODE=1 "$CRAWSHRIMP_NODE_EXECUTABLE" dist/cli.js product search --json
ELECTRON_RUN_AS_NODE=1 "$CRAWSHRIMP_NODE_EXECUTABLE" dist/cli.js stock query --json
ELECTRON_RUN_AS_NODE=1 "$CRAWSHRIMP_NODE_EXECUTABLE" dist/cli.js order plan --dry-run
ELECTRON_RUN_AS_NODE=1 "$CRAWSHRIMP_NODE_EXECUTABLE" dist/cli.js agent knowledge --json
ELECTRON_RUN_AS_NODE=1 "$CRAWSHRIMP_NODE_EXECUTABLE" dist/cli.js agent explain-error <code>
```

## 使用场景
- 商品/SKU/库存查询、订单规划、智能补货校验(`product`/`stock`/`order`/`replenishment`/`ai-replenishment`/`pickup`);
- 运维:切品牌门店、订单排查、地址维护、MDM 同步、导出任务轮询、allowlist job(`company`/`ops ...`);
- AI Agent:读 `manifest` 做能力规划、`--json` 拿稳定输出、`agent explain-error` 拿确定性排障剧本。

## 安全契约
- 真实下单/写操作必须先 `--dry-run` 预演并得到用户明确授权;
- 业务命令不使用浏览器自动化/CDP;浏览器仅用于交互式登录引导;
- 敏感凭证不落盘、不输出。
