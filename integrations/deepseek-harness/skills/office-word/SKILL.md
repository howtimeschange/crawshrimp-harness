---
name: office-word
description: 创建、修改、检查Word 文档，提供可编辑原件、PDF 与逐页预览。
---

# Word 文档

读取 `office-common/README.md` 并遵守统一执行与交付流程。使用 python-docx；不要安装其他运行库。

新建报告、调整排版或美化时，先 `skill_read('office-design-taste/SKILL.md')`，再读取其中的 Word 版式参考；仅提取文字/数据或小范围内容替换时保留原样式即可。

## 布局与数据

A4；标题层级、页边距、页眉页脚；长表格重复表头，标题避免孤行。所有正文、表格及页眉页脚显式设定东亚字体。生成 DOCX 不等于已分页，实际页数与布局以 LibreOffice PDF 为准。复杂修订/嵌入对象可能无法保真，默认另存。

## 开始生成

1. 调用 office_runtime_info 核对内置环境。
2. 读取 `office-design-taste/references/native-api.md`，按任务使用内置排版 API。以下仅是起点，交付前须替换示例内容。用户提供模板时优先沿用模板；PPT 使用 `inspect_template` / `follow_template`，不以新建版式覆盖公司母版。

```python
import os
from pathlib import Path
from core.office.word_design import new_document, add_table
output = Path(os.environ["CRAWSHRIMP_OFFICE_OUTPUT"])
doc = new_document("用户需要的标题", preset="report")
doc.add_heading("一、核心结论", 1)
doc.add_paragraph("根据用户资料填写正文。")
doc.save(output / "交付文件.docx")
```

3. office_job 取得完成后的文件名；office_validate 读回内容和业务预期。
4. office_render 转 PDF/逐页 PNG，再 office_job 获取渲染作业结果。
5. 每页 office_preview_read 并实际检查，office_review_record 留下页码与结论。发现问题后修改源脚本重跑。
6. 交付渲染作业对应的原件与 PDF，告知实际检查覆盖和未解决项。无视觉能力就说明视觉检查尚未完成。
