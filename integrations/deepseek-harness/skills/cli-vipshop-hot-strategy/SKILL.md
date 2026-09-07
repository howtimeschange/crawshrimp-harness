---
name: vipshop-hot-strategy
description: Use when the user asks to collect, export, analyze, or summarize Vipshop (唯品会) hot-product strategy reports — the 5 standard reports (魔方罗盘销售明细 / 唯直达投放效果 / T-max 商品打爆 / 中台礼金 / 中台购物车·跨品类券). Read-only collection from the logged-in CDP 9222 browser, then local analysis to Excel/JSON/Markdown.
---

# 唯品会爆款策略追踪 Agent CLI

## 内置运行时
- 本地路径:`skills/cli/vipshop-hot-strategy-agent`(可用 `CRAWSHRIMP_CLI_ROOT` 覆盖 CLI 根)。
- 抓虾 Harness 的打包 Python 已包含本项目所需 `openpyxl`、`PyYAML` 与 `websockets`；不要让最终用户执行 `pip install`。

## 调用方式
```bash
cd <CLI_ROOT>/vipshop-hot-strategy-agent
PYTHONPATH=src "$CRAWSHRIMP_PYTHON_EXECUTABLE" -m vipshop_hot_strategy_agent.cli collect
PYTHONPATH=src "$CRAWSHRIMP_PYTHON_EXECUTABLE" -m vipshop_hot_strategy_agent.cli analyze <excel>
PYTHONPATH=src "$CRAWSHRIMP_PYTHON_EXECUTABLE" -m vipshop_hot_strategy_agent.cli run
PYTHONPATH=src "$CRAWSHRIMP_PYTHON_EXECUTABLE" -m vipshop_hot_strategy_agent.cli doc-summary
```

## 使用场景
- 唯品会爆款策略复盘:采集 5 份报表 → 导出 Excel → 分析 → 生成策略总结;
- 覆盖报表:魔方罗盘销售明细、唯直达投放效果、T-max 商品打爆效果、中台礼金、中台购物车/跨品类券。

## 安全契约
- 默认只读链路:优先复用已登录 9222 会话;不可用时自动打开本项目专用 profile 的 9222 Chrome;
- 只调用页面自己的报表接口读取数据,不读取/保存 cookie、token、localStorage;
- 不修改广告、礼金、优惠券、预算、出价或商品配置。
