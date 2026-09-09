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

## main 客户端与安装包验收（2026-09-09）

实现提交：`5828cc06d6f7743a0e43be1bcab785a88e1ca7f9`。使用原项目 main 开发客户端 `127.0.0.1:5173`，未启动旧分支开发客户端。会话 `cs-web-b576f3f00577` 自行调用新 API 生成文件并完成检查：

| 文件 | 最终渲染作业 | 结果 |
| --- | --- | --- |
| Word 报告 | `268ec17c6c214a468fb051d0776e840a` | 基础、设计与视觉检查通过，2/2 页 |
| PPT 汇报 | `ac388495907743a8ac50055c01c79af7` | 基础、设计与视觉检查通过，6/6 页 |
| PPT 模板副本 | `77d87873478e446b9245b1578f6eaf02` | 仅改第 1 页标题，结构保真通过；视觉检查 6/6 页 |
| Excel 三表报表 | `f4901de35cb64dfeb220052c5ce803fe` | 基础、设计与视觉检查通过，3/3 页 |

实际点击 Word/PPT/Excel 产物预览与翻页，界面显示正确文件类型和检查覆盖。重新读取文件与页面 SHA，确认全部 17 页记录对应最终版本。Excel 核对 14 个公式、文本编号 `00123`/`00456`、销售额 5,130,000、利润 920,000、华东合计 2,740,000 与 IF 判断。原数据与公式语义保持，LibreOffice 仅去除了三处公式中不必要的工作表名引号。样例均明确标注为虚构数据。

真机发现并修复了固定行高裁切中文说明的问题，加入按列宽估算及 LibreOffice 宽度转换余量；同时完善逐页串行读图规则，避免批量图片桥接只观察到末页。真实会话中的单位/合计示例和汇总列宽、文本对齐也经过修正后再检查。

最后基于该 main 提交及固定子模块提交的干净源码快照完成 `stage-runtime.mjs --force`（含 Web profile 启动配置检查）、Vite 构建与 ARM DMG。打包门禁发现本机旧 Python 缓存缺少 Office 库；更新为与 main 锁文件一致的标准 Python 依赖缓存后，仅重跑失败的打包步骤。没有复制旧分支的应用代码。

- 安装包：`app/dist/office-design-5828cc06d/crawshrimp-harness-v0.1.13-mac-arm64.dmg`，929,881,353 字节。
- SHA-256：`6072d518b532dc1e447d43422a986e62944c33088e401578bb3b27b87d615e0f`。
- after-pack 包内 Python 原生检查通过：Word/PPT/Excel 渲染 3/5/3 页，中文字体与公式检查通过；新增六份设计样例生成、重新打开和设计审计通过。
- DMG 挂载后复制应用到新目录，卸载镜像，再使用复制出的包内 Python 重做原生检查，通过；运行前后 `codesign --verify --deep --strict` 均通过。
- 这是本地 ad-hoc 签名测试包，未公证、未发布。Intel/Windows 依赖锁和缓存已备齐，仍未在对应原生环境运行验收。

证据：`main-acceptance.json`、`main-final-ppt-page2.png`、`main-accepted-excel-page2.png`、`package-state.json`、`package-acceptance.json`、`installed-verification.log`、`installed-smoke/report.json`，均位于上述本地证据目录。
