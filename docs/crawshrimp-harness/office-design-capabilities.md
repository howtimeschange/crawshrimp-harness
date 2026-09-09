# Office 原生设计能力

本轮在 main 上独立实现，复用项目已有 python-docx、python-pptx、openpyxl、matplotlib 和 LibreOffice。统一通过 office_run 使用内置 Python；不新增安装步骤。

## 实现范围

| 能力 | 入口 | 行为 |
| --- | --- | --- |
| Word 设计 | core.office.word_design | report / proposal / policy 三套语义样式、页面、页眉页脚和原生表格 |
| Word 检查 | core.office.word_audit | 假标题提示、层级跳级、字号覆盖、预设漂移、表格网格与单元格宽度、长表重复表头 |
| PPT 版式 | core.office.ppt_design | 26 种原创版式、三套主题、原生图表/表格、等比图片、逐页结论/来源/备注、计划与文件 SHA |
| PPT 模板 | core.office.ppt_template | 检查页面与形状 ID、按映射填充副本、绑定模板 SHA、对照内容包/几何/样式/顺序 |
| PPT 检查 | core.office.ppt_audit | 画布越界错误与文本高度估算提示 |
| Excel 报表 | core.office.excel_design | 指定范围的输入/公式/汇总样式，编号、金额、日期和比例格式，冻结与打印布局；不改数据和公式 |

三件套 Skill 均引导读取 office-design-taste/references/native-api.md 并使用新 API。office_runtime_info 暴露可用预设与布局；office_validate 在基础校验之外返回 design_audit。

## 上游参考

融合 ppt-master 的受众/目标/主结论、逐页 takeaway 与证据、讲稿和导出检查方法。固定上游版本 3ad8052e97dd35cc57ae8c30442a5b8b5811e5eb；来源和 MIT 原文随预置 Skill 交付。没有导入上游 SVG 编译器、模板、额外音频/图形依赖或阶段确认门禁。现有 taste-skill 的办公适配继续保留。

旧 Codex 文件仅作为能力需求线索；本轮没有复制其受限文档、脚本或 Grid 布局模块。实现来自当前开源 Office 库的接口和公开 OOXML 格式。

## 边界

- 自动检查不能证明视觉正确。基础 status=passed、design_audit 和逐页视觉记录是三个独立结论。
- Word 检查未覆盖所有嵌套表格、文本框、复杂域；模板局部修改不应主动套用全稿预设。
- PPT 模板保持原有页数、形状和段落。当前不自动增删/复制页，不重建 SmartArt/图表/图片；表格替换要求行列一致且没有合并格。新文字沿用原段首 run 样式，局部强调需要另行指定。保真报告不是溢出检查。
- PPT 文本高度只是估算；内容过长应拆页或调整区域，仍需检查实际 PDF 每页。
- Excel 格式化保留值、公式和已有筛选/表结构；按列宽估算中文换行行高，但行高/列宽影响整行/列。合并格、公式结果与超长文本仍需实际渲染检查。openpyxl 不计算公式，重算副本后才核对缓存值。

## 验证

本地证据位于 `.codex-tmp/dont-stop/office-design/`，不随产品分发。

- 定向测试 66 项通过；全量 Python 回归 1713 项通过、1 项跳过、45 项子测试通过；后续模板检查、环境诊断与中文行高修复已由定向测试覆盖。打包钩子测试 17 项通过。
- LibreOffice 原生渲染：三套 Word 各 1 页、经营汇报 6 页、模板填充 6 页、Excel 3 页、完整布局样例 26 页；基础与设计检查通过。
- 已逐页审查 38 页：三套 Word、Excel 三页、模板填充六页、26 种布局。检查中文、边界、遮挡、表格与图表可读性；业务数字为明确标注的虚构示例。
- after-pack 的 smoke 新增六份设计样例的生成、重新打开和设计检查，原三件套渲染/中文字体/公式门禁继续保留。

客户端与最终安装包的实际验收结果见本轮交付记录；macOS ARM 本机结果不能代替 Intel/Windows 原生实测。
