"""Durable per-session Office jobs, bounded background workers and revision fences."""
from __future__ import annotations

import contextvars
import json
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from core.atomic_file import atomic_write_text
from .executor import execute
from .runtime import OfficeError, file_hash, python_executable

_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="office")
_lock = threading.RLock()
_live: dict[str, threading.Event] = {}
MAX_PENDING = 20


def save(work: Path, data: dict) -> None:
    atomic_write_text(work / "manifest.json", json.dumps(data, ensure_ascii=False, indent=2))


def locate(root: Path, job_id: str) -> Path:
    if len(job_id) != 32 or any(c not in "0123456789abcdef" for c in job_id):
        raise OfficeError("OFFICE_JOB_NOT_FOUND", "作业不存在。")
    work = (root / job_id).resolve()
    if not work.is_relative_to(root.resolve()) or not (work / "manifest.json").is_file():
        raise OfficeError("OFFICE_JOB_NOT_FOUND", "当前会话没有此作业。")
    return work


def read(root: Path, job_id: str, *, cancel: bool = False) -> dict:
    work = locate(root, job_id)
    with _lock:
        data = json.loads((work / "manifest.json").read_text(encoding="utf-8"))
        event = _live.get(str(work))
        if cancel and event:
            event.set()
        if data["state"] in ("queued", "running") and event is None:
            data.update(state="interrupted", error={"code": "OFFICE_INTERRUPTED", "message": "应用重启，作业已中断。"})
            save(work, data)
        return data


def start(root: Path, operation: str, *, code: str = "", document: Path | None = None,
          recalculate: bool = False, expected: dict | None = None) -> dict:
    # Resolve before accepting work; no fallback to the host interpreter.
    python = python_executable()
    with _lock:
        if len(_live) >= MAX_PENDING:
            raise OfficeError("OFFICE_QUEUE_FULL", "办公作业队列已满，请等待已有作业。")
        job_id = uuid.uuid4().hex
        work = (root / job_id).resolve()
        (work / "editable").mkdir(parents=True)
        data = {"job_id": job_id, "state": "queued", "operation": operation,
                "work": str(work), "result": None, "error": None}
        save(work, data)
        cancel = threading.Event()
        _live[str(work)] = cancel
    try:
        if operation == "run":
            script = work / "script.py"
            script.write_text(code, encoding="utf-8")
        elif operation == "render" and document:
            # Freeze the input before enqueueing; concurrent edits cannot change the job.
            import shutil
            (work / "source").mkdir()
            source = work / "source" / document.name
            shutil.copy2(document, source)
            document = source
        else:
            raise OfficeError("OFFICE_INVALID_INPUT", "未知办公操作。")
    except Exception as exc:
        with _lock:
            _live.pop(str(work), None)
            data.update(state="failed", error={"code": getattr(exc, "code", "OFFICE_FAILED"), "message": str(exc)})
            save(work, data)
        raise

    def task():
        try:
            with _lock:
                data["state"] = "running"
                save(work, data)
            if operation == "run":
                execution = execute([str(python), str(work / "script.py")], work, cancel=cancel)
                files = [str(p) for p in sorted((work / "editable").rglob("*"))
                         if p.is_file() and p.suffix.lower() in (".docx", ".pptx", ".xlsx", ".png", ".pdf")]
                result = {"files": files, **execution}
            else:
                # Heavy parsing/rasterization runs in the bundled child, not API threads.
                request = work / "request.json"
                request.write_text(json.dumps({"document": str(document), "work": str(work),
                                               "recalculate": recalculate, "expected": expected or {}}), encoding="utf-8")
                execute([str(python), str(Path(__file__).with_name("cli.py")), "render", str(request)],
                        work, timeout=300, cancel=cancel)
                result = json.loads((work / "result.json").read_text(encoding="utf-8"))
            with _lock:
                if cancel.is_set():
                    raise OfficeError("OFFICE_CANCELED", "作业已取消。")
                data.update(state="completed", result=result)
                save(work, data)
        except Exception as exc:
            with _lock:
                data.update(state="canceled" if getattr(exc, "code", "") == "OFFICE_CANCELED" else "failed",
                            error={"code": getattr(exc, "code", "OFFICE_FAILED"), "message": str(exc)[:16000]})
                save(work, data)
        finally:
            with _lock:
                _live.pop(str(work), None)
    try:
        _pool.submit(contextvars.copy_context().run, task)
    except Exception as exc:
        with _lock:
            _live.pop(str(work), None)
            data.update(state="failed", error={"code": "OFFICE_FAILED", "message": str(exc)})
            save(work, data)
        raise
    return data.copy()


def preview(root: Path, job_id: str, revision: str, page: int) -> dict:
    data = read(root, job_id)
    result = data.get("result") or {}
    if data["state"] != "completed" or result.get("revision") != revision:
        raise OfficeError("OFFICE_REVISION_MISMATCH", "预览版本已失效，请重新渲染。")
    if file_hash(Path(result["document"])) != revision:
        raise OfficeError("OFFICE_REVISION_MISMATCH", "文件已修改，请重新渲染。")
    pages = result.get("pages", [])
    if page < 1 or page > len(pages):
        raise OfficeError("OFFICE_PAGE_NOT_FOUND", "页码不存在。")
    item = pages[page - 1]
    path = Path(item["path"]).resolve()
    if not path.is_relative_to(locate(root, job_id)) or file_hash(path) != item["sha256"]:
        raise OfficeError("OFFICE_PREVIEW_CHANGED", "预览图片已变化，请重新渲染。")
    with _lock:
        data = read(root, job_id)
        delivered = data.setdefault("delivered_pages", [])
        if page not in delivered:
            delivered.append(page)
        save(locate(root, job_id), data)
    return item


def review(root: Path, job_id: str, revision: str, pages: list[dict]) -> dict:
    with _lock:
        data = read(root, job_id)
        for item in pages:
            number = item.get("page")
            if number not in data.get("delivered_pages", []):
                raise OfficeError("OFFICE_PAGE_NOT_VIEWED", "请先读取该页真实图片，再记录检查结果。")
            current = preview(root, job_id, revision, number)
            if item.get("sha256") != current["sha256"] or not isinstance(item.get("issues"), list) or not item.get("summary"):
                raise OfficeError("OFFICE_REVIEW_INVALID", "需要当前页图哈希、检查结论与问题列表。")
        reviewed = data.setdefault("reviewed_pages", {})
        for item in pages:
            reviewed[str(item["page"])] = item
        count = len(data["result"]["pages"])
        status = "partial" if len(reviewed) < count else "issues" if any(p["issues"] for p in reviewed.values()) else "passed"
        data["result"]["visual"] = {"status": status, "reviewed": sorted(map(int, reviewed)), "total": count}
        from .reports import write_report
        write_report(locate(root, job_id), data["result"], reviewed)
        save(locate(root, job_id), data)
        return data
