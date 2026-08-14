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


@router.post("/sessions/{session_id}/turns")
async def create_turn(session_id: str, req: TurnCreateRequest) -> dict:
    service = get_agent_service()
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(422, "text 不能为空")
    if len(text) > 20000:
        raise HTTPException(422, "text 过长")
    try:
        result = await service.submit_turn(session_id, text, req.context_refs)
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
