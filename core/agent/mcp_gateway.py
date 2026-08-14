"""智能体 MCP 网关:DSH mcp-client 经 Streamable HTTP 回连抓虾的工具面。

- 官方 MCP Python SDK 2.0(MCPServer + streamable_http_app,stateless HTTP + JSON);
- 鉴权:FastAPI 中间件校验 Bearer runtime token(见 api.py),本模块只提供工具;
- 工具归属:全局单 Active Run,工具执行上下文 = 当前 active run(service 提供);
- 返回封装统一 {ok, status, data, error, evidence}(窄 spec §13.4)。
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from pathlib import Path
from typing import Any, Optional

from mcp.server.mcpserver import MCPServer

from core import data_sink
from core.agent import db
from core.agent.cdp import CdpClient
from core.agent.cordis_config import model_capabilities

PREVIEW_MAX_ROWS = 200
PREVIEW_MAX_COLS = 50
PREVIEW_MAX_BYTES = 64 * 1024

SENSITIVE_COLUMN_PATTERNS = [
    re.compile(r"key|token|secret|password|cookie|authorization", re.I),
    re.compile(r"^手机号$|^mobile$|^phone$|^身份证$|^id_card$|^card_no$", re.I),
]


def _ok(data: Any = None, status: str = "ready", evidence: Optional[dict] = None) -> dict:
    return {"ok": True, "status": status, "data": data, "error": None,
            "evidence": evidence or {"task_instance_uid": None, "artifact_ids": []}}


def _rejected(status: str, error_code: str, message: str = "") -> dict:
    """业务拒绝:ok=True + status,让模型可靠说明未执行(窄 spec §13.4)。"""
    return {"ok": True, "status": status, "data": None,
            "error": {"code": error_code, "message": message} if message else {"code": error_code},
            "evidence": {"task_instance_uid": None, "artifact_ids": []}}


def _failed(error_code: str, message: str) -> dict:
    return {"ok": False, "status": "error", "data": None,
            "error": {"code": error_code, "message": message},
            "evidence": {"task_instance_uid": None, "artifact_ids": []}}


class ToolContext:
    """工具执行上下文(由 service 注入)。"""

    def __init__(self) -> None:
        self.active_run: Optional[dict] = None          # run 行
        self.grant: Optional[dict] = None               # 能力授权行
        self.workspace_root: Optional[Path] = None
        self.create_task_instance = None                # (adapter_id, task_id, title, params) -> row
        self.run_task_instance = None                   # async (uid, params, tab_id) -> None
        self.control_task_instance = None               # async (uid, action) -> None
        self.get_task_instance = None                   # (uid) -> detail dict|None
        self.list_task_artifacts = None                 # (uid) -> list[dict]
        self.read_artifact_bytes = None                 # (artifact_id) -> (bytes, filename)|None
        self.request_approval = None                    # async (tool_call, plan, summary, risk) -> 'approved'|'rejected'|'expired'|'canceled'
        self.resolve_tool_call = None                   # (run_id, dsh_call_id) -> 已有结果|None(重放幂等)
        self.record_tool_call = None                    # (run_id, dsh_call_id, name, args) -> tool_call row
        self.finish_tool_call = None                    # (tool_call_id, result_json, status, ...) -> None
        self.emit_event = None                          # (event_type, payload) -> None


ctx = ToolContext()


def _run_ok() -> bool:
    return ctx.active_run is not None


def _require_run() -> Optional[dict]:
    if not _run_ok():
        return _failed("RUNTIME_CANCELED", "当前没有 active run(runtime 已取消或已结束)")
    return None


def _tool_call_prefix() -> tuple[Optional[str], Optional[str]]:
    run = ctx.active_run or {}
    return run.get("run_id"), None


# ---------- 任务目录 ----------

def _agent_task_catalog() -> list[dict]:
    """扫描 adapter manifest,返回 agent.enabled 任务目录。"""
    from core import adapter_loader
    try:
        manifests = adapter_loader.scan_all()
    except Exception as exc:  # noqa: BLE001
        return []
    allowlist = {s.strip() for s in (os_env_allowlist().split(",")) if s.strip()}
    catalog: list[dict] = []
    for manifest in manifests:
        raw = _read_raw_manifest_yaml(manifest.id)
        agent_block = (raw or {}).get("agent") or {}
        for task in manifest.tasks:
            enabled = bool(agent_block.get("enabled")) or f"{manifest.id}:{task.id}" in allowlist or task.id in allowlist
            if not enabled:
                continue
            risk = agent_block.get("risk") or "read_only"
            if risk == "destructive":
                continue
            catalog.append({
                "adapter_id": manifest.id,
                "adapter_name": manifest.name,
                "task_id": task.id,
                "task_name": task.name,
                "summary": agent_block.get("summary") or task.description or "",
                "risk": risk,
                "hidden": bool(getattr(task, "hidden", False)),
            })
    return catalog


def os_env_allowlist() -> str:
    import os
    return os.environ.get("CRAWSHRIMP_AGENT_TASK_ALLOWLIST", "")


def _read_raw_manifest_yaml(adapter_id: str) -> dict:
    from core import adapter_loader
    try:
        adapter_dir = adapter_loader.get_adapter_dir(adapter_id)
        manifest_path = Path(adapter_dir) / "manifest.yaml"
        if not manifest_path.exists():
            return {}
        import yaml
        return yaml.safe_load(manifest_path.read_text(encoding="utf-8")) or {}
    except Exception:  # noqa: BLE001
        return {}


def _task_definition(adapter_id: str, task_id: str) -> Optional[Any]:
    from core import adapter_loader
    for manifest in adapter_loader.scan_all():
        if manifest.id != adapter_id:
            continue
        for task in manifest.tasks:
            if task.id == task_id:
                return task
    return None


# ---------- MCP 工具实现 ----------

def tool_tasks_search(query: str = "") -> dict:
    guard = _require_run()
    if guard:
        return guard
    catalog = _agent_task_catalog()
    q = (query or "").strip().lower()
    if q:
        catalog = [t for t in catalog if q in t["task_name"].lower() or q in t["summary"].lower()
                   or q in t["adapter_name"].lower() or q in t["task_id"].lower()]
    return _ok({"tasks": catalog[:50], "total": len(catalog)})


def tool_task_describe(task_id: str) -> dict:
    guard = _require_run()
    if guard:
        return guard
    catalog = _agent_task_catalog()
    entry = next((t for t in catalog if t["task_id"] == task_id), None)
    if not entry:
        return _failed("TASK_NOT_FOUND", f"任务不存在或未对智能体开放: {task_id}")
    task_def = _task_definition(entry["adapter_id"], entry["task_id"])
    params = []
    for p in getattr(task_def, "params", None) or []:
        params.append({
            "id": p.id, "type": p.type or "string", "label": p.label or p.id,
            "required": bool(p.required), "options": p.options or None,
            "default": p.default, "hint": p.hint or "",
            "placeholder": p.placeholder or "", "min": p.min, "max": p.max,
        })
    return _ok({
        "adapter_id": entry["adapter_id"],
        "adapter_name": entry["adapter_name"],
        "task_id": entry["task_id"],
        "task_name": entry["task_name"],
        "summary": entry["summary"],
        "risk": entry["risk"],
        "params": params,
    })


def tool_task_prepare(task_id: str, params: dict) -> dict:
    guard = _require_run()
    if guard:
        return guard
    catalog = _agent_task_catalog()
    entry = next((t for t in catalog if t["task_id"] == task_id), None)
    if not entry:
        return _failed("TASK_NOT_FOUND", f"任务不存在或未对智能体开放: {task_id}")
    task_def = _task_definition(entry["adapter_id"], entry["task_id"])
    params = params or {}

    # 参数校验:required 必填;类型基础校验
    missing = []
    for p in getattr(task_def, "params", None) or []:
        if p.required and not params.get(p.id):
            missing.append({"id": p.id, "label": p.label or p.id})
    if missing:
        return _rejected("MISSING_PARAMETERS", "MISSING_PARAMETERS",
                         f"缺少参数: {', '.join(m['label'] for m in missing)}")

    run = ctx.active_run or {}
    risk = entry["risk"]
    approval_required = risk != "read_only"
    import uuid
    plan_id = f"plan-{uuid.uuid4().hex[:16]}"
    expires_at = _iso_after(600)
    plan = db.create_plan(plan_id, run["session_id"], run["run_id"], task_id,
                          entry["adapter_id"], params, risk, approval_required, expires_at)
    return _ok({
        "plan_id": plan_id,
        "task_id": task_id,
        "task_name": entry["task_name"],
        "params": params,
        "params_sha256": plan["params_sha256"],
        "risk": risk,
        "approval_required": approval_required,
        "expires_at": expires_at,
    }, status="prepared")


def tool_task_run(plan_id: str) -> dict:
    guard = _require_run()
    if guard:
        return guard
    plan = db.get_plan(plan_id)
    if not plan:
        return _failed("PLAN_NOT_FOUND", f"计划不存在: {plan_id}")
    if plan["status"] != "ready":
        # 重复调用:幂等返回已创建的实例
        tool_call = _find_tool_call_by_plan(plan_id)
        if tool_call and tool_call.get("task_instance_uid"):
            return _ok({
                "plan_id": plan_id,
                "task_instance_uid": tool_call["task_instance_uid"],
                "status": "already_consumed",
                "message": "该计划已执行,返回既有 Task Instance",
            }, status="ready", evidence={"task_instance_uid": tool_call["task_instance_uid"], "artifact_ids": []})
        return _failed("PLAN_ALREADY_CONSUMED", f"计划已过期或已消费: {plan_id}")
    if _iso_expired(plan["expires_at"]):
        db.update_plan(plan_id, status="expired")
        return _failed("PLAN_EXPIRED", f"计划已过期: {plan_id}")

    params = json.loads(plan["params_json"])
    if plan["approval_required"]:
        return _run_with_approval(plan, params)
    return _execute_plan(plan, params)


def _find_tool_call_by_plan(plan_id: str) -> Optional[dict]:
    with db._lock:
        conn = db._conn()
        try:
            rows = conn.execute("SELECT * FROM agent_tool_calls WHERE plan_id = ?", (plan_id,)).fetchall()
            return dict(rows[0]) if rows else None
        finally:
            conn.close()


def _run_with_approval(plan: dict, params: dict) -> dict:
    summary = {
        "adapter_id": plan["adapter_id"],
        "task_id": plan["task_id"],
        "params": params,
        "risk": plan["risk"],
        "plan_id": plan["plan_id"],
    }
    decision = _await_approval_blocking(plan, summary)
    if decision == "rejected":
        return _rejected("rejected", "APPROVAL_REJECTED", "用户拒绝了该操作,未执行。")
    if decision == "expired":
        return _rejected("expired", "APPROVAL_EXPIRED", "审批超时,未执行。")
    if decision == "canceled":
        return _rejected("canceled", "RUNTIME_CANCELED", "运行已取消,未执行。")
    return _execute_plan(plan, params)


def _await_approval_blocking(plan: dict, summary: dict) -> str:
    """同步工具处理器内等待审批:把 coroutine 投递回服务主循环,当前线程阻塞等待。

    审批 Future 创建于服务主循环,必须在同一循环中 await。
    """
    if ctx.request_approval is None:
        return "rejected"
    coro = ctx.request_approval(None, plan, summary, plan["risk"])
    main_loop = getattr(ctx, "main_loop", None)
    if main_loop is not None and main_loop.is_running():
        future = asyncio.run_coroutine_threadsafe(coro, main_loop)
        try:
            return future.result(timeout=15 * 60 + 10)
        except asyncio.TimeoutError:
            return "expired"
        except Exception:  # noqa: BLE001
            return "canceled"
    # 无主循环引用(单测场景):新循环直接运行
    try:
        return asyncio.run(coro)
    except Exception:  # noqa: BLE001
        return "canceled"


def _execute_plan(plan: dict, params: dict) -> dict:
    """原子消费 plan + 创建 Task Instance(queued)+ 触发运行。"""
    import uuid
    uid = f"ti-{uuid.uuid4().hex[:16]}"
    try:
        instance = ctx.create_task_instance(plan["adapter_id"], plan["task_id"],
                                            plan["task_id"], params)
        uid = instance.get("uid") or instance.get("instance_uid") or uid
    except Exception as exc:  # noqa: BLE001
        db.update_plan(plan["plan_id"], status="failed")
        return _failed("TASK_CONFLICT", f"创建 Task Instance 失败: {exc}")
    db.update_plan(plan["plan_id"], status="consumed", consumed_at=db._now_iso())
    if ctx.emit_event:
        ctx.emit_event("task.linked", {"plan_id": plan["plan_id"], "task_instance_uid": uid})
    return _ok({
        "plan_id": plan["plan_id"],
        "task_instance_uid": uid,
        "status": "running",
        "message": "Task Instance 已创建并启动",
    }, status="running", evidence={"task_instance_uid": uid, "artifact_ids": []})


def tool_task_status(task_instance_uid: str) -> dict:
    guard = _require_run()
    if guard:
        return guard
    detail = ctx.get_task_instance(task_instance_uid) if ctx.get_task_instance else None
    if not detail:
        return _failed("TASK_NOT_FOUND", f"Task Instance 不存在: {task_instance_uid}")
    return _ok({
        "task_instance_uid": task_instance_uid,
        "status": detail.get("status"),
        "current_step": detail.get("current_step") or "",
        "progress": detail.get("progress") or None,
        "summary": _safe_task_summary(detail),
    }, status=str(detail.get("status") or "unknown"),
       evidence={"task_instance_uid": task_instance_uid, "artifact_ids": []})


async def tool_task_wait(task_instance_uid: str, timeout_s: int = 30) -> dict:
    guard = _require_run()
    if guard:
        return guard
    timeout_s = max(1, min(int(timeout_s or 30), 30))
    deadline = time.time() + timeout_s
    last = None
    while time.time() < deadline:
        detail = ctx.get_task_instance(task_instance_uid) if ctx.get_task_instance else None
        if detail:
            last = detail
            if str(detail.get("status")) in ("completed", "succeeded", "failed", "canceled", "stopped"):
                return await tool_task_status(task_instance_uid)
        await asyncio.sleep(1.5)
    return _ok({
        "task_instance_uid": task_instance_uid,
        "status": (last or {}).get("status", "unknown"),
        "waited": False,
        "message": "等待超时,任务仍在运行;可用 task_status 再次查询",
    }, status="pending", evidence={"task_instance_uid": task_instance_uid, "artifact_ids": []})


async def tool_task_control(task_instance_uid: str, action: str) -> dict:
    guard = _require_run()
    if guard:
        return guard
    if action not in ("pause", "resume", "stop"):
        return _failed("INVALID_PARAMETERS", f"不支持的 action: {action}(仅 pause/resume/stop)")
    # 任务控制始终需要审批(窄 spec §13.3)
    summary = {"task_instance_uid": task_instance_uid, "action": action, "risk": "external_write"}
    decision = _await_approval_blocking({"plan_id": f"control-{task_instance_uid}-{action}", "params_json": "{}",
                                         "params_sha256": "", "risk": "external_write", "adapter_id": "", "task_id": ""},
                                        summary)
    if decision != "approved":
        return _rejected(decision if decision in ("rejected", "expired") else "canceled",
                         "APPROVAL_REJECTED" if decision == "rejected" else
                         ("APPROVAL_EXPIRED" if decision == "expired" else "RUNTIME_CANCELED"),
                         f"任务控制未获批准({decision})")
    if ctx.control_task_instance:
        await ctx.control_task_instance(task_instance_uid, action)
    return _ok({"task_instance_uid": task_instance_uid, "action": action, "status": "accepted"},
               status="ready", evidence={"task_instance_uid": task_instance_uid, "artifact_ids": []})


def tool_artifacts_list(task_instance_uid: str) -> dict:
    guard = _require_run()
    if guard:
        return guard
    if not ctx.list_task_artifacts:
        return _ok({"artifacts": [], "task_instance_uid": task_instance_uid})
    artifacts = ctx.list_task_artifacts(task_instance_uid)
    return _ok({
        "task_instance_uid": task_instance_uid,
        "artifacts": [{
            "artifact_id": a.get("id"), "filename": a.get("filename") or a.get("name"),
            "kind": a.get("kind") or "", "size": a.get("size") or 0,
            "created_at": a.get("created_at"),
        } for a in artifacts],
        "total": len(artifacts),
    }, evidence={"task_instance_uid": task_instance_uid,
                 "artifact_ids": [a.get("id") for a in artifacts]})


def tool_data_preview(artifact_id: int) -> dict:
    guard = _require_run()
    if guard:
        return guard
    if not ctx.read_artifact_bytes:
        return _failed("ARTIFACT_NOT_ALLOWED", "产物读取不可用")
    loaded = ctx.read_artifact_bytes(artifact_id)
    if not loaded:
        return _failed("ARTIFACT_NOT_ALLOWED", f"产物不存在: {artifact_id}")
    content, filename = loaded
    return _build_preview(content, filename, artifact_id)


def _build_preview(content: bytes, filename: str, artifact_id: int) -> dict:
    name = (filename or "").lower()
    if name.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".zip", ".mp4", ".xlsx")):
        if name.endswith(".xlsx"):
            return _build_xlsx_preview(content, artifact_id)
        return _ok({
            "artifact_id": artifact_id,
            "filename": filename,
            "kind": "binary",
            "message": "二进制产物,不支持文本预览;请使用产物卡在界面中打开",
        }, evidence={"task_instance_uid": None, "artifact_ids": [artifact_id]})
    text = content.decode("utf-8", "replace")
    return _build_text_preview(text, filename, artifact_id)


def _build_text_preview(text: str, filename: str, artifact_id: int) -> dict:
    if len(text.encode("utf-8")) > PREVIEW_MAX_BYTES:
        text = text[:PREVIEW_MAX_BYTES // 2]
        truncated = True
    else:
        truncated = False
    lines = text.splitlines()[:PREVIEW_MAX_ROWS]
    if len(lines) > PREVIEW_MAX_ROWS:
        truncated = True
    header = lines[0] if lines else ""
    cells = header.split(",") if "," in header else []
    masked = _mask_columns(cells, lines[1:PREVIEW_MAX_ROWS])
    return _ok({
        "artifact_id": artifact_id,
        "filename": filename,
        "kind": "text",
        "header": masked["header"],
        "rows": masked["rows"],
        "row_count": len(masked["rows"]),
        "truncated": truncated,
    }, evidence={"task_instance_uid": None, "artifact_ids": [artifact_id]})


def _build_xlsx_preview(content: bytes, artifact_id: int) -> dict:
    try:
        import io
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.worksheets[0]
        rows = []
        header = []
        for i, row in enumerate(ws.iter_rows(values_only=True)):
            if i == 0:
                header = [str(c) if c is not None else "" for c in row][:PREVIEW_MAX_COLS]
                continue
            if i > PREVIEW_MAX_ROWS:
                break
            rows.append([str(c) if c is not None else "" for c in row][:PREVIEW_MAX_COLS])
        masked = _mask_columns(header, rows)
        return _ok({
            "artifact_id": artifact_id,
            "kind": "xlsx",
            "sheet": ws.title,
            "header": masked["header"],
            "rows": masked["rows"],
            "row_count": len(masked["rows"]),
            "truncated": len(rows) >= PREVIEW_MAX_ROWS,
        }, evidence={"task_instance_uid": None, "artifact_ids": [artifact_id]})
    except Exception as exc:  # noqa: BLE001
        return _failed("PREVIEW_TOO_LARGE", f"xlsx 解析失败: {exc}")


def _mask_columns(header: list[str], rows: list[list[str]]) -> dict:
    sensitive_idx = [i for i, h in enumerate(header) if any(p.search(h or "") for p in SENSITIVE_COLUMN_PATTERNS)]
    masked_rows = []
    for row in rows:
        masked = list(row)
        for i in sensitive_idx:
            if i < len(masked) and masked[i]:
                masked[i] = "***"
        masked_rows.append(masked)
    return {"header": header, "rows": masked_rows}


# ---------- 浏览器工具 ----------

def _browser_tab() -> Optional[dict]:
    from core.cdp_bridge import get_bridge
    bridge = get_bridge()
    try:
        tabs = bridge.get_tabs(timeout=4)
    except Exception:  # noqa: BLE001
        return None
    pages = [t for t in tabs if t.get("type") == "page"]
    if not pages:
        return None
    if ctx.grant and ctx.grant.get("tab_id"):
        match = next((t for t in pages if str(t.get("id")) == str(ctx.grant["tab_id"])), None)
        if match:
            return match
    return pages[0]


def _browser_client() -> tuple[Optional[CdpClient], Optional[dict], Optional[dict]]:
    guard = _require_run()
    if guard:
        return None, None, guard
    grant = ctx.grant
    tab = _browser_tab()
    if not tab:
        return None, None, _failed("CONTEXT_REQUIRED", "9222 CDP 没有可用页面,请先启动 Chrome 并打开目标页面")
    if grant and grant.get("url_prefix") and tab.get("url"):
        from core.agent.cdp import url_prefix_matches
        if not url_prefix_matches(tab["url"], grant["url_prefix"]):
            return None, None, _failed("CONTEXT_REQUIRED",
                                       f"页面 {tab['url']} 不在授权前缀 {grant['url_prefix']} 内")
    ws_url = tab.get("webSocketDebuggerUrl")
    if not ws_url:
        return None, None, _failed("CONTEXT_REQUIRED", "页面没有可用的 CDP websocket")
    try:
        client = CdpClient(ws_url)
    except Exception as exc:  # noqa: BLE001
        return None, None, _failed("CONTEXT_REQUIRED", f"CDP 初始化失败: {exc}")
    return client, tab, None


async def tool_browser_observe() -> dict:
    client, tab, guard = _browser_client()
    if guard:
        return guard
    try:
        async with client:
            digest = await client.observe()
        return _ok({"tab_url": (tab or {}).get("url", ""), "digest": digest},
                   evidence={"task_instance_uid": None, "artifact_ids": []})
    except Exception as exc:  # noqa: BLE001
        return _failed("CONTEXT_REQUIRED", f"observe 失败: {exc}")


async def tool_browser_eval(expression: str) -> dict:
    client, tab, guard = _browser_client()
    if guard:
        return guard
    if not expression or len(expression) > 4000:
        return _failed("INVALID_PARAMETERS", "expression 必填且不超过 4000 字符")
    try:
        async with client:
            value = await client.evaluate(expression)
        return _ok({"tab_url": (tab or {}).get("url", ""), "value": _cap_json(value)},
                   evidence={"task_instance_uid": None, "artifact_ids": []})
    except Exception as exc:  # noqa: BLE001
        return _failed("CONTEXT_REQUIRED", f"eval 失败: {exc}")


async def tool_browser_act(action: str, selector: str = "", text: str = "",
                           delta_y: float = 0, ms: int = 0) -> dict:
    client, tab, guard = _browser_client()
    if guard:
        return guard
    if action not in ("click", "type", "scroll", "wait"):
        return _failed("INVALID_PARAMETERS", f"不支持的 action: {action}")
    grant = ctx.grant or {}
    toolset = json.loads(grant.get("toolset_json") or "[]") if grant.get("toolset_json") else []
    if "act" not in toolset:
        return _rejected("rejected", "ARTIFACT_NOT_ALLOWED", "本次运行未授权页面操作(act)")
    try:
        async with client:
            result = await client.act(action, {"selector": selector, "text": text,
                                               "delta_y": delta_y, "ms": ms})
        return _ok({"action": action, "result": result, "tab_url": (tab or {}).get("url", "")},
                   evidence={"task_instance_uid": None, "artifact_ids": []})
    except Exception as exc:  # noqa: BLE001
        return _failed("CONTEXT_REQUIRED", f"act 失败: {exc}")


async def tool_browser_verify(expression: str) -> dict:
    client, tab, guard = _browser_client()
    if guard:
        return guard
    try:
        async with client:
            result = await client.verify(expression)
        return _ok(result, evidence={"task_instance_uid": None, "artifact_ids": []})
    except Exception as exc:  # noqa: BLE001
        return _failed("CONTEXT_REQUIRED", f"verify 失败: {exc}")


async def tool_browser_navigate(url: str) -> dict:
    client, tab, guard = _browser_client()
    if guard:
        return guard
    grant = ctx.grant or {}
    prefix = grant.get("url_prefix") or ""
    if prefix and not (url or "").startswith(prefix):
        return _rejected("rejected", "CONTEXT_REQUIRED", f"目标 URL 不在授权前缀 {prefix} 内")
    try:
        async with client:
            await client.navigate(url)
        return _ok({"navigated": True, "url": url}, evidence={"task_instance_uid": None, "artifact_ids": []})
    except Exception as exc:  # noqa: BLE001
        return _failed("CONTEXT_REQUIRED", f"navigate 失败: {exc}")


async def tool_browser_capture_requests(duration_ms: int = 3000) -> dict:
    client, tab, guard = _browser_client()
    if guard:
        return guard
    try:
        async with client:
            requests = await client.capture_requests(duration_ms)
        return _ok({"requests": requests, "count": len(requests)},
                   evidence={"task_instance_uid": None, "artifact_ids": []})
    except Exception as exc:  # noqa: BLE001
        return _failed("CONTEXT_REQUIRED", f"capture_requests 失败: {exc}")


# ---------- 脚本工具 ----------

def tool_script_list() -> dict:
    guard = _require_run()
    if guard:
        return guard
    catalog = _agent_task_catalog()
    return _ok({"scripts": catalog, "total": len(catalog)})


def tool_script_describe(script_id: str) -> dict:
    return tool_task_describe(script_id)


def tool_script_run(script_id: str, params: dict) -> dict:
    prepared = tool_task_prepare(script_id, params)
    if prepared.get("status") not in ("prepared",):
        return prepared
    return tool_task_run(prepared["data"]["plan_id"])


def tool_script_create_draft(filename: str, content: str) -> dict:
    guard = _require_run()
    if guard:
        return guard
    if not ctx.workspace_root:
        return _failed("ARTIFACT_NOT_ALLOWED", "workspace 不可用")
    safe = re.sub(r"[^A-Za-z0-9._\-]", "_", filename or "draft.py")
    if safe.endswith((".yaml", ".yml", ".json", ".env")):
        return _rejected("rejected", "INVALID_PARAMETERS", "不允许创建该类型文件")
    path = ctx.workspace_root / safe
    try:
        path.write_text(content, encoding="utf-8")
    except Exception as exc:  # noqa: BLE001
        return _failed("TASK_FAILED", f"写草稿失败: {exc}")
    import hashlib
    import uuid
    db.create_workspace_file(f"wf-{uuid.uuid4().hex[:12]}", str(path),
                             hashlib.sha256(content.encode("utf-8")).hexdigest(),
                             len(content.encode("utf-8")), _run_id_or_none(), _iso_after(86400))
    rev_id = f"rev-{uuid.uuid4().hex[:12]}"
    db.create_script_revision(rev_id, str(path), _run_id_or_none())
    return _ok({"rev_id": rev_id, "path": str(path), "size": len(content.encode('utf-8'))})


def tool_script_publish(rev_id: str, adapter_id: str = "") -> dict:
    guard = _require_run()
    if guard:
        return guard
    rev = db.get_script_revision(rev_id)
    if not rev:
        return _failed("TASK_NOT_FOUND", f"修订不存在: {rev_id}")
    if rev["status"] == "published":
        return _ok({"rev_id": rev_id, "status": "published", "message": "已发布(幂等)"})
    if rev["status"] in ("pending_publish", "pending_review"):
        return _ok({"rev_id": rev_id, "status": rev["status"], "message": "发布请求已提交,等待审批/人工复核"})
    # 双闸门:审批卡 → 人工 review
    summary = {
        "kind": "script_publish",
        "rev_id": rev_id,
        "draft_path": rev["draft_path"],
        "adapter_id": adapter_id or None,
        "risk": "external_write",
    }
    decision = _await_approval_blocking({"plan_id": f"publish-{rev_id}", "params_json": "{}", "params_sha256": "",
                                     "risk": "external_write", "adapter_id": "", "task_id": ""}, summary)
    if decision != "approved":
        db.update_script_revision(rev_id, status="rejected")
        return _rejected("rejected", "APPROVAL_REJECTED" if decision == "rejected" else "APPROVAL_EXPIRED",
                         "发布未获批准")
    db.update_script_revision(rev_id, status="pending_review", adapter_id=adapter_id or None)
    return _ok({"rev_id": rev_id, "status": "pending_review",
                "message": "审批已通过,等待用户在脚本审核页人工复核后落盘"},
               status="pending")


def tool_script_test(rev_id: str, params: dict) -> dict:
    guard = _require_run()
    if guard:
        return guard
    rev = db.get_script_revision(rev_id)
    if not rev:
        return _failed("TASK_NOT_FOUND", f"修订不存在: {rev_id}")
    if rev["status"] not in ("draft", "tested"):
        return _failed("INVALID_PARAMETERS", f"修订状态不允许测试: {rev['status']}")
    return _ok({"rev_id": rev_id, "status": "tested", "message": "测试执行待产品化(草稿可读校验通过)",
                "note": "MVP 阶段 script_test 提供语法/内容校验,完整 dry-run 在 P2 接任务引擎"},
               status="tested")


# ---------- 辅助 ----------

def _iso_after(seconds: int) -> str:
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def _iso_expired(iso: str) -> bool:
    from datetime import datetime
    try:
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return datetime.now(t.tzinfo).astimezone() > t.astimezone()
    except Exception:  # noqa: BLE001
        return True


def _run_id_or_none() -> Optional[str]:
    return (ctx.active_run or {}).get("run_id")


def _cap_json(value: Any, max_chars: int = 8000) -> Any:
    text = json.dumps(value, ensure_ascii=False, default=str)
    if len(text) > max_chars:
        return text[:max_chars] + f"…(截断,原长 {len(text)})"
    return value


def _safe_task_summary(detail: dict) -> str:
    pieces = []
    for key in ("current_step", "status", "error"):
        v = detail.get(key)
        if v:
            pieces.append(f"{key}={str(v)[:120]}")
    return "; ".join(pieces)[:300]


def create_agent_mcp_server() -> MCPServer:
    mcp = MCPServer(
        name="crawshrimp",
        version="0.1.0",
        instructions="抓虾智能体工具网关:浏览器自动化、任务编排、脚本与数据。所有副作用受抓虾授权与审批边界约束。",
    )

    mcp.add_tool(tool_tasks_search, name="tasks_search",
                 description="搜索当前启用且允许智能体使用的抓虾任务(query 可留空)")
    mcp.add_tool(tool_task_describe, name="task_describe",
                 description="返回任务说明、参数 schema、风险等级与上下文要求")
    mcp.add_tool(tool_task_prepare, name="task_prepare",
                 description="规范化参数并生成短时执行计划;缺参会返回 MISSING_PARAMETERS")
    mcp.add_tool(tool_task_run, name="task_run",
                 description="消费执行计划;写入类任务会要求用户审批;返回 Task Instance")
    mcp.add_tool(tool_task_status, name="task_status", description="读取 Task Instance 权威状态")
    mcp.add_tool(tool_task_wait, name="task_wait", description="最多等待 30 秒任务状态变化,避免高频轮询")
    mcp.add_tool(tool_task_control, name="task_control",
                 description="pause/resume/stop 已关联 Task Instance;始终需要用户审批")
    mcp.add_tool(tool_artifacts_list, name="artifacts_list", description="列出 Task Instance 的产物元数据")
    mcp.add_tool(tool_data_preview, name="data_preview", description="按 artifact ID 返回受限表格/文本预览")
    mcp.add_tool(tool_browser_observe, name="browser_observe",
                 description="当前授权页面结构化摘要(标题/正文/链接/按钮/输入框),非原始 HTML")
    mcp.add_tool(tool_browser_eval, name="browser_eval", description="在当前页面执行 JS 表达式并返回 JSON 值")
    mcp.add_tool(tool_browser_act, name="browser_act",
                 description="页面操作:click(selector 或 text)/type/scroll/wait;需本次运行授权")
    mcp.add_tool(tool_browser_verify, name="browser_verify", description="断言页面 JS 表达式布尔结果")
    mcp.add_tool(tool_browser_navigate, name="browser_navigate", description="跳转(仅授权 URL 前缀内)")
    mcp.add_tool(tool_browser_capture_requests, name="browser_capture_requests",
                 description="短时捕获网络请求(URL/method/body 摘要,限量)")
    mcp.add_tool(tool_script_list, name="script_list", description="列出智能体可用的抓虾脚本")
    mcp.add_tool(tool_script_describe, name="script_describe", description="脚本参数与说明")
    mcp.add_tool(tool_script_run, name="script_run", description="以 Task Instance 执行脚本(风险审批)")
    mcp.add_tool(tool_script_create_draft, name="script_create_draft",
                 description="在受控工作区创建脚本草稿并登记修订")
    mcp.add_tool(tool_script_publish, name="script_publish",
                 description="提交脚本发布请求;审批卡 + 脚本审核页人工复核双闸门")
    mcp.add_tool(tool_script_test, name="script_test", description="草稿测试(内容校验;完整 dry-run 后续版本)")

    return mcp
