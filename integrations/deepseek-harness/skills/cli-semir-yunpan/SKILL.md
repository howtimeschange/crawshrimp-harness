---
name: semir-yunpan-cli
description: Use when the user asks to search or download image assets from the Semir cloud drive (森马云盘) — search by style code (款号), by path keywords, by extension, or run batch SPU/SKC downloads with dedup and representative-image rules. Reuses the logged-in Chrome CDP 9222 session and page-owned APIs.
---

# 森马云盘 CLI

## 位置与安装
- 本地路径:`skills/cli/semir-yunpan-cli`(可用 `CRAWSHRIMP_CLI_ROOT` 覆盖 CLI 根)。
- 依赖:Node 20+。首次使用 `npm install && npm run build`。

## 调用方式
```bash
cd <CLI_ROOT>/semir-yunpan-cli
npm run dev -- style 208326133201 --limit 10 -f table
node dist/cli.js --help
```

## 使用场景
- 搜款号:按货号找包装图、平拍/模拍/创意拍、PSD/AI/CDR 源文件、PDF/尺码表;
- 搜图包:按路径关键词、扩展名、目录规则筛选;
- 按路径找图:给完整云盘路径解析文件信息与临时预览/下载链接;
- 批量下载:SPU/SKC 搜图、去重、代表图、命名规则(与抓虾任务同一套逻辑);
- 深绘上新图包整理:款号文件夹定位、模特图/静物图 SOP 过滤、yq 命名与下载计划。

## 输出格式
支持 `json` / `ndjson` / `csv` / `md` / `table`,给 agent 时优先 `-f json`。

## 安全契约
- 复用 9222 已登录会话,在页面上下文调用森马云盘自己的接口;
- 不读取/落盘 cookie、token、密码、签名;
- 下载写本地文件属于 local_write,输出目录默认在任务数据目录。
