"""智能体服务编排:队列、Run 状态机、事件投影、审批、SSE 扇出、Worker 监督。

经典产品队列保持单 Active Run；DSH Web 原生会话按 runtime session 独立投影，
MCP 工具调用通过会话上下文 lease 绑定正确 run。业务 Task Instance 不受此限制。
"""
from __future__ import annotations

import asyncio
import json
import os
import secrets
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

from core import data_sink
from core.agent import db
from core.agent import mcp_gateway
from core.agent.redaction import redact_text as _redact_secret_text, redact_value
from core.agent.cordis_config import build_cordis_yaml, resolve_provider_for_model, model_capabilities
from core.llm_gateway import deepseek_official_real_model
from core.agent.worker import AgentWorker, resolve_harness_root, resolve_node_executable
from core.config import load_config

APPROVAL_WAIT_SECONDS = 15 * 60
APPROVAL_MAX_CONCURRENCY = 4
MCP_CONTEXT_ACQUIRE_TIMEOUT_SECONDS = 25
MCP_CONTEXT_LEASE_MAX_SECONDS = 30 * 60

# 审批桥最长会阻塞十五分钟，绝不能占用 asyncio 默认线程池（否则普通
# to_thread 文件/CDP 操作会被审批等待饿死）。并发槽在提交 executor 前获取，
# 因此 ThreadPoolExecutor 的内部队列始终不会积压超过工作线程数。
_APPROVAL_EXECUTOR = ThreadPoolExecutor(
    max_workers=APPROVAL_MAX_CONCURRENCY,
    thread_name_prefix="crawshrimp-approval",
)

# 免审批任务:简单下载/找图类(用户指令明确请求执行时自动放行,审计保留)
AUTO_APPROVE_TASK_IDS = frozenset({"batch_image_download", "cloud_folder_download"})


def _auto_approve_task(task_id: str, risk: str) -> bool:
    """简单下载/找图类任务自动批准;上传/发布/删除类即使名字相近也不放行。"""
    if risk not in ("read_only", "local_write"):
        return False
    tid = str(task_id or "").strip().lower()
    if not tid:
        return False
    if tid in AUTO_APPROVE_TASK_IDS:
        return True
    if any(k in tid for k in ("upload", "publish", "delete", "remove", "update", "modify")):
        return False
    return any(k in tid for k in ("download", "找图", "找款", "云盘"))


_IMAGE_MEDIA_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
_VIDEO_MEDIA_EXT = {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"}
_AUDIO_MEDIA_EXT = {".mp3", ".wav", ".m4a", ".aac", ".ogg"}
_MODEL_IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


def _classify_artifact_media(filename: str, path: str):
    """按文件名分类产物媒体类型;zip 产物返回内部图片条目清单(轻量 namelist)。"""
    name = str(filename or "")
    lower = name.lower()
    ext = "." + lower.rsplit(".", 1)[-1] if "." in lower else ""
    if ext in _IMAGE_MEDIA_EXT:
        return "image", []
    if ext in _VIDEO_MEDIA_EXT:
        return "video", []
    if ext in _AUDIO_MEDIA_EXT:
        return "audio", []
    if ext == ".zip" and path:
        images: list[str] = []
        try:
            import zipfile as _zipfile
            with _zipfile.ZipFile(path) as zf:
                for member in zf.namelist():
                    if not member or member.endswith("/"):
                        continue
                    m_ext = "." + member.rsplit(".", 1)[-1].lower() if "." in member else ""
                    if m_ext in _IMAGE_MEDIA_EXT:
                        images.append(member)
                        if len(images) >= 20:
                            break
        except Exception:  # noqa: BLE001
            images = []
        return "zip", images
    return "file", []


def _pick_free_port(start_port: int, max_steps: int = 8) -> int:
    """端口自愈:起始端口被占用时自动 +1 递增,避免残留进程卡死 runtime。"""
    import socket as _socket
    port = max(1, int(start_port or 0))
    for _ in range(max(1, int(max_steps))):
        try:
            with _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM) as sock:
                sock.bind(("127.0.0.1", port))
            return port
        except OSError:
            port += 1
    raise RuntimeError(f"端口范围 {start_port}..{port - 1} 均已占用")


def _reserve_free_port(start_port: int, max_steps: int = 8):
    """绑定并保留监听 socket，供 uvicorn 直接接管，消除检查后再 bind 的竞态。"""
    import socket
    port = max(1, int(start_port or 0))
    for _ in range(max(1, int(max_steps))):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("127.0.0.1", port))
            sock.listen(128)
            sock.setblocking(False)
            return port, sock
        except OSError:
            sock.close()
            port += 1
    raise RuntimeError(f"端口范围 {start_port}..{port - 1} 均已占用")


def _process_is_alive(pid: int) -> bool:
    if pid <= 1:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _cleanup_orphan_runtimes(data_root: str) -> None:
    """清理本 data 目录的孤儿 worker/harness 进程(后端被强杀后的残留)。

    匹配依据:进程环境含本 data 目录的 harness 会话根路径。
    """
    if os.name != "posix":
        return
    import subprocess
    session_root = str(Path(data_root) / "agent" / "harness-sessions")
    try:
        out = subprocess.run(
            ["ps", "eww", "-axo", "pid=,ppid=,command="], capture_output=True, text=True, timeout=15
        ).stdout
    except Exception:  # noqa: BLE001
        return
    for line in out.splitlines():
        if session_root not in line:
            continue
        if "dsh-sdk-jsonrpc-demo" not in line and "worker/worker.mjs" not in line:
            continue
        fields = line.strip().split(maxsplit=2)
        if len(fields) < 3:
            continue
        try:
            pid = int(fields[0])
            ppid = int(fields[1])
        except ValueError:
            continue
        if pid == os.getpid() or (ppid > 1 and _process_is_alive(ppid)):
            continue
        try:
            os.kill(pid, 15)
            print(f"[agent] 清理孤儿 runtime 进程 pid={pid}", flush=True)
        except (OSError, ValueError):
            pass


def _remove_owned_tree(path: Path) -> None:
    """删除智能体自有目录；符号链接只移除链接本身，绝不跟随到外部目标。"""
    import shutil

    if path.is_symlink():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path, ignore_errors=False)

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


def _task_display_name(adapter_id: str, task_id: str) -> str:
    """任务中文正式名称(来自适配器 manifest),失败回退英文 id。"""
    try:
        from core import adapter_loader
        manifest = adapter_loader.get_adapter(str(adapter_id or ""))
        if manifest:
            for task in getattr(manifest, "tasks", None) or []:
                if (str(getattr(task, "id", "")) == str(task_id)
                        and str(getattr(task, "name", "") or "").strip()):
                    return str(task.name).strip()
    except Exception:  # noqa: BLE001
        pass
    return str(task_id or "")


def _params_brief(params) -> str:
    """参数的人类可读摘要(截断,不泄密)。"""
    if not isinstance(params, dict) or not params:
        return ""
    parts = []
    for key, value in list(redact_value(params).items())[:6]:
        text = str(value)
        if len(text) > 24:
            text = text[:24] + "…"
        parts.append(f"{key}={text}")
    return "参数:" + "; ".join(parts)


def _approval_human_text(summary: dict, plan: dict, risk: str) -> str:
    """审批卡中文人话描述(替代英文键值堆砌)。"""
    kind = str(summary.get("kind") or "")
    if kind == "script_publish":
        fname = str(summary.get("draft_path") or "").split("/")[-1]
        return (f"发布脚本「{fname}」为可复用抓虾脚本(适配器:{summary.get('adapter_id') or '未指定'})。"
                f"发布后进入脚本库,可被其他任务调用,属于外部写入操作,请确认脚本内容无误。")
    if kind == "fs_write":
        return f"写入本机文件:{summary.get('path')}({summary.get('size', 0)} 字节)。"
    if kind == "fs_exec":
        return f"在本机执行命令:{_redact_secret_text(summary.get('command'))}"
    if kind == "repo_install":
        return f"把第三方代码仓库「{summary.get('repo')}」下载到抓虾本地仓库目录；只下载，不执行代码。"
    if kind == "repo_update":
        return f"从已配置的公网 origin 更新本地代码仓库「{summary.get('repo')}」，会修改本地仓库文件。"
    if kind == "repo_learn":
        return f"为本地代码仓库「{summary.get('repo')}」生成 DSH 技能入口文件；不会复制第三方 README 到指令正文。"
    if kind == "browser_navigate":
        return (f"把浏览器页面从 {summary.get('from_url') or '当前页面'} "
                f"跳转到 {summary.get('url')}。页面跳转可能向外部网站发送请求，请确认。")
    if kind == "capability_upgrade":
        return "允许智能体在本次任务中点击、输入和滚动当前浏览器页面。"
    if kind == "sensitive_click":
        return (f"在浏览器页面点击「{summary.get('text') or summary.get('selector') or '敏感按钮'}」。"
                "该操作可能提交、发布、上传或删除外部数据，请确认。")
    action = str(summary.get("action") or "")
    if action in ("pause", "resume", "stop") and summary.get("task_instance_uid"):
        action_zh = {"pause": "暂停", "resume": "继续", "stop": "停止"}.get(action, action)
        return f"对任务实例 {summary.get('task_instance_uid')} 执行「{action_zh}」操作。"
    adapter_id = str(plan.get("adapter_id") or summary.get("adapter_id") or "")
    task_id = str(plan.get("task_id") or summary.get("task_id") or "")
    if task_id:
        name = _task_display_name(adapter_id, task_id)
        brief = _params_brief(summary.get("params") or {})
        return f"运行任务「{name}」({adapter_id}/{task_id})。{brief}".rstrip("。") + "。"
    return f"执行敏感操作(风险:{risk or '外部写入'}),请确认。"


def _approval_human_tool_name(summary: dict, plan: dict) -> str:
    kind = str(summary.get("kind") or "")
    if kind == "script_publish":
        return "发布脚本"
    if kind == "fs_write":
        return "写入文件"
    if kind == "fs_exec":
        return "执行命令"
    if kind == "repo_install":
        return "下载代码仓库"
    if kind == "repo_update":
        return "更新代码仓库"
    if kind == "repo_learn":
        return "生成仓库技能入口"
    if kind == "browser_navigate":
        return "跳转浏览器页面"
    if kind == "capability_upgrade":
        return "操作浏览器页面"
    if kind == "sensitive_click":
        return "确认浏览器敏感操作"
    action = str(summary.get("action") or "")
    if action in ("pause", "resume", "stop"):
        return {"pause": "暂停任务", "resume": "继续任务", "stop": "停止任务"}.get(action, "任务控制")
    task_id = str(plan.get("task_id") or summary.get("task_id") or "")
    if task_id:
        adapter_id = plan.get("adapter_id") or summary.get("adapter_id")
        return f"运行任务:{_task_display_name(adapter_id, task_id)}"
    return "敏感操作"


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
        self._approval_slots = asyncio.Semaphore(APPROVAL_MAX_CONCURRENCY)
        self.subscribers: dict[str, set[asyncio.Queue]] = {}
        self.global_subscribers: set[asyncio.Queue] = set()
        self.sse_dropped_events = 0
        # web UI 原生会话的影子投影:runtime_session_id → 影子 run
        self.shadow_runs: dict[str, dict] = {}
        # MCP client 是 runtime 级单连接，但 DSH Web 可并行运行多个会话。
        # 这里保存 runtime session → run 的真值；产品桥在每次 MCP 工具调用
        # 外层获取互斥 lease，避免一个会话覆盖另一个会话的审批/grant 上下文。
        self.active_runs_by_runtime: dict[str, dict] = {}
        self.grants_by_run: dict[str, dict] = {}
        self._mcp_context_lock = asyncio.Lock()
        self._mcp_context_lease_id = ""
        self._mcp_lease_expiry_task: Optional[asyncio.Task] = None

        self._mcp_app = None
        self._mcp_uvicorn = None
        self._mcp_task: Optional[asyncio.Task] = None
        self._mcp_socket = None
        self.mcp_port = 0
        self.mcp_url = "http://127.0.0.1:18965/mcp"
        self.generation_model: Optional[str] = None
        self.generation_model_provider: Optional[str] = None
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
        mcp_gateway.ctx.emit_event = self._emit_tool_event_sync

    def register_run_context(self, runtime_session_id: str, run: dict,
                             grant: Optional[dict] = None) -> None:
        runtime_id = str(runtime_session_id or "").strip()
        run_id = str((run or {}).get("run_id") or "").strip()
        if not runtime_id or not run_id:
            raise ValueError("runtime_session_id/run_id 必填")
        self.active_runs_by_runtime[runtime_id] = dict(run)
        if grant:
            self.grants_by_run[run_id] = dict(grant)

    def unregister_run_context(self, runtime_session_id: str,
                               run_id: str = "") -> None:
        runtime_id = str(runtime_session_id or "").strip()
        current = self.active_runs_by_runtime.get(runtime_id)
        if current is None:
            return
        expected_run_id = str(run_id or "").strip()
        if expected_run_id and str(current.get("run_id") or "") != expected_run_id:
            return
        removed = self.active_runs_by_runtime.pop(runtime_id, None) or {}
        self.grants_by_run.pop(str(removed.get("run_id") or ""), None)

    def active_run_for_session(self, session_id: str) -> Optional[dict]:
        wanted = str(session_id or "")
        if self.active_run and str(self.active_run.get("session_id") or "") == wanted:
            return self.active_run
        return next((run for run in self.active_runs_by_runtime.values()
                     if str(run.get("session_id") or "") == wanted), None)

    async def acquire_mcp_context(self, runtime_session_id: str,
                                  call_id: str = "") -> dict:
        """为一次 DSH MCP 调用租用正确会话上下文。

        DSH 0.1.0-rc.6 的 MCP transport 是 runtime 级单连接，HTTP 请求本身
        不携带 agent/session。crawshrimp-product-bridge 能在 tools/execute 外层
        读取 exec.agent.id，因此先通过本 lease 串行化并激活对应 run，再发 MCP
        请求；finally 释放。未知会话安全失败，不回退到“最近一个 run”。
        """
        try:
            await asyncio.wait_for(
                self._mcp_context_lock.acquire(),
                timeout=MCP_CONTEXT_ACQUIRE_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError as exc:
            raise TimeoutError("MCP context busy; previous tool call did not release its lease") from exc
        try:
            runtime_id = str(runtime_session_id or "").strip()
            run = self.active_runs_by_runtime.get(runtime_id)
            if not run:
                raise LookupError(f"runtime session 没有 active run: {runtime_id}")
            lease_id = f"lease-{uuid.uuid4().hex[:16]}"
            self._mcp_context_lease_id = lease_id
            self._mcp_lease_expiry_task = asyncio.create_task(
                self._expire_mcp_context_lease(lease_id)
            )
            mcp_gateway.ctx.active_run = dict(run)
            mcp_gateway.ctx.grant = self.grants_by_run.get(str(run.get("run_id") or ""))
            mcp_gateway.ctx.current_tool_call_id = (
                f"{run.get('run_id')}:{str(call_id).strip()}" if str(call_id or "").strip() else ""
            )
            return {
                "lease_id": lease_id,
                "run_id": run.get("run_id"),
                "session_id": run.get("session_id"),
                "call_id": str(call_id or ""),
            }
        except Exception:
            self._mcp_context_lease_id = ""
            mcp_gateway.ctx.active_run = None
            mcp_gateway.ctx.grant = None
            mcp_gateway.ctx.current_tool_call_id = ""
            self._mcp_context_lock.release()
            raise

    async def _expire_mcp_context_lease(self, lease_id: str) -> None:
        try:
            await asyncio.sleep(MCP_CONTEXT_LEASE_MAX_SECONDS)
            self.release_mcp_context(lease_id)
        except asyncio.CancelledError:
            return

    def release_mcp_context(self, lease_id: str) -> bool:
        supplied = str(lease_id or "").strip()
        if not supplied or supplied != self._mcp_context_lease_id:
            return False
        active_run = mcp_gateway.ctx.active_run or {}
        run_id = str(active_run.get("run_id") or "").strip()
        if run_id and mcp_gateway.ctx.grant:
            # MCP 工具会在原生审批通过后原地扩充 grant.toolset_json。
            # 每次调用使用独立 lease，因此释放前必须把新权限写回 run 级真值，
            # 否则下一次 acquire 会恢复批准前快照并重复弹审批卡。
            self.grants_by_run[run_id] = dict(mcp_gateway.ctx.grant)
        expiry_task = self._mcp_lease_expiry_task
        self._mcp_lease_expiry_task = None
        if expiry_task and not expiry_task.done():
            try:
                current = asyncio.current_task()
            except RuntimeError:
                current = None
            if expiry_task is not current:
                expiry_task.cancel()
        self._mcp_context_lease_id = ""
        mcp_gateway.ctx.active_run = None
        mcp_gateway.ctx.grant = None
        mcp_gateway.ctx.current_tool_call_id = ""
        if self._mcp_context_lock.locked():
            self._mcp_context_lock.release()
        return True

    def _emit_tool_event_sync(self, event_type: str, payload: dict) -> None:
        """工具执行中同步广播产品事件(线程安全:投递到主事件循环)。"""
        run = mcp_gateway.ctx.active_run
        if not run:
            return
        session_id = run.get("session_id")
        if not session_id:
            return
        loop = getattr(self, "main_loop", None)
        if loop is None or loop.is_closed():
            return
        try:
            event_payload = {**(payload or {}), "run_id": run.get("run_id")}
            if event_type == "browser.activity":
                event_payload["tabs"] = self._session_browser_tabs(session_id, event_payload)
            future = asyncio.run_coroutine_threadsafe(
                self.broadcast(session_id, _seq(session_id), event_type, event_payload), loop)

            def _done(f):
                try:
                    f.result()
                except Exception as exc:  # noqa: BLE001
                    print(f"[agent] emit broadcast 异常: {exc}", flush=True)
            future.add_done_callback(_done)
        except Exception as exc:  # noqa: BLE001
            print(f"[agent] emit 投递失败: {exc}", flush=True)

    @staticmethod
    def _session_browser_tabs(session_id: str, payload: dict) -> list[dict]:
        """把当前 tab 扩展为会话级页面子集；绝不暴露其他会话的全局页面。"""
        allowed = set(db.list_granted_tab_ids_for_session(session_id))
        current_tabs = payload.get("tabs") if isinstance(payload.get("tabs"), list) else []
        current_by_id = {
            str(tab.get("id") or ""): tab for tab in current_tabs
            if isinstance(tab, dict) and str(tab.get("id") or "")
        }
        allowed.update(current_by_id)
        try:
            from core.cdp_bridge import get_bridge
            live_pages = [tab for tab in get_bridge().get_tabs(timeout=2) if tab.get("type") == "page"]
        except Exception:  # noqa: BLE001
            live_pages = list(current_by_id.values())
        live_by_id = {str(tab.get("id") or ""): tab for tab in live_pages}
        tabs = []
        for tab_id in allowed:
            tab = live_by_id.get(tab_id)
            if not tab:
                continue
            tabs.append({
                "id": tab_id,
                "url": str(tab.get("url") or ""),
                "title": str(tab.get("title") or ""),
            })
        return tabs

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
        # MCP 端口取 API 端口 + 200,保证永不落入回退区间且实例间唯一;
        # 端口自愈:被残留进程占用时自动递增,不再卡死。
        port = int(_os.environ.get("CRAWSHRIMP_AGENT_MCP_PORT", str(base_port + 200)))
        port, reserved_socket = _reserve_free_port(port, 8)
        self.mcp_port = port
        self.mcp_url = f"http://127.0.0.1:{port}/mcp"
        app = agent_api.build_agent_mcp_asgi(
            lambda: self.runtime_token,
            context_acquirer=self.acquire_mcp_context,
            context_releaser=self.release_mcp_context,
        )
        config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
        self._mcp_uvicorn = uvicorn.Server(config)
        self._mcp_socket = reserved_socket
        self._mcp_task = asyncio.create_task(self._mcp_uvicorn.serve(sockets=[reserved_socket]))
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
        if self._mcp_socket is not None:
            try:
                self._mcp_socket.close()
            except OSError:
                pass
            self._mcp_socket = None

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
        self.active_runs_by_runtime.clear()
        self.grants_by_run.clear()
        if self._mcp_context_lease_id:
            self.release_mcp_context(self._mcp_context_lease_id)

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
        """持久化一次产品事件并用同一个 SQLite seq 扇出 session/global SSE。"""
        del seq  # 旧调用位保留兼容；事件序号只能来自 agent_events 自增主键。
        session = db.get_session(session_id) or {}
        if isinstance(payload, dict):
            payload = {
                **payload,
                "session_id": payload.get("session_id") or session_id,
                "runtime_session_id": payload.get("runtime_session_id")
                or session.get("runtime_session_id") or "",
            }
        run_id = payload.get("run_id") if isinstance(payload, dict) else None
        event_seq = db.append_event(session_id, run_id, event_type, payload)
        message = {"seq": event_seq, "event_type": event_type, "payload": payload}
        for queue in list(self.subscribers.get(session_id, ())):
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                self.sse_dropped_events += 1
                if self.sse_dropped_events == 1 or self.sse_dropped_events % 100 == 0:
                    print(f"[agent] SSE session 队列已满，累计丢弃 {self.sse_dropped_events} 次；客户端将按 SQLite cursor 补放", flush=True)
        gmessage = message
        for queue in list(self.global_subscribers):
            try:
                queue.put_nowait(gmessage)
            except asyncio.QueueFull:
                self.sse_dropped_events += 1
                if self.sse_dropped_events == 1 or self.sse_dropped_events % 100 == 0:
                    print(f"[agent] SSE global 队列已满，累计丢弃 {self.sse_dropped_events} 次；客户端将按 SQLite cursor 补放", flush=True)

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
        image_attachments: list[dict] = []
        for aid in (attachment_ids or []):
            row = db.get_attachment(str(aid or "").strip())
            if row and row.get("session_id") == session_id:
                db.create_attachment(f"{row['attachment_id']}:{turn_id}", session_id, turn_id, run_id,
                                     row["filename"], row["path"], row["mime"], row["size"])
                if (str(row.get("mime") or "") in _MODEL_IMAGE_MIME_TYPES
                        and int(row.get("size") or 0) <= 8 * 1024 * 1024):
                    image_attachments.append({
                        "path": row.get("path"), "mediaType": row.get("mime"), "name": row.get("filename"),
                    })
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
            "sse_dropped_events": self.sse_dropped_events,
        })
        await self.queue.put({
            "run_id": run_id, "session_id": session_id, "turn_id": turn_id,
            "text": final_text, "message_id": message_id, "model_id": model_id,
            "provider_id": provider_id, "context_refs": context_refs or [],
            "grant_prefs": grant_prefs or {}, "image_attachments": image_attachments,
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

        # 同步 HTTP(CDP bridge)不得阻塞事件循环 → to_thread
        grant = await asyncio.to_thread(self._grant_for_run, item)
        runtime_session_ids = {self._runtime_session_id(session_id)}
        self.register_run_context(next(iter(runtime_session_ids)), db.get_run(run_id), grant)

        status: Optional[str] = None
        try:
            generation_ok = await self._ensure_generation(item)
            if not generation_ok:
                raise RuntimeError(self.runtime_error or "runtime 启动失败")

            budget = BUDGET_PROFILES["browser"] if self._is_browser_run(item) else BUDGET_PROFILES["default"]
            summary = await self.worker.request("worker.run", {
                "runId": run_id,
                "sessionId": self._runtime_session_id(session_id),
                "text": item["text"],
                "images": item.get("image_attachments") or [],
                "budget": budget,
            }, timeout=30 * 60 + 60)

            result = (summary or {}).get("summary") or {}

            # DSH 持久化不变量:runtime 重启后,旧 runtime_session_id 与既有日志不匹配
            # (id collision)。产品行为:轮换 runtime_session_id 并重试一次,提示上下文不可恢复。
            if result.get("status") == "failed" and _is_session_collision(result):
                import uuid as _uuid
                new_sid = f"dsh-{_uuid.uuid4().hex}"
                db.update_session(session_id, runtime_session_id=new_sid, continuation_available=0)
                for old_sid in tuple(runtime_session_ids):
                    self.unregister_run_context(old_sid, run_id)
                runtime_session_ids = {new_sid}
                self.register_run_context(new_sid, db.get_run(run_id), grant)
                notice = "智能体运行时已重启,上一轮对话上下文无法继续恢复;已开启新上下文继续本轮。"
                db.create_message(f"{run_id}:notice", session_id, turn_id, run_id, "system", "notice", {"text": notice})
                await self.broadcast(session_id, 0, "session.updated",
                                     {"session_id": session_id, "notice": notice, "new_context": True})
                summary = await self.worker.request("worker.run", {
                    "runId": run_id,
                    "sessionId": new_sid,
                    "text": item["text"],
                    "images": item.get("image_attachments") or [],
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
            if status == "completed":
                await self._broadcast_run_artifacts(run_id, session_id)
        except Exception as exc:  # noqa: BLE001
            db.update_run(run_id, status="failed", finished_at=_now_iso(),
                          error_code="WORKER_ERROR", error_message=str(exc)[:500])
            db.update_turn(turn_id, status="failed", completed_at=_now_iso())
            await self.broadcast(session_id, 0, "run.failed", {"run_id": run_id, "error": str(exc)[:300]})
            self._note_crash(str(exc))
        finally:
            for runtime_sid in runtime_session_ids:
                self.unregister_run_context(runtime_sid, run_id)
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
        requested_tab_id = str(tab_ref.get("id") or "")
        from core.cdp_bridge import get_bridge
        try:
            tabs = get_bridge().get_tabs(timeout=2)
        except Exception:  # noqa: BLE001
            tabs = []
        pages = [t for t in tabs if t.get("type") == "page"]
        missing_explicit_tab = bool(requested_tab_id and requested_tab_id != "current") and not any(
            str(entry.get("id") or "") == requested_tab_id for entry in pages
        )
        if not pages and not missing_explicit_tab:
            return None
        if requested_tab_id and requested_tab_id != "current":
            tab = next((entry for entry in pages if str(entry.get("id") or "") == requested_tab_id), None)
            if tab is None:
                # 保留精确 tab 墓碑；后续工具会明确报告“页面已关闭”，不能回退全局第一页。
                tab = {"id": requested_tab_id, "url": ""}
        else:
            tab = pages[0]
        grant_id = f"grant-{uuid.uuid4().hex[:12]}"
        toolset = ["observe", "eval", "verify", "capture_requests"]
        prefs = item.get("grant_prefs") or {}
        pref_toolset = prefs.get("toolset")
        if isinstance(pref_toolset, list):
            for entry in pref_toolset:
                if entry not in toolset:
                    toolset.append(entry)
        return db.create_grant(grant_id, item["run_id"], None, str(tab.get("id")),
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
        # DSH Web UI「工作区」默认指向抓虾运行时目录(data/agent/workspace)
        workspace_root = _data_root() / "agent" / "workspace"
        workspace_root.mkdir(parents=True, exist_ok=True)
        os.environ["CRAWSHRIMP_WORKSPACE_ROOT"] = str(workspace_root)
        base = (cfg.get("ai") or {}).get("llm") or {}
        for env_key, cfg_key, default in (
            ("CRAWSHRIMP_OVERSEAS_OPENAI_BASE_URL", "overseas_openai_base_url", None),
            ("CRAWSHRIMP_OVERSEAS_ANTHROPIC_BASE_URL", "overseas_anthropic_base_url", None),
            ("CRAWSHRIMP_DOMESTIC_OPENAI_BASE_URL", "domestic_base_url", None),
            ("CRAWSHRIMP_DEEPSEEK_BASE_URL", "deepseek_base_url", None),
        ):
            value = str(base.get(cfg_key) or "").strip()
            if value:
                os.environ[env_key] = value
        # DeepSeek 原生接入:独立 Key 注入 runtime 环境(不落盘)
        ds_key = os.environ.get("CRAWSHRIMP_DEEPSEEK_API_KEY", "").strip() or str(base.get("deepseek_api_key") or "").strip()
        if ds_key:
            os.environ["CRAWSHRIMP_DEEPSEEK_API_KEY"] = ds_key

        data_root = _data_root()
        agent_dir = data_root / "agent"
        # 启动 worker 前先清理本 data 目录的孤儿 runtime(上次后端被强杀的残留),
        # 避免残留进程占用端口导致 DSH webserver 内部 +1 漂移(前端拿不到真实端口会白屏)。
        _cleanup_orphan_runtimes(str(data_root))
        # Web host 端口自愈:清完残留再选端口,并把结果回写 self.web_port,
        # runtime_status 必须上报与 harness 实际监听一致的端口。
        self.web_port = _pick_free_port(self.web_port, 8)
        os.environ["CRAWSHRIMP_WEB_PORT"] = str(self.web_port)
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
                # DeepSeek 官方模型:产品内 ID → runtime 真实模型名
                "model": deepseek_official_real_model(model_id),
                "maxTokens": model_capabilities(model_id).get("max_output_tokens", 8192),
                "cwd": str(agent_dir / "runtime-workdir"),
            }, timeout=120)
            if not gen.get("ok"):
                raise RuntimeError(f"start_generation 失败: {gen}")
            self.worker = worker
            self.runtime_state = "ready"
            self.generation_model = model_id
            self.generation_model_provider = provider_id
            # 端口漂移兜底:DSH webserver 在首选端口被占时会内部 +1,
            # 后台探测真实监听端口并回写 self.web_port,前端 iframe 才能加载正确地址。
            asyncio.get_running_loop().create_task(self._settle_web_port(self.web_port))
            return True
        except Exception as exc:  # noqa: BLE001
            self.runtime_error = str(exc)
            self.runtime_state = "crashed"
            await worker.stop()
            self._note_crash(str(exc))
            return False

    async def _settle_web_port(self, preferred: int) -> None:
        """探测 DSH web host 真实监听端口(webserver 内部端口冲突会 +1)。

        在 [preferred, preferred+8] 范围内找第一个返回 __DSH_BOOT__ 特征的
        端口并回写 self.web_port 与环境变量;最多探测约 15s(webserver 启动有延迟)。
        """
        import http.client as _http
        import time as _time
        base = max(1, int(preferred or 0))
        deadline = _time.monotonic() + 15

        def _probe(port: int) -> Optional[int]:
            conn = None
            try:
                conn = _http.HTTPConnection("127.0.0.1", port, timeout=0.25)
                conn.request("GET", "/")
                resp = conn.getresponse()
                body = resp.read(64 * 1024).decode("utf-8", "replace")
                if (resp.status == 200 and "__DSH_BOOT__" in body
                        and "crawshrimp-product-bridge" in body and "crawshrimp-slots" in body):
                    return port
            except OSError:
                return None
            finally:
                if conn is not None:
                    conn.close()
            return None

        while _time.monotonic() < deadline:
            matches = await asyncio.gather(*(
                asyncio.to_thread(_probe, port) for port in range(base, base + 9)
            ))
            found = next((port for port in matches if port), None)
            if found:
                if found != self.web_port:
                    print(f"[agent] web host 实际端口修正 {self.web_port}→{found}", flush=True)
                    self.web_port = found
                    os.environ["CRAWSHRIMP_WEB_PORT"] = str(found)
                return
            await asyncio.sleep(0.25)
        print(f"[agent] 15 秒内未发现本实例 DSH web host，保留端口 {self.web_port}", flush=True)

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
        if self.active_run is not None or self.active_runs_by_runtime:
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
            "active_run": ((self.active_run or next(iter(self.active_runs_by_runtime.values()), {}))
                           or {}).get("run_id"),
            "queue_depth": self.queue.qsize(),
            "error": self.runtime_error,
            "node_executable": resolve_node_executable(),
            # DSH web host(方案 §12.7):前端 iframe 嵌入的页面地址
            "web_port": web_port,
            "web_url": f"http://127.0.0.1:{web_port}/" if web_port else "",
            # 默认工作区(前端自动建立,不需要用户指定)
            "workspace_root": str(_data_root() / "agent" / "workspace"),
        }

    async def _broadcast_run_artifacts(self, run_id: str, session_id: str) -> None:
        """任务执行完成后,把产物以附件形式推送到聊天(流程 1)。"""
        if not mcp_gateway.ctx.list_task_artifacts:
            return
        payloads = await asyncio.to_thread(self._collect_run_artifacts, run_id)
        for payload in payloads:
            await self.broadcast(session_id, _seq(session_id), "artifact.created", payload)

    @staticmethod
    def _collect_run_artifacts(run_id: str) -> list[dict]:
        """在线程中完成 SQLite/文件 stat/ZIP namelist，避免阻塞 agent 事件循环。"""
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
        payloads: list[dict] = []
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
                filename = artifact.get("label") or (path.split("/")[-1] if path else "")
                media_kind, zip_images = _classify_artifact_media(filename, path)
                payloads.append({
                    "artifact_id": artifact.get("id"),
                    "filename": filename,
                    "kind": artifact.get("kind") or "",
                    "path": path,
                    "size": size,
                    "task_instance_uid": uid,
                    # 会话内直接显示:媒体类型 + zip 内图片条目清单(最多 20 张,不解压字节)
                    "media_kind": media_kind,
                    "zip_images": zip_images,
                })
        return payloads

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
        if not run_id:
            # web UI 原生会话:影子投影(建立 active run,任务准备/审批/产物可用)
            shadow_session = params.get("sessionId")
            if shadow_session:
                await self._project_shadow_event(str(shadow_session), event)
            return
        run = db.get_run(run_id)
        if not run:
            return
        session_id = run["session_id"]
        await self._project_event(session_id, run, event)

    # ---------- web UI 原生会话影子投影 ----------

    async def _project_shadow_event(self, runtime_session_id: str, event: dict) -> None:
        event_type = event.get("type") or "unknown"
        data = event.get("data") or {}

        session = db.get_session_by_runtime(runtime_session_id)
        if session is None:
            session_id = f"cs-web-{uuid.uuid4().hex[:12]}"
            try:
                session = db.create_session(session_id, runtime_session_id, title="智能体会话")
            except Exception as exc:  # noqa: BLE001
                print(f"[agent] 影子会话创建失败: {exc}", flush=True)
                return

        run = self.shadow_runs.get(runtime_session_id)

        if event_type == "turn/start" and run is None:
            session_id = session["session_id"]
            turn_id = f"turn-web-{uuid.uuid4().hex[:12]}"
            run_id = f"run-web-{uuid.uuid4().hex[:12]}"
            db.create_turn(turn_id, session_id, db.next_turn_ordinal(session_id) + 1, f"{run_id}:user")
            run = db.create_run(run_id, session_id, turn_id,
                                self.generation_model_provider or "crawshrimp-overseas-openai",
                                self.generation_model or "gpt-5.6-terra")
            db.update_run(run_id, status="running", started_at=_now_iso())
            self.shadow_runs[runtime_session_id] = run
            # DSH Web 原生会话没有显式「附加当前页面」开关；首次 turn 固定绑定
            # 当时的 Chrome page，后续浏览器事件只公开这个 grant.tab_id。
            grant = await asyncio.to_thread(self._grant_for_run, {
                "run_id": run_id,
                "context_refs": [{"type": "browser_tab", "id": "current"}],
                "grant_prefs": {},
            })
            self.register_run_context(runtime_session_id, run, grant)
            db.update_session(session_id, status="running")
            await self.broadcast(session_id, 0, "run.started", {"run_id": run_id, "turn_id": turn_id})
            await self._project_event(session_id, run, event)
            return

        if run is None:
            return

        session_id = run["session_id"]

        if event_type == "user/message":
            text = _extract_text(data)
            if text:
                db.create_message(f"{run['run_id']}:user", session_id, run.get("turn_id"), run["run_id"],
                                  "user", "text", {"text": text})
        elif event_type == "session/title":
            title = str(data.get("title") or "").strip()[:80]
            if title:
                db.update_session(session_id, title=title)
        elif event_type == "turn/end":
            reason = data.get("reason") or {}
            kind = reason.get("kind") or "completed"
            if kind == "completed":
                db.update_run(run["run_id"], status="completed", finished_at=_now_iso())
                db.update_turn(run.get("turn_id") or "", status="completed", completed_at=_now_iso())
                await self.broadcast(session_id, 0, "run.completed", {"run_id": run["run_id"]})
                await self._broadcast_run_artifacts(run["run_id"], session_id)
            else:
                error_code = None
                if isinstance(reason.get("error"), dict):
                    error_code = reason["error"].get("code")
                db.update_run(run["run_id"], status="failed", error_code=error_code, finished_at=_now_iso())
                await self.broadcast(session_id, 0, "run.failed",
                                     {"run_id": run["run_id"], "kind": kind, "error_code": error_code})
            db.update_session(session_id, status="idle")
            self.shadow_runs.pop(runtime_session_id, None)
            self.unregister_run_context(runtime_session_id, run["run_id"])
            return

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
            safe_arguments = redact_value(_parse_args(data.get("arguments")))
            call = db.upsert_tool_call(run_id, data.get("callId") or str(uuid.uuid4()),
                                       data.get("name") or "unknown",
                                       safe_arguments)
            await self.broadcast(session_id, _seq(session_id), "tool.requested", {
                "tool_call_id": call["tool_call_id"],
                "tool_name": call["tool_name"],
                "arguments": safe_arguments,
            })
            return

        if event_type == "tool/result":
            result_text = _extract_tool_result_text(data)
            safe_result_text = redact_text(result_text)
            call_id = _extract_tool_call_id(data)
            if call_id:
                tool_call = db.get_tool_call(run_id, call_id)
                if tool_call:
                    db.update_tool_call(tool_call["tool_call_id"], result_json={"text": safe_result_text[:4000]},
                                        status="succeeded", finished_at=_now_iso())
                await self.broadcast(session_id, _seq(session_id), "tool.completed", {
                    "run_id": run_id, "dsh_call_id": call_id, "result": safe_result_text[:2000],
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
        await self.broadcast(session_id, _seq(session_id), event_type, {"run_id": run_id, "seq": dsh_seq})

    # ---------- 审批 ----------

    async def request_approval(self, tool_call: Optional[dict], plan: dict, summary: dict,
                               risk: str) -> str:
        import hashlib
        approval_id = f"apv-{uuid.uuid4().hex[:12]}"
        params_hash = hashlib.sha256(
            json.dumps(summary, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        safe_summary = redact_value(summary)
        # 影子会话(web UI 原生)的 active run 在 mcp_gateway.ctx 上。
        # 审批必须持久化其归属，前端重载/后端重启后才能从 SQLite 真值恢复或清理
        # 跨会话提示，而不是依赖可能中断的 SSE 终态事件。
        run = mcp_gateway.ctx.active_run or self.active_run or {}
        session_id = (run or {}).get("session_id") or ""
        db.create_approval(approval_id, plan.get("plan_id") or "control", None, safe_summary, risk,
                           params_hash, _iso_after(APPROVAL_WAIT_SECONDS),
                           session_id=session_id, run_id=(run or {}).get("run_id") or "")
        if session_id:
            payload = {
                "approval_id": approval_id,
                "summary": safe_summary,
                "risk": risk,
                "run_id": run.get("run_id"),
            }
            await self.broadcast(session_id, 0, "tool.approval_required", payload)

        # 简单下载/找图类任务:用户指令明确请求执行时免审批,自动放行。
        # 无论自动批准、原生卡批准还是拒绝，都显式广播终态；否则跨会话的
        # “等待审批”提示只能碰运气等 tool/result，拒绝/取消路径会永久残留。
        if _auto_approve_task(str(plan.get("task_id") or ""), risk):
            decision = "approved"
            decided_by = "auto-approved"
        else:
            # DSH 原生审批交互:crawshrimp-product-bridge → ctx.approval.request →
            # 原生审批卡 → 用户决策回传。失败时安全失败(rejected)。
            decision = await self._ds_native_approval(run, plan, safe_summary, risk)
            decided_by = "dsh-native"
        db.decide_approval(approval_id, decision, decided_by)
        if session_id:
            await self.broadcast(session_id, 0, "tool.approval_resolved", {
                "approval_id": approval_id,
                "decision": decision,
                "run_id": run.get("run_id"),
            })
        return decision

    async def _ds_native_approval(self, run: dict, plan: dict, summary: dict, risk: str) -> str:
        """经产品桥走 DSH 原生审批卡;不可达/异常时安全失败。"""
        web_port = getattr(self, "web_port", 0) or int(os.environ.get("CRAWSHRIMP_WEB_PORT", "0") or 0)
        if not web_port:
            return "rejected"
        session = db.get_session((run or {}).get("session_id") or "")
        runtime_session_id = (session or {}).get("runtime_session_id") or ""
        if not runtime_session_id:
            return "rejected"
        tool_name = _approval_human_tool_name(summary, plan)
        reason = _approval_human_text(summary, plan, risk)
        payload = {
            "sessionId": runtime_session_id,
            "toolName": tool_name,
            "reason": reason,
            "timeoutMs": (APPROVAL_WAIT_SECONDS - 30) * 1000,
        }

        def _post() -> str:
            import urllib.request
            req = urllib.request.Request(
                f"http://127.0.0.1:{web_port}/api/crawshrimp/approval/request",
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=APPROVAL_WAIT_SECONDS) as resp:
                    result = json.loads(resp.read().decode("utf-8"))
                if result.get("ok"):
                    outcome = str(result.get("outcome") or "rejected")
                    # DSH 原生审批结果词汇:allowed-once(批准一次)/rejected/cancelled/unavailable
                    if outcome == "allowed-once":
                        return "approved"
                    if outcome == "cancelled":
                        return "expired"
                    return "rejected"
                return "rejected"
            except Exception as exc:  # noqa: BLE001
                print(f"[agent] DSH 原生审批桥不可用({exc}),安全失败", flush=True)
                return "rejected"

        async with self._approval_slots:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(_APPROVAL_EXECUTOR, _post)

    def clear_agent_data(self) -> dict:
        """清除智能体投影及其受控附件、草稿、运行日志和智能体发布适配包。"""
        if self.active_run is not None or self.active_runs_by_runtime:
            return {"ok": False, "error": "存在进行中的运行,请先停止后再清除"}
        try:
            with db._lock:
                conn = db._conn()
                try:
                    revisions = [dict(row) for row in conn.execute(
                        "SELECT status, adapter_id, target_adapter_id, test_adapter_id"
                        " FROM agent_script_revisions"
                    ).fetchall()]
                finally:
                    conn.close()
            from core import adapter_loader as _adapter_loader
            from core.agent import api as _agent_api
            published_ids = {
                str(revision.get("target_adapter_id") or revision.get("adapter_id") or "")
                for revision in revisions if revision.get("status") == "published"
            }
            for adapter_id in sorted(published_ids - {""}):
                if not _agent_api._restore_published_adapter_baseline(adapter_id):
                    _adapter_loader.uninstall(adapter_id)
            for revision in revisions:
                candidate_ids = [revision.get("test_adapter_id")]
                for adapter_id in candidate_ids:
                    if adapter_id:
                        _adapter_loader.uninstall(str(adapter_id))
            agent_root = Path(_data_root()) / "agent"
            for child_name in ("attachments", "workspace", "harness-sessions", "runtime-workdir",
                               "review-backups"):
                _remove_owned_tree(agent_root / child_name)
            tmp_root = os.environ.get("CRAWSHRIMP_AGENT_ATTACHMENT_TMP_ROOT", "").strip()
            if tmp_root:
                tmp_path = Path(tmp_root).expanduser().resolve()
                if tmp_path.name == "tmp-agent-attachments" and tmp_path.is_dir():
                    _remove_owned_tree(tmp_path)
            db.clear_agent_data()
            # 基线留到数据库清理成功后再删；此前任一步失败都能重复恢复，
            # 不会在重试时把刚恢复的用户原适配器误当成智能体包卸载。
            baseline_root = agent_root / "published-baselines"
            _remove_owned_tree(baseline_root)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"清除失败: {exc}"}
        self.shadow_runs.clear()
        self.approval_waits.clear()
        mcp_gateway.ctx.plan_params.clear()
        return {"ok": True, "cleared": True, "removed_runtime_files": True,
                "removed_agent_adapters": True}

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
    # 对外文本沿用既有 *** 合同；数据库结构化字段使用 [REDACTED]，两者语义一致。
    out = _redact_secret_text(text).replace("[REDACTED]", "***")
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
