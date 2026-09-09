---
name: office-excel
description: 创建、修改、检查Excel 工作簿，提供可编辑原件、PDF 与逐页预览。
---

# Excel 工作簿

读取 `office-common/README.md` 并遵守统一执行与交付流程。使用 openpyxl 与 pandas；不要安装其他运行库。

需要设计汇报页、图表或统一视觉样式时，读取 `office-design-taste/SKILL.md`；普通数据处理无需额外设计流程，公式与数据规则始终适用。

## 布局与数据

数据/汇总/说明分表；保留商品编号前导零，空值不当作零；确认统计口径、日期与金额精度。pandas 的 Excel 引擎显式用 openpyxl。冻结表头、筛选、数值格式、打印范围；打印宽度一页而高度自动。隐藏表及不打印的数据区域说明范围。openpyxl 不计算公式，data_only=True 是旧缓存，不是实时结果。新建普通工作簿允许 LibreOffice 重算副本后读回；Excel 特有函数、宏、外链及复杂图表须保留原件并报告限制。

## 开始生成

1. 调用 office_runtime_info 核对内置环境。
2. office_run 运行下面的起始脚本，再根据用户内容扩充。也可用 `office-excel/templates/starter.xlsx` 真实模板；模板绝对目录从 skill_read 返回的 root 解析，不猜路径。

```python
import os
from pathlib import Path
from core.office.templates import excel_template
output = Path(os.environ["CRAWSHRIMP_OFFICE_OUTPUT"])
excel_template(output / "交付文件.xlsx", title="用户需要的标题")
```

3. office_job 取得完成后的文件名；office_validate 读回内容和业务预期。
4. office_render 转 PDF/逐页 PNG，再 office_job 获取渲染作业结果。
5. 每页 office_preview_read 并实际检查，office_review_record 留下页码与结论。发现问题后修改源脚本重跑。
6. 交付渲染作业对应的原件与 PDF，告知实际检查覆盖和未解决项。无视觉能力就说明视觉检查尚未完成。
