---
name: office-ppt
description: 创建、修改、检查PowerPoint 演示文稿，提供可编辑原件、PDF 与逐页预览。
---

# PowerPoint 演示文稿

读取 `office-common/README.md` 并遵守统一执行与交付流程。使用 python-pptx；不要安装其他运行库。

## 布局与数据

默认 16:9；每页单一主题，统一安全边距、字体层级和对齐。优先原生形状/表格/图表；插入的 matplotlib 图是图片，不能承诺逐元素可编辑。检查每页长标题、文本框越界、遮挡和小字号。

## 开始生成

1. 调用 office_runtime_info 核对内置环境。
2. office_run 运行下面的起始脚本，再根据用户内容扩充。也可用 `office-ppt/templates/starter.pptx` 真实模板；模板绝对目录从 skill_read 返回的 root 解析，不猜路径。

```python
import os
from pathlib import Path
from core.office.templates import ppt_template
output = Path(os.environ["CRAWSHRIMP_OFFICE_OUTPUT"])
ppt_template(output / "交付文件.pptx", title="用户需要的标题")
```

3. office_job 取得完成后的文件名；office_validate 读回内容和业务预期。
4. office_render 转 PDF/逐页 PNG，再 office_job 获取渲染作业结果。
5. 每页 office_preview_read 并实际检查，office_review_record 留下页码与结论。发现问题后修改源脚本重跑。
6. 交付渲染作业对应的原件与 PDF，告知实际检查覆盖和未解决项。无视觉能力就说明视觉检查尚未完成。
