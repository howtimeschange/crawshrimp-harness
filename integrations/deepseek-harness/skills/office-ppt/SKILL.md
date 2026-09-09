---
name: office-ppt
description: 创建、修改、检查PowerPoint 演示文稿，提供可编辑原件、PDF 与逐页预览。
---

# PowerPoint 演示文稿

读取 `office-common/README.md` 并遵守统一执行与交付流程。使用 python-pptx；不要安装其他运行库。

新建演示、调整版式或美化时，先 `skill_read('office-design-taste/SKILL.md')`，再读取其中的 PPT 版式参考；仅提取文字/数据或小范围内容替换时保留原样式即可。

## 布局与数据

默认 16:9；每页单一主题，统一安全边距、字体层级和对齐。优先原生形状/表格/图表；插入的 matplotlib 图是图片，不能承诺逐元素可编辑。检查每页长标题、文本框越界、遮挡和小字号。

## 开始生成

1. 调用 office_runtime_info 核对内置环境。
2. 读取 `office-design-taste/references/native-api.md`，按任务使用内置排版 API。以下仅是起点，交付前须替换示例内容。用户提供模板时优先沿用模板；PPT 使用 `inspect_template` / `follow_template`，不以新建版式覆盖公司母版。

```python
import os
from pathlib import Path
from core.office.ppt_design import build_deck
output = Path(os.environ["CRAWSHRIMP_OFFICE_OUTPUT"])
plan = {"audience": "目标读者", "purpose": "沟通目的", "message": "全稿主结论", "slides": [
    {"layout": "conclusion", "title": "本页结论", "takeaway": "读者应理解的要点",
     "content": {"message": "核心结论", "evidence": "用户提供的证据", "action": "下一步行动"},
     "notes": "基于资料填写讲稿。"}
]  # 实际交付前替换全部示例文字，并按内容增加页面。
build_deck(plan, output / "交付文件.pptx")
```

3. office_job 取得完成后的文件名；office_validate 读回内容和业务预期。
4. office_render 转 PDF/逐页 PNG，再 office_job 获取渲染作业结果。
5. 每页 office_preview_read 并实际检查，office_review_record 留下页码与结论。发现问题后修改源脚本重跑。
6. 交付渲染作业对应的原件与 PDF，告知实际检查覆盖和未解决项。无视觉能力就说明视觉检查尚未完成。
