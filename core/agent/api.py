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

from core.atomic_file import atomic_write_text, remove_path_with_retry, retry_file_operation
from core.agent import db, mcp_gateway
from core.agent.service import AgentService, SSE_DISCONNECT

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
    session_id: str = ""
    runtime_session_id: str = ""


class ArtifactSignRequest(BaseModel):
    path: str
    entry: str = ""


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
    from core.agent.cordis_config import agent_capable_model_ids, model_capabilities, resolve_provider_for_model
    from core.config import load_config
    from core.llm_gateway import model_has_configured_key

    cfg = load_config()
    models = []
    for model_id in agent_capable_model_ids():
        cap = model_capabilities(model_id)
        if not model_has_configured_key(model_id, cfg):
            continue
        models.append({
            "model_id": model_id,
            "route": resolve_provider_for_model(model_id),
            "context_window": cap.get("context_window"),
            "max_output_tokens": cap.get("max_output_tokens"),
        })
    return {"models": models}


@router.get("/model-catalog")
def list_crawshrimp_model_catalog() -> dict:
    from core.model_catalog import crawshrimp_model_catalog

    return crawshrimp_model_catalog()


@router.patch("/sessions/{session_id}/model")
def set_session_model(session_id: str, req: SessionModelRequest) -> dict:
    from core.agent.cordis_config import model_capabilities
    from core.config import load_config
    from core.llm_gateway import model_has_configured_key

    session = db.get_session(session_id)
    if not session:
        raise HTTPException(404, "会话不存在")
    model_id = str(req.model_id or "").strip()
    cap = model_capabilities(model_id)
    if not cap.get("supports_tools"):
        raise HTTPException(422, f"模型不可用于智能体: {model_id}")
    if not model_has_configured_key(model_id, load_config()):
        raise HTTPException(422, f"模型未配置 API Key: {model_id}")
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


@router.post("/attachments/inbox")
def create_inbox_attachment(req: AttachmentCreateRequest) -> dict:
    """会话界面上传附件；必须显式绑定当前 DSH runtime/product 会话。"""
    session = None
    runtime_id = str(req.runtime_session_id or "").strip()
    product_id = str(req.session_id or "").strip()
    if runtime_id:
        session = db.get_session_by_runtime(runtime_id)
        if session is None:
            # DSH 新会话可能在首条 turn/start 前上传附件，先建立影子投影。
            try:
                session = db.create_session(f"cs-web-{uuid.uuid4().hex[:12]}", runtime_id, "智能体会话")
            except Exception:  # 并发消息可能已创建，按 runtime 再读一次
                session = db.get_session_by_runtime(runtime_id)
    elif product_id:
        session = db.get_session(product_id)
    if not session or session.get("archived_at"):
        raise HTTPException(409, "无法确认当前会话，请等待会话加载完成后重试上传")
    return _register_attachment(str(session["session_id"]), req, cleanup_tmp=True)


MAX_AGENT_ATTACHMENT_BYTES = 200 * 1024 * 1024
_EXECUTABLE_ATTACHMENT_EXT = {
    ".app", ".bat", ".cmd", ".com", ".dll", ".dmg", ".exe", ".msi", ".pkg", ".ps1", ".scr",
}


def _detected_attachment_mime(path) -> str:
    """用少量 magic bytes 识别常见展示格式，避免只信任扩展名/前端 MIME。"""
    import mimetypes
    try:
        with path.open("rb") as stream:
            head = stream.read(16)
    except OSError:
        return "application/octet-stream"
    signatures = (
        (b"\x89PNG\r\n\x1a\n", "image/png"),
        (b"\xff\xd8\xff", "image/jpeg"),
        (b"GIF87a", "image/gif"),
        (b"GIF89a", "image/gif"),
        (b"BM", "image/bmp"),
        (b"%PDF-", "application/pdf"),
        (b"PK\x03\x04", "application/zip"),
        (b"\x7fELF", "application/x-executable"),
        (b"MZ", "application/x-dosexec"),
        (b"\xcf\xfa\xed\xfe", "application/x-mach-binary"),
        (b"\xfe\xed\xfa\xcf", "application/x-mach-binary"),
        (b"\xca\xfe\xba\xbe", "application/x-mach-binary"),
    )
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return "image/webp"
    for prefix, mime in signatures:
        if head.startswith(prefix):
            if mime == "application/zip" and path.suffix.lower() in {".xlsx", ".xlsm"}:
                return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            return mime
    guessed = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    # 图片必须由 magic bytes 证实；仅凭 .png/.webp 扩展名不能进入模型像素通道。
    return "application/octet-stream" if guessed.startswith("image/") else guessed


def _register_attachment(session_id: str, req: AttachmentCreateRequest, *, cleanup_tmp: bool = False) -> dict:
    import re as _re
    import shutil as _shutil
    import uuid as _uuid
    from pathlib import Path as _P
    from core.agent.service import _data_root

    src = _P(str(req.path or "")).expanduser()
    if not src.is_file():
        raise HTTPException(422, "文件不存在")
    try:
        actual_size = src.stat().st_size
    except OSError as exc:
        raise HTTPException(422, f"读取附件大小失败: {exc}") from exc
    if actual_size > MAX_AGENT_ATTACHMENT_BYTES:
        raise HTTPException(413, f"附件超过 {MAX_AGENT_ATTACHMENT_BYTES // (1024 * 1024)}MB 上限")
    safe_name = _re.sub(r"[^A-Za-z0-9._\u4e00-\u9fff-]", "_", str(req.name or src.name))
    if not safe_name or safe_name in {".", ".."}:
        safe_name = "attachment"
    if _P(safe_name).suffix.lower() in _EXECUTABLE_ATTACHMENT_EXT:
        raise HTTPException(415, "不支持上传可执行安装文件")
    attachment_id = f"att-{_uuid.uuid4().hex[:12]}"
    dest_dir = _data_root() / "agent" / "attachments" / attachment_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / safe_name
    try:
        copied_size = 0
        with src.open("rb") as source_stream, dest.open("xb") as dest_stream:
            while True:
                chunk = source_stream.read(1024 * 1024)
                if not chunk:
                    break
                copied_size += len(chunk)
                if copied_size > MAX_AGENT_ATTACHMENT_BYTES:
                    raise HTTPException(
                        413,
                        f"附件超过 {MAX_AGENT_ATTACHMENT_BYTES // (1024 * 1024)}MB 上限",
                    )
                dest_stream.write(chunk)
        copied_size = dest.stat().st_size
        if copied_size != actual_size or copied_size > MAX_AGENT_ATTACHMENT_BYTES:
            raise OSError("附件复制后大小校验失败")
    except HTTPException:
        _shutil.rmtree(dest_dir, ignore_errors=True)
        raise
    except OSError as exc:
        _shutil.rmtree(dest_dir, ignore_errors=True)
        raise HTTPException(422, f"复制附件失败: {exc}") from exc
    detected_mime = _detected_attachment_mime(dest)
    claimed_mime = str(req.mime or "").strip().lower()
    if detected_mime in {"application/x-executable", "application/x-dosexec", "application/x-mach-binary"}:
        _shutil.rmtree(dest_dir, ignore_errors=True)
        raise HTTPException(415, "不支持上传可执行安装文件")
    if claimed_mime.startswith("image/") and not detected_mime.startswith("image/"):
        _shutil.rmtree(dest_dir, ignore_errors=True)
        raise HTTPException(415, "附件内容与声明的图片类型不一致")
    row = db.create_attachment(attachment_id, session_id, None, None,
                               safe_name, str(dest), detected_mime, copied_size)
    # 上传临时文件已复制进受控附件目录,清理 tmp 源避免 userData 无限增长
    if cleanup_tmp:
        import os as _os
        tmp_root = _os.environ.get("CRAWSHRIMP_AGENT_ATTACHMENT_TMP_ROOT", "").strip()
        if tmp_root:
            try:
                src.resolve().relative_to(_P(tmp_root).expanduser().resolve())
                src.unlink()
            except (OSError, ValueError):
                pass
    return {"attachment": row}


@router.post("/sessions/{session_id}/attachments")
def create_attachment(session_id: str, req: AttachmentCreateRequest) -> dict:
    """渲染端经原生选择器挑选文件后注册为会话附件(拷贝进受控附件目录)。"""
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(404, "会话不存在")
    if session.get("archived_at"):
        raise HTTPException(409, "会话已归档，不能继续上传附件")
    return _register_attachment(session_id, req, cleanup_tmp=True)


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


@router.post("/data/clear")
async def clear_agent_data() -> dict:
    """清除智能体数据及受控附件/草稿/运行日志/智能体发布适配包。

    不清任务实例、任务产物与模型配置。
    """
    service = get_agent_service()
    result = await service.clear_agent_data()
    if not result.get("ok"):
        raise HTTPException(409, result.get("error", "存在进行中的运行,无法清除"))
    return result


@router.get("/task-instances/{instance_uid}")
def get_task_instance_status(instance_uid: str) -> dict:
    """任务实例状态(任务卡实时刷新)。"""
    from core import data_sink as _ds
    detail = _ds.get_task_instance_detail(instance_uid)
    if not detail:
        raise HTTPException(404, "任务实例不存在")
    return {
        "instance_uid": instance_uid,
        "status": detail.get("status"),
        "current_step": detail.get("current_step") or "",
        "progress": detail.get("progress") or None,
        "title": detail.get("title") or "",
        "summary": detail.get("summary") or None,
        "artifacts": detail.get("artifacts") or [],
    }


# ---------- 产物媒体访问(会话内多图直接显示/视频可点击播放/附件可点击) ----------

_MEDIA_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
_MEDIA_VIDEO_EXT = {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"}
_MEDIA_AUDIO_EXT = {".mp3", ".wav", ".m4a", ".aac", ".ogg"}


@router.post("/artifacts/sign")
def sign_artifact_url(req: ArtifactSignRequest) -> dict:
    """为一个确切的媒体文件/ZIP 条目签发短期只读 capability。"""
    p = _artifact_path_safe(req.path)
    entry = str(req.entry or "")
    if entry:
        if p.suffix.lower() != ".zip":
            raise HTTPException(400, "entry 仅适用于 zip 产物")
        import zipfile
        try:
            with zipfile.ZipFile(p) as zf:
                if entry not in zf.namelist():
                    raise HTTPException(404, "zip 内条目不存在")
        except zipfile.BadZipFile as exc:
            raise HTTPException(400, "zip 文件损坏") from exc
    from core.api_server import _sign_media_access
    signed = _sign_media_access(str(p), entry, route="entry" if entry else "file")
    return {"path": str(p), "entry": entry, **signed}


def _media_kind_for(name: str) -> str:
    lower = str(name or "").lower()
    ext = "." + lower.rsplit(".", 1)[-1] if "." in lower else ""
    if ext in _MEDIA_IMAGE_EXT:
        return "image"
    if ext in _MEDIA_VIDEO_EXT:
        return "video"
    if ext in _MEDIA_AUDIO_EXT:
        return "audio"
    return "file"


def _artifact_path_safe(path_value: str):
    """会话内媒体显示专用:按用户要求全面开放本地路径(仅校验文件存在)。

    本端点为本地回环 + token 鉴权的展示通道(图片/视频/附件预览),
    产物可能落在 Downloads/抓虾导出 等任意用户目录,不再限制必须位于数据目录内。
    """
    from pathlib import Path as _Path
    raw = str(path_value or "").strip()
    if not raw:
        raise HTTPException(400, "缺少 path 参数")
    p = _Path(raw).expanduser().resolve()
    if not p.is_file():
        raise HTTPException(404, "文件不存在")
    return p


def _guess_media_type(name: str) -> str:
    import mimetypes
    guessed = mimetypes.guess_type(str(name or ""))[0]
    if guessed:
        return guessed
    kind = _media_kind_for(name)
    return {"image": "application/octet-stream", "video": "video/mp4", "audio": "audio/mpeg"}.get(kind, "application/octet-stream")


@router.get("/artifacts/entry")
def artifact_zip_entry(path: str, entry: str) -> Response:
    """ZIP 产物内单条目字节流(会话内多图直接显示用;仅解压目标条目)。"""
    import zipfile
    from fastapi.responses import Response as _Response
    p = _artifact_path_safe(path)
    if not str(p.name).lower().endswith(".zip"):
        raise HTTPException(400, "仅支持 zip 产物")
    entry_name = str(entry or "").strip()
    if not entry_name:
        raise HTTPException(400, "缺少 entry 参数")
    try:
        with zipfile.ZipFile(str(p)) as zf:
            names = zf.namelist()
            if entry_name not in names:
                raise HTTPException(404, "zip 内条目不存在")
            info = zf.getinfo(entry_name)
            # zip bomb 防护:解压前检查未压缩大小,超大条目直接拒绝
            if info.file_size > 64 * 1024 * 1024:
                raise HTTPException(413, "条目过大")
            data = zf.read(entry_name)
    except HTTPException:
        raise
    except zipfile.BadZipFile as exc:
        raise HTTPException(400, "zip 文件损坏") from exc
    return _Response(
        content=data,
        media_type=_guess_media_type(entry_name),
        headers={"Cache-Control": "no-store", "Content-Disposition": "inline"},
    )


@router.get("/artifacts/file")
def artifact_file(path: str, request: Request):
    """产物文件字节流,支持 Range(视频拖动进度条/音频 seek)。"""
    import os as _os
    from fastapi.responses import FileResponse as _FileResponse
    p = _artifact_path_safe(path)
    size = _os.path.getsize(p)
    media_type = _guess_media_type(str(p.name))
    common = {"Accept-Ranges": "bytes", "Cache-Control": "no-store", "Content-Disposition": "inline"}
    range_header = str(request.headers.get("range") or "").strip()
    if range_header:
        import re as _re
        m = _re.match(r"bytes=(\d*)-(\d*)$", range_header)
        if m and (m.group(1) or m.group(2)):
            start_s, end_s = m.group(1), m.group(2)
            if start_s == "" and end_s != "":
                # 后缀区间 bytes=-N:最后 N 字节(RFC 7233)
                n = int(end_s)
                if n <= 0:
                    from fastapi.responses import Response as _Response
                    return _Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
                start = max(0, size - n)
                end = size - 1
            else:
                start = int(start_s) if start_s else 0
                end = int(end_s) if end_s else (size - 1)
            if start >= size or start > end:
                from fastapi.responses import Response as _Response
                return _Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
            end = min(end, size - 1)
            length = end - start + 1

            def _chunks():
                remaining = length
                with open(p, "rb") as f:
                    f.seek(start)
                    while remaining > 0:
                        chunk = f.read(min(65536, remaining))
                        if not chunk:
                            break
                        remaining -= len(chunk)
                        yield chunk

            return StreamingResponse(
                _chunks(), status_code=206, media_type=media_type,
                headers={**common, "Content-Range": f"bytes {start}-{end}/{size}", "Content-Length": str(length)},
            )
    return _FileResponse(p, media_type=media_type, headers=common)


@router.get("/sessions/{session_id}/events")
async def session_events(session_id: str, request: Request, after_seq: int = 0) -> StreamingResponse:
    service = get_agent_service()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(404, "会话不存在")

    async def event_source():
        # 先订阅再补历史，消除“查完历史、挂 live 之前”丢事件的竞态；
        # live 队列中与历史重叠的 seq 会被 cursor 去重。
        queue = service.subscribe(session_id)
        try:
            cursor = max(0, int(after_seq or 0))
            while True:
                rows = db.list_events_after(session_id, cursor)
                for row in rows:
                    cursor = max(cursor, int(row["seq"]))
                    yield f"id: {row['seq']}\nevent: {row['event_type']}\ndata: {row['payload_json']}\n\n"
                if len(rows) < 500:
                    break
            while True:
                if await request.is_disconnected():
                    break
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=20)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if message is SSE_DISCONNECT:
                    break
                message_seq = int(message.get("seq") or 0)
                if message_seq <= cursor:
                    continue
                cursor = message_seq
                payload = message.get("payload")
                yield (f"id: {message_seq}\nevent: {message.get('event_type')}\n"
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
        queue = service.subscribe_all()
        try:
            # -1 = 首次挂载只建立当前高水位，不重放其他会话的历史卡片；
            # cursor 事件把高水位交给客户端，后续断线即可无缝补放。
            if int(after_seq) < 0:
                cursor = db.latest_event_seq()
                yield (f"id: {cursor}\nevent: cursor\n"
                       f"data: {json.dumps({'seq': cursor}, ensure_ascii=False)}\n\n")
            else:
                cursor = max(0, int(after_seq or 0))
                while True:
                    rows = db.list_all_events_after(cursor)
                    for row in rows:
                        cursor = max(cursor, int(row["seq"]))
                        payload = row.get("payload_json") or "{}"
                        yield f"id: {row['seq']}\nevent: {row['event_type']}\ndata: {payload}\n\n"
                    if len(rows) < 500:
                        break
            while True:
                if await request.is_disconnected():
                    break
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=20)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if message is SSE_DISCONNECT:
                    break
                message_seq = int(message.get("seq") or 0)
                if message_seq <= cursor:
                    continue
                cursor = message_seq
                payload = message.get("payload")
                yield (f"id: {message_seq}\nevent: {message.get('event_type')}\n"
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
    approvals = []
    for row in rows:
        session = db.get_session(str(row.get("session_id") or "")) or {}
        approvals.append({
            "approval_id": row.get("approval_id"),
            "plan_id": row.get("plan_id"),
            "run_id": row.get("run_id"),
            "session_id": row.get("session_id"),
            "runtime_session_id": session.get("runtime_session_id") or "",
            "summary": json.loads(row.get("summary_json") or "{}"),
            "risk": row.get("risk"),
            "status": row.get("status"),
            "created_at": row.get("created_at"),
        })
    return {"approvals": approvals}


# ---------- 能力授权(浏览器任务) ----------

@router.post("/sessions/{session_id}/grants")
def create_grant(session_id: str, req: GrantCreateRequest) -> dict:
    service = get_agent_service()
    run = service.active_run_for_session(session_id) or {}
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
    package_files = []
    for name, path in _collect_revision_files(rev):
        try:
            content = path.read_text(encoding="utf-8")
        except OSError as exc:
            content = f"(读取失败: {exc})"
        package_files.append({"name": name, "content": content[:200000]})
    draft_name = Path(rev["draft_path"]).name
    content = next((item["content"] for item in package_files if item["name"] == draft_name), "")
    return {"revision": rev, "content": content, "files": package_files}


class ScriptReviewRequest(BaseModel):
    decision: str  # publish | reject


def _collect_revision_files(rev: dict):
    """收集某修订所属 run 的适配包文件(manifest.yaml + 各任务脚本/附属文件)。"""
    from pathlib import Path as _P
    from core.agent import db as _db
    files: list[tuple[str, _P]] = []
    seen: set[str] = set()
    for wf in (_db.list_workspace_files(rev.get("created_run_id")) or []):
        src = _P(wf.get("path") or "")
        if not src.is_file():
            continue
        if src.name in seen or not src.name.endswith((".js", ".yaml", ".yml", ".json", ".md", ".txt", ".csv")):
            continue
        seen.add(src.name)
        files.append((src.name, src))
    draft = _P(str(rev.get("draft_path") or ""))
    if draft.is_file() and draft.name not in seen:
        files.append((draft.name, draft))
    return files


def _adapter_snapshot_dir(adapter_id: str):
    from pathlib import Path as _P
    from core.agent.service import _data_root
    safe = _P(str(adapter_id or "")).name or "adapter"
    # 备份不能放在 adapters 根目录，否则 scan_all 会把备份 manifest 当成正式包。
    return _data_root() / "agent" / "review-backups" / safe


def _discard_adapter_backup_best_effort(path, label: str) -> bool:
    """Remove an obsolete backup without turning a completed state change into a failure."""
    try:
        remove_path_with_retry(path)
        return True
    except OSError as exc:
        # The restored/published adapter remains authoritative. Keeping a stale
        # backup is safer than reporting the completed operation as failed.
        print(f"[agent] {label}清理失败，将在后续清库时重试: {exc}", flush=True)
        return False


def _snapshot_existing_adapter(adapter_id: str) -> bool:
    """测试安装前快照同名生产适配器;无同名适配器时返回 False。"""
    if not adapter_id:
        return False
    import shutil as _sh
    from pathlib import Path as _P
    from core.agent.service import _data_root
    dest = _data_root() / "adapters" / str(adapter_id)
    if not (dest.exists() or dest.is_symlink()):
        return False
    backup = _adapter_snapshot_dir(adapter_id)
    backup_adapter = backup / "adapter"
    backup_meta = backup / "install-meta.json"
    remove_path_with_retry(backup)
    try:
        backup.mkdir(parents=True, exist_ok=False)
        _sh.copytree(str(dest), str(backup_adapter), symlinks=True)
        from core import adapter_loader as _al
        meta_path = _al._metadata_path(adapter_id)
        if meta_path.is_file():
            _sh.copy2(str(meta_path), str(backup_meta))
        return True
    except Exception as exc:  # noqa: BLE001
        _discard_adapter_backup_best_effort(backup, f"适配器 {adapter_id} 不完整快照")
        raise HTTPException(409, f"无法为现有适配器 {adapter_id} 创建安全快照: {exc}") from exc


def _restore_snapshotted_adapter(adapter_id: str) -> None:
    """拒绝时恢复快照的生产适配器,并重新加载运行时。"""
    if not adapter_id:
        return
    import shutil as _sh
    from core.agent.service import _data_root
    backup = _adapter_snapshot_dir(adapter_id)
    backup_adapter = backup / "adapter"
    backup_meta = backup / "install-meta.json"
    if not backup_adapter.exists():
        return
    dest = _data_root() / "adapters" / str(adapter_id)
    try:
        remove_path_with_retry(dest)
        _sh.copytree(str(backup_adapter), str(dest), symlinks=True)
        from core import adapter_loader as _al
        meta_path = _al._metadata_path(adapter_id)
        if backup_meta.is_file():
            atomic_write_text(meta_path, backup_meta.read_text(encoding="utf-8"))
        else:
            remove_path_with_retry(meta_path)
        _al.scan_all()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"恢复适配器 {adapter_id} 的发布前快照失败: {exc}") from exc
    _discard_adapter_backup_best_effort(backup, f"适配器 {adapter_id} 已恢复快照")


def _discard_adapter_snapshot(adapter_id: str) -> None:
    if not adapter_id:
        return
    backup = _adapter_snapshot_dir(adapter_id)
    _discard_adapter_backup_best_effort(backup, f"适配器 {adapter_id} 已提交快照")


def _published_adapter_baseline_dir(adapter_id: str):
    """智能体首次发布前的长期基线；清除智能体数据时用于恢复用户原包。"""
    from core.models import SLUG_PATTERN
    from core.agent.service import _data_root
    value = str(adapter_id or "").strip()
    if not SLUG_PATTERN.fullmatch(value):
        raise HTTPException(409, f"非法适配器 id: {value}")
    return _data_root() / "agent" / "published-baselines" / value


def _capture_published_adapter_baseline(adapter_id: str) -> bool:
    """只在首次智能体发布时保存原适配器；后续覆盖不得冲掉这份基线。"""
    import json as _json
    import shutil as _sh
    from core.agent.service import _data_root
    from core import adapter_loader as _al

    baseline = _published_adapter_baseline_dir(adapter_id)
    state_path = baseline / "state.json"
    if state_path.is_file():
        return False
    tmp = baseline.parent / f".{baseline.name}.tmp-{uuid.uuid4().hex[:8]}"
    remove_path_with_retry(tmp)
    try:
        tmp.mkdir(parents=True, exist_ok=False)
        dest = _data_root() / "adapters" / str(adapter_id)
        had_adapter = bool(dest.exists() or dest.is_symlink())
        if had_adapter:
            if not dest.is_dir():
                raise OSError("现有适配器目标不是目录")
            _sh.copytree(str(dest), str(tmp / "adapter"), symlinks=True)
        meta_path = _al._metadata_path(adapter_id)
        if meta_path.is_file():
            _sh.copy2(str(meta_path), str(tmp / "install-meta.json"))
        (tmp / "state.json").write_text(
            _json.dumps({"had_adapter": had_adapter}, ensure_ascii=False), encoding="utf-8"
        )
        baseline.parent.mkdir(parents=True, exist_ok=True)
        if baseline.exists():
            _discard_adapter_backup_best_effort(tmp, f"适配器 {adapter_id} 临时基线")
            return False
        retry_file_operation(lambda: tmp.rename(baseline))
        return True
    except Exception as exc:  # noqa: BLE001
        _discard_adapter_backup_best_effort(tmp, f"适配器 {adapter_id} 不完整基线")
        raise HTTPException(409, f"无法保存适配器 {adapter_id} 的发布前基线: {exc}") from exc


def _discard_published_adapter_baseline(adapter_id: str) -> None:
    _discard_adapter_backup_best_effort(
        _published_adapter_baseline_dir(adapter_id),
        f"适配器 {adapter_id} 未发布基线",
    )


def _restore_published_adapter_baseline(adapter_id: str) -> bool:
    """恢复首次发布前基线；成功清库前不删除备份，失败后可安全重试。"""
    import json as _json
    import shutil as _sh
    from core.agent.service import _data_root
    from core import adapter_loader as _al

    baseline = _published_adapter_baseline_dir(adapter_id)
    state_path = baseline / "state.json"
    if not state_path.is_file():
        return False
    try:
        state = _json.loads(state_path.read_text(encoding="utf-8"))
        had_adapter = bool(state.get("had_adapter"))
        backup_adapter = baseline / "adapter"
        backup_meta = baseline / "install-meta.json"
        _al.uninstall(adapter_id)
        dest = _data_root() / "adapters" / str(adapter_id)
        remove_path_with_retry(dest)
        meta_path = _al._metadata_path(adapter_id)
        if had_adapter:
            if not backup_adapter.is_dir():
                raise OSError("发布前适配器基线缺失")
            _sh.copytree(str(backup_adapter), str(dest), symlinks=True)
            if backup_meta.is_file():
                atomic_write_text(meta_path, backup_meta.read_text(encoding="utf-8"))
            else:
                remove_path_with_retry(meta_path)
        _al.scan_all()
        return True
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"恢复适配器 {adapter_id} 的发布前基线失败: {exc}") from exc


def _revision_package_sha256(rev: dict) -> str:
    """按文件名与内容锁定经过测试的完整适配包。"""
    import hashlib as _hashlib
    digest = _hashlib.sha256()
    for name, path in sorted(_collect_revision_files(rev), key=lambda item: item[0]):
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _remove_failed_adapter(adapter_id: str) -> None:
    """无旧版本可恢复时清除正式安装留下的半目录并刷新加载缓存。"""
    from core.agent.service import _data_root
    from core import adapter_loader as _al
    dest = _data_root() / "adapters" / str(adapter_id)
    try:
        _al.uninstall(adapter_id)
    except Exception:  # noqa: BLE001
        pass
    remove_path_with_retry(dest)
    remove_path_with_retry(_al._metadata_path(adapter_id))
    _al.scan_all()


def _rollback_failed_adapter_install(
    adapter_id: str,
    *,
    had_snapshot: bool,
    original_exc: Exception,
) -> None:
    """Restore the pre-install state and retain both errors if rollback also fails."""
    try:
        if had_snapshot:
            _restore_snapshotted_adapter(adapter_id)
        else:
            _remove_failed_adapter(adapter_id)
    except Exception as rollback_exc:  # noqa: BLE001
        raise HTTPException(
            500,
            f"适配器 {adapter_id} 发布失败，且无法恢复发布前状态；"
            f"原始错误: {original_exc}; 回滚错误: {rollback_exc}",
        ) from rollback_exc


def _test_adapter_id(rev_id: str) -> str:
    import hashlib
    return f"review-{hashlib.sha256(str(rev_id).encode('utf-8')).hexdigest()[:20]}"


def _load_revision_package(rev: dict):
    """读取并严格校验一个 manifest 修订，返回 manifest 与包文件。"""
    from pathlib import Path as _P
    import yaml as _y
    from core.agent.script_contract import validate_adapter_package

    draft = _P(str(rev.get("draft_path") or ""))
    if draft.name != "manifest.yaml" or not draft.is_file():
        raise HTTPException(409, "脚本修订必须以 manifest.yaml 为入口，单文件脚本不能测试或发布")
    files = dict(_collect_revision_files(rev))
    manifest_src = files.get("manifest.yaml") or draft
    try:
        manifest_doc = _y.safe_load(manifest_src.read_text(encoding="utf-8")) or {}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(409, f"manifest.yaml 解析失败: {exc}") from exc
    if not isinstance(manifest_doc, dict):
        raise HTTPException(409, "manifest.yaml 顶层必须是对象")
    try:
        validate_adapter_package(manifest_doc, files)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return manifest_doc, files


def _install_revision_to_adapters(rev: dict, *, adapter_id_override: str = ""):
    """把修订的适配包文件安装到抓虾 adapters 运行时(经 adapter_loader 加载)。

    返回 (adapter_id, manifest_doc)。manifest 声明缺失脚本时报 409。
    """
    from pathlib import Path as _P
    import tempfile as _tf
    import shutil as _sh
    import yaml as _y
    from core import adapter_loader as _al
    manifest_doc, file_map = _load_revision_package(rev)
    adapter_id = str(adapter_id_override or manifest_doc.get("id") or "").strip()
    install_manifest = dict(manifest_doc)
    if adapter_id_override:
        install_manifest["id"] = adapter_id
        install_manifest["name"] = f"[测试] {manifest_doc.get('name') or manifest_doc.get('id')}"
    with _tf.TemporaryDirectory(prefix="crawshrimp-rev-") as tmp:
        tmpdir = _P(tmp)
        for name, src in file_map.items():
            if name == "manifest.yaml":
                continue
            _sh.copy2(str(src), str(tmpdir / name))
        (tmpdir / "manifest.yaml").write_text(
            _y.safe_dump(install_manifest, allow_unicode=True, sort_keys=False), encoding="utf-8"
        )
        try:
            _al.install_from_dir(str(tmpdir), install_mode="copy")
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(409, f"安装到运行时失败: {exc}") from exc
    return adapter_id, manifest_doc


@router.post("/script-revisions/{rev_id}/test-install")
async def test_install_script_revision(rev_id: str) -> dict:
    """把待复核适配包安装到运行时测试区(与正式脚本界面同一运行环境)。

    用户在审核页即可真实运行测试;批准=转正,拒绝=卸载测试安装。
    """
    from core.agent import db as _db
    rev = db.get_script_revision(rev_id)
    if not rev:
        raise HTTPException(404, "修订不存在")
    if rev["status"] not in ("pending_review", "testing"):
        raise HTTPException(409, f"修订状态不允许测试安装: {rev['status']}")
    manifest_doc, _files = _load_revision_package(rev)
    target_adapter_id = str(manifest_doc.get("id") or "")
    test_adapter_id = str(rev.get("test_adapter_id") or _test_adapter_id(rev_id))
    tested_sha256 = _revision_package_sha256(rev)
    if (rev.get("status") == "testing" and rev.get("test_adapter_id")
            and str(rev.get("tested_sha256") or "") == tested_sha256):
        return {"ok": True, "idempotent": True, "status": "testing",
                "adapter_id": test_adapter_id, "target_adapter_id": target_adapter_id,
                "test_adapter_id": test_adapter_id, "tested_sha256": tested_sha256,
                "message": "该版本已安装在隔离测试命名空间，无需重复覆盖"}
    if rev.get("test_adapter_id"):
        await _stop_test_adapter_instances(test_adapter_id)
    try:
        installed_id, _ = _install_revision_to_adapters(rev, adapter_id_override=test_adapter_id)
    except Exception as install_exc:
        # adapter_loader 覆盖安装会先移除旧测试目录；失败后不能继续把修订
        # 标成 testing，也不能留下缓存中的半安装 review-* 包。
        cleanup_exc = None
        try:
            _remove_failed_adapter(test_adapter_id)
        except Exception as exc:  # noqa: BLE001
            cleanup_exc = exc
        _db.update_script_revision(
            rev_id, status="pending_review", test_adapter_id=None,
            tested_sha256=None,
        )
        if cleanup_exc is not None:
            raise HTTPException(
                500,
                f"测试适配器安装失败，且残留目录清理失败；"
                f"安装错误: {install_exc}; 清理错误: {cleanup_exc}",
            ) from cleanup_exc
        raise
    _db.update_script_revision(
        rev_id, status="testing", adapter_id=target_adapter_id,
        target_adapter_id=target_adapter_id, test_adapter_id=installed_id,
        tested_sha256=tested_sha256,
    )
    return {"ok": True, "status": "testing", "adapter_id": installed_id,
            "target_adapter_id": target_adapter_id, "test_adapter_id": installed_id,
            "tested_sha256": tested_sha256,
            "adapter": {
                "id": installed_id,
                "name": f"[测试] {manifest_doc.get('name') or target_adapter_id}",
                "version": str(manifest_doc.get("version") or ""),
                "description": manifest_doc.get("description") or "",
                "task_count": len([t for t in manifest_doc.get("tasks") or [] if isinstance(t, dict)]),
            },
            "message": "已安装到隔离测试命名空间，不会覆盖或触发同名正式适配器；真实运行确认后才能批准发布"}


async def _stop_test_adapter_instances(adapter_id: str) -> None:
    """卸载测试适配器前停止其活动实例，避免 Windows 文件占用和孤儿任务。"""
    if not adapter_id:
        return
    from core import data_sink as _sink
    active = _sink.list_task_instances(status_group="current", adapter_id=adapter_id, limit=500)
    if not active:
        return
    service = get_agent_service()
    control = service._callbacks.get("control_task_instance")
    if not control:
        raise HTTPException(503, "任务控制服务未就绪，无法安全卸载测试适配器")
    for item in active:
        try:
            await control(str(item["instance_uid"]), "stop")
        except Exception as exc:  # noqa: BLE001
            current = _sink.get_task_instance(str(item["instance_uid"])) or {}
            if str(current.get("status") or "") in {"draft", "queued", "running", "generating", "creating", "waiting_approval"}:
                raise HTTPException(409, f"测试任务 {item['instance_uid']} 无法停止: {exc}") from exc


@router.post("/script-revisions/{rev_id}/review")
async def review_script_revision(rev_id: str, req: ScriptReviewRequest) -> dict:
    """人工复核闸门:把草稿发布到已发布脚本库,或拒绝。"""
    from pathlib import Path
    from core.agent import db as _db

    if req.decision not in ("publish", "reject"):
        raise HTTPException(422, "decision 仅支持 publish/reject")
    rev = db.get_script_revision(rev_id)
    if not rev:
        raise HTTPException(404, "修订不存在")
    if rev["status"] not in ("pending_review", "testing"):
        if rev["status"] == "published" and req.decision == "publish":
            return {"ok": True, "idempotent": True, "status": "published"}
        raise HTTPException(409, f"修订状态不允许复核: {rev['status']}")
    if req.decision == "reject":
        test_adapter_id = str(rev.get("test_adapter_id") or "")
        if test_adapter_id:
            await _stop_test_adapter_instances(test_adapter_id)
            from core import adapter_loader as _al
            _al.uninstall(test_adapter_id)
        _db.update_script_revision(rev_id, status="rejected", test_adapter_id=None,
                                   tested_sha256=None)
        return {"ok": True, "status": "rejected"}

    if rev["status"] != "testing" or not rev.get("test_adapter_id"):
        raise HTTPException(409, "必须先安装到隔离测试区并真实测试，才能批准发布")

    draft = Path(rev["draft_path"])
    if not draft.exists():
        _db.update_script_revision(rev_id, status="rejected")
        raise HTTPException(409, "草稿文件已不存在,无法发布")
    manifest_doc, _files = _load_revision_package(rev)
    package_sha256 = _revision_package_sha256(rev)
    if not rev.get("tested_sha256") or str(rev.get("tested_sha256")) != package_sha256:
        raise HTTPException(409, "适配包内容在测试后已变化，必须重新安装到隔离测试区并真实测试")
    safe_adapter = str(manifest_doc["id"])
    published_files = [name for name, _src in _collect_revision_files(rev) if name != "manifest.yaml"]
    task_id = str((manifest_doc.get("tasks") or [{}])[0].get("id") or "")
    test_adapter_id = str(rev.get("test_adapter_id") or "")
    await _stop_test_adapter_instances(test_adapter_id)
    baseline_created = _capture_published_adapter_baseline(safe_adapter)
    try:
        had_snapshot = _snapshot_existing_adapter(safe_adapter)
    except Exception:
        if baseline_created:
            _discard_published_adapter_baseline(safe_adapter)
        raise
    try:
        _install_revision_to_adapters(rev)
    except Exception as exc:
        _rollback_failed_adapter_install(
            safe_adapter,
            had_snapshot=had_snapshot,
            original_exc=exc,
        )
        if baseline_created:
            _discard_published_adapter_baseline(safe_adapter)
        raise
    sha = package_sha256
    try:
        _db.update_script_revision(
            rev_id, status="published", adapter_id=safe_adapter,
            target_adapter_id=safe_adapter, test_adapter_id=None,
            tested_sha256=package_sha256, source_sha256=sha,
        )
    except Exception as exc:
        _rollback_failed_adapter_install(
            safe_adapter,
            had_snapshot=had_snapshot,
            original_exc=exc,
        )
        if baseline_created:
            _discard_published_adapter_baseline(safe_adapter)
        raise
    if test_adapter_id:
        from core import adapter_loader as _al
        try:
            _al.uninstall(test_adapter_id)
        except Exception as exc:  # noqa: BLE001
            # 正式包和数据库状态已经提交；保留审计告警，清除智能体数据仍会清理 review-*。
            print(f"[agent] 测试适配器 {test_adapter_id} 发布后清理失败: {exc}", flush=True)
    _discard_adapter_snapshot(safe_adapter)
    return {"ok": True, "status": "published", "path": draft and str(draft),
            "adapter_id": safe_adapter, "task_id": task_id,
            "files": published_files,
            "source_sha256": sha,
            "message": f"已固化到抓虾脚本库:任务 {task_id} 可复用(tasks_search 可见)"}


def build_agent_mcp_asgi(token_provider, context_acquirer=None,
                         context_releaser=None, context_binder=None,
                         context_resetter=None) -> Any:
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
            path = str(request.url.path or "")
            if path == "/context/acquire" and request.method == "POST":
                if context_acquirer is None:
                    return JSONResponse({"detail": "Context leasing unavailable"}, status_code=503)
                try:
                    body = await request.json()
                    lease = await context_acquirer(
                        str(body.get("runtime_session_id") or ""),
                        str(body.get("call_id") or ""),
                    )
                    return JSONResponse({"ok": True, **lease})
                except LookupError as exc:
                    return JSONResponse({"detail": str(exc)}, status_code=409)
                except Exception as exc:  # noqa: BLE001
                    return JSONResponse({"detail": str(exc)}, status_code=500)
            if path == "/context/release" and request.method == "POST":
                if context_releaser is None:
                    return JSONResponse({"detail": "Context leasing unavailable"}, status_code=503)
                try:
                    body = await request.json()
                    released = bool(context_releaser(str(body.get("lease_id") or "")))
                except Exception as exc:  # noqa: BLE001
                    return JSONResponse({"detail": str(exc)}, status_code=500)
                if not released:
                    return JSONResponse({"detail": "Unknown context lease"}, status_code=409)
                return JSONResponse({"ok": True, "released": True})
            context_token = None
            if path == "/mcp":
                lease_id = str(request.headers.get("x-crawshrimp-mcp-lease") or "").strip()
                if lease_id:
                    if context_binder is None or context_resetter is None:
                        return JSONResponse({"detail": "Context leasing unavailable"}, status_code=503)
                    try:
                        context_token = context_binder(lease_id)
                    except LookupError as exc:
                        return JSONResponse({"detail": str(exc)}, status_code=409)
                    except Exception as exc:  # noqa: BLE001
                        return JSONResponse({"detail": str(exc)}, status_code=500)
                try:
                    return await call_next(request)
                finally:
                    if context_token is not None:
                        context_resetter(context_token)
            return await call_next(request)

    return McpBearerAuth(inner)
