"""Absolute-script entry point, always launched using CRAWSHRIMP_PYTHON_EXECUTABLE."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from core.office.runtime import inspect_runtime


def main() -> None:
    action = sys.argv[1]
    if action == "smoke":
        from core.office.smoke import check
        check(Path(sys.argv[2]).resolve())
        return
    if action == "doctor":
        result = inspect_runtime()
        payload = json.dumps(result, ensure_ascii=False)
        if len(sys.argv) > 2:
            Path(sys.argv[2]).write_text(payload, encoding="utf-8")
        else:
            print(payload)
        return
    if action == "validate":
        from core.office.validate import validate
        config = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
        result = validate(Path(config["document"]), config.get("expected"))
        Path(config["result"]).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        return
    if action == "render":
        from core.office.render import render
        from core.office.validate import validate
        config = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
        work = Path(config["work"])
        result = render(Path(config["document"]), work, recalculate=config.get("recalculate", False))
        result["validation"] = validate(Path(result["document"]), config.get("expected"))
        result["visual"] = {"status": "not_run", "reviewed": [], "total": len(result["pages"])}
        from core.office.reports import write_report
        write_report(work, result)
        (work / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        return
    raise SystemExit("Unknown Office action")


if __name__ == "__main__":
    main()
