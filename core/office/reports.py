"""Readable, durable verification evidence accompanying editable documents."""
import json
from pathlib import Path
from core.atomic_file import atomic_write_text


def write_report(work: Path, result: dict, reviewed: dict | None = None) -> None:
    dest = work / "checks"
    dest.mkdir(exist_ok=True)
    report = {"revision": result.get("revision"), "document": result.get("document"),
              "validation": result.get("validation"), "visual": result.get("visual"),
              "fonts": result.get("fonts", []), "reviewed_pages": reviewed or {}}
    atomic_write_text(dest / "report.json", json.dumps(report, ensure_ascii=False, indent=2))
    visual = report["visual"] or {}
    lines = ["# 文档检查结果", "", f"文件：{Path(result['document']).name}",
             f"版本：{report['revision']}", "", f"结构与数据：{(report['validation'] or {}).get('status', 'not_run')}",
             f"视觉检查：{visual.get('status', 'not_run')}（{len(visual.get('reviewed', []))}/{visual.get('total', 0)} 页）", ""]
    for item in (report["validation"] or {}).get("issues", []):
        lines.append("- " + json.dumps(item, ensure_ascii=False))
    for page, item in sorted((reviewed or {}).items(), key=lambda x: int(x[0])):
        lines += ["", f"第 {page} 页：{item['summary']}"]
        lines.extend("- " + str(issue) for issue in item["issues"])
    atomic_write_text(dest / "report.md", "\n".join(lines) + "\n")
