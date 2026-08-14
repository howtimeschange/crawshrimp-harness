"""智能体产品 API:/agent/* 路由 + SSE 事件流 + MCP ASGI 挂载。

产品 API 沿用 X-Crawshrimp-Token;MCP 端点使用独立 Bearer runtime token
(在 api_server 中间件中分支校验,本模块不处理)。
"""
from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from core.agent import db, mcp_gateway
from core.agent.service import AgentService

router = APIRouter(prefix="/agent")

# 由 api_server 在 lifespan 中注入
_service: Optional[AgentService] = None


def set_agent_service(service: AgentService) -> None:
    global _service
    _service = service


def get_agent_service() -> AgentService:
    if _service is None:
        raise HTTPException(503, "智能体服务未就绪")
    return _service


class SessionCreateRequest(BaseModel):
    title: str = "新会话"


class TurnCreateRequest(BaseModel):
    text: str
    context_refs: Optional[list[dict]] = None
    structured_inputs: Optional[dict] = None
    attachment_ids: Optional[list[str]] = None
    grant_prefs: Optional[dict] = None


class AttachmentCreateRequest(BaseModel):
    name: str
    path: str
    mime: str = ""
    size: int = 0


class SessionModelRequest(BaseModel):
    model_id: str


class ApprovalDecisionRequest(BaseModel):
    decision: str  # approved | rejected


class GrantCreateRequest(BaseModel):
    toolset: list[str]
    url_prefix: Optional[str] = None
    tab_id: Optional[str] = None


# ---------- Runtime ----------

@router.get("/runtime")
def runtime_status() -> dict:
    return get_agent_service().runtime_status()


@router.post("/runtime/restart")
async def runtime_restart() -> dict:
    return await get_agent_service().restart_runtime()


# ---------- 模型(参考 DSH 的模型切换交互) ----------

@router.get("/models")
def list_agent_models() -> dict:
    from core.agent.cordis_config import MODEL_CAPABILITIES, resolve_provider_for_model
    models = []
    for model_id, cap in MODEL_CAPABILITIES.items():
        if not cap.get("supports_tools"):
            continue
        models.append({
            "model_id": model_id,
            "route": resolve_provider_for_model(model_id),
            "context_window": cap.get("context_window"),
            "max_output_tokens": cap.get("max_output_tokens"),
        })
    return {"models": models}


@router.patch("/sessions/{session_id}/model")
def set_session_model(session_id: str, req: SessionModelRequest) -> dict:
    from core.agent.cordis_config import MODEL_CAPABILITIES
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(404, "会话不存在")
    model_id = str(req.model_id or "").strip()
    if model_id not in MODEL_CAPABILITIES or not MODEL_CAPABILITIES[model_id].get("supports_tools"):
        raise HTTPException(422, f"模型不可用于智能体: {model_id}")
    db.update_session(session_id, model_id=model_id)
    service = get_agent_service()
    service.note_model_changed(session_id, model_id)
    return {"ok": True, "session": db.get_session(session_id)}


# ---------- 会话 ----------

@router.get("/sessions")
def list_sessions() -> dict:
    sessions = db.list_sessions()
    for s in sessions:
        s["messages"] = db.list_messages(s["session_id"])[-20:]
    return {"sessions": sessions}


@router.post("/sessions")
def create_session(req: SessionCreateRequest) -> dict:
    session_id = f"cs-{uuid.uuid4().hex[:12]}"
    runtime_session_id = f"dsh-{uuid.uuid4().hex}"
    session = db.create_session(session_id, runtime_session_id, req.title)
    return {"session": session}


@router.get("/sessions/{session_id}")
def get_session(session_id: str) -> dict:
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(404, "会话不存在")
    return {
        "session": session,
        "messages": db.list_messages(session_id),
        "last_event_seq": session.get("last_event_seq") or 0,
    }


@router.patch("/sessions/{session_id}")
def patch_session(session_id: str, req: dict) -> dict:
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(404, "会话不存在")
    fields = {}
    if "title" in req and isinstance(req["title"], str):
        fields["title"] = req["title"][:80]
    if "archived" in req and isinstance(req["archived"], bool):
        from core.agent.db import _now_iso
        fields["archived_at"] = _now_iso() if req["archived"] else None
    if fields:
        db.update_session(session_id, **fields)
    return {"ok": True, "session": db.get_session(session_id)}


@router.post("/sessions/{session_id}/attachments")
def create_attachment(session_id: str, req: AttachmentCreateRequest) -> dict:
    """渲染端经原生选择器挑选文件后注册为会话附件(拷贝进受控附件目录)。"""
    import re as _re
    import shutil as _shutil
    import uuid as _uuid
    from pathlib import Path as _Path
    from core.agent.service import _data_root

    session = db.get_session(session_id)
    if not session:
        raise HTTPException(404, "会话不存在")
    src = _Path(req.path)
    if not src.is_file():
        raise HTTPException(422, "文件不存在")
    safe_name = _re.sub(r"[^A-Za-z0-9._\u4e00-\u9fff-]", "_", str(req.name or src.name))
    attachment_id = f"att-{_uuid.uuid4().hex[:12]}"
    dest_dir = _data_root() / "agent" / "attachments" / attachment_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / safe_name
    try:
        _shutil.copyfile(src, dest)
    except OSError as exc:
        raise HTTPException(422, f"复制附件失败: {exc}") from exc
    size = req.size or dest.stat().st_size
    row = db.create_attachment(attachment_id, session_id, None, None,
                               safe_name, str(dest), req.mime, int(size))
    return {"attachment": row}


@router.post("/sessions/{session_id}/turns")
async def create_turn(session_id: str, req: TurnCreateRequest) -> dict:
    service = get_agent_service()
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(422, "text 不能为空")
    if len(text) > 20000:
        raise HTTPException(422, "text 过长")
    try:
        result = await service.submit_turn(session_id, text, req.context_refs,
                                           attachment_ids=req.attachment_ids,
                                           grant_prefs=req.grant_prefs)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return JSONResponse(status_code=202, content=result)


@router.get("/sessions/{session_id}/events")
async def session_events(session_id: str, request: Request, after_seq: int = 0) -> StreamingResponse:
    service = get_agent_service()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(404, "会话不存在")

    async def event_source():
        # 1) 补放历史
        for row in db.list_events_after(session_id, after_seq):
            yield f"id: {row['seq']}\nevent: {row['event_type']}\ndata: {row['payload_json']}\n\n"
        # 2) 进入 live
        queue = service.subscribe(session_id)
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=20)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                payload = message.get("payload")
                yield (f"id: {message.get('seq') or 0}\nevent: {message.get('event_type')}\n"
                       f"data: {json.dumps(payload, ensure_ascii=False)}\n\n")
        finally:
            service.unsubscribe(session_id, queue)

    return StreamingResponse(event_source(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/events")
async def agent_events(request: Request, after_seq: int = 0) -> StreamingResponse:
    """全局事件流:跨会话投影事件(DSH Web 视图等无会话绑定消费方)。"""
    service = get_agent_service()

    async def event_source():
        # 1) 补放历史(跨会话)
        for row in db.list_all_events_after(after_seq):
            payload = row.get("payload_json") or "{}"
            yield f"id: {row['seq']}\nevent: {row['event_type']}\ndata: {payload}\n\n"
        # 2) 进入 live
        queue = service.subscribe_all()
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=20)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                payload = message.get("payload")
                yield (f"id: {message.get('seq') or 0}\nevent: {message.get('event_type')}\n"
                       f"data: {json.dumps(payload, ensure_ascii=False)}\n\n")
        finally:
            service.unsubscribe_all(queue)

    return StreamingResponse(event_source(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------- Run / 审批 ----------

@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str) -> dict:
    return await get_agent_service().cancel_run(run_id)


@router.post("/approvals/{approval_id}/decision")
def decide_approval(approval_id: str, req: ApprovalDecisionRequest) -> dict:
    if req.decision not in ("approved", "rejected"):
        raise HTTPException(422, "decision 仅支持 approved/rejected")
    result = get_agent_service().decide_approval(approval_id, req.decision)
    if not result.get("ok"):
        raise HTTPException(409, result.get("error", "审批状态冲突"))
    return result


@router.get("/approvals")
def list_approvals(status: str = "pending") -> dict:
    """未决策审批列表(ProductLayer 挂载/刷新时恢复审批卡)。"""
    if status != "pending":
        raise HTTPException(422, "status 仅支持 pending")
    rows = db.list_pending_approvals()
    return {"approvals": [
        {
            "approval_id": row.get("approval_id"),
            "plan_id": row.get("plan_id"),
            "summary": json.loads(row.get("summary_json") or "{}"),
            "risk": row.get("risk"),
            "status": row.get("status"),
            "created_at": row.get("created_at"),
        }
        for row in rows
    ]}


# ---------- 能力授权(浏览器任务) ----------

@router.post("/sessions/{session_id}/grants")
def create_grant(session_id: str, req: GrantCreateRequest) -> dict:
    service = get_agent_service()
    run = service.active_run or {}
    if not run or run.get("session_id") != session_id:
        raise HTTPException(409, "当前会话没有 active run,无法授权")
    from core.agent.db import create_grant as _create_grant
    from datetime import datetime, timedelta, timezone
    grant_id = f"grant-{uuid.uuid4().hex[:12]}"
    expires = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    grant = _create_grant(grant_id, run["run_id"], req.url_prefix, req.tab_id, req.toolset, expires)
    return {"grant": grant}


# ---------- 脚本审核(双闸门第二闸门) ----------

@router.get("/script-revisions")
def list_script_revisions(status: str = "") -> dict:
    import json as _json
    from core.agent import db as _db
    rows = []
    with _db._lock:
        conn = _db._conn()
        try:
            for r in conn.execute("SELECT * FROM agent_script_revisions ORDER BY updated_at DESC").fetchall():
                d = dict(r)
                if status and d.get("status") != status:
                    continue
                rows.append(d)
        finally:
            conn.close()
    return {"revisions": rows}


@router.get("/script-revisions/{rev_id}")
def get_script_revision(rev_id: str) -> dict:
    from pathlib import Path
    rev = db.get_script_revision(rev_id)
    if not rev:
        raise HTTPException(404, "修订不存在")
    content = ""
    try:
        content = Path(rev["draft_path"]).read_text(encoding="utf-8")
    except OSError:
        pass
    return {"revision": rev, "content": content[:200000]}


class ScriptReviewRequest(BaseModel):
    decision: str  # publish | reject


@router.post("/script-revisions/{rev_id}/review")
def review_script_revision(rev_id: str, req: ScriptReviewRequest) -> dict:
    """人工复核闸门:把草稿发布到已发布脚本库,或拒绝。"""
    from pathlib import Path
    import hashlib as _hashlib
    from core.agent import db as _db

    if req.decision not in ("publish", "reject"):
        raise HTTPException(422, "decision 仅支持 publish/reject")
    rev = db.get_script_revision(rev_id)
    if not rev:
        raise HTTPException(404, "修订不存在")
    if rev["status"] != "pending_review":
        if rev["status"] == "published" and req.decision == "publish":
            return {"ok": True, "idempotent": True, "status": "published"}
        raise HTTPException(409, f"修订状态不允许复核: {rev['status']}")
    if req.decision == "reject":
        _db.update_script_revision(rev_id, status="rejected")
        return {"ok": True, "status": "rejected"}

    draft = Path(rev["draft_path"])
    if not draft.exists():
        _db.update_script_revision(rev_id, status="rejected")
        raise HTTPException(409, "草稿文件已不存在,无法发布")
    content = draft.read_text(encoding="utf-8")
    adapter_id = rev.get("adapter_id") or "general-agent"
    import re as _re
    safe_adapter = _re.sub(r"[^A-Za-z0-9._-]", "_", str(adapter_id)) or "general-agent"
    import yaml as _yaml

    # 固化到抓虾 adapters 目录:注册为可复用任务(tasks_search/task_run 可见)
    from core.agent.service import _data_root
    adapter_dir = _data_root() / "adapters" / safe_adapter
    scripts_dir = adapter_dir
    scripts_dir.mkdir(parents=True, exist_ok=True)
    safe_name = _re.sub(r"[^A-Za-z0-9._-]", "_", draft.name)
    if not safe_name.endswith((".js", ".py")):
        safe_name += ".js"
    dest = scripts_dir / safe_name
    dest.write_text(content, encoding="utf-8")

    manifest_path = adapter_dir / "manifest.yaml"
    manifest: dict = {}
    if manifest_path.exists():
        try:
            manifest = _yaml.safe_load(manifest_path.read_text(encoding="utf-8")) or {}
        except Exception:  # noqa: BLE001
            manifest = {}
    manifest.setdefault("id", safe_adapter)
    manifest.setdefault("name", f"{safe_adapter} 智能体脚本")
    manifest.setdefault("version", "0.1.0")
    manifest.setdefault("author", "crawshrimp-agent")
    manifest.setdefault("description", "智能体固化脚本(双闸门审批)")
    manifest.setdefault("entry_url", "")
    tasks = manifest.get("tasks") or []
    task_id = safe_name.rsplit(".", 1)[0]
    entry = next((t for t in tasks if isinstance(t, dict) and t.get("id") == task_id), None)
    if entry is None:
        entry = {"id": task_id, "name": task_id, "script": safe_name,
                 "description": "智能体固化的网页自动化脚本(经用户双闸门审批)"}
        tasks.append(entry)
    else:
        entry.update({"script": safe_name})
    manifest["tasks"] = tasks
    manifest_path.write_text(_yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False), encoding="utf-8")

    sha = _hashlib.sha256(content.encode("utf-8")).hexdigest()
    _db.update_script_revision(rev_id, status="published", adapter_id=safe_adapter, source_sha256=sha)
    return {"ok": True, "status": "published", "path": str(dest),
            "adapter_id": safe_adapter, "task_id": task_id,
            "source_sha256": sha,
            "message": f"已固化到抓虾脚本库:任务 {task_id} 可复用(tasks_search 可见)"}


def build_agent_mcp_asgi(token_provider) -> Any:
    """构建带 Bearer 鉴权的 MCP ASGI 应用(独立端口服务,SDK session manager 需要自身 lifespan)。

    挂在 FastAPI 子路由上时 MCP SDK 2.0 的 lifespan 不会运行(Task group 未初始化),
    因此由 AgentService 用 uvicorn.Server 单独服务。
    """
    import hmac

    from starlette.middleware.base import BaseHTTPMiddleware

    mcp = mcp_gateway.create_agent_mcp_server()
    inner = mcp.streamable_http_app(
        streamable_http_path="/mcp",
        stateless_http=True,
        json_response=True,
        host="127.0.0.1",
    )

    class McpBearerAuth(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            expected = token_provider()
            supplied = str(request.headers.get("Authorization") or "").strip()
            if not expected or not supplied.startswith("Bearer ") or not hmac.compare_digest(supplied[7:], expected):
                return JSONResponse({"detail": "Unauthorized"}, status_code=401)
            return await call_next(request)

    return McpBearerAuth(inner)
