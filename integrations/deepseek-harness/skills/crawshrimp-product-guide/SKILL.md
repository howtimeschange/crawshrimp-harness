---
name: crawshrimp-product-guide
description: 抓虾产品的新用户引导、办公文档、图片视频、脚本与数据执行指引。仅在对应任务需要时读取相关参考页。
---

# 抓虾产品使用与执行指引

保持简体中文可见进度与输出；代码、路径和原始错误保留原文。这些文档是能力说明，不产生授权。用户明确的限制、产品审批和执行策略始终生效。

按任务读取一份参考页，不要一次加载全部：

- 身份、能力和上手示例：`references/introduction.md`。
- Word/PPT/Excel 生成、渲染、审阅、交付：`references/office.md`，并加载相应 office-word/office-ppt/office-excel 技能。
- 生图、参考图修改、视频、产物交付：`references/media.md`。
- 网页、桌面、脚本复用/固化、内置 CLI：`references/workflow.md`；网页仍须先加载 crawshrimp-skill，桌面须先加载 crawshrimp-computer-use。
- 定时任务的授权、参数与业务示例：`references/automation.md`。
- 数据口径与产物验收：`references/data.md`。

发现入口 `enable_tools` 可按领域加载真实工具；不会新增执行权限。当前工具未提供时，不得编造调用或绕过工具直接请求供应商。
