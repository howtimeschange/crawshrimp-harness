"""智能体服务编排:队列、Run 状态机、事件投影、审批、SSE 扇出、Worker 监督。

全局单 Active Agent Run(窄 spec §7.2);业务 Task Instance 不受此限制。
"""
from __future__ import annotations

import asyncio
import json
import os
import secrets
import uuid
from pathlib import Path
from typing import Any, Optional

from core import data_sink
from core.agent import db
from core.agent import mcp_gateway
from core.agent.cordis_config import build_cordis_yaml, resolve_provider_for_model, model_capabilities
from core.agent.worker import AgentWorker, resolve_harness_root, resolve_node_executable
from core.config import load_config

APPROVAL_WAIT_SECONDS = 15 * 60

# 不写入产品事件表的 Harness 事件(窄 spec §7.1)
FILTERED_EVENT_TYPES = {"request/header", "request/context"}

RUN_FINAL_STATUSES = {"completed", "failed", "canceled", "interrupted"}

# 分级预算(方案 §11):按 Run 类型;worker 侧计数执行
BUDGET_PROFILES = {
    "browser": {"maxSteps": 80, "maxToolCalls": 120, "maxObserve": 40, "maxAct": 50,
                "wallclockMs": 30 * 60 * 1000},
    "default": {"maxSteps": 30, "maxToolCalls": 40, "maxObserve": 5, "maxAct": 0,
                "wallclockMs": 15 * 60 * 1000},
}


def _data_root() -> Path:
    import os as _os
    env = _os.environ.get("CRAWSHRIMP_DATA", "").strip()
    if env:
        return Path(env)
    return Path.home() / ".crawshrimp" / "data"


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _iso_after(seconds: int) -> str:
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


class AgentService:
    def __init__(self) -> None:
        self.main_loop: Optional[asyncio.AbstractEventLoop] = None
        self.worker: Optional[AgentWorker] = None
        self.generation = 0
        self.runtime_token = secrets.token_hex(32)  # 256-bit
        self.runtime_state = "stopped"  # stopped|starting|ready|crashed|disabled_until_manual_restart
        self.runtime_error = ""
        self.crash_budget: list[float] = []

        self.queue: asyncio.Queue[dict] = asyncio.Queue()
        self.active_run: Optional[dict] = None          # run 行
        self.active_run_task: Optional[asyncio.Task] = None
        self.queue_task: Optional[asyncio.Task] = None

        self.approval_waits: dict[str, asyncio.Future] = {}
        self.subscribers: dict[str, set[asyncio.Queue]] = {}
        self.global_subscribers: set[asyncio.Queue] = set()

        self._mcp_app = None
        self._mcp_uvicorn = None
        self._mcp_task: Optional[asyncio.Task] = None
        self.mcp_port = 0
        self.mcp_url = "http://127.0.0.1:18965/mcp"
        self.generation_model: Optional[str] = None
        self._callbacks: dict[str, Any] = {}

    # ---------- 初始化 / 恢复 ----------

    def bind_callbacks(self, **callbacks: Any) -> None:
        self._callbacks.update(callbacks)
        mcp_gateway.ctx.main_loop = self.main_loop
        mcp_gateway.ctx.create_task_instance = callbacks.get("create_task_instance")
        mcp_gateway.ctx.run_task_instance = callbacks.get("run_task_instance")
        mcp_gateway.ctx.control_task_instance = callbacks.get("control_task_instance")
        mcp_gateway.ctx.get_task_instance = callbacks.get("get_task_instance")
        mcp_gateway.ctx.list_task_artifacts = callbacks.get("list_task_artifacts")
        mcp_gateway.ctx.read_artifact_bytes = callbacks.get("read_artifact_bytes")
        mcp_gateway.ctx.write_artifact = callbacks.get("write_artifact")
        mcp_gateway.ctx.request_approval = self.request_approval
        mcp_gateway.ctx.emit_event = lambda event_type, payload: None

    async def start(self) -> None:
        self.main_loop = asyncio.get_event_loop()
        mcp_gateway.ctx.main_loop = self.main_loop
        try:
            import faulthandler
            import signal
            faulthandler.register(signal.SIGUSR1, all_threads=True)  # 诊断用:kill -USR1 转储全部栈
        except Exception:  # noqa: BLE001
            pass
        self._recover_on_startup()
        self.queue_task = asyncio.create_task(self._queue_loop())
        data_root = _data_root()
        (data_root / "agent").mkdir(parents=True, exist_ok=True)
        (data_root / "agent" / "workspace").mkdir(parents=True, exist_ok=True)
        (data_root / "agent" / "runtime-workdir").mkdir(parents=True, exist_ok=True)
        mcp_gateway.ctx.workspace_root = data_root / "agent" / "workspace"
        await self._start_mcp_server()

    async def _start_mcp_server(self) -> None:
        import os as _os
        import uvicorn
        from core.agent import api as agent_api
        base_port = int(_os.environ.get("CRAWSHRIMP_PORT", "18765"))
        # API 端口有 +1..+100 的回退区间(main.js findAvailableApiPort),
        # MCP 端口取 API 端口 + 200,保证永不落入回退区间且实例间唯一。
        port = int(_os.environ.get("CRAWSHRIMP_AGENT_MCP_PORT", str(base_port + 200)))
        self.mcp_port = port
        self.mcp_url = f"http://127.0.0.1:{port}/mcp"
        app = agent_api.build_agent_mcp_asgi(lambda: self.runtime_token)
        config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
        self._mcp_uvicorn = uvicorn.Server(config)
        self._mcp_task = asyncio.create_task(self._mcp_uvicorn.serve())
        print(f"[agent] MCP gateway listening on {self.mcp_url}", flush=True)

    async def _stop_mcp_server(self) -> None:
        if getattr(self, "_mcp_uvicorn", None) is not None:
            self._mcp_uvicorn.should_exit = True
            try:
                await asyncio.wait_for(asyncio.shield(self._mcp_task), timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):  # noqa: BLE001
                self._mcp_task.cancel()
            self._mcp_uvicorn = None
            self._mcp_task = None

    async def stop(self) -> None:
        if self.queue_task:
            self.queue_task.cancel()
            self.queue_task = None
        if self.active_run_task:
            self.active_run_task.cancel()
            self.active_run_task = None
        await self._stop_worker()
        await self._stop_mcp_server()
        for fut in self.approval_waits.values():
            if not fut.done():
                fut.set_result("canceled")
        self.approval_waits.clear()

    def _recover_on_startup(self) -> None:
        for run in db.list_nonterminal_runs():
            db.update_run(run["run_id"], status="interrupted", finished_at=_now_iso(),
                          error_code="AGENT_DISPATCH_INTERRUPTED")
        canceled = db.cancel_pending_approvals()
        if canceled:
            print(f"[agent] 启动恢复:取消 {canceled} 条 pending 审批")

    # ---------- 事件订阅 ----------

    def subscribe(self, session_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self.subscribers.setdefault(session_id, set()).add(queue)
        return queue

    def unsubscribe(self, session_id: str, queue: asyncio.Queue) -> None:
        subs = self.subscribers.get(session_id)
        if subs:
            subs.discard(queue)

    def subscribe_all(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self.global_subscribers.add(queue)
        return queue

    def unsubscribe_all(self, queue: asyncio.Queue) -> None:
        self.global_subscribers.discard(queue)

    async def broadcast(self, session_id: str, seq: int, event_type: str, payload: Any) -> None:
        message = {"seq": seq, "event_type": event_type, "payload": payload}
        for queue in list(self.subscribers.get(session_id, ())):
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                pass
        # 全局事件流(DSH Web 视图等无会话绑定消费方):payload 注入 session_id
        if isinstance(payload, dict) and "session_id" not in payload:
            payload = {**payload, "session_id": session_id}
        gmessage = {"seq": seq, "event_type": event_type, "payload": payload}
        for queue in list(self.global_subscribers):
            try:
                queue.put_nowait(gmessage)
            except asyncio.QueueFull:
                pass

    # ---------- 提交轮次 ----------

    async def submit_turn(self, session_id: str, text: str,
                          context_refs: Optional[list[dict]] = None,
                          attachment_ids: Optional[list[str]] = None,
                          grant_prefs: Optional[dict] = None) -> dict:
        session = db.get_session(session_id)
        if not session:
            raise ValueError(f"会话不存在: {session_id}")
        turn_id = f"turn-{uuid.uuid4().hex[:12]}"
        run_id = f"run-{uuid.uuid4().hex[:12]}"
        message_id = f"msg-{uuid.uuid4().hex[:12]}"
        ordinal = db.next_turn_ordinal(session_id)

        # 附件:登记到本轮,并向模型注入提示
        final_text = text
        for aid in (attachment_ids or []):
            row = db.get_attachment(str(aid or "").strip())
            if row and row.get("session_id") == session_id:
                db.create_attachment(f"{row['attachment_id']}:{turn_id}", session_id, turn_id, run_id,
                                     row["filename"], row["path"], row["mime"], row["size"])
        if attachment_ids:
            names = []
            for aid in attachment_ids:
                row = db.get_attachment(str(aid or "").strip())
                if row:
                    names.append(f"- {row['filename']}(attachment_id={row['attachment_id']})")
            if names:
                final_text = "用户上传了附件,可用 attachment_read 工具读取:\n" + "\n".join(names) + "\n\n" + text

        db.create_message(message_id, session_id, turn_id, run_id, "user", "text", {"text": text})
        turn = db.create_turn(turn_id, session_id, ordinal, message_id)
        model_id, provider_id = self._resolve_model(session_id)
        run = db.create_run(run_id, session_id, turn_id, provider_id, model_id)
        db.update_turn(turn_id, active_run_id=run_id)
        db.update_session(session_id, status="running")

        await self.broadcast(session_id, 0, "turn.queued", {
            "turn_id": turn_id, "run_id": run_id, "ordinal": ordinal,
            "queue_depth": self.queue.qsize(),
        })
        await self.queue.put({
            "run_id": run_id, "session_id": session_id, "turn_id": turn_id,
            "text": final_text, "message_id": message_id, "model_id": model_id,
            "provider_id": provider_id, "context_refs": context_refs or [],
            "grant_prefs": grant_prefs or {},
        })
        return {"turn_id": turn_id, "run_id": run_id, "queued": True,
                "queue_depth": self.queue.qsize() + (1 if self.active_run else 0)}

    def _resolve_model(self, session_id: Optional[str] = None) -> tuple[str, str]:
        cfg = load_config()
        llm = (cfg.get("ai") or {}).get("llm") or {}
        model_id = llm.get("default_model") or "gpt-5.6-terra"
        if session_id:
            session = db.get_session(session_id)
            if session and session.get("model_id"):
                model_id = session["model_id"]
        if not model_capabilities(model_id).get("supports_tools"):
            model_id = "gpt-5.6-terra"
        return model_id, resolve_provider_for_model(model_id)

    def note_model_changed(self, session_id: str, model_id: str) -> None:
        """会话模型切换后,下一 Run 前重启 generation(Worker 不变量:不混用模型)。"""
        print(f"[agent] session {session_id} 模型切换为 {model_id},下一轮生效", flush=True)

    # ---------- 队列循环 ----------

    async def _queue_loop(self) -> None:
        while True:
            item = await self.queue.get()
            try:
                if self.active_run is not None:
                    await self.queue.put(item)  # 放回队尾重排(理论上不会发生,单消费者)
                    await asyncio.sleep(0.2)
                    continue
                await self._run_one(item)
            except Exception as exc:  # noqa: BLE001
                import traceback
                traceback.print_exc()
                try:
                    db.update_run(item.get("run_id"), status="failed", finished_at=_now_iso(),
                                  error_code="INTERNAL_ERROR", error_message=str(exc)[:500])
                    db.update_turn(item.get("turn_id"), status="failed", completed_at=_now_iso())
                    await self.broadcast(item.get("session_id"), 0, "run.failed",
                                         {"run_id": item.get("run_id"), "error": str(exc)[:300]})
                except Exception:  # noqa: BLE001
                    pass
                self.active_run = None
                mcp_gateway.ctx.active_run = None
                mcp_gateway.ctx.grant = None

    async def _run_one(self, item: dict) -> None:
        run_id, session_id, turn_id = item["run_id"], item["session_id"], item["turn_id"]
        run = db.get_run(run_id)
        if not run or run["status"] in RUN_FINAL_STATUSES:
            return
        self.active_run = run
        db.update_run(run_id, status="starting", started_at=_now_iso())
        db.update_turn(turn_id, status="running")
        await self.broadcast(session_id, 0, "run.started", {"run_id": run_id, "turn_id": turn_id})

        mcp_gateway.ctx.active_run = db.get_run(run_id)
        # 同步 HTTP(CDP bridge)不得阻塞事件循环 → to_thread
        mcp_gateway.ctx.grant = await asyncio.to_thread(self._grant_for_run, item)

        try:
            generation_ok = await self._ensure_generation(item)
            if not generation_ok:
                raise RuntimeError(self.runtime_error or "runtime 启动失败")

            budget = BUDGET_PROFILES["browser"] if self._is_browser_run(item) else BUDGET_PROFILES["default"]
            summary = await self.worker.request("worker.run", {
                "runId": run_id,
                "sessionId": self._runtime_session_id(session_id),
                "text": item["text"],
                "budget": budget,
            }, timeout=30 * 60 + 60)

            result = (summary or {}).get("summary") or {}

            # DSH 持久化不变量:runtime 重启后,旧 runtime_session_id 与既有日志不匹配
            # (id collision)。产品行为:轮换 runtime_session_id 并重试一次,提示上下文不可恢复。
            if result.get("status") == "failed" and _is_session_collision(result):
                import uuid as _uuid
                new_sid = f"dsh-{_uuid.uuid4().hex}"
                db.update_session(session_id, runtime_session_id=new_sid, continuation_available=0)
                notice = "智能体运行时已重启,上一轮对话上下文无法继续恢复;已开启新上下文继续本轮。"
                db.create_message(f"{run_id}:notice", session_id, turn_id, run_id, "system", "notice", {"text": notice})
                await self.broadcast(session_id, 0, "session.updated",
                                     {"session_id": session_id, "notice": notice, "new_context": True})
                summary = await self.worker.request("worker.run", {
                    "runId": run_id,
                    "sessionId": new_sid,
                    "text": item["text"],
                    "budget": budget,
                }, timeout=30 * 60 + 60)
                result = (summary or {}).get("summary") or {}
            status = result.get("status")
            if status not in RUN_FINAL_STATUSES:
                status = "failed"
            db.update_run(run_id, status=status, finished_at=_now_iso(),
                          dsh_message_id=result.get("messageId"),
                          dsh_start_seq=result.get("dsh_start_seq") or 0,
                          dsh_end_seq=result.get("dsh_end_seq") or 0,
                          error_code=None if status == "completed" else (result.get("reason") or {}).get("error", {}).get("code") if isinstance(result.get("reason"), dict) else None,
                          error_message=None if status == "completed" else json.dumps(result.get("reason"), ensure_ascii=False)[:500])
            db.update_turn(turn_id, status=status, completed_at=_now_iso())
            event_type = {"completed": "run.completed", "failed": "run.failed",
                          "canceled": "run.canceled", "interrupted": "run.interrupted"}[status]
            await self.broadcast(session_id, 0, event_type, {"run_id": run_id, "status": status})
        except Exception as exc:  # noqa: BLE001
            db.update_run(run_id, status="failed", finished_at=_now_iso(),
                          error_code="WORKER_ERROR", error_message=str(exc)[:500])
            db.update_turn(turn_id, status="failed", completed_at=_now_iso())
            await self.broadcast(session_id, 0, "run.failed", {"run_id": run_id, "error": str(exc)[:300]})
            self._note_crash(str(exc))
            if status == "completed":
                await self._broadcast_run_artifacts(run_id, session_id)
        finally:
            mcp_gateway.ctx.active_run = None
            mcp_gateway.ctx.grant = None
            self.active_run = None
            db.update_session(session_id, status="idle")
            await self.broadcast(session_id, 0, "session.updated", {"session_id": session_id, "status": "idle"})

    @staticmethod
    def _is_browser_run(item: dict) -> bool:
        refs = item.get("context_refs") or []
        return any(r.get("type") == "browser_tab" for r in refs)

    def _runtime_session_id(self, session_id: str) -> str:
        session = db.get_session(session_id)
        return session["runtime_session_id"] if session else session_id

    def _grant_for_run(self, item: dict) -> Optional[dict]:
        refs = item.get("context_refs") or []
        tab_ref = next((r for r in refs if r.get("type") == "browser_tab"), None)
        if not tab_ref:
            return None
        from core.cdp_bridge import get_bridge
        try:
            tabs = get_bridge().get_tabs(timeout=2)
        except Exception:  # noqa: BLE001
            tabs = []
        pages = [t for t in tabs if t.get("type") == "page"]
        if not pages:
            return None
        tab = pages[0]
        url = str(tab.get("url") or "")
        prefix = url[: url.find("/", url.find("//") + 3)] if url else ""
        grant_id = f"grant-{uuid.uuid4().hex[:12]}"
        toolset = ["observe", "eval", "verify", "capture_requests"]
        prefs = item.get("grant_prefs") or {}
        pref_toolset = prefs.get("toolset")
        if isinstance(pref_toolset, list):
            for entry in pref_toolset:
                if entry not in toolset:
                    toolset.append(entry)
        return db.create_grant(grant_id, item["run_id"], prefix or None, str(tab.get("id")),
                               toolset, _iso_after(3600))

    # ---------- runtime generation ----------

    async def _ensure_generation(self, item: dict) -> bool:
        if (self.worker is not None and self.runtime_state == "ready"
                and self.generation_model == item.get("model_id")):
            return True
        return await self.start_generation(item["provider_id"], item["model_id"])

    async def start_generation(self, provider_id: Optional[str] = None,
                               model_id: Optional[str] = None) -> bool:
        await self._stop_worker()
        self.generation += 1
        self.runtime_state = "starting"
        self.runtime_error = ""

        if model_id is None:
            model_id, provider_id = self._resolve_model()
        if provider_id is None:
            provider_id = resolve_provider_for_model(model_id)

        # API key 进入进程环境(不落盘)
        cfg = load_config()
        llm = (cfg.get("ai") or {}).get("llm") or {}
        api_key = os.environ.get("CRAWSHRIMP_LLM_API_KEY", "").strip() or str(llm.get("api_key") or "").strip()
        if api_key:
            os.environ["CRAWSHRIMP_LLM_API_KEY"] = api_key

        # 轮换 runtime token
        self.runtime_token = secrets.token_hex(32)
        os.environ["CRAWSHRIMP_MCP_TOKEN"] = self.runtime_token

        # Web host 端口与网关 baseURL:web-cordis.yml 经 !!js 环境表达式读取。
        # Web host 端口取 MCP 端口 + 100(API+300),避开 main.js 端口回退区间。
        self.web_port = getattr(self, "web_port", 0) or (self.mcp_port + 100)
        os.environ["CRAWSHRIMP_WEB_PORT"] = str(self.web_port)
        base = (cfg.get("ai") or {}).get("llm") or {}
        for env_key, cfg_key, default in (
            ("CRAWSHRIMP_OVERSEAS_OPENAI_BASE_URL", "overseas_openai_base_url", None),
            ("CRAWSHRIMP_OVERSEAS_ANTHROPIC_BASE_URL", "overseas_anthropic_base_url", None),
            ("CRAWSHRIMP_DOMESTIC_OPENAI_BASE_URL", "domestic_base_url", None),
        ):
            value = str(base.get(cfg_key) or "").strip()
            if value:
                os.environ[env_key] = value

        data_root = _data_root()
        agent_dir = data_root / "agent"
        # runtime cordis 必须写在 harness root(node_modules 旁):
        # dsh-app-boot 以 config 所在目录为模块解析基准(ctx.baseUrl),
        # 写进 data 目录会导致 client 插件包(bare import)解析失败,web BOOT entries 为空。
        harness_root = resolve_harness_root()
        cordis_path = harness_root / "runtime-cordis.yml"
        try:
            cordis_path.write_text(build_cordis_yaml(cfg, model_id), encoding="utf-8")
        except OSError as exc:
            print(f"[agent] 无法写入 {cordis_path}({exc}),回退 data 目录", flush=True)
            cordis_path = agent_dir / "runtime-cordis.yml"
            cordis_path.write_text(build_cordis_yaml(cfg, model_id), encoding="utf-8")

        worker = AgentWorker(
            runtime_root=str(resolve_harness_root()),
            data_root=str(data_root),
            cordis_path=str(cordis_path),
            mcp_url=getattr(self, "mcp_url", "http://127.0.0.1:18965/mcp"),
            session_root=str(agent_dir / "harness-sessions"),
            on_notification=self._on_worker_notification,
        )
        try:
            await worker.start()
            init = await worker.request("worker.initialize", {
                "runtimeRoot": str(resolve_harness_root()),
                "dataRoot": str(data_root),
                "cordisPath": str(cordis_path),
                "mcpUrl": getattr(self, "mcp_url", "http://127.0.0.1:18965/mcp"),
                "sessionRoot": str(agent_dir / "harness-sessions"),
            }, timeout=20)
            if not init.get("ok"):
                raise RuntimeError(f"worker.initialize 失败: {init}")
            gen = await worker.request("worker.start_generation", {
                "generation": self.generation,
                "provider": provider_id,
                "model": model_id,
                "maxTokens": model_capabilities(model_id).get("max_output_tokens", 8192),
                "cwd": str(agent_dir / "runtime-workdir"),
            }, timeout=120)
            if not gen.get("ok"):
                raise RuntimeError(f"start_generation 失败: {gen}")
            self.worker = worker
            self.runtime_state = "ready"
            self.generation_model = model_id
            return True
        except Exception as exc:  # noqa: BLE001
            self.runtime_error = str(exc)
            self.runtime_state = "crashed"
            await worker.stop()
            self._note_crash(str(exc))
            return False

    def _note_crash(self, message: str) -> None:
        import time as _time
        now = _time.monotonic()
        self.crash_budget = [t for t in self.crash_budget if now - t < 300]
        self.crash_budget.append(now)
        print(f"[agent] runtime 异常: {message}", flush=True)
        if len(self.crash_budget) >= 3:
            self.runtime_state = "disabled_until_manual_restart"
            print("[agent] 连续崩溃超过预算,runtime 进入 disabled_until_manual_restart", flush=True)

    async def _stop_worker(self) -> None:
        if self.worker is not None:
            try:
                await self.worker.stop()
            except Exception:  # noqa: BLE001
                pass
            self.worker = None
        self.runtime_state = "stopped"

    async def restart_runtime(self) -> dict:
        if self.active_run is not None:
            return {"ok": False, "error": "ACTIVE_RUN", "message": "存在 active run,无法重启"}
        ok = await self.start_generation()
        return {"ok": ok, "state": self.runtime_state, "error": self.runtime_error}

    def runtime_status(self) -> dict:
        cfg = load_config()
        llm = (cfg.get("ai") or {}).get("llm") or {}
        import os as _os
        web_port = getattr(self, "web_port", 0) or int(_os.environ.get("CRAWSHRIMP_WEB_PORT", "0") or 0)
        return {
            "enabled": _os.environ.get("CRAWSHRIMP_AGENT_ENABLED", "1") not in ("0", "false", "no"),
            "state": self.runtime_state,
            "generation": self.generation,
            "model": llm.get("default_model") or "gpt-5.6-terra",
            "api_key_configured": bool(os.environ.get("CRAWSHRIMP_LLM_API_KEY") or llm.get("api_key")),
            "active_run": (self.active_run or {}).get("run_id"),
            "queue_depth": self.queue.qsize(),
            "error": self.runtime_error,
            "node_executable": resolve_node_executable(),
            # DSH web host(方案 §12.7):前端 iframe 嵌入的页面地址
            "web_port": web_port,
            "web_url": f"http://127.0.0.1:{web_port}/" if web_port else "",
        }

    async def _broadcast_run_artifacts(self, run_id: str, session_id: str) -> None:
        """任务执行完成后,把产物以附件形式推送到聊天(流程 1)。"""
        if not mcp_gateway.ctx.list_task_artifacts:
            return
        import json as _json
        import os as _os
        with db._lock:
            conn = db._conn()
            try:
                calls = [dict(r) for r in conn.execute(
                    "SELECT * FROM agent_tool_calls WHERE run_id = ? AND status = 'succeeded'", (run_id,)).fetchall()]
            finally:
                conn.close()
        seen: set[str] = set()
        for call in calls:
            try:
                envelope = _json.loads(call.get("result_json") or "{}")
            except (TypeError, ValueError):
                continue
            envelope = envelope.get("text") if isinstance(envelope, dict) else None
            if isinstance(envelope, str):
                try:
                    envelope = _json.loads(envelope)
                except ValueError:
                    continue
            evidence = (envelope or {}).get("evidence") or {}
            uid = evidence.get("task_instance_uid")
            if not uid or uid in seen:
                continue
            seen.add(uid)
            for artifact in (mcp_gateway.ctx.list_task_artifacts(uid) or []):
                path = artifact.get("path") or ""
                size = 0
                if path:
                    try:
                        size = _os.path.getsize(path)
                    except OSError:
                        size = 0
                await self.broadcast(session_id, _seq(session_id), "artifact.created", {
                    "artifact_id": artifact.get("id"),
                    "filename": artifact.get("label") or (path.split("/")[-1] if path else ""),
                    "kind": artifact.get("kind") or "",
                    "path": path,
                    "size": size,
                    "task_instance_uid": uid,
                })

    # ---------- Worker 事件投影 ----------

    async def _on_worker_notification(self, method: str, params: dict) -> None:
        if method == "worker.status":
            state = params.get("status")
            if state in ("ready", "starting", "stopping", "stopped", "crashed"):
                self.runtime_state = state
            if state == "crashed":
                self.runtime_error = str(params.get("message", ""))[:300]
                self._note_crash(self.runtime_error)
            return
        if method != "harness.notification":
            return
        run_id = params.get("runId")
        event = params.get("event") or {}
        run = db.get_run(run_id) if run_id else None
        if not run:
            return
        session_id = run["session_id"]
        await self._project_event(session_id, run, event)

    async def _project_event(self, session_id: str, run: dict, event: dict) -> None:
        event_type = event.get("type") or "unknown"
        data = event.get("data") or {}
        dsh_seq = int(event.get("seq") or 0)
        run_id = run["run_id"]

        if dsh_seq:
            db.update_run(run_id, dsh_end_seq=max(int(run.get("dsh_end_seq") or 0), dsh_seq))

        if event_type in FILTERED_EVENT_TYPES:
            return

        if event_type == "assistant/chunk":
            delta = _extract_text(data)
            if delta:
                message_id = f"{run_id}:assistant"
                existing = _get_message_by_id(message_id)
                if existing:
                    content = json.loads(existing["content_json"])
                    content["text"] = (content.get("text") or "") + delta
                    db.update_message(message_id, content_json=content)
                else:
                    db.create_message(message_id, session_id, run.get("turn_id"), run_id,
                                      "assistant", "text", {"text": delta}, status="streaming")
                await self.broadcast(session_id, _seq(session_id), "assistant.delta",
                                     {"run_id": run_id, "delta": delta})
            return

        if event_type == "assistant/message":
            text = _extract_text(data)
            if text:
                message_id = f"{run_id}:assistant"
                existing = _get_message_by_id(message_id)
                if existing:
                    db.update_message(message_id, content_json={"text": text}, status="complete",
                                      completed_at=_now_iso())
                else:
                    db.create_message(message_id, session_id, run.get("turn_id"), run_id,
                                      "assistant", "text", {"text": text})
                await self.broadcast(session_id, _seq(session_id), "assistant.completed",
                                     {"run_id": run_id, "text": text})
            return

        if event_type == "tool/call":
            call = db.upsert_tool_call(run_id, data.get("callId") or str(uuid.uuid4()),
                                       data.get("name") or "unknown",
                                       _parse_args(data.get("arguments")))
            await self.broadcast(session_id, _seq(session_id), "tool.requested", {
                "tool_call_id": call["tool_call_id"],
                "tool_name": call["tool_name"],
                "arguments": _parse_args(data.get("arguments")),
            })
            return

        if event_type == "tool/result":
            result_text = _extract_tool_result_text(data)
            call_id = _extract_tool_call_id(data)
            if call_id:
                tool_call = db.get_tool_call(run_id, call_id)
                if tool_call:
                    db.update_tool_call(tool_call["tool_call_id"], result_json={"text": result_text[:4000]},
                                        status="succeeded", finished_at=_now_iso())
                await self.broadcast(session_id, _seq(session_id), "tool.completed", {
                    "run_id": run_id, "dsh_call_id": call_id, "result": redact_text(result_text)[:2000],
                })
            return

        if event_type == "turn/end":
            reason = data.get("reason") or {}
            kind = reason.get("kind") or "error"
            if kind == "completed":
                return  # run.completed 由 _run_one 收尾广播
            error_code = None
            if isinstance(reason.get("error"), dict):
                error_code = reason["error"].get("code")
            await self.broadcast(session_id, _seq(session_id), "run.failed", {
                "run_id": run_id, "kind": kind, "error_code": error_code,
            })
            return

        if event_type == "session/title":
            title = str(data.get("title") or "").strip()[:80]
            session = db.get_session(session_id)
            if title and session and session.get("title") in ("", "新会话"):
                db.update_session(session_id, title=title)
                await self.broadcast(session_id, _seq(session_id), "session.updated",
                                     {"session_id": session_id, "title": title})
            return

        if event_type in ("user/message", "step/start", "step/end", "agent/inbox/spliced", "turn/start"):
            return

        # 其他事件:仅投影类型,不存完整 payload
        db.append_event(session_id, run_id, event_type, {"seq": dsh_seq})
        await self.broadcast(session_id, _seq(session_id), event_type, {"run_id": run_id, "seq": dsh_seq})

    # ---------- 审批 ----------

    async def request_approval(self, tool_call: Optional[dict], plan: dict, summary: dict,
                               risk: str) -> str:
        import hashlib
        approval_id = f"apv-{uuid.uuid4().hex[:12]}"
        params_hash = hashlib.sha256(
            json.dumps(summary, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        db.create_approval(approval_id, plan.get("plan_id") or "control", None, summary, risk,
                           params_hash, _iso_after(APPROVAL_WAIT_SECONDS))
        run = self.active_run or {}
        session_id = (run or {}).get("session_id") or ""
        if session_id:
            await self.broadcast(session_id, _seq(session_id), "tool.approval_required", {
                "approval_id": approval_id,
                "summary": summary,
                "risk": risk,
                "run_id": run.get("run_id"),
            })
        loop = asyncio.get_event_loop()
        future: asyncio.Future = loop.create_future()
        self.approval_waits[approval_id] = future
        try:
            decision = await asyncio.wait_for(future, timeout=APPROVAL_WAIT_SECONDS)
            return decision
        except asyncio.TimeoutError:
            db.decide_approval(approval_id, "expired", "timeout")
            return "expired"
        finally:
            self.approval_waits.pop(approval_id, None)

    def decide_approval(self, approval_id: str, decision: str) -> dict:
        approval = db.get_approval(approval_id)
        if not approval:
            return {"ok": False, "error": "NOT_FOUND"}
        if approval["status"] != "pending":
            if approval["status"] == decision:
                return {"ok": True, "idempotent": True, "status": approval["status"]}
            return {"ok": False, "error": "CONFLICT", "status": approval["status"]}
        db.decide_approval(approval_id, decision, "user")
        future = self.approval_waits.get(approval_id)
        if future and not future.done():
            future.set_result(decision)
        return {"ok": True, "status": decision}

    # ---------- 取消 ----------

    async def cancel_run(self, run_id: str) -> dict:
        run = db.get_run(run_id)
        if not run:
            return {"ok": False, "error": "NOT_FOUND"}
        if run["status"] == "queued":
            # 从队列取消(惰性:标记 canceled,出队时跳过)
            db.update_run(run_id, status="canceled", finished_at=_now_iso())
            db.update_turn(run.get("turn_id") or "", status="canceled", completed_at=_now_iso())
            await self.broadcast(run["session_id"], 0, "run.canceled", {"run_id": run_id})
            return {"ok": True, "status": "canceled"}
        if run["status"] in RUN_FINAL_STATUSES:
            return {"ok": True, "status": run["status"], "idempotent": True}
        if self.active_run and self.active_run["run_id"] == run_id and self.worker:
            result = await self.worker.request("worker.cancel_active", {"runId": run_id}, timeout=15)
            db.update_run(run_id, status="canceled", finished_at=_now_iso())
            db.update_turn(run.get("turn_id") or "", status="canceled", completed_at=_now_iso())
            await self.broadcast(run["session_id"], 0, "run.canceled", {"run_id": run_id})
            return {"ok": True, "status": "canceled"}
        return {"ok": False, "error": "NOT_ACTIVE"}


def _is_session_collision(result: dict) -> bool:
    reason = result.get("reason") or {}
    error = reason.get("error") if isinstance(reason, dict) else None
    message = str((error or {}).get("message") or "") if isinstance(error, dict) else ""
    return "persisted log" in message or "id collision" in message


def _seq(session_id: str) -> int:
    row = db.get_session(session_id)
    return int((row or {}).get("last_event_seq") or 0)


def _extract_text(data: dict) -> str:
    if isinstance(data, dict):
        chunk = data.get("chunk") if isinstance(data.get("chunk"), dict) else None
        if chunk:
            if chunk.get("type") == "text-delta":
                return str(chunk.get("text") or "")
            if chunk.get("type") == "block-end" and isinstance(chunk.get("block"), dict):
                return str(chunk["block"].get("text") or "")
        if isinstance(data.get("text"), str):
            return data["text"]
        content = data.get("message", {}).get("content") if isinstance(data.get("message"), dict) else None
        if isinstance(content, list):
            return "".join(str(b.get("text") or "") for b in content if isinstance(b, dict))
    return ""


import re as _re

_REDACT_PATTERNS = [
    (_re.compile(r"(Bearer\s+)[A-Za-z0-9._\-]{16,}"), r"\1***"),
    (_re.compile(r"(sk-[A-Za-z0-9]{8,})"), "sk-***"),
    (_re.compile(r"(api[_-]?key[\"']?\s*[:=]\s*[\"']?)[A-Za-z0-9]{16,}"), r"\1***"),
    (_re.compile(r"(authorization[\"']?\s*[:=]\s*[\"']?)[^\"',\s]{16,}"), r"\1***"),
    (_re.compile(r"(cookie[\"']?\s*[:=]\s*[\"']?)[^\"',\s]{16,}"), r"\1***"),
    (_re.compile(r"(token[\"']?\s*[:=]\s*[\"']?)[A-Za-z0-9._\-]{24,}"), r"\1***"),
]


def redact_text(text: str) -> str:
    """对可能包含密钥/Cookie/Authorization 的文本做模式脱敏(注入防御第一道)。"""
    if not text:
        return ""
    out = str(text)
    for pattern, repl in _REDACT_PATTERNS:
        out = pattern.sub(repl, out)
    return out


def _extract_tool_call_id(data: dict) -> Optional[str]:
    if isinstance(data, dict):
        source = data.get("message", {}).get("source") if isinstance(data.get("message"), dict) else None
        if isinstance(source, dict) and source.get("callId"):
            return str(source["callId"])
        if data.get("callId"):
            return str(data["callId"])
    return None


def _extract_tool_result_text(data: dict) -> str:
    """tool/result → 结构化返回封装的 {ok,status,data,error,evidence} 文本。"""
    if isinstance(data, dict):
        content = data.get("message", {}).get("content") if isinstance(data.get("message"), dict) else None
        if isinstance(content, list):
            texts = []
            for block in content:
                if not isinstance(block, dict) or block.get("type") != "tool-result":
                    continue
                inner = block.get("content")
                if isinstance(inner, list):
                    for b in inner:
                        if isinstance(b, dict) and b.get("type") == "text":
                            texts.append(str(b.get("text") or ""))
                elif isinstance(inner, str):
                    texts.append(inner)
            return "\n".join(t for t in texts if t)
    return ""


def _parse_args(arguments: Any) -> Any:
    if isinstance(arguments, str):
        try:
            return json.loads(arguments)
        except json.JSONDecodeError:
            return {"raw": arguments}
    return arguments or {}


def _get_message_by_id(message_id: str) -> Optional[dict]:
    with db._lock:
        conn = db._conn()
        try:
            row = conn.execute("SELECT * FROM agent_messages WHERE message_id = ?", (message_id,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()
