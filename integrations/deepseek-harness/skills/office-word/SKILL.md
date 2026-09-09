---
name: office-word
description: 创建、修改、检查Word 文档，提供可编辑原件、PDF 与逐页预览。
---

# Word 文档

读取 `office-common/README.md` 并遵守统一执行与交付流程。使用 python-docx；不要安装其他运行库。

## 布局与数据

A4；标题层级、页边距、页眉页脚；长表格重复表头，标题避免孤行。所有正文、表格及页眉页脚显式设定东亚字体。生成 DOCX 不等于已分页，实际页数与布局以 LibreOffice PDF 为准。复杂修订/嵌入对象可能无法保真，默认另存。

## 开始生成

1. 调用 office_runtime_info 核对内置环境。
2. office_run 运行下面的起始脚本，再根据用户内容扩充。也可用 `office-word/templates/starter.docx` 真实模板；模板绝对目录从 skill_read 返回的 root 解析，不猜路径。

```python
import os
from pathlib import Path
from core.office.templates import word_template
output = Path(os.environ["CRAWSHRIMP_OFFICE_OUTPUT"])
word_template(output / "交付文件.docx", title="用户需要的标题")
```

3. office_job 取得完成后的文件名；office_validate 读回内容和业务预期。
4. office_render 转 PDF/逐页 PNG，再 office_job 获取渲染作业结果。
5. 每页 office_preview_read 并实际检查，office_review_record 留下页码与结论。发现问题后修改源脚本重跑。
6. 交付渲染作业对应的原件与 PDF，告知实际检查覆盖和未解决项。无视觉能力就说明视觉检查尚未完成。
