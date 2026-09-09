"""Native packaging gate: execute against the copied runtime, not the build host Python."""
from __future__ import annotations

import json
import re
import sys
import importlib.metadata
from pathlib import Path

from .runtime import OfficeError, inspect_runtime


def check(output: Path) -> dict:
    from .templates import acceptance_samples
    from .render import render
    from .validate import validate
    output.mkdir(parents=True, exist_ok=True)
    info = inspect_runtime()
    report = {"runtime": info, "documents": [], "ok": False}
    try:
        if not info["ok"]:
            raise OfficeError("OFFICE_RUNTIME_INCOMPLETE", json.dumps(info["issues"]))
        python_root = Path(sys.executable).resolve().parent
        if python_root.name == "bin":
            python_root = python_root.parent
        lock = python_root / ".crawshrimp-python.lock"
        for name, version in re.findall(r"^([a-zA-Z0-9_.-]+)==([^\s;\\]+)", lock.read_text(encoding="utf-8"), re.M):
            if importlib.metadata.version(name) != version:
                raise OfficeError("OFFICE_RUNTIME_MISMATCH", f"Installed version differs from lock: {name}")
        sources = output / "sources"
        sources.mkdir()
        for source in acceptance_samples(sources):
            # Reading the generated original is separate from checking recalculated copies.
            original = validate(source)
            allowed = {"FORMULA_CACHE_MISSING"} if source.suffix == ".xlsx" else set()
            if any(issue["code"] not in allowed for issue in original["issues"]):
                raise OfficeError("OFFICE_SMOKE_FAILED", json.dumps(original))
            work = output / source.suffix[1:]
            work.mkdir()
            result = render(source, work, recalculate=source.suffix == ".xlsx")
            expected = {"contains": ["业务报告"]} if source.suffix == ".docx" else (
                {"slides": 5} if source.suffix == ".pptx" else
                {"cells": {"数据!A2": "00123", "汇总!B2": 69, "汇总!B3": "有销售"}})
            result["validation"] = validate(Path(result["document"]), expected)
            result["visual"] = {"status": "not_run", "reviewed": [], "total": len(result["pages"])}
            report["documents"].append(result)
            wanted_pages = 5 if source.suffix == ".pptx" else 3
            if (result["validation"]["status"] != "passed" or len(result["pages"]) != wanted_pages
                    or not any("SourceHanSansSC" in font for font in result["fonts"])):
                raise OfficeError("OFFICE_SMOKE_FAILED", f"{source.name}: content/pages/fonts mismatch")
        # Exercise shipped design helpers and template fidelity with the copied Python.
        # The rendered starter checks above remain an independent pagination/font gate.
        from .design_samples import generate_samples
        report["design_documents"] = []
        for source in generate_samples(output / "design-sources"):
            result = validate(source)
            allowed = {"FORMULA_CACHE_MISSING"} if source.suffix == ".xlsx" else set()
            if (any(i["code"] not in allowed for i in result["issues"])
                    or result["design_audit"]["status"] != "passed"):
                raise OfficeError("OFFICE_DESIGN_SMOKE_FAILED", json.dumps(result))
            report["design_documents"].append({"name": source.name, "validation": result})
        report["ok"] = True
        return report
    finally:
        (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
