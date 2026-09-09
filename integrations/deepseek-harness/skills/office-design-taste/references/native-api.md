# 内置排版 API

以下代码都在 `office_run` 内运行，输出保存到 `Path(os.environ['CRAWSHRIMP_OFFICE_OUTPUT'])`。不安装依赖。API 来自 Harness 自主实现的 `core.office`，采用已有 python-docx、python-pptx 和 openpyxl。

## Word：设计预设、页眉和表格

```python
import os
from pathlib import Path
from core.office.word_design import new_document, add_table, presets
from core.office.word_audit import audit_word
out = Path(os.environ['CRAWSHRIMP_OFFICE_OUTPUT'])
doc = new_document('第三季度经营分析', preset='report', subtitle='经营管理部', metadata={'期间': '2026 Q3'})
doc.add_heading('一、经营结论', 1)
doc.add_paragraph('填写有真实数据支撑的结论。')
add_table(doc, ['指标', '本期', '同比'], [['收入', '120 万元', '18%']], widths_cm=[7, 5, 4])
path = out / '经营分析.docx'
doc.save(path)
print(audit_word(path))
```

`presets()` 返回 report（商务报告）、proposal（项目方案）、policy（制度规范）的具体字号、字体、行距、页边距和主题色。表格 `preset` 参数与文档保持一致。`apply_preset(doc, preset)` 用于用户授权的整体重排，改变页面与样式；局部编辑不要调用。`table_geometry(table, widths_cm)` 在合并单元格后重新统一表宽、网格列宽和单元格宽度。

`audit_word(path)` 只读检查疑似假标题、标题跳级、直接字号覆盖、预设字号漂移、长段落连排以及表格宽度和重复表头。`warning` 是需要核对的提示（如有意的特殊字号），`error` 是明确结构问题。不会自动修复或改写内容。检查尚不覆盖所有嵌套表、文本框和复杂域。

## PPT：先明确结论，再选择原生版式

在生成前写清受众、用途、全稿主结论和逐页 takeaway。每页使用标题、数据/证据和版式匹配这一结论，不为凑页数编造数据。规划流程参考 ppt-master 的通用方法，实际构建使用以下 Harness API。

```python
from core.office.ppt_design import layout_catalog, build_deck
print(layout_catalog())  # 26 种布局的内容字段、类型和英寸坐标
plan = {
  'audience': '经营管理层', 'purpose': '审议下一季度投入', 'message': '先验证试点再扩大投入',
  'theme': 'business',
  'slides': [{
    'layout': 'chart-insight', 'title': '收入持续增长，下一步验证利润回报',
    'takeaway': '收入增长需要结合成本判断投入',
    'content': {'chart': {'categories': ['六月','七月','八月'], 'series': {'收入':[100,120,150]}, 'unit':'万元'},
                'insight': '这里填写基于用户数据的分析。'},
    'source': '示例数据，不代表实际业务',
    'notes': '请按图表解释变化，再介绍需要管理层决策的事项。'
  }]
}
build_deck(plan, out / '经营汇报.pptx')
```

主题：business、proposal、mono。默认画布 16:9。图表和表格是原生可编辑对象，图片保持比例。讲稿写入备注页。`.design.json` 保存计划、文件 SHA 和布局诊断，便于核对实际交付版本。也可用 `new_deck()`、`add_slide(prs, layout, title, content, theme=...)` 逐页构建。

26 种布局：cover、section、agenda、conclusion、two-column、three-column、compare-two、compare-three、before-after、problem-solution、quote、image-left、image-right、image-wide、two-images、metric-focus、metric-three、chart-wide、chart-insight、chart-pair、table-wide、table-insight、process、timeline、four-quadrant、action-plan。

先读取 `layout_catalog()` 对应的字段，再提供 `content`。text/lead/body/panel/metric 使用字符串；list/process 使用字符串数组；image 使用准确图片路径；table 使用包含表头的二维数组，最多 9 行，更多则拆页；chart 使用 categories、series，可选 type='line' 和 unit。所有命名字段必须填写，不能交付空占位框。

从 `core.office.ppt_audit` 导入 `audit_ppt`（不是 `ppt_design`）。`audit_ppt(path)` 检查画布越界并估算文本高度。文本估算只是预警，会受字体、字距和继承样式影响；修复内容密度后须实际渲染确认。不要把自动缩小字体当作默认修复方式。

## PPT：跟随公司原始模板

```python
from core.office.ppt_template import inspect_template, follow_template
source = Path('/用户授权的准确路径/公司模板.pptx')
info = inspect_template(source)
print(info)  # 页码、形状 id/name、文本、段落数、母版布局名与坐标、表格行列/内容/合并标记
# 用实际返回的 ID，不能假设标题一定是 2。这里只演示请求结构。
title_id = info['slides'][0]['shapes'][0]['id']
report = follow_template(source, out / '公司汇报.pptx',
    [{'slide': 1, 'texts': {title_id: '第三季度经营汇报'}}], source_sha256=info['sha256'])
print(report)
```

映射使用一基页码和准确形状 ID；texts 修改文本，tables 修改形状 ID 对应的二维表格。母版、主题、页面尺寸、未指定内容、图片和讲稿保持；不覆盖源文件。额外的 `.fidelity.json` 是结构对照结果，并非视觉通过证明。

当前保守模式保持所有页和段落结构，不自动增删/复制页。文本段落数不能超过模板，表格行列数要一致且没有合并单元格；目标不存在、模板 SHA 变化或保真失败会报错。替换文字沿用各段首个 run 的样式，旧的局部强调不会自动映射到新词；需要进一步设计时明确调整并重新检查。复杂图表、SmartArt、嵌入对象原样保留，不承诺可编辑转换。

## Excel：按明确范围设置报表

```python
from openpyxl import Workbook
from core.office.excel_design import format_report, audit_report
book = Workbook()
ws = book.active
ws.title = '经营明细'
for row in [['编号','收入','成本','利润'], ['00123',120,70,'=B2-C2']]:
    ws.append(row)
format_report(ws, 'A1:D2', columns={'A':'text','B':'amount','C':'amount','D':'amount'},
              roles={'B2:C2':'input','D2:D2':'formula'}, title='经营明细', financial=True)
book.save(out / '经营报表.xlsx')
print(audit_report(ws))
```

列格式支持 text、amount、integer、percent、date；角色底色支持 input、formula、summary，必须在正文范围内，表头不作为输入区。角色颜色之外还应有清晰的列名/说明页，不能只靠颜色。格式化只作用于指定单元格范围；行高/列宽会影响所在整行/整列。它会设置冻结、打印区域/表头、页眉页脚及缩放，不推断业务公式，不改写值、已有筛选和表结构，不添加合并单元格。修改现有样式前确认用户要求的是美化而非只改数据。

文字行高按列宽、中文字符宽度与显式换行估算，避免固定行高裁切说明列。`EXCEL_TEXT_FIT_ESTIMATE` 是提示而非视觉结论；合并格、公式结果和超过 Excel 最大行高的长文本要单独调整列宽、拆分内容并渲染检查。

financial=True 只增加口径提示，不生成财务模型；须明确币种、期间、税口径、负数和缺失值含义。比例应存小数并使用百分比格式，编号从输入开始保留字符串。公式缓存与错误使用 `office_validate` 和现有重算流程核对。

## 统一验证

`office_validate` 返回基础内容校验以及 `design_audit`。基础 status=passed 不代表设计或视觉通过；查看设计报告的 issues，解决明确错误，记录有意保留的提示。然后执行现有逐页渲染、读取和检查记录流程。新文件、模板填充文件都不能跳过视觉检查。
