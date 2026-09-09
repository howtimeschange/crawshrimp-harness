# 来源与改编

- 上游：https://github.com/Leonxlnx/taste-skill
- 固定版本：`ccbc15639c97057cbfcf32ecebc38ef716e4bb37`
- 参考文件：`skills/taste-skill/SKILL.md`，原名称 `design-taste-frontend`。
- 许可：MIT，完整原文随本目录 `LICENSE` 分发，版权归 Leonxlnx。
- 本目录为 Crawshrimp Harness 的办公场景改编版，不是上游原版，也不代表上游支持或认证。

吸收的部分：Section 0 的受众/场景/品牌判断，Section 4.1–4.4 的字体层级、配色一致性、布局多样性与克制装饰，Section 11 的先审阅后改版、保留品牌与内容原则。

Harness 补充：中文内置字体、PPT 的页面与字号建议、Word 语义样式/分页/长表、Excel 数据与公式保护、统一 office_run 执行及逐页预览审查。

未移植网页框架安装、React/Tailwind/GSAP 代码、网页动效参数、网页组件与 SEO 检查，也未移植不适合办公文档的绝对字体/颜色/标点禁令。未导入上游其他 Skill、安装脚本、宣传素材或外部运行依赖。全部设计建议服从用户模板、品牌规范和文件可读性要求。

## PPT Master 工作流参考

- 来源：https://github.com/hugohe3/ppt-master
- 固定版本：`3ad8052e97dd35cc57ae8c30442a5b8b5811e5eb`（Skill 标记 6.3.1）。
- 参考：`skills/ppt-master/SKILL.md`、`references/plan-core.md`、`references/shared-standards-core.md`、`workflows/profiles/quick-generate.md`。
- 许可：MIT，Copyright (c) 2025-2026 Hugo He，原文随 `LICENSE.ppt-master` 分发。
- 融合：先明确受众和沟通目标，逐页规划结论与证据，统一视觉规则，原生图表/表格及备注，导出前检查并记录版本。
- 未导入其 SVG 编译器、脚本、品牌模板、推广素材或额外图形/音频依赖。采用 Harness 自有 Python 排版代码与现有 Office 工具；没有移植上游的分阶段确认、安装命令或宿主专用规则。

`core.office.word_design/word_audit/ppt_design/ppt_audit/ppt_template/excel_design` 均为 Harness 自主实现，26 种布局是本项目原创配方，并非 Codex Grid 模块或 PPT Master 模板的复制品。
