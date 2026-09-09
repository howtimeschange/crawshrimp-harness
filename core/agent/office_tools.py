"""Office MCP surface; uses the same session, approval and artifact contracts as other tools."""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

from core.office import jobs
from core.office.executor import execute
from core.office.runtime import OfficeError, python_executable


def gateway():
    from core.agent import mcp_gateway
    return mcp_gateway


def root() -> Path:
    gw = gateway()
    if not gw.ctx.active_run:
        raise OfficeError("NO_ACTIVE_RUN", "没有活动会话。")
    session = str(gw.ctx.active_run.get("session_id") or "")
    if not session:
        raise OfficeError("NO_ACTIVE_RUN", "没有活动会话。")
    workspace = gw.ctx.workspace_root or (gw.runtime_paths.data_root() / "agent" / "workspace")
    return Path(workspace) / "outputs" / "office" / hashlib.sha256(session.encode()).hexdigest()[:24]


def failed(exc: Exception) -> dict:
    return gateway()._failed(getattr(exc, "code", "OFFICE_FAILED"), str(exc))


def publish(data: dict) -> None:
    gw = gateway()
    result = data.get("result") or {}
    files = result.get("files") or ([result["document"]] if result.get("document") else [])
    for raw in files:
        path = Path(raw)
        if not path.is_file() or not path.resolve().is_relative_to(root().resolve()):
            continue
        payload = {"artifact_id": f"office-{data['job_id']}-{path.name}", "filename": path.name,
                   "kind": "file", "path": str(path), "size": path.stat().st_size,
                   "media_kind": "office", "tool_call_id": gw.ctx.current_tool_call_id,
                   "office": {"job_id": data["job_id"], "revision": result.get("revision"),
                              "pdf": result.get("pdf"), "pages": result.get("pages", []),
                              "validation": result.get("validation"), "visual": result.get("visual")}}
        if gw.ctx.emit_event:
            gw.ctx.emit_event("artifact.created", payload)


def office_runtime_info() -> dict:
    try:
        import uuid
        work = root() / "diagnostics" / uuid.uuid4().hex
        work.mkdir(parents=True)
        output = work / "result.json"
        execute([str(python_executable()), str(Path(jobs.__file__).with_name("cli.py")), "doctor", str(output)], work)
        info = json.loads(output.read_text(encoding="utf-8"))
        return gateway()._ok(info) if info["ok"] else gateway()._failed("OFFICE_RUNTIME_INCOMPLETE", json.dumps(info, ensure_ascii=False))
    except Exception as exc:
        return failed(exc)


async def authorize(tool: str, summary: dict, risk: str) -> bool:
    import uuid
    return await gateway()._await_approval_async(
        {"plan_id": f"office-{uuid.uuid4().hex}", "params_json": "{}", "params_sha256": "",
         "risk": risk, "adapter_id": "", "task_id": ""},
        {"kind": "fs_exec" if tool == "office_run" else "office_render", "tool_name": tool, **summary}) == "approved"


async def office_run(code: str) -> dict:
    """Execute Python source with the built-in Python. Save deliverables to CRAWSHRIMP_OFFICE_OUTPUT."""
    try:
        workspace = root()
        if not code.strip() or len(code.encode()) > 250000:
            raise OfficeError("OFFICE_INVALID_INPUT", "脚本为空或超过 250KB。")
        # Keep full source in the existing approval/audit path. This is not a sandbox.
        if not await authorize("office_run", {"command": code}, "external_write"):
            return gateway()._rejected("rejected", "APPROVAL_REJECTED", "办公脚本执行未获授权。")
        return gateway()._ok(jobs.start(workspace, "run", code=code), status="running")
    except Exception as exc:
        return failed(exc)


async def office_render(job_id: str, filename: str, recalculate: bool = False, expected: dict | None = None) -> dict:
    """Render a generated Office file. Recalculate only new/simple XLSX copies, never complex originals."""
    try:
        workspace = root()
        data = jobs.read(workspace, job_id)
        files = (data.get("result") or {}).get("files") or [(data.get("result") or {}).get("document")]
        matches = [Path(p) for p in files if p and Path(p).name == filename]
        if len(matches) != 1 or not matches[0].resolve().is_relative_to(jobs.locate(workspace, job_id)):
            raise OfficeError("OFFICE_FILE_NOT_FOUND", "请使用当前作业返回的准确文件名。")
        if not await authorize("office_render", {"path": str(matches[0])}, "local_write"):
            return gateway()._rejected("rejected", "APPROVAL_REJECTED", "办公文件预览未获授权。")
        return gateway()._ok(jobs.start(workspace, "render", document=matches[0], recalculate=recalculate, expected=expected), status="running")
    except Exception as exc:
        return failed(exc)


def office_job(job_id: str, cancel: bool = False) -> dict:
    try:
        data = jobs.read(root(), job_id, cancel=cancel)
        if data["state"] == "completed":
            publish(data)
        return gateway()._ok(data, status=data["state"])
    except Exception as exc:
        return failed(exc)


def office_validate(job_id: str, filename: str, expected: dict | None = None) -> dict:
    try:
        data = jobs.read(root(), job_id)
        result = data.get("result") or {}
        files = result.get("files") or [result.get("document")]
        matches = [Path(p) for p in files if p and Path(p).name == filename]
        if len(matches) != 1 or not matches[0].resolve().is_relative_to(jobs.locate(root(), job_id)):
            raise OfficeError("OFFICE_FILE_NOT_FOUND", "当前作业没有此文件。")
        import uuid
        work = jobs.locate(root(), job_id) / ("validate-" + uuid.uuid4().hex)
        work.mkdir()
        request, output = work / "request.json", work / "result.json"
        request.write_text(json.dumps({"document": str(matches[0]), "expected": expected or {}, "result": str(output)}), encoding="utf-8")
        execute([str(python_executable()), str(Path(jobs.__file__).with_name("cli.py")), "validate", str(request)], work)
        return gateway()._ok(json.loads(output.read_text(encoding="utf-8")))
    except Exception as exc:
        return failed(exc)


def office_preview_read(job_id: str, revision: str, page: int):
    """Return actual page pixels, not a path/metadata; record visual conclusions with office_review_record."""
    from mcp.types import CallToolResult, ImageContent, TextContent
    try:
        item = jobs.preview(root(), job_id, revision, page)
        return CallToolResult(content=[TextContent(type="text", text=json.dumps(item)),
                                      ImageContent(type="image", mimeType="image/png",
                                                   data=base64.b64encode(Path(item["path"]).read_bytes()).decode())])
    except Exception as exc:
        return CallToolResult(isError=True, content=[TextContent(type="text", text=json.dumps(failed(exc), ensure_ascii=False))])


def office_review_record(job_id: str, revision: str, pages: list[dict]) -> dict:
    """Record actual visual observations: each page needs page, sha256, summary and issues list."""
    try:
        data = jobs.review(root(), job_id, revision, pages)
        publish(data)
        return gateway()._ok(data["result"]["visual"])
    except Exception as exc:
        return failed(exc)


TOOLS = [office_runtime_info, office_run, office_render, office_job, office_validate,
         office_preview_read, office_review_record]
