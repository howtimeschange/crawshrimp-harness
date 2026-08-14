---
name: tmall-cli
description: Use when the user asks to inspect the Tmall/千牛 merchant center through an already logged-in CDP 9222 Chrome session — export menu trees, page snapshots, loaded MTOP/H5 API shapes, or run read-only recon. Never use it for writes; the CLI is read-only by contract and mutations require an explicit executor plan with confirmation gates.
---

# Tmall CLI(天猫商家中心只读 CLI)

## 位置与安装
- 本地路径:`skills/cli/tmall-cli`(可用环境变量 `CRAWSHRIMP_CLI_ROOT` 覆盖 CLI 根目录)。
- 依赖:Node 20+。首次使用前 `npm install && npm run build`(本地已装过则跳过)。

## 调用方式
```bash
cd <CLI_ROOT>/tmall-cli
npm run dev -- doctor -f json
npm run dev -- whoami -f json
npm run dev -- menu summary -f table
npm run dev -- menu list --top 商品 --leaves-only -f table
npm run dev -- endpoints apis -f table
npm run dev -- recon export --output-dir docs/recon -f json
npm run dev -- material-test items --keyword 1060862679580 -f json
```

## 使用场景
- 了解天猫商家中心菜单结构(`menu`)与已加载接口形状(`endpoints apis`);
- 沉淀某功能域的接口清单(`recon export`);
- 素材测款相关查询(`material-test`)。

## 安全契约(必须遵守)
- 默认只读:绝不点击提交/保存/发布/删除/退款/报名/上传等线上写操作;
- 不读取或落盘 cookie/token/密码/签名/原始带签 URL;
- `write_or_mutation_risk` 接口只报告风险,不执行;真实执行需要独立 `executor plan` 且满足全部确认门(用户明确授权前不得执行);
- 输出稳定 JSON 供结构化解析,`-f json` 优先。
