"""Bounded subprocess execution with per-job cancellation, without shell parsing."""
from __future__ import annotations

import os
import json
import signal
import subprocess
import threading
import time
from pathlib import Path

from .runtime import OfficeError, environment

INSTALL_PROGRESS_STATES = {"waiting", "downloading", "verifying", "extracting"}
INSTALL_TIMEOUT_SECONDS = 1800.0


def terminate_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run([str(Path(os.environ["SystemRoot"]) / "System32/taskkill.exe"),
                        "/PID", str(proc.pid), "/T", "/F"], capture_output=True, timeout=15)
    elif getattr(proc, "office_owns_group", True):
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    else:
        proc.kill()
    proc.wait(timeout=15)


def execute(argv: list[str], work: Path, *, timeout: float = 120,
            cancel: threading.Event | None = None,
            progress=None) -> dict:
    work.mkdir(parents=True, exist_ok=True)
    if cancel and cancel.is_set():
        raise OfficeError("OFFICE_CANCELED", "作业已取消。")
    # Stream to files rather than unbounded PIPE buffers; cap returned diagnostics.
    log_id = time.time_ns()
    out_path, err_path = work / f"{log_id}.stdout.log", work / f"{log_id}.stderr.log"
    progress_path = work / f"{log_id}.office-progress.json"
    progress_mtime = 0
    install_elapsed = 0.0
    compute_elapsed = 0.0
    last_tick = time.monotonic()
    install_state = False
    with out_path.open("wb") as out, err_path.open("wb") as err:
        env = environment(work)
        # A render CLI and its LibreOffice descendants share one owned group.
        own_group = os.environ.get("CRAWSHRIMP_OFFICE_CHILD") != "1"
        env["CRAWSHRIMP_OFFICE_CHILD"] = "1"
        if progress:
            env["CRAWSHRIMP_OFFICE_PROGRESS_FILE"] = str(progress_path)
        proc = subprocess.Popen(argv, cwd=work, env=env, shell=False,
                                stdout=out, stderr=err, start_new_session=os.name != "nt" and own_group)
        proc.office_owns_group = own_group
        compute_limit = max(1, min(timeout, 300))
        try:
            while proc.poll() is None:
                now = time.monotonic()
                delta = max(0.0, now - last_tick)
                last_tick = now
                if install_state:
                    install_elapsed += delta
                else:
                    compute_elapsed += delta
                if progress and progress_path.is_file():
                    try:
                        stat = progress_path.stat()
                        if stat.st_mtime_ns != progress_mtime:
                            progress_mtime = stat.st_mtime_ns
                            payload = json.loads(progress_path.read_text(encoding="utf-8"))
                            progress(payload)
                            install_state = payload.get("state") in INSTALL_PROGRESS_STATES
                    except (OSError, json.JSONDecodeError, TypeError, ValueError):
                        pass
                if cancel and cancel.is_set():
                    raise OfficeError("OFFICE_CANCELED", "作业已取消。")
                if install_elapsed >= INSTALL_TIMEOUT_SECONDS:
                    raise OfficeError("OFFICE_INSTALL_TIMEOUT", "Office 资源安装超时。")
                if compute_elapsed >= compute_limit:
                    raise OfficeError("OFFICE_TIMEOUT", "办公处理超时，原件已保留。")
                if out_path.stat().st_size + err_path.stat().st_size > 8 * 1024 * 1024:
                    raise OfficeError("OFFICE_OUTPUT_LIMIT", "办公脚本日志超过 8MB，请缩减日志。")
                time.sleep(0.1)
        finally:
            terminate_tree(proc)
    def tail(path: Path) -> str:
        with path.open("rb") as stream:
            stream.seek(max(0, path.stat().st_size - 16000))
            return stream.read().decode("utf-8", errors="replace")
    result = {"exit_code": proc.returncode, "stdout": tail(out_path), "stderr": tail(err_path)}
    if proc.returncode:
        raise OfficeError("OFFICE_PROCESS_FAILED", result["stderr"] or result["stdout"] or "办公处理失败。")
    return result
