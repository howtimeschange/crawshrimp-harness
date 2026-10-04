"""Resolve UI-requested Office previews without mutating delivered artifacts."""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from core import runtime_paths
from core.atomic_file import atomic_write_text
from core.office import jobs
from core.office.runtime import OfficeError, file_hash

SUPPORTED_SUFFIXES = {".docx", ".pptx", ".xlsx"}
REQUEST_FILE = "office-preview-request.json"
_lock = threading.RLock()


def preview_root() -> Path:
    root = runtime_paths.data_root() / "agent" / "previews" / "office"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _error(code: str, message: str, *, job_id: str | None = None) -> dict:
    payload = {"state": "failed", "error": {"code": code, "message": message}}
    if job_id:
        payload["job_id"] = job_id
    return payload


def _safe_path(value: Any) -> Path | None:
    if not value:
        return None
    try:
        return Path(str(value)).expanduser().resolve()
    except (OSError, RuntimeError, TypeError, ValueError):
        return None


def _read_json(path: Path) -> dict | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, ValueError):
        return None


def _request_for(work: Path) -> dict | None:
    return _read_json(work / REQUEST_FILE)


def _same_file(left: Path | None, right: Path) -> bool:
    return bool(left and left == right)


def _page_item(item: dict, work: Path) -> dict | None:
    try:
        page_path = _safe_path(item.get("path"))
        if not page_path or not page_path.is_file() or not page_path.is_relative_to(work):
            return None
        expected_hash = item.get("sha256")
        if expected_hash and file_hash(page_path) != expected_hash:
            return None
    except (OSError, RuntimeError, TypeError, ValueError):
        return None
    clean = {
        "page": item.get("page"),
        "path": str(page_path),
        "sha256": expected_hash or file_hash(page_path),
    }
    for key in ("width", "height", "text_length"):
        if key in item:
            clean[key] = item[key]
    return clean


def _office_from_manifest(work: Path, requested: Path) -> dict | None:
    try:
        data = _read_json(work / "manifest.json")
        if not data or data.get("state") != "completed":
            return None
        result = data.get("result") if isinstance(data.get("result"), dict) else {}
        document = _safe_path(result.get("document"))
        if not _same_file(document, requested) or not document.is_file():
            return None
        revision = result.get("revision")
        if not revision or file_hash(document) != revision:
            return None
        pages = []
        for item in result.get("pages") or []:
            if not isinstance(item, dict):
                return None
            clean = _page_item(item, work)
            if not clean:
                return None
            pages.append(clean)
        if not pages:
            return None
        pdf = _safe_path(result.get("pdf"))
        office = {"job_id": data.get("job_id") or work.name, "revision": revision, "pages": pages}
        if pdf and pdf.is_file() and pdf.is_relative_to(work):
            office["pdf"] = str(pdf)
        for key in ("validation", "visual", "delivery"):
            value = result.get(key)
            if isinstance(value, dict):
                office[key] = value
        return office
    except (OSError, RuntimeError, TypeError, ValueError):
        return None


def _recover_sibling_manifest(path: Path) -> dict | None:
    if path.parent.name != "editable":
        return None
    work = path.parent.parent.resolve()
    if not (work / "manifest.json").is_file():
        return None
    return _office_from_manifest(work, path)


def _preview_work_items(root: Path):
    try:
        children = list(root.iterdir())
    except OSError:
        return []
    candidates = [child for child in children if child.is_dir() and len(child.name) == 32]
    def mtime(item: Path) -> float:
        try:
            return item.stat().st_mtime
        except OSError:
            return 0
    candidates.sort(key=mtime, reverse=True)
    return candidates[:40]


def _matches_request(work: Path, path: Path, revision: str) -> bool:
    request = _request_for(work)
    return bool(request and _safe_path(request.get("source_path")) == path and request.get("source_revision") == revision)


def _office_from_preview_job(work: Path, requested: Path, revision: str) -> dict | None:
    try:
        data = jobs.read(preview_root(), work.name)
        if data.get("state") != "completed":
            return None
        result = data.get("result") if isinstance(data.get("result"), dict) else {}
        document = _safe_path(result.get("document"))
        if (not document or not document.is_file() or not document.is_relative_to(work)
                or result.get("revision") != revision or file_hash(document) != revision):
            return None
        pages = []
        for item in result.get("pages") or []:
            if not isinstance(item, dict):
                return None
            clean = _page_item(item, work)
            if not clean:
                return None
            pages.append(clean)
        if not pages:
            return None
        pdf = _safe_path(result.get("pdf"))
        office = {"job_id": work.name, "revision": revision, "pages": pages}
        if pdf and pdf.is_file() and pdf.is_relative_to(work):
            office["pdf"] = str(pdf)
        for key in ("validation", "visual"):
            value = result.get(key)
            if isinstance(value, dict):
                office[key] = value
        return office
    except (OSError, OfficeError, RuntimeError, TypeError, ValueError):
        return None


def _existing_for(path: Path, revision: str) -> dict | None:
    root = preview_root()
    for work in _preview_work_items(root):
        if not _matches_request(work, path, revision):
            continue
        try:
            data = jobs.read(root, work.name)
        except (OSError, OfficeError, RuntimeError, TypeError, ValueError):
            continue
        state = data.get("state")
        if state in {"queued", "running"}:
            return {"state": state, "job_id": work.name}
        if state == "completed":
            office = _office_from_preview_job(work, path, revision)
            if office:
                return {"state": "completed", "office": office}
        # Failed/stale jobs are intentionally ignored on a fresh open so the
        # user can retry by opening the file again. Polling a job_id stays fixed.
    return None


def _start_render(path: Path, revision: str) -> dict:
    root = preview_root()
    data = jobs.start(root, "render", document=path, recalculate=False)
    work = jobs.locate(root, data["job_id"])
    atomic_write_text(work / REQUEST_FILE, json.dumps({
        "source_path": str(path),
        "source_revision": revision,
    }, ensure_ascii=False, indent=2))
    return _poll(path, data["job_id"])


def _poll(path: Path, job_id: str) -> dict:
    root = preview_root()
    try:
        work = jobs.locate(root, job_id)
    except OfficeError:
        return _error("OFFICE_PREVIEW_JOB_NOT_FOUND", "预览作业不存在。", job_id=job_id)
    request = _request_for(work)
    if not request or _safe_path(request.get("source_path")) != path:
        return _error("OFFICE_PREVIEW_PATH_MISMATCH", "预览作业不属于当前文件。", job_id=job_id)
    try:
        current_revision = file_hash(path)
    except OSError:
        return _error("OFFICE_PREVIEW_SOURCE_MISSING", "文件不存在。", job_id=job_id)
    if request.get("source_revision") != current_revision:
        return _error("OFFICE_PREVIEW_STALE", "文件已修改，请重新打开预览。", job_id=job_id)
    try:
        data = jobs.read(root, job_id)
    except (OSError, OfficeError, RuntimeError, TypeError, ValueError) as exc:
        return _error(getattr(exc, "code", "OFFICE_PREVIEW_FAILED"), str(exc), job_id=job_id)
    state = data.get("state")
    if state in {"queued", "running"}:
        return {"state": state, "job_id": job_id}
    if state == "completed":
        office = _office_from_preview_job(work, path, current_revision)
        if office:
            return {"state": "completed", "office": office}
        return _error("OFFICE_PREVIEW_INVALID", "预览结果已失效，请重新打开预览。", job_id=job_id)
    error = data.get("error") if isinstance(data.get("error"), dict) else {}
    return _error(error.get("code") or "OFFICE_PREVIEW_FAILED",
                  error.get("message") or "办公预览生成失败。", job_id=job_id)


def resolve(path: Path, job_id: str | None = None) -> dict:
    path = path.expanduser().resolve()
    if path.suffix.lower() not in SUPPORTED_SUFFIXES:
        return _error("OFFICE_FORMAT_UNSUPPORTED", "仅支持 DOCX、PPTX、XLSX 预览。")
    if not path.is_file():
        return _error("OFFICE_FILE_NOT_FOUND", "文件不存在。")
    if job_id:
        try:
            with _lock:
                return _poll(path, job_id)
        except (OfficeError, OSError, RuntimeError, ValueError) as exc:
            return _error(getattr(exc, "code", "OFFICE_PREVIEW_FAILED"), str(exc), job_id=job_id)
    try:
        revision = file_hash(path)
    except OSError:
        return _error("OFFICE_FILE_NOT_FOUND", "文件不存在。")
    with _lock:
        try:
            office = _recover_sibling_manifest(path)
            if office:
                return {"state": "completed", "office": office}
            existing = _existing_for(path, revision)
            if existing:
                return existing
            return _start_render(path, revision)
        except (OfficeError, OSError, RuntimeError, ValueError) as exc:
            return _error(getattr(exc, "code", "OFFICE_PREVIEW_FAILED"), str(exc))
