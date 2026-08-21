"""Agent Worker 监督器:FastAPI 侧管理 Electron-as-Node Worker 子进程。

NDJSON JSON-RPC 2.0 over stdio(protocol_version: 1),协议见窄 spec §10。
发布态通过 CRAWSHRIMP_NODE_EXECUTABLE 指向打包 Electron;开发态回退 app 的 electron。
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

WORKER_ENTRY = "worker/worker.mjs"
WORKER_STREAM_LIMIT_BYTES = 4 * 1024 * 1024 + 64 * 1024

NotificationHandler = Callable[[str, dict], Awaitable[None]]


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _app_root() -> Path:
    return _repo_root() / "app"


def resolve_node_executable() -> str:
    """返回可运行 Node 的 Electron 可执行文件路径。"""
    explicit = os.environ.get("CRAWSHRIMP_NODE_EXECUTABLE", "").strip()
    if explicit and Path(explicit).exists():
        return explicit
    if os.environ.get("CRAWSHRIMP_ELECTRON_NODE", "").strip():
        return os.environ["CRAWSHRIMP_ELECTRON_NODE"].strip()
    # 开发态:app/node_modules/electron
    electron_root = _app_root() / "node_modules" / "electron"
    electron_dist = electron_root / "dist"
    path_file = electron_root / "path.txt"
    try:
        relative_executable = path_file.read_text(encoding="utf-8").strip()
        candidate = (electron_dist / relative_executable).resolve()
        candidate.relative_to(electron_dist.resolve())
        if relative_executable and candidate.is_file():
            return str(candidate)
    except (OSError, ValueError):
        pass

    bin_dir = _app_root() / "node_modules" / ".bin"
    electron = bin_dir / ("electron.cmd" if os.name == "nt" else "electron")
    if electron.exists():
        return str(electron)
    return shutil.which("electron") or "electron"


def resolve_harness_root(is_packaged: bool = False) -> Path:
    # 发布态由 Electron main 注入(Resources/deepseek-harness);开发态用仓库目录
    env_root = os.environ.get("CRAWSHRIMP_HARNESS_ROOT", "").strip()
    if env_root:
        return Path(env_root)
    if not is_packaged:
        return _repo_root() / "integrations" / "deepseek-harness"
    return Path(os.environ.get("CRAWSHRIMP_RESOURCES_PATH", "")) / "deepseek-harness"


class WorkerProtocolError(Exception):
    pass


class AgentWorker:
    """一个 Worker 子进程的异步 JSON-RPC 客户端。"""

    def __init__(self, *, runtime_root: str, data_root: str, cordis_path: str,
                 mcp_url: str, session_root: str,
                 on_notification: Optional[NotificationHandler] = None):
        self.runtime_root = runtime_root
        self.data_root = data_root
        self.cordis_path = cordis_path
        self.mcp_url = mcp_url
        self.session_root = session_root
        self.on_notification = on_notification
        self.proc: Optional[asyncio.subprocess.Process] = None
        self._next_id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._reader_task: Optional[asyncio.Task] = None
        self.stderr_tail: str = ""

    async def start(self) -> None:
        node_executable = resolve_node_executable()
        worker_entry = str(Path(self.runtime_root) / WORKER_ENTRY)
        if not Path(worker_entry).exists():
            raise WorkerProtocolError(f"worker 入口不存在: {worker_entry}")

        env = dict(os.environ)
        env["ELECTRON_RUN_AS_NODE"] = "1"
        env["CRAWSHRIMP_NODE_EXECUTABLE"] = node_executable
        env["CRAWSHRIMP_MCP_URL"] = self.mcp_url
        env["CRAWSHRIMP_SESSION_ROOT"] = self.session_root
        # API key 由外部注入到 FastAPI 环境,worker 继承并传给 runtime

        self.proc = await asyncio.create_subprocess_exec(
            node_executable, worker_entry,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            cwd=str(Path(self.runtime_root)),
            limit=WORKER_STREAM_LIMIT_BYTES,
        )
        self._reader_task = asyncio.create_task(self._read_loop())

    async def _read_loop(self) -> None:
        assert self.proc and self.proc.stdout
        stderr_task = asyncio.create_task(self._drain_stderr())
        try:
            while True:
                line = await self.proc.stdout.readline()
                if not line:
                    break
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise WorkerProtocolError(f"worker 非 JSON 帧: {line[:160]!r}") from exc
                if isinstance(msg.get("id"), (int, str)) and msg.get("id") in self._pending:
                    fut = self._pending.pop(msg["id"])
                    if fut.done():
                        continue
                    if "error" in msg:
                        fut.set_exception(WorkerProtocolError(msg["error"].get("message", "worker error")))
                    else:
                        fut.set_result(msg.get("result"))
                elif msg.get("method") and self.on_notification:
                    await self.on_notification(msg["method"], msg.get("params") or {})
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            self._fail_pending(f"worker 读取失败: {exc}")
        finally:
            stderr_task.cancel()
            self._fail_pending("worker 已退出,未返回请求结果")

    def _fail_pending(self, message: str) -> None:
        pending = list(self._pending.values())
        self._pending.clear()
        for fut in pending:
            if not fut.done():
                fut.set_exception(WorkerProtocolError(message))

    async def _drain_stderr(self) -> None:
        assert self.proc and self.proc.stderr
        try:
            while True:
                line = await self.proc.stderr.readline()
                if not line:
                    break
                self.stderr_tail = (self.stderr_tail + line.decode("utf-8", "replace"))[-6000:]
                print(f"[agent-worker] {line.decode('utf-8', 'replace').rstrip()}", flush=True)
        except asyncio.CancelledError:
            raise

    async def request(self, method: str, params: Optional[dict] = None, timeout: float = 30.0) -> Any:
        if self.proc is None or self.proc.stdin is None:
            raise WorkerProtocolError("worker 未启动")
        self._next_id += 1
        msg_id = self._next_id
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[msg_id] = fut
        payload = {"jsonrpc": "2.0", "id": msg_id, "method": method,
                   "params": {"protocol_version": 1, **(params or {})}}
        self.proc.stdin.write((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))
        await self.proc.stdin.drain()
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        finally:
            if self._pending.get(msg_id) is fut:
                self._pending.pop(msg_id, None)

    async def wait_exit(self) -> Optional[int]:
        if self.proc is None:
            return None
        return await self.proc.wait()

    async def stop(self) -> None:
        if self.proc is None:
            return
        try:
            await asyncio.wait_for(self.request("worker.shutdown", {}, timeout=8), timeout=8)
        except Exception:  # noqa: BLE001
            pass
        try:
            await asyncio.wait_for(self.proc.wait(), timeout=5)
        except asyncio.TimeoutError:
            self.proc.kill()
            await self.proc.wait()
        if self._reader_task:
            self._reader_task.cancel()
        self._fail_pending("worker 已停止")
        self.proc = None
