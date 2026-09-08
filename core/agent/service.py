"""智能体服务编排:队列、Run 状态机、事件投影、审批、SSE 扇出、Worker 监督。

经典产品队列保持单 Active Run；DSH Web 原生会话按 runtime session 独立投影，
MCP 工具调用通过会话上下文 lease 绑定正确 run。业务 Task Instance 不受此限制。
"""
from __future__ import annotations

import asyncio
import copy
import inspect
import json
import math
import os
import re
import secrets
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Mapping, Optional

from core import data_sink
from core.atomic_file import atomic_write_text, remove_path_with_retry
from core.agent import db
from core.agent import mcp_gateway
from core.agent.redaction import REDACTED, redact_text as _redact_secret_text, redact_value
from core.agent.cordis_config import AGENT_PERSONA, resolve_provider_for_model, model_capabilities
from core.llm_gateway import (
    BUILTIN_LLM_PROVIDERS,
    DEFAULT_MODEL,
    any_llm_api_key_configured,
    custom_providers_runtime_payload,
    deepseek_api_key_configured,
    glm_api_key_configured,
    official_real_model,
    gateway_api_key_configured,
    model_has_configured_key,
    select_default_model,
)
from core.agent.worker import AgentWorker, resolve_harness_root, resolve_node_executable
from core.config import load_config

APPROVAL_WAIT_SECONDS = 15 * 60
APPROVAL_MAX_CONCURRENCY = 4
MCP_CONTEXT_LEASE_MAX_SECONDS = 30 * 60
DEFAULT_INHERITED_AUTOMATION_WAIT_SECONDS = 5 * 60
MAX_INHERITED_AUTOMATION_WAIT_SECONDS = 2 * 60 * 60
# A native DSH turn can ask for its first MCP tool immediately after the
# renderer announces its Session.  Give the renderer-owned follow a chance to
# project that exact turn before replacing it, then allow one bounded scoped
# re-follow.  The whole barrier remains well below the product bridge's 30s
# request timeout.
NATIVE_WEB_CONTEXT_INITIAL_WAIT_SECONDS = 4
NATIVE_WEB_CONTEXT_FOLLOW_TIMEOUT_SECONDS = 4
NATIVE_WEB_CONTEXT_PROJECTION_WAIT_SECONDS = 6

# 审批桥最长会阻塞十五分钟，绝不能占用 asyncio 默认线程池（否则普通
# to_thread 文件/CDP 操作会被审批等待饿死）。并发槽在提交 executor 前获取，
# 因此 ThreadPoolExecutor 的内部队列始终不会积压超过工作线程数。
_APPROVAL_EXECUTOR = ThreadPoolExecutor(
    max_workers=APPROVAL_MAX_CONCURRENCY,
    thread_name_prefix="crawshrimp-approval",
)

# 免审批任务:简单下载/找图类(用户指令明确请求执行时自动放行,审计保留)
AUTO_APPROVE_TASK_IDS = frozenset({"batch_image_download", "cloud_folder_download"})


class AgentModelConfigurationError(RuntimeError):
    """Raised when no configured model route can safely start the DSH runtime."""


class AutomationRunTimeoutError(RuntimeError):
    """A durable Automation exhausted its own configured execution budget."""


def _automation_worker_timeout_seconds(item: dict) -> float:
    """Return the per-run Automation deadline without changing interactive defaults.

    A user-facing Automation policy is authoritative only for Controller-owned
    turns.  Normal interactive turns intentionally retain the established
    thirty-minute worker timeout plus protocol grace period.
    """
    if not str((item or {}).get("automation_run_uid") or "").strip():
        return float(30 * 60 + 60)
    policy = (item or {}).get("automation_policy")
    execution_policy = policy.get("execution_policy") if isinstance(policy, dict) else {}
    raw = execution_policy.get("timeout_seconds") if isinstance(execution_policy, dict) else None
    if raw is None or str(raw).strip() == "":
        # Definitions created before the timeout control existed must remain
        # bounded too; match the Automation Center's visible default.
        return 300.0
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return 300.0
    if not math.isfinite(value) or value <= 0:
        return 300.0
    # Keep malformed or hand-edited local SQLite values from creating an
    # effectively unbounded unattended execution.  The Controller performs
    # normal API validation for new definitions; this is a recovery guard.
    return min(value, float(2 * 60 * 60))


def _inherited_automation_wait_seconds(automation: dict) -> int:
    """Return the bounded queue wait for an inherited Automation turn.

    An inherited turn shares the source DSH conversation and cannot preempt an
    interactive turn.  Old definitions predate this option, so they receive
    the visible five-minute default instead of an unbounded queue wait.
    """
    policy = (automation or {}).get("execution_policy")
    raw = policy.get("inherited_wait_seconds") if isinstance(policy, dict) else None
    if raw is None or str(raw).strip() == "":
        return DEFAULT_INHERITED_AUTOMATION_WAIT_SECONDS
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return DEFAULT_INHERITED_AUTOMATION_WAIT_SECONDS
    if not math.isfinite(value) or not value.is_integer() or value <= 0:
        return DEFAULT_INHERITED_AUTOMATION_WAIT_SECONDS
    return min(int(value), MAX_INHERITED_AUTOMATION_WAIT_SECONDS)


class McpContextUnavailableError(LookupError):
    """One native-Web Session was not ready after its scoped recovery barrier."""

    code = "RUNTIME_SESSION_CONTEXT_NOT_READY"
    retryable = True
    retry_after_ms = 1500
    public_message = "当前会话仍在建立执行上下文，请稍候重试刚才的操作。"

    def __init__(self, runtime_session_id: str, reason: str = "") -> None:
        # `reason` and the runtime id are useful for local diagnostics, but are
        # deliberately not transported into the DSH conversation: they are
        # implementation details and previously exposed the misleading
        # "active run" wording to end users.
        self.runtime_session_id = str(runtime_session_id or "").strip()
        self.reason = str(reason or "").strip()
        super().__init__(self.public_message)


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


def _decode_process_output(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    data = bytes(value)
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        import locale
        encoding = locale.getpreferredencoding(False) or "utf-8"
        return data.decode(encoding, errors="replace")


def _cleanup_orphan_runtimes(data_root: str) -> None:
    """清理本 data 目录的孤儿 worker/harness 进程(后端被强杀后的残留)。

    匹配依据:进程环境含本 data 目录的 harness 会话根路径。
    """
    if os.name == "nt":
        _cleanup_orphan_runtimes_windows(data_root)
        return
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
        if "@deepseek-ai/dsh/lib/bin.js" not in line and "worker/worker.mjs" not in line:
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


def _cleanup_orphan_runtimes_windows(data_root: str) -> None:
    """Windows 版孤儿 runtime 清理。

    Win32_Process 不暴露子进程环境变量，因此不能像 POSIX ps eww 那样匹配
    CRAWSHRIMP_SESSION_ROOT。这里退而匹配抓虾 DSH runtime/worker 的命令行入口，
    只在父进程已经不存在时终止，避免误杀仍由另一个抓虾桌面实例托管的进程。
    """
    import json as _json
    import subprocess as _subprocess

    harness_root = str(resolve_harness_root())
    needles = [
        str(Path(harness_root) / "worker" / "worker.mjs"),
        str(Path(harness_root) / "node_modules" / "@deepseek-ai" / "dsh" / "lib" / "bin.js"),
        "worker/worker.mjs",
        "worker\\worker.mjs",
        "@deepseek-ai/dsh/lib/bin.js",
    ]
    env = dict(os.environ)
    env["CRAWSHRIMP_RUNTIME_NEEDLES_JSON"] = _json.dumps(needles)
    script = r"""
$ErrorActionPreference = 'SilentlyContinue'
$needles = ConvertFrom-Json $env:CRAWSHRIMP_RUNTIME_NEEDLES_JSON
Get-CimInstance Win32_Process |
  Where-Object {
    $cmd = [string]$_.CommandLine
    if (-not $cmd) { return $false }
    foreach ($needle in $needles) {
      if ($needle -and $cmd.Contains([string]$needle)) { return $true }
    }
    return $false
  } |
  Select-Object ProcessId,ParentProcessId,CommandLine |
  ConvertTo-Json -Compress
"""
    try:
        out = _subprocess.run(
            ["powershell", "-NoProfile", "-Command", script],
            capture_output=True,
            timeout=15,
            env=env,
        ).stdout
    except Exception:  # noqa: BLE001
        return
    out = _decode_process_output(out).strip()
    if not out:
        return
    try:
        parsed = _json.loads(out)
    except Exception:  # noqa: BLE001
        return
    processes = parsed if isinstance(parsed, list) else [parsed]
    for entry in processes:
        try:
            pid = int(entry.get("ProcessId") or 0)
            ppid = int(entry.get("ParentProcessId") or 0)
        except (TypeError, ValueError):
            continue
        if pid == os.getpid() or (ppid > 1 and _process_is_alive(ppid)):
            continue
        try:
            _subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], timeout=5, stdout=_subprocess.DEVNULL, stderr=_subprocess.DEVNULL)
            print(f"[agent] 清理 Windows 孤儿 runtime 进程 pid={pid}", flush=True)
        except Exception:  # noqa: BLE001
            pass


def _remove_owned_tree(path: Path) -> None:
    """删除智能体自有目录；符号链接只移除链接本身，绝不跟随到外部目标。"""
    remove_path_with_retry(path)

# 不写入产品事件表的 Harness 事件(窄 spec §7.1)
FILTERED_EVENT_TYPES = {"request/header", "request/context"}

RUN_FINAL_STATUSES = {"completed", "failed", "canceled", "interrupted"}
OUTPUT_BUDGET_ERROR_CODE = "OUTPUT_BUDGET_REACHED"
OUTPUT_BUDGET_NOTICE = "内容较长，已自动分段输出并达到单轮安全上限。当前内容已保留；如需更多内容，可缩小范围或发送“继续”。"
AUTOMATION_POLICY_DENIED_ERROR_CODE = "AUTOMATION_POLICY_DENIED"


def _result_reason(result: dict) -> dict:
    reason = result.get("reason") if isinstance(result, dict) else None
    return reason if isinstance(reason, dict) else {}


def _result_error_code(result: dict) -> Optional[str]:
    error = _result_reason(result).get("error")
    if isinstance(error, dict):
        code = str(error.get("code") or "").strip()
        if code:
            return code
    hook_message = _result_hook_abort_message(result)
    if hook_message and (
        hook_message == AUTOMATION_POLICY_DENIED_ERROR_CODE
        or hook_message.startswith(f"{AUTOMATION_POLICY_DENIED_ERROR_CODE}:")
    ):
        return AUTOMATION_POLICY_DENIED_ERROR_CODE
    return None


def _result_error_message(result: dict) -> Optional[str]:
    error = _result_reason(result).get("error")
    if isinstance(error, dict):
        message = str(error.get("message") or "").strip()
        if message:
            return message
    hook_message = _result_hook_abort_message(result)
    if hook_message and (
        hook_message == AUTOMATION_POLICY_DENIED_ERROR_CODE
        or hook_message.startswith(f"{AUTOMATION_POLICY_DENIED_ERROR_CODE}:")
    ):
        return hook_message
    return None


def _result_hook_abort_message(result: dict) -> Optional[str]:
    reason = _result_reason(result)
    if reason.get("kind") != "aborted":
        return None
    cancel_reason = reason.get("reason")
    if not isinstance(cancel_reason, dict) or cancel_reason.get("kind") != "hook":
        return None
    message = str(cancel_reason.get("reason") or "").strip()
    return message or None


def _is_output_budget_turn_end(reason: dict) -> bool:
    if not isinstance(reason, dict) or reason.get("kind") != "aborted":
        return False
    cancel_reason = reason.get("reason")
    if not isinstance(cancel_reason, dict) or cancel_reason.get("kind") != "hook":
        return False
    return OUTPUT_BUDGET_ERROR_CODE in str(cancel_reason.get("reason") or "")


def _int_env(name: str, default: int, *, minimum: int = 1) -> int:
    try:
        value = int(str(os.environ.get(name, "")).strip() or default)
    except (TypeError, ValueError):
        return default
    return max(minimum, value)


def _float_env(name: str, default: float, *, minimum: float = 0.0) -> float:
    try:
        value = float(str(os.environ.get(name, "")).strip() or default)
    except (TypeError, ValueError):
        return default
    return max(minimum, value)


AGENT_DELTA_FLUSH_INTERVAL_SECONDS = _float_env("CRAWSHRIMP_AGENT_DELTA_FLUSH_MS", 200.0, minimum=10.0) / 1000.0
AGENT_DELTA_FLUSH_BYTES = _int_env("CRAWSHRIMP_AGENT_DELTA_FLUSH_BYTES", 1024)
SSE_QUEUE_MAX_OVERFLOWS = _int_env("CRAWSHRIMP_AGENT_SSE_QUEUE_MAX_OVERFLOWS", 3)
SSE_DISCONNECT = object()

# 分级保护:按 Run 类型传给 worker。长文阈值只做最后保险,持续高速 delta 洪峰会先触发自动分段。
BUDGET_PROFILES = {
    "browser": {"maxSteps": 80, "maxToolCalls": 120, "maxObserve": 40, "maxAct": 50,
                "maxTextDeltas": _int_env("CRAWSHRIMP_AGENT_BROWSER_MAX_TEXT_DELTAS", 20000),
                "maxOutputChars": _int_env("CRAWSHRIMP_AGENT_BROWSER_MAX_OUTPUT_CHARS", 480000),
                "maxOutputSegments": _int_env("CRAWSHRIMP_AGENT_BROWSER_MAX_OUTPUT_SEGMENTS", 6),
                "minOutputDeltasBeforePause": _int_env("CRAWSHRIMP_AGENT_BROWSER_MIN_OUTPUT_DELTAS_BEFORE_PAUSE", 2500),
                "maxTextDeltaRatePerSecond": _float_env("CRAWSHRIMP_AGENT_BROWSER_MAX_TEXT_DELTA_RATE_PER_SECOND", 32.0, minimum=1.0),
                "outputRateWindowMs": _int_env("CRAWSHRIMP_AGENT_BROWSER_OUTPUT_RATE_WINDOW_MS", 10000, minimum=1000),
                "wallclockMs": 30 * 60 * 1000},
    "default": {"maxSteps": 30, "maxToolCalls": 40, "maxObserve": 5, "maxAct": 0,
                "maxTextDeltas": _int_env("CRAWSHRIMP_AGENT_MAX_TEXT_DELTAS", 12000),
                "maxOutputChars": _int_env("CRAWSHRIMP_AGENT_MAX_OUTPUT_CHARS", 240000),
                "maxOutputSegments": _int_env("CRAWSHRIMP_AGENT_MAX_OUTPUT_SEGMENTS", 6),
                "minOutputDeltasBeforePause": _int_env("CRAWSHRIMP_AGENT_MIN_OUTPUT_DELTAS_BEFORE_PAUSE", 2500),
                "maxTextDeltaRatePerSecond": _float_env("CRAWSHRIMP_AGENT_MAX_TEXT_DELTA_RATE_PER_SECOND", 32.0, minimum=1.0),
                "outputRateWindowMs": _int_env("CRAWSHRIMP_AGENT_OUTPUT_RATE_WINDOW_MS", 10000, minimum=1000),
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


def _resolve_configured_generation_model(
    cfg: dict,
    provider_id: Optional[str],
    model_id: Optional[str],
) -> tuple[str, str]:
    requested_model = str(model_id or "").strip()
    if not requested_model or not model_capabilities(requested_model).get("supports_tools"):
        requested_model = select_default_model(cfg)
    if model_has_configured_key(requested_model, cfg):
        return requested_model, resolve_provider_for_model(requested_model, cfg)

    fallback_model = select_default_model(cfg)
    if (
        fallback_model != requested_model
        and model_capabilities(fallback_model).get("supports_tools")
        and model_has_configured_key(fallback_model, cfg)
    ):
        return fallback_model, resolve_provider_for_model(fallback_model, cfg)

    provider_label = str(provider_id or resolve_provider_for_model(requested_model, cfg) or "").strip()
    raise AgentModelConfigurationError(
        f"智能体模型 {requested_model}({provider_label}) 没有可用 API Key；"
        "请配置 DeepSeek/GLM 官方 API Key，或配置网关 API Key 后再使用海外/国内网关模型。"
    )


def _compact_text(value: Any) -> str:
    return str(value or "").strip()


def build_llm_runtime_environment(external_env: Mapping[str, str], cfg: Mapping[str, Any]) -> dict[str, str]:
    """Build a fresh DSH child environment from external values and current config.

    The caller supplies a process-start snapshot of truly external variables.
    Settings override that snapshot for this generation only; clearing a setting
    means no service-owned value is exported, so old keys cannot survive a
    runtime restart through ``os.environ``.
    """
    env = {str(key): str(value) for key, value in dict(external_env or {}).items()}
    ai = cfg.get("ai") if isinstance(cfg, Mapping) else None
    llm = ai.get("llm") if isinstance(ai, Mapping) else None
    llm = llm if isinstance(llm, Mapping) else {}

    legacy_config_key = _compact_text(llm.get("api_key"))
    if legacy_config_key:
        env["CRAWSHRIMP_LLM_API_KEY"] = legacy_config_key
    for provider in BUILTIN_LLM_PROVIDERS:
        env_key = _compact_text(provider.get("api_key_env"))
        config_key = _compact_text(provider.get("api_key_key"))
        if env_key and config_key:
            configured = _compact_text(llm.get(config_key))
            if not configured and provider.get("legacy_gateway"):
                configured = legacy_config_key
            if configured:
                env[env_key] = configured
        base_env_key = _compact_text(provider.get("base_url_env"))
        base_config_key = _compact_text(provider.get("base_url_key"))
        configured_base = _compact_text(llm.get(base_config_key)) if base_config_key else ""
        if base_env_key and configured_base:
            env[base_env_key] = configured_base

    # The temporary upstream alias lives only in this child environment.  Do
    # not overwrite a real process-start DEEPSEEK_* override, and do not leave
    # any alias behind once the service-owned Crawshrimp setting is cleared.
    deepseek_key = _compact_text(env.get("CRAWSHRIMP_DEEPSEEK_API_KEY"))
    deepseek_base = _compact_text(env.get("CRAWSHRIMP_DEEPSEEK_BASE_URL"))
    if deepseek_key and not _compact_text(external_env.get("DEEPSEEK_API_KEY")):
        env["DEEPSEEK_API_KEY"] = deepseek_key
    if deepseek_base and not _compact_text(external_env.get("DEEPSEEK_BASE_URL")):
        env["DEEPSEEK_BASE_URL"] = deepseek_base

    custom_providers, custom_env = custom_providers_runtime_payload(dict(cfg))
    env.update(custom_env)
    env["CRAWSHRIMP_LLM_PROVIDERS_JSON"] = json.dumps(custom_providers, ensure_ascii=False)
    return env


def _dsh_llm_pi_ai_settings(
    cfg: dict,
    custom_provider_profiles: list[dict[str, Any]],
    runtime_env: Optional[Mapping[str, str]] = None,
) -> dict[str, Any]:
    llm = (cfg.get("ai") or {}).get("llm") or {}
    llm = llm if isinstance(llm, dict) else {}
    providers: dict[str, Any] = {}
    for provider in BUILTIN_LLM_PROVIDERS:
        provider_id = str(provider.get("id") or "").strip()
        if not provider_id:
            continue
        models = []
        for model_id in provider.get("models") or []:
            cap = model_capabilities(str(model_id))
            runtime_model_id = official_real_model(str(model_id)) if (
                provider.get("official_deepseek") or provider.get("official_glm")
            ) else str(model_id)
            model = {
                "id": runtime_model_id,
                "contextWindow": int(cap.get("context_window") or 64000),
                "maxTokens": int(cap.get("max_output_tokens") or 8192),
                "input": list(cap.get("input_modalities") or ["text"]),
            }
            if provider.get("official_deepseek") and model["input"] == ["text"]:
                model["reasoningEfforts"] = {"off": None, "low": "low", "high": "high", "max": "max"}
            models.append(model)
        base_url = (
            _compact_text(llm.get(str(provider.get("base_url_key") or "")))
            or _compact_text((runtime_env or os.environ).get(str(provider.get("base_url_env") or "")))
            or str(provider.get("base_url_default") or "")
        )
        entry: dict[str, Any] = {
            "displayName": str(provider.get("display_name") or provider_id),
            "apiKeyEnv": str(provider.get("api_key_env") or ""),
            "api": str(provider.get("api") or "openai-completions"),
            "baseURL": base_url,
            "models": models,
        }
        providers[provider_id] = entry
    for provider in custom_provider_profiles:
        provider_id = _compact_text(provider.get("id"))
        if not provider_id:
            continue
        providers[provider_id] = {
            "displayName": _compact_text(provider.get("displayName")) or provider_id,
            "apiKeyEnv": _compact_text(provider.get("apiKeyEnv")),
            "api": "anthropic-messages" if provider.get("api") == "anthropic-messages" else "openai-completions",
            "baseURL": _compact_text(provider.get("baseURL")),
            "models": list(provider.get("models") or []),
        }
    return {"providers": providers}


def _sync_dsh_default_model_settings(
    agent_dir: Path,
    provider_id: str,
    runtime_model_id: str,
    cfg: Optional[dict] = None,
    custom_provider_profiles: Optional[list[dict[str, Any]]] = None,
    runtime_env: Optional[Mapping[str, str]] = None,
) -> None:
    settings_path = agent_dir / "dsh-home" / "settings.yaml"
    try:
        import yaml
    except ImportError as exc:  # pragma: no cover - pyyaml is in core requirements.
        raise AgentModelConfigurationError("缺少 PyYAML，无法准备智能体运行时模型配置。") from exc

    settings: dict[str, Any] = {}
    if settings_path.exists():
        loaded = yaml.safe_load(settings_path.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            settings = loaded
    current = settings.get("agent-default-model")
    entry = dict(current) if isinstance(current, dict) else {}
    entry.update({"provider": provider_id, "model": runtime_model_id})
    # DSH persists the complete default selection.  A previous text-only
    # selection may carry `reasoningEffort: high`; carrying it into a vision
    # route makes DeepSeek reject the first image turn.  The generated
    # Crawshrimp catalog only exposes reasoning controls for text-only routes,
    # so remove that stale field whenever the new model is multimodal.
    runtime_is_multimodal = (
        "image" in list(model_capabilities(runtime_model_id).get("input_modalities") or [])
        # Official DeepSeek provider IDs are normalized before entering DSH,
        # while the product capability table uses the `official` prefix.
        or runtime_model_id.endswith("-vision-exp")
    )
    if runtime_is_multimodal:
        entry.pop("reasoningEffort", None)
    elif provider_id == "crawshrimp-deepseek-official" and runtime_model_id in (
        "deepseek-v4-flash", "deepseek-v4-pro",
    ):
        # Default new/unconfigured text-model sessions to High. Explicit user
        # selections (including off/low) remain authoritative across restarts.
        entry.setdefault("reasoningEffort", "high")
    settings["agent-default-model"] = entry
    settings["llm-pi-ai"] = _dsh_llm_pi_ai_settings(
        cfg if isinstance(cfg, dict) else {},
        custom_provider_profiles if isinstance(custom_provider_profiles, list) else [],
        runtime_env,
    )
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_text(settings_path, yaml.safe_dump(settings, allow_unicode=True, sort_keys=False))


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


def _brief_display_value(value: Any, max_chars: int = 48) -> str:
    text = str(value)
    text = " ".join(text.split())
    if len(text) > max_chars:
        text = text[:max_chars] + "..."
    return text


def _approval_brief_params(summary: dict, plan: dict) -> list[str]:
    items: list[tuple[str, Any]] = []
    if isinstance(summary.get("params"), dict):
        items.extend(list(redact_value(summary.get("params")).items())[:6])
    for key in (
        "path",
        "size",
        "command",
        "url",
        "repo",
        "draft_path",
        "task_instance_uid",
        "action",
    ):
        value = summary.get(key)
        if value not in (None, ""):
            items.append((key, redact_value(value)))
    for key in ("adapter_id", "task_id", "plan_id"):
        value = plan.get(key)
        if value not in (None, ""):
            items.append((key, value))

    seen: set[str] = set()
    brief: list[str] = []
    for key, value in items:
        key_text = str(key or "").strip()
        if not key_text or key_text in seen:
            continue
        seen.add(key_text)
        brief.append(f"{key_text}={_brief_display_value(value)}")
        if len(brief) >= 6:
            break
    return brief


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
        return "在本机执行一条命令；完整命令已收起，只展示简略参数。"
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


def _approval_runtime_call_id() -> str:
    """Return the DSH call id for the current MCP tool, without the run prefix."""
    raw = str(getattr(mcp_gateway.ctx, "current_tool_call_id", "") or "").strip()
    if not raw:
        return ""
    return raw.split(":", 1)[1].strip() if ":" in raw else raw


def _cap_approval_display_arguments(value: Any, max_chars: int = 4_500) -> Any:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    if len(text) <= max_chars:
        return value
    suffix = f"...(truncated, original length {len(text)})"
    return f"{text[:max(0, max_chars - len(suffix))]}{suffix}"


def _approval_display_arguments(summary: dict, plan: dict, risk: str) -> Any:
    """Build the brief, display-only argument summary used by IM approvals."""
    safe_summary = summary if isinstance(summary, dict) else {}
    safe_plan = plan if isinstance(plan, dict) else {}
    lines = []
    if risk:
        lines.append(f"风险:{risk}")
    brief = _approval_brief_params(safe_summary, safe_plan)
    if brief:
        lines.append("关键参数:" + "; ".join(brief))
    if not lines:
        lines.append("关键参数:无")
    return _cap_approval_display_arguments("\n".join(lines), 900)


class AgentService:
    def __init__(self) -> None:
        # Snapshot only actual process-start values. Runtime generations never
        # write their own credentials back to os.environ, so a subsequent
        # restart can distinguish an operator fallback from an old UI setting.
        self._external_runtime_env = dict(os.environ)
        self.main_loop: Optional[asyncio.AbstractEventLoop] = None
        self.worker: Optional[AgentWorker] = None
        self.generation = 0
        self.runtime_token = secrets.token_hex(32)  # 256-bit
        self.runtime_state = "stopped"  # stopped|starting|ready|needs_configuration|crashed|disabled_until_manual_restart
        self.runtime_error = ""
        self.runtime_error_code = ""
        self.crash_budget: list[float] = []
        self.web_port = 0
        # rc.1 Web Host issues an authenticated, one-time iframe launch URL.
        # It is never logged, persisted, or shown in settings; it exists only
        # while this in-memory runtime generation is alive.
        self._web_launch_url = ""
        self._web_origin = ""

        self.queue: asyncio.Queue[dict] = asyncio.Queue()
        self.active_run: Optional[dict] = None          # run 行
        self.active_run_task: Optional[asyncio.Task] = None
        self.queue_task: Optional[asyncio.Task] = None
        # DSH also hosts long-lived IM channel connections. Start it with the
        # core service, but never hold FastAPI startup on the runtime boot path.
        self._runtime_startup_task: Optional[asyncio.Task] = None

        self.approval_waits: dict[str, asyncio.Future] = {}
        self._approval_slots = asyncio.Semaphore(APPROVAL_MAX_CONCURRENCY)
        self.subscribers: dict[str, set[asyncio.Queue]] = {}
        self.global_subscribers: set[asyncio.Queue] = set()
        self.sse_dropped_events = 0
        self._sse_queue_overflows: dict[asyncio.Queue, int] = {}
        self._assistant_streams: dict[str, dict] = {}
        # web UI 原生会话的影子投影:runtime_session_id → 影子 run
        self.shadow_runs: dict[str, dict] = {}
        # MCP client 是 runtime 级单连接，但 DSH Web 可并行运行多个会话。
        # 这里保存 runtime session → run 的真值；产品桥在每次 MCP 工具调用
        # 外层获取会话 lease，并通过请求级 context 绑定 run/grant，避免跨会话串线。
        self.active_runs_by_runtime: dict[str, dict] = {}
        self.grants_by_run: dict[str, dict] = {}
        self._runtime_mutation_lock = asyncio.Lock()
        self._mcp_context_leases: dict[str, dict] = {}
        self._mcp_lease_expiry_tasks: dict[str, asyncio.Task] = {}
        # The first native-Web tool can arrive before the renderer's initial
        # follow is projected. These waiters recover only that exact session.
        self._native_web_context_events: dict[str, asyncio.Event] = {}
        self._native_web_context_recovery_locks: dict[str, asyncio.Lock] = {}

        self._mcp_app = None
        self._mcp_uvicorn = None
        self._mcp_task: Optional[asyncio.Task] = None
        self._mcp_socket = None
        self.mcp_port = 0
        self.mcp_url = "http://127.0.0.1:18965/mcp"
        self.generation_model: Optional[str] = None
        self.generation_model_provider: Optional[str] = None
        self._callbacks: dict[str, Any] = {}
        self.automation_controller = None
        self._automation_receipt_retry_tasks: dict[str, asyncio.Task] = {}
        # Only inherited Automation turns need this deadline.  The queue is
        # still globally serialized by the DSH worker, but this separate
        # record makes the source-session safety guarantee observable and
        # prevents a scheduled turn waiting behind interactive work forever.
        self._inherited_automation_wait_tasks: dict[str, asyncio.Task] = {}
        self._inherited_automation_waits: dict[str, dict] = {}

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

    def set_automation_controller(self, controller: Any) -> None:
        """Bind the Controller that owns Automation run lifecycle state."""
        self.automation_controller = controller

    async def _project_automation_agent_terminal(
        self,
        item: dict,
        *,
        status: str,
        error_code: str = "",
        error_message: str = "",
        retryable: bool = False,
    ) -> dict:
        """Close the durable Automation Run after its linked Agent Run ends."""
        automation_run_uid = str(item.get("automation_run_uid") or "").strip()
        agent_run_id = str(item.get("run_id") or "").strip()
        if not automation_run_uid or not agent_run_id:
            return {}
        controller = self.automation_controller or getattr(mcp_gateway.ctx, "automation_controller", None)
        project = getattr(controller, "project_agent_run_terminal", None)
        if not callable(project):
            return {}
        try:
            result = project(
                automation_run_uid,
                agent_run_id,
                status,
                error_code=error_code,
                error_message=error_message,
                retryable=retryable,
            )
            if inspect.isawaitable(result):
                result = await result
            return dict(result) if isinstance(result, dict) else {}
        except Exception:  # noqa: BLE001
            # The Agent run itself is already durably terminal.  Never allow a
            # projection exception to reopen it or suppress the normal event.
            logger.exception("Unable to project terminal Agent Run onto Automation")
            return {}

    async def _cancel_automation_task_instances(self, automation_run_uid: str) -> None:
        """Best-effort stop for tasks created by one canceled Automation run."""
        run_uid = str(automation_run_uid or "").strip()
        control = self._callbacks.get("control_task_instance")
        if not run_uid or not callable(control):
            return
        for link in data_sink.list_agent_automation_run_links(run_uid):
            if str(link.get("link_kind") or "") != "task_instance":
                continue
            task_instance_uid = str(link.get("link_uid") or "").strip()
            if not task_instance_uid:
                continue
            try:
                result = control(task_instance_uid, "stop")
                if inspect.isawaitable(result):
                    await result
            except Exception:  # noqa: BLE001
                # The Automation Run still records the terminal timeout or
                # cancellation. A failed downstream stop remains observable
                # in Task Center rather than blocking worker cleanup forever.
                logger.exception("Unable to stop Automation task instance %s", task_instance_uid)

    async def _cancel_automation_tasks_for_agent_run(self, agent_run_id: str) -> None:
        run = data_sink.get_agent_automation_run_by_agent_run_id(agent_run_id)
        if run:
            await self._cancel_automation_task_instances(run.get("run_uid") or "")

    def register_run_context(self, runtime_session_id: str, run: dict,
                             grant: Optional[dict] = None) -> None:
        runtime_id = str(runtime_session_id or "").strip()
        run_id = str((run or {}).get("run_id") or "").strip()
        if not runtime_id or not run_id:
            raise ValueError("runtime_session_id/run_id 必填")
        self.active_runs_by_runtime[runtime_id] = dict(run)
        self._native_web_context_events.setdefault(runtime_id, asyncio.Event()).set()
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
        event = self._native_web_context_events.get(runtime_id)
        if event is not None:
            event.clear()
        for lease_id, lease in list(self._mcp_context_leases.items()):
            if lease.get("runtime_session_id") == runtime_id:
                self.release_mcp_context(lease_id)
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
        读取 exec.agent.id，因此先签发一个会话 lease，再由每个 MCP HTTP 请求
        用该 lease 绑定对应 run。未知会话安全失败，不回退到“最近一个 run”。
        """
        runtime_id = str(runtime_session_id or "").strip()
        run = self.active_runs_by_runtime.get(runtime_id)
        if not run:
            run = await self._recover_native_web_mcp_context(runtime_id)
        run_id = str(run.get("run_id") or "").strip()
        call_text = str(call_id or "").strip()
        lease_id = f"lease-{uuid.uuid4().hex[:16]}"
        lease = {
            "lease_id": lease_id,
            "runtime_session_id": runtime_id,
            "active_run": dict(run),
            "grant": self.grants_by_run.get(run_id),
            "current_tool_call_id": f"{run_id}:{call_text}" if run_id and call_text else "",
            "automation_policy": copy.deepcopy(run.get("automation_policy")) if isinstance(run.get("automation_policy"), dict) else None,
            "automation_run_uid": str(run.get("automation_run_uid") or "").strip(),
            "created_at": _now_iso(),
        }
        self._mcp_context_leases[lease_id] = lease
        self._mcp_lease_expiry_tasks[lease_id] = asyncio.create_task(
            self._expire_mcp_context_lease(lease_id)
        )
        return {
            "lease_id": lease_id,
            "run_id": run.get("run_id"),
            "session_id": run.get("session_id"),
            "call_id": call_text,
        }

    async def _recover_native_web_mcp_context(self, runtime_session_id: str) -> dict:
        """Wait for one named Web follow, then refresh only that Session once.

        The worker receives only the runtime session supplied by DSH. There is
        deliberately no latest-run or cross-session fallback here.
        """
        runtime_id = str(runtime_session_id or "").strip()
        if not runtime_id:
            raise McpContextUnavailableError(runtime_id, "INVALID_SESSION_ID")
        # A stopped/crashed host cannot possibly emit this Session's
        # `turn/start`; fail through the same safe retry contract instead of
        # occupying the readiness barrier pointlessly.
        if self.runtime_state != "ready" or self.worker is None:
            raise McpContextUnavailableError(runtime_id, "RUNTIME_UNAVAILABLE")
        lock = self._native_web_context_recovery_locks.setdefault(runtime_id, asyncio.Lock())
        async with lock:
            run = self.active_runs_by_runtime.get(runtime_id)
            if run:
                return run
            projected = self._native_web_context_events.setdefault(runtime_id, asyncio.Event())
            # The renderer has already registered a follow for this exact
            # Session. Its first `turn/start` can arrive just after the tool
            # request, so do not tear it down immediately: wait for that
            # projection before performing a scoped reconnect.
            try:
                await asyncio.wait_for(
                    projected.wait(), timeout=NATIVE_WEB_CONTEXT_INITIAL_WAIT_SECONDS,
                )
            except TimeoutError:
                pass
            run = self.active_runs_by_runtime.get(runtime_id)
            if run:
                return run

            # The initial follow did not materialize a turn in time. Clear the
            # event immediately before the re-follow so only a fresh
            # projection for this *same* runtime Session opens the barrier.
            projected.clear()
            recovery_owner = "mcp-recovery"
            try:
                response = await self.observe_native_web_session(
                    runtime_id,
                    refresh=True,
                    timeout=NATIVE_WEB_CONTEXT_FOLLOW_TIMEOUT_SECONDS,
                    owner=recovery_owner,
                )
                run = self.active_runs_by_runtime.get(runtime_id)
                if run:
                    return run
                if not isinstance(response, dict) or response.get("ok") is not True:
                    raw_error = response.get("error") if isinstance(response, dict) else "INVALID_WORKER_RESPONSE"
                    if isinstance(raw_error, dict):
                        reason = str(raw_error.get("code") or raw_error.get("message") or "SESSION_FOLLOW_FAILED")
                    else:
                        reason = str(raw_error or "SESSION_FOLLOW_FAILED")
                    raise McpContextUnavailableError(runtime_id, reason[:120])
                try:
                    await asyncio.wait_for(projected.wait(), timeout=NATIVE_WEB_CONTEXT_PROJECTION_WAIT_SECONDS)
                except TimeoutError as exc:
                    raise McpContextUnavailableError(runtime_id, "SHADOW_RUN_NOT_PROJECTED") from exc
                run = self.active_runs_by_runtime.get(runtime_id)
                if not run:
                    raise McpContextUnavailableError(runtime_id, "SHADOW_RUN_NOT_PROJECTED")
                return run
            finally:
                # Refresh inherits renderer owners in the Node manager. This
                # temporary recovery owner is scoped to this barrier and must
                # never keep an idle socket alive after success or timeout.
                await self.unobserve_native_web_session(runtime_id, owner=recovery_owner)

    async def _expire_mcp_context_lease(self, lease_id: str) -> None:
        try:
            await asyncio.sleep(MCP_CONTEXT_LEASE_MAX_SECONDS)
            self.release_mcp_context(lease_id)
        except asyncio.CancelledError:
            return

    async def report_native_automation_policy_denied(self, runtime_session_id: str, tool_name: str) -> bool:
        """Atomically contain a DSH-native Automation policy violation.

        `tools/pre-execute` executes before native approval and before the tool
        body.  Persist needs_review first, then cancel the exact active Session
        so a model cannot continue an unattended Automation after observing a
        denial result.
        """
        runtime_id = str(runtime_session_id or "").strip()
        run = self.active_runs_by_runtime.get(runtime_id) or {}
        automation_run_uid = str(run.get("automation_run_uid") or "").strip()
        run_id = str(run.get("run_id") or "").strip()
        if not automation_run_uid or not run_id:
            return False
        controller = self.automation_controller or getattr(mcp_gateway.ctx, "automation_controller", None)
        mark = getattr(controller, "mark_needs_review", None)
        if not callable(mark):
            return False
        message = f'Native DSH tool "{str(tool_name or "unknown")[:120]}" is outside the Automation execution policy'
        result = mark(automation_run_uid, "AUTOMATION_POLICY_DENIED", message)
        if inspect.isawaitable(result):
            await result
        if self.worker is not None:
            try:
                await self.worker.request("worker.cancel_active", {"runId": run_id}, timeout=15)
            except Exception:  # noqa: BLE001
                # The durable needs_review audit is already authoritative; the
                # worker's own absolute timeout remains the secondary stop.
                pass
        return True

    def release_mcp_context(self, lease_id: str) -> bool:
        supplied = str(lease_id or "").strip()
        if not supplied:
            return False
        lease = self._mcp_context_leases.pop(supplied, None)
        if lease is None:
            return False
        active_run = lease.get("active_run") or {}
        run_id = str(active_run.get("run_id") or "").strip()
        grant = lease.get("grant")
        if run_id and grant:
            # MCP 工具会在原生审批通过后原地扩充 grant.toolset_json。
            # 每次调用使用独立 lease，因此释放前必须把新权限写回 run 级真值，
            # 否则下一次 acquire 会恢复批准前快照并重复弹审批卡。
            self.grants_by_run[run_id] = dict(grant)
        expiry_task = self._mcp_lease_expiry_tasks.pop(supplied, None)
        if expiry_task and not expiry_task.done():
            try:
                current = asyncio.current_task()
            except RuntimeError:
                current = None
            if expiry_task is not current:
                expiry_task.cancel()
        return True

    def bind_mcp_context_for_request(self, lease_id: str):
        lease = self._mcp_context_leases.get(str(lease_id or "").strip())
        if lease is None:
            raise LookupError("Unknown MCP context lease")
        return mcp_gateway.bind_tool_context(lease)

    def reset_mcp_context_for_request(self, token) -> None:
        mcp_gateway.reset_tool_context(token)

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
        """只公开当前浏览器活动绑定的页面，避免把历史/全局 Chrome tab 展开到 UI。"""
        allowed = set(db.list_granted_tab_ids_for_session(session_id))
        current_tabs = payload.get("tabs") if isinstance(payload.get("tabs"), list) else []
        current_by_id = {
            str(tab.get("id") or ""): tab for tab in current_tabs
            if isinstance(tab, dict) and str(tab.get("id") or "")
        }
        active_tab_id = str(payload.get("active_tab_id") or "")
        candidate_ids = []
        if active_tab_id:
            candidate_ids.append(active_tab_id)
        elif len(current_by_id) == 1:
            candidate_ids.extend(current_by_id)
        elif current_by_id:
            for tab_id in current_by_id:
                if tab_id in allowed:
                    candidate_ids.append(tab_id)
                    break
        try:
            from core.cdp_bridge import get_bridge
            live_pages = [tab for tab in get_bridge().get_tabs(timeout=2) if tab.get("type") == "page"]
        except Exception:  # noqa: BLE001
            live_pages = list(current_by_id.values())
        live_by_id = {str(tab.get("id") or ""): tab for tab in live_pages}
        tabs = []
        seen = set()
        for tab_id in candidate_ids:
            if not tab_id or tab_id in seen:
                continue
            seen.add(tab_id)
            if tab_id not in allowed and tab_id not in current_by_id:
                continue
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
        self._runtime_startup_task = asyncio.create_task(self.start_generation())

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
            context_binder=self.bind_mcp_context_for_request,
            context_resetter=self.reset_mcp_context_for_request,
            native_policy_reporter=self.report_native_automation_policy_denied,
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
        runtime_startup_task = self._runtime_startup_task
        self._runtime_startup_task = None
        if runtime_startup_task is not None:
            if not runtime_startup_task.done():
                runtime_startup_task.cancel()
            try:
                await runtime_startup_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        if self.queue_task:
            self.queue_task.cancel()
            self.queue_task = None
        if self.active_run_task:
            self.active_run_task.cancel()
            self.active_run_task = None
        for task in list(self._automation_receipt_retry_tasks.values()):
            if not task.done():
                task.cancel()
        self._automation_receipt_retry_tasks.clear()
        for task in list(self._inherited_automation_wait_tasks.values()):
            if not task.done():
                task.cancel()
        self._inherited_automation_wait_tasks.clear()
        self._inherited_automation_waits.clear()
        await self._stop_worker()
        await self._stop_mcp_server()
        for fut in self.approval_waits.values():
            if not fut.done():
                fut.set_result("canceled")
        self.approval_waits.clear()
        for lease_id in list(self._mcp_context_leases):
            self.release_mcp_context(lease_id)
        self.active_runs_by_runtime.clear()
        self.grants_by_run.clear()
        self._native_web_context_events.clear()
        self._native_web_context_recovery_locks.clear()

    def _recover_on_startup(self) -> None:
        for run in db.list_nonterminal_runs():
            run_id = str(run["run_id"])
            session_id = str(run["session_id"])
            session = db.get_session(session_id) or {}
            message = _get_message_by_id(f"{run_id}:assistant")
            if message and message.get("status") == "streaming":
                try:
                    content = json.loads(message.get("content_json") or "{}")
                    text = str(content.get("text") or "")
                except (TypeError, ValueError):
                    text = ""
                db.update_message(message["message_id"], status="complete", completed_at=_now_iso())
                if text:
                    db.append_event(session_id, run_id, "assistant.completed", {
                        "run_id": run_id,
                        "text": text,
                        "session_id": session_id,
                        "runtime_session_id": session.get("runtime_session_id") or "",
                    })
            db.update_run(run["run_id"], status="interrupted", finished_at=_now_iso(),
                          error_code="AGENT_DISPATCH_INTERRUPTED")
            db.update_turn(run.get("turn_id") or "", status="interrupted", completed_at=_now_iso())
            db.update_session(session_id, status="idle")
            db.append_event(session_id, run_id, "run.interrupted", {
                "run_id": run_id,
                "status": "interrupted",
                "error_code": "AGENT_DISPATCH_INTERRUPTED",
                "session_id": session_id,
                "runtime_session_id": session.get("runtime_session_id") or "",
            })
        canceled = db.cancel_pending_approvals()
        if canceled:
            print(f"[agent] 启动恢复:取消 {canceled} 条 pending 审批")

    # ---------- 事件订阅 ----------

    def subscribe(self, session_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self.subscribers.setdefault(session_id, set()).add(queue)
        self._sse_queue_overflows.pop(queue, None)
        return queue

    def unsubscribe(self, session_id: str, queue: asyncio.Queue) -> None:
        subs = self.subscribers.get(session_id)
        if subs:
            subs.discard(queue)
        self._sse_queue_overflows.pop(queue, None)

    def subscribe_all(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self.global_subscribers.add(queue)
        self._sse_queue_overflows.pop(queue, None)
        return queue

    def unsubscribe_all(self, queue: asyncio.Queue) -> None:
        self.global_subscribers.discard(queue)
        self._sse_queue_overflows.pop(queue, None)

    def _record_sse_queue_full(self, queue: asyncio.Queue, *,
                               session_id: str = "", global_stream: bool = False) -> None:
        self.sse_dropped_events += 1
        overflow_count = self._sse_queue_overflows.get(queue, 0) + 1
        self._sse_queue_overflows[queue] = overflow_count
        label = "global" if global_stream else "session"
        if self.sse_dropped_events == 1 or self.sse_dropped_events % 100 == 0:
            print(f"[agent] SSE {label} 队列已满，累计丢弃 {self.sse_dropped_events} 次；客户端将按 SQLite cursor 补放", flush=True)
        if overflow_count < SSE_QUEUE_MAX_OVERFLOWS:
            return
        if global_stream:
            self.global_subscribers.discard(queue)
        else:
            subs = self.subscribers.get(session_id)
            if subs:
                subs.discard(queue)
        self._sse_queue_overflows.pop(queue, None)
        while True:
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        queue.put_nowait(SSE_DISCONNECT)
        print(f"[agent] SSE {label} 订阅者连续 {overflow_count} 次不消费，已断开以触发 cursor 补放", flush=True)

    def _fanout_sse_message(self, queue: asyncio.Queue, message: dict, *,
                            session_id: str = "", global_stream: bool = False) -> None:
        try:
            queue.put_nowait(message)
            self._sse_queue_overflows.pop(queue, None)
        except asyncio.QueueFull:
            self._record_sse_queue_full(queue, session_id=session_id, global_stream=global_stream)

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
            self._fanout_sse_message(queue, message, session_id=session_id)
        gmessage = message
        for queue in list(self.global_subscribers):
            self._fanout_sse_message(queue, gmessage, global_stream=True)

    def _assistant_stream_state(self, session_id: str, run: dict) -> dict:
        run_id = str(run["run_id"])
        state = self._assistant_streams.get(run_id)
        if state is not None:
            return state
        message_id = f"{run_id}:assistant"
        existing = _get_message_by_id(message_id)
        text = ""
        if existing:
            try:
                content = json.loads(existing.get("content_json") or "{}")
                text = str(content.get("text") or "")
            except (TypeError, ValueError):
                text = ""
        state = {
            "run_id": run_id,
            "session_id": session_id,
            "turn_id": run.get("turn_id"),
            "message_id": message_id,
            "text": text,
            "pending": [],
            "pending_bytes": 0,
            "message_exists": bool(existing),
            "append_assistant_messages": False,
            "flush_task": None,
        }
        self._assistant_streams[run_id] = state
        return state

    def _cancel_assistant_flush_task(self, state: dict) -> None:
        task = state.get("flush_task")
        if not task or task.done():
            state["flush_task"] = None
            return
        try:
            current = asyncio.current_task()
        except RuntimeError:
            current = None
        if task is not current:
            task.cancel()
        state["flush_task"] = None

    def _schedule_assistant_delta_flush(self, run_id: str) -> None:
        state = self._assistant_streams.get(run_id)
        if not state or not state.get("pending"):
            return
        task = state.get("flush_task")
        if task and not task.done():
            return
        state["flush_task"] = asyncio.create_task(self._delayed_assistant_delta_flush(run_id))

    async def _delayed_assistant_delta_flush(self, run_id: str) -> None:
        try:
            await asyncio.sleep(AGENT_DELTA_FLUSH_INTERVAL_SECONDS)
            await self._flush_assistant_delta(run_id)
        except asyncio.CancelledError:
            return
        finally:
            state = self._assistant_streams.get(run_id)
            if state and state.get("flush_task") is asyncio.current_task():
                state["flush_task"] = None

    def _persist_assistant_stream_message(self, state: dict, *, status: str = "streaming") -> None:
        content = {"text": state.get("text") or ""}
        if state.get("message_exists"):
            db.update_message(state["message_id"], content_json=content, status=status,
                              completed_at=_now_iso() if status == "complete" else None)
        else:
            db.create_message(state["message_id"], state["session_id"], state.get("turn_id"),
                              state["run_id"], "assistant", "text", content, status=status)
            state["message_exists"] = True

    async def _flush_assistant_delta(self, run_id: str) -> None:
        state = self._assistant_streams.get(str(run_id))
        if not state or not state.get("pending"):
            return
        delta = "".join(state.get("pending") or [])
        state["pending"] = []
        state["pending_bytes"] = 0
        if not delta:
            return
        self._persist_assistant_stream_message(state, status="streaming")
        await self.broadcast(state["session_id"], 0, "assistant.delta",
                             {"run_id": state["run_id"], "delta": delta})

    async def _project_assistant_delta(self, session_id: str, run: dict, delta: str) -> None:
        if not delta:
            return
        state = self._assistant_stream_state(session_id, run)
        state["text"] = f"{state.get('text') or ''}{delta}"
        state.setdefault("pending", []).append(delta)
        state["pending_bytes"] = int(state.get("pending_bytes") or 0) + len(delta.encode("utf-8", "replace"))
        if state["pending_bytes"] >= AGENT_DELTA_FLUSH_BYTES:
            self._cancel_assistant_flush_task(state)
            await self._flush_assistant_delta(str(run["run_id"]))
        else:
            self._schedule_assistant_delta_flush(str(run["run_id"]))

    async def _complete_assistant_message(self, session_id: str, run: dict, text: str) -> None:
        if not text:
            return
        state = self._assistant_stream_state(session_id, run)
        self._cancel_assistant_flush_task(state)
        current_text = state.get("text") or ""
        if state.get("append_assistant_messages") and current_text:
            state["text"] = current_text if current_text.endswith(text) else f"{current_text}{text}"
        else:
            state["text"] = text
        state["append_assistant_messages"] = False
        state["pending"] = []
        state["pending_bytes"] = 0
        self._persist_assistant_stream_message(state, status="complete")
        await self.broadcast(session_id, 0, "assistant.completed",
                             {"run_id": run["run_id"], "text": state["text"]})
        self._assistant_streams.pop(str(run["run_id"]), None)

    @staticmethod
    def _automation_receipt_text(automation: dict, agent_run_id: str) -> str:
        """Use a structured verification message, never model/tool transcript text."""
        for call in reversed(db.list_tool_calls_for_run(agent_run_id)):
            if str(call.get("tool_name") or "") != "mcp__crawshrimp__automation_record_verification":
                continue
            if str(call.get("status") or "") != "succeeded":
                continue
            try:
                arguments = json.loads(call.get("arguments_json") or "{}")
            except (TypeError, ValueError):
                continue
            result = arguments.get("result") if isinstance(arguments, dict) else None
            if not isinstance(result, dict):
                continue
            # ``user_message`` is the explicit durable contract.  ``message``
            # remains supported for Automations created before this field was
            # documented, but is still structured tool input rather than the
            # DSH's concatenated assistant/tool transcript.
            message = result.get("user_message") or result.get("message")
            if isinstance(message, str) and message.strip():
                return redact_text(message.strip())[:2000]
        title = str(automation.get("title") or "自动化").strip() or "自动化"
        return f"自动化「{title}」已完成。"

    @staticmethod
    def _is_persisted_automation_receipt_event(session_id: str, data: Mapping[str, Any]) -> bool:
        """Whether a DSH message is the native mirror of an existing receipt.

        The bridge writes the receipt directly into the source DSH conversation,
        then its normal event stream is projected back into Harness.  The
        receipt itself has already been stored by
        ``_publish_automation_source_receipt``; treating that mirror as a new
        assistant message would create a second, identical message in the
        source session's durable timeline.
        """
        message = data.get("message") if isinstance(data.get("message"), Mapping) else {}
        source = message.get("source") if isinstance(message.get("source"), Mapping) else {}
        if str(source.get("provider") or "").strip() != "crawshrimp-automation":
            return False
        model = str(source.get("model") or "").strip()
        if not model.startswith("receipt:"):
            return False
        receipt_id = model.removeprefix("receipt:").strip()
        if not receipt_id:
            return False
        persisted = _get_message_by_id(receipt_id)
        return bool(
            persisted
            and str(persisted.get("session_id") or "") == str(session_id)
            and str(persisted.get("kind") or "") == "automation_receipt"
        )

    async def _publish_automation_source_receipt(
        self,
        automation_session_id: str,
        run: dict,
        *,
        status: str,
    ) -> None:
        """Project a one-off Automation result into its creating conversation.

        Scheduled work normally runs in an isolated Agent session.  The
        Automation Controller remains the execution/audit owner, while this
        product projection provides the user-facing completion receipt.  Keep
        the first version deliberately narrow: only an ``at`` schedule can
        create one receipt, so periodic loops and recurring schedules cannot
        unexpectedly flood a conversation.
        """
        automation_run_uid = str(run.get("automation_run_uid") or "").strip()
        agent_run_id = str(run.get("run_id") or "").strip()
        if not automation_run_uid or not agent_run_id:
            return
        automation_run = data_sink.get_agent_automation_run(automation_run_uid)
        if not automation_run or str(automation_run.get("agent_run_id") or "") != agent_run_id:
            return
        automation = data_sink.get_agent_automation(
            str(automation_run.get("automation_uid") or "")
        )
        if not automation:
            return
        # A receipt belongs to the already-claimed run, not a later edited
        # definition.  In particular, changing an at schedule into a periodic
        # one while its isolated Agent Turn finishes must not make the original
        # user-visible one-off receipt disappear.
        definition = automation_run.get("definition_snapshot")
        definition = definition if isinstance(definition, dict) else {}
        schedule = definition.get("schedule") if isinstance(definition.get("schedule"), dict) else {}
        if not schedule:
            schedule = automation.get("schedule") if isinstance(automation.get("schedule"), dict) else {}
        automation_kind = str(
            definition.get("automation_kind") or automation.get("automation_kind") or ""
        ).strip().lower()
        if (
            automation_kind != "scheduled"
            or str(schedule.get("kind") or "").strip().lower() != "at"
        ):
            return
        # A transient error may have scheduled a retry for this exact durable
        # run.  Sending an early failure reply would contradict that state.
        if status == "retry_scheduled":
            return
        durable_status = str(automation_run.get("status") or "").strip()
        # Agent and Automation lifecycles are deliberately separate. Do not
        # tell the creating conversation a run failed until the Controller has
        # recorded its terminal outcome; an unavailable Controller can leave a
        # linked Agent failure queued for repair or retry.
        if durable_status not in {"completed", "failed", "canceled", "needs_review"}:
            return
        if status == "completed" and durable_status != "completed":
            return
        source_session_id = str(automation.get("source_session_id") or "").strip()
        if not source_session_id or source_session_id == str(automation_session_id or ""):
            return
        if not db.get_session(source_session_id):
            return

        receipt_id = f"{agent_run_id}:automation-source-receipt"
        if _get_message_by_id(receipt_id):
            data_sink.update_agent_automation_run(automation_run_uid, notification_status="delivered")
            return
        title = str(definition.get("title") or automation.get("title") or "自动化").strip() or "自动化"
        if status == "completed":
            receipt_text = self._automation_receipt_text({**automation, **definition}, agent_run_id)
        else:
            # Do not expose provider/internal error details in the source chat.
            receipt_text = f"自动化「{title}」未能完成。请在自动化中心查看详情。"
        delivered = await self._project_automation_receipt_to_runtime(
            source_session_id,
            receipt_id,
            receipt_text,
        )
        if not delivered:
            # A source DSH session may be actively answering the user.  Keep
            # delivery separate from Automation execution: persist a pending
            # receipt and retry the projection later without repeating tools
            # or mutating the Automation Run.
            data_sink.update_agent_automation_run(
                automation_run_uid,
                notification_status="pending_source_receipt",
            )
            self._schedule_automation_receipt_retry(
                automation_session_id,
                {"run_id": agent_run_id, "automation_run_uid": automation_run_uid},
                status=status,
            )
            return
        data_sink.update_agent_automation_run(automation_run_uid, notification_status="delivered")
        db.create_message(
            receipt_id,
            source_session_id,
            None,
            agent_run_id,
            "assistant",
            "automation_receipt",
            {
                "text": receipt_text,
                "automation_uid": str(automation.get("automation_uid") or ""),
                "automation_run_uid": automation_run_uid,
                "status": status,
            },
        )
        await self.broadcast(source_session_id, 0, "assistant.completed", {
            "run_id": agent_run_id,
            "text": receipt_text,
            "automation_receipt": True,
            "automation_uid": str(automation.get("automation_uid") or ""),
            "automation_run_uid": automation_run_uid,
        })

    def _schedule_automation_receipt_retry(self, automation_session_id: str, run: dict, *, status: str) -> None:
        """Retry a source-chat receipt without replaying the Automation action."""
        automation_run_uid = str(run.get("automation_run_uid") or "").strip()
        agent_run_id = str(run.get("run_id") or "").strip()
        key = f"{automation_run_uid}:{agent_run_id}"
        existing = self._automation_receipt_retry_tasks.get(key)
        if existing is not None and not existing.done():
            return

        async def _retry() -> None:
            try:
                # Enough time for an active source turn to settle, without a
                # tight poll. A restart retains pending_source_receipt and
                # requeues it through recover_automation_receipts().
                for delay_seconds in (2, 5, 15, 30, 60):
                    await asyncio.sleep(delay_seconds)
                    if _get_message_by_id(f"{agent_run_id}:automation-source-receipt"):
                        return
                    await self._publish_automation_source_receipt(
                        automation_session_id,
                        run,
                        status=status,
                    )
                    if _get_message_by_id(f"{agent_run_id}:automation-source-receipt"):
                        return
            except asyncio.CancelledError:
                raise
            finally:
                self._automation_receipt_retry_tasks.pop(key, None)

        self._automation_receipt_retry_tasks[key] = asyncio.create_task(_retry())

    async def recover_automation_receipts(self) -> None:
        """Requeue pending one-off receipts after backend or DSH restart."""
        for automation in data_sink.list_agent_automations(include_archived=True, limit=500):
            for run in data_sink.list_agent_automation_runs(str(automation.get("automation_uid") or ""), 500):
                if str(run.get("notification_status") or "") != "pending_source_receipt":
                    continue
                definition = run.get("definition_snapshot")
                definition = definition if isinstance(definition, dict) else {}
                schedule = definition.get("schedule") if isinstance(definition.get("schedule"), dict) else {}
                if not schedule:
                    schedule = automation.get("schedule") if isinstance(automation.get("schedule"), dict) else {}
                automation_kind = str(
                    definition.get("automation_kind") or automation.get("automation_kind") or ""
                ).lower()
                if automation_kind != "scheduled" or str(schedule.get("kind") or "").lower() != "at":
                    continue
                agent_run_id = str(run.get("agent_run_id") or "").strip()
                if not agent_run_id:
                    continue
                await self._publish_automation_source_receipt(
                    "",
                    {"run_id": agent_run_id, "automation_run_uid": run["run_uid"]},
                    status=str(run.get("status") or "needs_review"),
                )

    async def _project_automation_receipt_to_runtime(
        self,
        source_session_id: str,
        receipt_id: str,
        receipt_text: str,
    ) -> bool:
        """Append a one-off receipt to the source DSH Web session when available.

        Harness SQLite/SSE is a product projection, while the embedded DSH Web
        client renders its own session event log. Post through the local,
        token-protected product bridge so both stores show the same receipt.
        A failed projection intentionally does not block durable Harness audit
        persistence; it is logged without leaking the underlying error into
        the user-visible message.
        """
        source = db.get_session(source_session_id) or {}
        runtime_session_id = str(source.get("runtime_session_id") or "").strip()
        port = int(getattr(self, "web_port", 0) or 0)
        token = str(os.environ.get("CRAWSHRIMP_API_TOKEN") or "").strip()
        if not runtime_session_id or not port or not token:
            return False
        payload = {
            "sessionId": runtime_session_id,
            "receiptId": receipt_id,
            "text": receipt_text,
        }

        def _post() -> bool:
            import urllib.request

            request = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/crawshrimp/session/automation-receipt",
                data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "X-Crawshrimp-Token": token,
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=10) as response:
                    result = json.loads(response.read().decode("utf-8"))
                return bool(result.get("ok"))
            except Exception as exc:  # noqa: BLE001
                print(f"[agent] 自动化回执未写回 DSH 会话({type(exc).__name__})", flush=True)
                return False

        return await asyncio.to_thread(_post)

    async def _checkpoint_interrupted_assistant_message(self, session_id: str, run: dict, text: str) -> None:
        state = self._assistant_stream_state(session_id, run)
        self._cancel_assistant_flush_task(state)
        await self._flush_assistant_delta(str(run["run_id"]))
        current_text = state.get("text") or ""
        if text:
            state["text"] = current_text if current_text.endswith(text) else f"{current_text}{text}"
        state["pending"] = []
        state["pending_bytes"] = 0
        state["append_assistant_messages"] = True
        self._persist_assistant_stream_message(state, status="streaming")

    async def _finalize_assistant_stream(self, run_id: str, *, mark_complete: bool = False) -> None:
        state = self._assistant_streams.get(str(run_id))
        if not state:
            return
        self._cancel_assistant_flush_task(state)
        if mark_complete and state.get("text"):
            self._persist_assistant_stream_message(state, status="complete")
            await self.broadcast(state["session_id"], 0, "assistant.completed",
                                 {"run_id": state["run_id"], "text": state.get("text") or ""})
            self._assistant_streams.pop(str(run_id), None)
            return
        await self._flush_assistant_delta(str(run_id))
        if not mark_complete:
            self._assistant_streams.pop(str(run_id), None)

    # ---------- 提交轮次 ----------

    async def submit_turn(self, session_id: str, text: str,
                          context_refs: Optional[list[dict]] = None,
                          attachment_ids: Optional[list[str]] = None,
                          grant_prefs: Optional[dict] = None,
                          automation_policy: Optional[dict] = None,
                          automation_run_uid: str = "") -> dict:
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
            "grant_prefs": copy.deepcopy(grant_prefs or {}),
            "automation_policy": copy.deepcopy(automation_policy) if isinstance(automation_policy, dict) else None,
            "automation_run_uid": str(automation_run_uid or "").strip(),
            "image_attachments": image_attachments,
        })
        return {"turn_id": turn_id, "run_id": run_id, "queued": True,
                "queue_depth": self.queue.qsize() + (1 if self.active_run else 0)}

    async def submit_automation_turn(
        self,
        automation: dict,
        run: dict,
        prompt: str,
        toolset: list[str],
    ) -> dict:
        """Queue one Controller-owned turn with an immutable automation policy.

        This bridge deliberately keeps the Automation authority separate from
        interactive grant state.  A missing browser reference therefore does
        not create a broad grant; the request-scoped MCP policy remains the
        sole unattended-approval source.
        """
        automation_uid = str((automation or {}).get("automation_uid") or "").strip()
        automation_run_uid = str((run or {}).get("run_uid") or "").strip()
        if not automation_uid or not automation_run_uid:
            raise ValueError("automation_uid and automation run_uid are required")
        normalized_toolset = sorted({str(item).strip() for item in toolset or [] if str(item).strip()})
        context_mode = str((automation or {}).get("context_mode") or "isolated").strip().lower()
        if context_mode == "inherited":
            session_id = str((automation or {}).get("source_session_id") or "").strip()
            if not session_id or not db.get_session(session_id):
                raise ValueError("inherited Automation requires an existing source session")
        elif context_mode == "isolated":
            session_id = f"automation:{automation_uid}:{automation_run_uid}"
            if not db.get_session(session_id):
                db.create_session(session_id, f"dsh-{uuid.uuid4().hex}", f"自动化：{str((automation or {}).get('title') or '').strip() or automation_uid}")
        else:
            raise ValueError("automation context_mode must be isolated or inherited")

        execution_policy = (automation or {}).get("execution_policy")
        browser_tab_id = str(
            execution_policy.get("browser_tab_id") if isinstance(execution_policy, dict) else ""
        ).strip()
        context_refs = (
            [{"type": "browser_tab", "id": browser_tab_id}]
            if browser_tab_id else []
        )
        policy = {
            "toolset": list(normalized_toolset),
            "execution_policy": copy.deepcopy(execution_policy) if isinstance(execution_policy, dict) else {},
        }
        queued = await self.submit_turn(
            session_id,
            str(prompt or ""),
            context_refs=context_refs,
            grant_prefs={"toolset": list(normalized_toolset)},
            automation_policy=policy,
            automation_run_uid=automation_run_uid,
        )
        if context_mode == "inherited":
            self._schedule_inherited_automation_wait(
                agent_run_id=str(queued.get("run_id") or ""),
                automation_run_uid=automation_run_uid,
                source_session_id=session_id,
                wait_seconds=_inherited_automation_wait_seconds(automation),
            )
        # The Controller projects this queued Agent Run onto its durable
        # Automation Run.  The Agent service deliberately does not update the
        # Automation tables itself, preserving the Controller as lifecycle
        # owner.
        # Keep a stable explicit status for Controller integrations. The
        # ``queued`` boolean remains for compatibility with existing callers.
        return {**queued, "session_id": session_id, "status": "queued"}

    def _schedule_inherited_automation_wait(
        self,
        *,
        agent_run_id: str,
        automation_run_uid: str,
        source_session_id: str,
        wait_seconds: int,
    ) -> None:
        """Schedule the source-session queue deadline for one inherited turn."""
        run_id = str(agent_run_id or "").strip()
        if not run_id:
            return
        existing = self._inherited_automation_wait_tasks.pop(run_id, None)
        if existing and not existing.done():
            existing.cancel()
        seconds = max(1, min(int(wait_seconds or DEFAULT_INHERITED_AUTOMATION_WAIT_SECONDS), MAX_INHERITED_AUTOMATION_WAIT_SECONDS))
        self._inherited_automation_waits[run_id] = {
            "automation_run_uid": str(automation_run_uid or "").strip(),
            "source_session_id": str(source_session_id or "").strip(),
            "wait_seconds": seconds,
        }

        async def _wait() -> None:
            try:
                await asyncio.sleep(seconds)
                await self._expire_inherited_automation_wait(
                    run_id,
                    str(automation_run_uid or "").strip(),
                    str(source_session_id or "").strip(),
                )
            except asyncio.CancelledError:
                return
            finally:
                if self._inherited_automation_wait_tasks.get(run_id) is asyncio.current_task():
                    self._inherited_automation_wait_tasks.pop(run_id, None)
                self._inherited_automation_waits.pop(run_id, None)

        self._inherited_automation_wait_tasks[run_id] = asyncio.create_task(_wait())

    def _clear_inherited_automation_wait(self, agent_run_id: str) -> None:
        """Cancel the deadline once a queued inherited turn starts or ends."""
        run_id = str(agent_run_id or "").strip()
        self._inherited_automation_waits.pop(run_id, None)
        task = self._inherited_automation_wait_tasks.pop(run_id, None)
        if task and not task.done() and task is not asyncio.current_task():
            task.cancel()

    async def _expire_inherited_automation_wait(
        self,
        agent_run_id: str,
        automation_run_uid: str,
        source_session_id: str,
    ) -> bool:
        """Turn an expired inherited queue wait into durable ``skipped_overlap``.

        The Agent Run is compare-and-set from queued to canceled before the
        Automation projection.  Therefore a queue consumer that already began
        the turn wins the race and this method becomes a no-op; a stale timeout
        can never stop a live action.
        """
        run_id = str(agent_run_id or "").strip()
        wait = self._inherited_automation_waits.get(run_id) or {}
        seconds = int(wait.get("wait_seconds") or DEFAULT_INHERITED_AUTOMATION_WAIT_SECONDS)
        run_uid = str(automation_run_uid or wait.get("automation_run_uid") or "").strip()
        session_id = str(source_session_id or wait.get("source_session_id") or "").strip()
        if not run_id or not run_uid:
            return False
        message = f"继承会话在 {seconds} 秒内未空闲，本次自动化已跳过"
        if not db.cancel_queued_run(
            run_id,
            error_code="INHERITED_CONTEXT_WAIT_TIMEOUT",
            error_message=message,
        ):
            return False
        run = db.get_run(run_id) or {}
        db.update_turn(str(run.get("turn_id") or ""), status="canceled", completed_at=_now_iso())
        if session_id:
            await self.broadcast(session_id, 0, "run.canceled", {
                "run_id": run_id,
                "error_code": "INHERITED_CONTEXT_WAIT_TIMEOUT",
                "error": message,
            })
        controller = self.automation_controller or getattr(mcp_gateway.ctx, "automation_controller", None)
        mark = getattr(controller, "mark_inherited_wait_timeout", None)
        if not callable(mark):
            # The run is safely canceled and cannot execute. Startup
            # reconciliation will surface it if the Controller was unavailable
            # during a teardown race; do not fabricate a completed Automation.
            return False
        try:
            projected = mark(run_uid, run_id, message)
            if inspect.isawaitable(projected):
                projected = await projected
            return isinstance(projected, dict) and str(projected.get("status") or "") == "skipped_overlap"
        except Exception:  # noqa: BLE001
            logger.exception("Unable to project inherited Automation queue timeout")
            return False

    def _resolve_model(self, session_id: Optional[str] = None) -> tuple[str, str]:
        cfg = load_config()
        model_id = select_default_model(cfg)
        if session_id:
            session = db.get_session(session_id)
            if session and session.get("model_id") and model_has_configured_key(session["model_id"], cfg):
                model_id = session["model_id"]
        if not model_capabilities(model_id).get("supports_tools"):
            model_id = select_default_model(cfg)
        return model_id, resolve_provider_for_model(model_id, cfg)

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
                    await self._finalize_assistant_stream(item.get("run_id"), mark_complete=True)
                    db.update_run(item.get("run_id"), status="failed", finished_at=_now_iso(),
                                  error_code="INTERNAL_ERROR", error_message=str(exc)[:500])
                    db.update_turn(item.get("turn_id"), status="failed", completed_at=_now_iso())
                    await self.broadcast(item.get("session_id"), 0, "run.failed",
                                         {"run_id": item.get("run_id"), "error": str(exc)[:300]})
                    projected = await self._project_automation_agent_terminal(
                        item,
                        status="failed",
                        error_code="INTERNAL_ERROR",
                        error_message=str(exc),
                        retryable=True,
                    )
                    await self._publish_automation_source_receipt(
                        str(item.get("session_id") or ""),
                        {"run_id": item.get("run_id"), "automation_run_uid": item.get("automation_run_uid")},
                        status=str(projected.get("status") or "failed"),
                    )
                except Exception:  # noqa: BLE001
                    pass
                self.active_run = None
                mcp_gateway.ctx.active_run = None
                mcp_gateway.ctx.grant = None

    async def _run_one(self, item: dict) -> None:
        run_id, session_id, turn_id = item["run_id"], item["session_id"], item["turn_id"]
        run = db.get_run(run_id)
        self._clear_inherited_automation_wait(run_id)
        if not run or run["status"] in RUN_FINAL_STATUSES:
            return
        self.active_run = run
        db.update_run(run_id, status="starting", started_at=_now_iso())
        db.update_turn(turn_id, status="running")
        await self.broadcast(session_id, 0, "run.started", {"run_id": run_id, "turn_id": turn_id})

        # 同步 HTTP(CDP bridge)不得阻塞事件循环 → to_thread
        grant = await asyncio.to_thread(self._grant_for_run, item)
        runtime_session_ids = {self._runtime_session_id(session_id)}
        run_context = dict(db.get_run(run_id) or {})
        run_context["automation_policy"] = copy.deepcopy(item.get("automation_policy")) if isinstance(item.get("automation_policy"), dict) else None
        run_context["automation_run_uid"] = str(item.get("automation_run_uid") or "").strip()
        self.register_run_context(next(iter(runtime_session_ids)), run_context, grant)

        status: Optional[str] = None
        try:
            generation_ok = await self._ensure_generation(item)
            if not generation_ok:
                message = self.runtime_error or "runtime 启动失败"
                if self.runtime_error_code == "MODEL_CONFIGURATION":
                    raise AgentModelConfigurationError(message)
                raise RuntimeError(message)

            budget = BUDGET_PROFILES["browser"] if self._is_browser_run(item) else BUDGET_PROFILES["default"]
            worker_payload = {
                "runId": run_id,
                "sessionId": self._runtime_session_id(session_id),
                "text": item["text"],
                "images": item.get("image_attachments") or [],
                # A DSH runtime may recreate a persisted Session after a
                # generation restart. Keep the product's per-session model
                # authoritative so a previous text-only selection cannot
                # reject a newly attached image.
                "provider": item["provider_id"],
                "model": official_real_model(item["model_id"]),
                "budget": budget,
            }
            if isinstance(item.get("automation_policy"), dict):
                # The policy snapshot was captured at Automation claim time;
                # send that immutable copy to the native DSH boundary as well
                # as retaining it for MCP lease enforcement.
                worker_payload["automationPolicy"] = copy.deepcopy(item["automation_policy"])
            worker_timeout = _automation_worker_timeout_seconds(item)
            try:
                summary = await self.worker.request("worker.run", worker_payload, timeout=worker_timeout)
            except asyncio.TimeoutError as exc:
                if not str(item.get("automation_run_uid") or "").strip():
                    raise
                # The worker may still be processing the turn after its RPC
                # response times out. Cancel it before publishing a durable
                # failure so no timed-out Automation keeps operating unseen.
                try:
                    await self.worker.request("worker.cancel_active", {"runId": run_id}, timeout=15)
                except Exception:  # noqa: BLE001
                    pass
                await self._cancel_automation_task_instances(item.get("automation_run_uid") or "")
                raise AutomationRunTimeoutError(
                    f"Automation execution exceeded its {int(worker_timeout)}-second timeout"
                ) from exc

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
                retry_context = dict(db.get_run(run_id) or {})
                retry_context["automation_policy"] = copy.deepcopy(item.get("automation_policy")) if isinstance(item.get("automation_policy"), dict) else None
                retry_context["automation_run_uid"] = str(item.get("automation_run_uid") or "").strip()
                self.register_run_context(new_sid, retry_context, grant)
                notice = "智能体运行时已重启,上一轮对话上下文无法继续恢复;已开启新上下文继续本轮。"
                db.create_message(f"{run_id}:notice", session_id, turn_id, run_id, "system", "notice", {"text": notice})
                await self.broadcast(session_id, 0, "session.updated",
                                     {"session_id": session_id, "notice": notice, "new_context": True})
                try:
                    retry_payload = {
                        "runId": run_id,
                        "sessionId": new_sid,
                        "text": item["text"],
                        "images": item.get("image_attachments") or [],
                        "provider": item["provider_id"],
                        "model": official_real_model(item["model_id"]),
                        "budget": budget,
                    }
                    if isinstance(item.get("automation_policy"), dict):
                        retry_payload["automationPolicy"] = copy.deepcopy(item["automation_policy"])
                    summary = await self.worker.request("worker.run", retry_payload, timeout=worker_timeout)
                except asyncio.TimeoutError as exc:
                    if not str(item.get("automation_run_uid") or "").strip():
                        raise
                    try:
                        await self.worker.request("worker.cancel_active", {"runId": run_id}, timeout=15)
                    except Exception:  # noqa: BLE001
                        pass
                    await self._cancel_automation_task_instances(item.get("automation_run_uid") or "")
                    raise AutomationRunTimeoutError(
                        f"Automation execution exceeded its {int(worker_timeout)}-second timeout"
                    ) from exc
                result = (summary or {}).get("summary") or {}
            status = result.get("status")
            if status not in RUN_FINAL_STATUSES:
                status = "failed"
            error_code = _result_error_code(result)
            error_message = _result_error_message(result)
            output_budget_reached = status == "interrupted" and error_code == OUTPUT_BUDGET_ERROR_CODE
            await self._finalize_assistant_stream(
                run_id,
                mark_complete=True,
            )
            db.update_run(run_id, status=status, finished_at=_now_iso(),
                          dsh_message_id=result.get("messageId"),
                          dsh_start_seq=result.get("dsh_start_seq") or 0,
                          dsh_end_seq=result.get("dsh_end_seq") or 0,
                          error_code=None if status == "completed" else error_code,
                          error_message=None if status == "completed" else json.dumps(result.get("reason"), ensure_ascii=False)[:500])
            db.update_turn(turn_id, status=status, completed_at=_now_iso())
            event_type = {"completed": "run.completed", "failed": "run.failed",
                          "canceled": "run.canceled", "interrupted": "run.interrupted"}[status]
            event_payload = {"run_id": run_id, "status": status}
            if status != "completed":
                if error_code:
                    event_payload["error_code"] = error_code
                if error_message:
                    event_payload["error"] = error_message
            if output_budget_reached:
                event_payload.update({"resumable": True, "notice": OUTPUT_BUDGET_NOTICE})
            await self.broadcast(session_id, 0, event_type, event_payload)
            if status == "completed":
                await self._broadcast_run_artifacts(run_id, session_id)
            projected = await self._project_automation_agent_terminal(
                item,
                status=status,
                error_code=error_code or "",
                error_message=error_message or "",
                retryable=(status == "failed" and str(error_code or "").upper() in {
                    "NETWORK", "NETWORK_ERROR", "TIMEOUT", "TIMEOUT_ERROR", "WORKER_ERROR", "RUNTIME_ERROR",
                }),
            )
            await self._publish_automation_source_receipt(
                session_id,
                {"run_id": run_id, "automation_run_uid": item.get("automation_run_uid")},
                status=str(projected.get("status") or status),
            )
        except AutomationRunTimeoutError as exc:
            await self._finalize_assistant_stream(run_id, mark_complete=True)
            db.update_run(run_id, status="failed", finished_at=_now_iso(),
                          error_code="AUTOMATION_TIMEOUT", error_message=str(exc)[:500])
            db.update_turn(turn_id, status="failed", completed_at=_now_iso())
            await self.broadcast(session_id, 0, "run.failed", {
                "run_id": run_id,
                "error_code": "AUTOMATION_TIMEOUT",
                "error": "自动化执行超时，已请求停止运行",
            })
            projected = await self._project_automation_agent_terminal(
                item,
                status="failed",
                error_code="AUTOMATION_TIMEOUT",
                error_message=str(exc),
                retryable=True,
            )
            await self._publish_automation_source_receipt(
                session_id,
                {"run_id": run_id, "automation_run_uid": item.get("automation_run_uid")},
                status=str(projected.get("status") or "failed"),
            )
        except AgentModelConfigurationError as exc:
            await self._finalize_assistant_stream(run_id, mark_complete=True)
            db.update_run(run_id, status="failed", finished_at=_now_iso(),
                          error_code="MODEL_CONFIGURATION_ERROR", error_message=str(exc)[:500])
            db.update_turn(turn_id, status="failed", completed_at=_now_iso())
            await self.broadcast(session_id, 0, "run.failed", {"run_id": run_id, "error": str(exc)[:300]})
            projected = await self._project_automation_agent_terminal(
                item,
                status="failed",
                error_code="MODEL_CONFIGURATION_ERROR",
                error_message=str(exc),
                retryable=False,
            )
            await self._publish_automation_source_receipt(
                session_id,
                {"run_id": run_id, "automation_run_uid": item.get("automation_run_uid")},
                status=str(projected.get("status") or "failed"),
            )
        except Exception as exc:  # noqa: BLE001
            await self._finalize_assistant_stream(run_id, mark_complete=True)
            db.update_run(run_id, status="failed", finished_at=_now_iso(),
                          error_code="WORKER_ERROR", error_message=str(exc)[:500])
            db.update_turn(turn_id, status="failed", completed_at=_now_iso())
            await self.broadcast(session_id, 0, "run.failed", {"run_id": run_id, "error": str(exc)[:300]})
            projected = await self._project_automation_agent_terminal(
                item,
                status="failed",
                error_code="WORKER_ERROR",
                error_message=str(exc),
                retryable=True,
            )
            await self._publish_automation_source_receipt(
                session_id,
                {"run_id": run_id, "automation_run_uid": item.get("automation_run_uid")},
                status=str(projected.get("status") or "failed"),
            )
            self._note_crash(str(exc))
        finally:
            for runtime_sid in runtime_session_ids:
                self.unregister_run_context(runtime_sid, run_id)
            self.active_run = None
            self._assistant_streams.pop(run_id, None)
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
        async with self._runtime_mutation_lock:
            return await self._start_generation_unlocked(provider_id, model_id)

    async def _start_generation_unlocked(self, provider_id: Optional[str] = None,
                                         model_id: Optional[str] = None) -> bool:
        await self._stop_worker()
        self.generation += 1
        self.runtime_state = "starting"
        self.runtime_error = ""
        self.runtime_error_code = ""

        # API key 进入进程环境(不落盘)
        cfg = load_config()
        llm = (cfg.get("ai") or {}).get("llm") or {}
        if model_id is None:
            model_id, provider_id = self._resolve_model()
        config_required_mode = False
        try:
            model_id, provider_id = _resolve_configured_generation_model(cfg, provider_id, model_id)
        except AgentModelConfigurationError as exc:
            if not any_llm_api_key_configured(cfg):
                config_required_mode = True
                model_id = select_default_model(cfg)
                provider_id = resolve_provider_for_model(model_id, cfg)
            else:
                self.runtime_error = str(exc)
                self.runtime_error_code = "MODEL_CONFIGURATION"
                self.runtime_state = "needs_configuration"
                return False
        runtime_model_id = official_real_model(model_id)

        runtime_env = build_llm_runtime_environment(self._external_runtime_env, cfg)
        if config_required_mode:
            runtime_env["CRAWSHRIMP_LLM_CONFIG_REQUIRED"] = "1"
            runtime_env["CRAWSHRIMP_LLM_CONFIG_PLACEHOLDER_KEY"] = "cs-config-required-placeholder"
        else:
            runtime_env.pop("CRAWSHRIMP_LLM_CONFIG_REQUIRED", None)
            runtime_env.pop("CRAWSHRIMP_LLM_CONFIG_PLACEHOLDER_KEY", None)

        runtime_env["CRAWSHRIMP_AGENT_PROVIDER"] = provider_id
        runtime_env["CRAWSHRIMP_AGENT_MODEL"] = runtime_model_id
        # Product policy: the embedded DSH module must not register generic
        # web_search/web_fetch under any preset or resumed Session.
        runtime_env["CRAWSHRIMP_DISABLE_NATIVE_WEB"] = "1"
        # rc.1 Web profile owns system-prompt composition. Keep the product
        # persona in process memory and overlay it through the profile instead
        # of writing a mutable Cordis config into the installed runtime.
        runtime_env["CRAWSHRIMP_AGENT_PERSONA"] = AGENT_PERSONA

        # 轮换 runtime token
        self.runtime_token = secrets.token_hex(32)
        runtime_env["CRAWSHRIMP_MCP_TOKEN"] = self.runtime_token

        # Web Host 端口取 MCP 端口 + 100(API+300),避开 main.js 端口回退区间。
        self.web_port = getattr(self, "web_port", 0) or (self.mcp_port + 100)
        runtime_env["CRAWSHRIMP_WEB_PORT"] = str(self.web_port)
        # DSH Web UI「工作区」默认指向抓虾运行时目录(data/agent/workspace)
        workspace_root = _data_root() / "agent" / "workspace"
        workspace_root.mkdir(parents=True, exist_ok=True)
        runtime_env["CRAWSHRIMP_WORKSPACE_ROOT"] = str(workspace_root)
        custom_providers, custom_env = custom_providers_runtime_payload(cfg)

        data_root = _data_root()
        agent_dir = data_root / "agent"
        try:
            _sync_dsh_default_model_settings(
                agent_dir, provider_id, runtime_model_id, cfg, custom_providers, runtime_env,
            )
        except AgentModelConfigurationError as exc:
            self.runtime_error = str(exc)
            self.runtime_error_code = "MODEL_CONFIGURATION"
            self.runtime_state = "needs_configuration"
            return False
        # 启动 worker 前先清理本 data 目录的孤儿 runtime(上次后端被强杀的残留),
        # 避免残留进程占用端口导致 DSH webserver 内部 +1 漂移(前端拿不到真实端口会白屏)。
        _cleanup_orphan_runtimes(str(data_root))
        # Worker passes this fixed loopback port to the official rc.1 Web
        # profile.  Its authenticated launch response is the readiness proof;
        # never probe GET / because it correctly returns 401 without a cookie.
        self.web_port = _pick_free_port(self.web_port, 8)
        runtime_env["CRAWSHRIMP_WEB_PORT"] = str(self.web_port)

        worker: Optional[AgentWorker] = None

        async def on_worker_exit(message: str, unexpected: bool) -> None:
            # The worker has a distinct lifetime from FastAPI. Do not leave
            # `/agent/runtime` reporting a stale ready Web host after stdio EOF.
            if worker is not None:
                await self._on_worker_exit(worker, message, unexpected)

        worker = AgentWorker(
            runtime_root=str(resolve_harness_root()),
            data_root=str(data_root),
            mcp_url=getattr(self, "mcp_url", "http://127.0.0.1:18965/mcp"),
            session_root=str(agent_dir / "harness-sessions"),
            runtime_env=runtime_env,
            on_notification=self._on_worker_notification,
            on_exit=on_worker_exit,
        )
        try:
            await worker.start()
            init = await worker.request("worker.initialize", {
                "runtimeRoot": str(resolve_harness_root()),
                "dataRoot": str(data_root),
                "mcpUrl": getattr(self, "mcp_url", "http://127.0.0.1:18965/mcp"),
                "sessionRoot": str(agent_dir / "harness-sessions"),
            }, timeout=20)
            if not init.get("ok"):
                raise RuntimeError(f"worker.initialize 失败: {init}")
            gen = await worker.request("worker.start_generation", {
                "generation": self.generation,
                "provider": provider_id,
                # DeepSeek 官方模型:产品内 ID → runtime 真实模型名
                "model": runtime_model_id,
                "maxTokens": model_capabilities(model_id).get("max_output_tokens", 8192),
                # Keep the DSH session and Web profile on the same product
                # workspace so native Web can discover it and render approvals.
                "cwd": str(agent_dir / "workspace"),
                "webPort": self.web_port,
            }, timeout=120)
            if not gen.get("ok"):
                raise RuntimeError(f"start_generation 失败: {gen}")
            server_info = gen.get("serverInfo") if isinstance(gen.get("serverInfo"), dict) else {}
            web_launch_url = str(server_info.get("webLaunchUrl") or "").strip()
            web_origin = str(server_info.get("webOrigin") or "").strip().rstrip("/")
            from urllib.parse import urlparse
            launch = urlparse(web_launch_url)
            origin = urlparse(web_origin)
            if (
                launch.scheme != "http" or launch.hostname != "127.0.0.1" or not launch.query
                or origin.scheme != "http" or origin.hostname != "127.0.0.1" or launch.netloc != origin.netloc
            ):
                raise RuntimeError("DSH Web 未返回受控 loopback 启动地址")
            self.web_port = int(launch.port or 0)
            self._web_launch_url = web_launch_url
            self._web_origin = web_origin + "/"
            self.worker = worker
            self.runtime_state = "ready"
            self.runtime_error_code = ""
            self.generation_model = model_id
            self.generation_model_provider = provider_id
            return True
        except asyncio.CancelledError:
            await worker.stop()
            self.runtime_state = "stopped"
            raise
        except Exception as exc:  # noqa: BLE001
            self.runtime_error = str(exc)
            self.runtime_error_code = "WORKER_ERROR"
            self.runtime_state = "crashed"
            await worker.stop()
            self._note_crash(str(exc))
            return False

    async def _on_worker_exit(self, worker: AgentWorker, message: str,
                              unexpected: bool) -> None:
        """Project an unexpected stdio worker exit into the public runtime state."""
        if not unexpected or self.worker is not worker:
            return
        await self._interrupt_shadow_runs(
            "WORKER_EXITED", str(message or "worker 已退出")[:300],
        )
        self.worker = None
        self.runtime_state = "crashed"
        self.runtime_error_code = "WORKER_EXITED"
        self.runtime_error = str(message or "worker 已退出")[:300]
        self._web_port_verified = False
        self._note_crash(self.runtime_error)

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
        await self._interrupt_shadow_runs("RUNTIME_STOPPED", "runtime stopped")
        self._web_launch_url = ""
        self._web_origin = ""
        self.runtime_state = "stopped"

    async def restart_runtime(self) -> dict:
        if self.active_run is not None or self.active_runs_by_runtime:
            return {"ok": False, "error": "ACTIVE_RUN", "message": "存在 active run,无法重启"}
        ok = await self.start_generation()
        return {"ok": ok, "state": self.runtime_state, "error": self.runtime_error}

    async def observe_native_web_session(self, runtime_session_id: str,
                                         *, refresh: bool = False, timeout: int = 15,
                                         owner: str = "") -> dict:
        """Open one scoped shadow follow for a renderer-announced Web session.

        A native DSH Web session is not interchangeable with a product API run:
        it must explicitly identify itself before its MCP calls can obtain a
        context lease.  This endpoint therefore never chooses a recent or
        currently active run as a fallback.
        """
        runtime_id = str(runtime_session_id or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,159}", runtime_id):
            return {"ok": False, "error": "INVALID_SESSION_ID"}
        if self.runtime_state != "ready" or self.worker is None:
            return {"ok": False, "error": "RUNTIME_UNAVAILABLE"}
        try:
            params = {"sessionId": runtime_id}
            if refresh:
                params["refresh"] = True
            if str(owner or "").strip():
                params["owner"] = str(owner).strip()
            response = await self.worker.request(
                "worker.observe_web_session", params, timeout=timeout,
            )
        except Exception as exc:  # noqa: BLE001
            # A Python-side timeout must actively release the Node follow;
            # otherwise a late initial frame could retain an orphan socket and
            # recreate a shadow context after the caller has given up.
            if isinstance(exc, asyncio.TimeoutError):
                try:
                    cancel_params = {"sessionId": runtime_id}
                    if str(owner or "").strip():
                        cancel_params["owner"] = str(owner).strip()
                    await self.worker.request("worker.unobserve_web_session", cancel_params, timeout=3)
                except Exception:  # noqa: BLE001
                    pass
            return {"ok": False, "error": "SESSION_FOLLOW_FAILED", "message": str(exc)[:300]}
        if not isinstance(response, dict):
            return {"ok": False, "error": "INVALID_WORKER_RESPONSE"}
        return response

    async def unobserve_native_web_session(self, runtime_session_id: str, *, owner: str = "") -> dict:
        runtime_id = str(runtime_session_id or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,159}", runtime_id):
            return {"ok": False, "error": "INVALID_SESSION_ID"}
        if self.runtime_state != "ready" or self.worker is None:
            return {"ok": True, "following": False, "idempotent": True}
        params = {"sessionId": runtime_id}
        if str(owner or "").strip():
            params["owner"] = str(owner).strip()
        try:
            response = await self.worker.request("worker.unobserve_web_session", params, timeout=5)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": "SESSION_UNFOLLOW_FAILED", "message": str(exc)[:300]}
        return response if isinstance(response, dict) else {"ok": False, "error": "INVALID_WORKER_RESPONSE"}

    def runtime_status(self) -> dict:
        cfg = load_config()
        llm = (cfg.get("ai") or {}).get("llm") or {}
        import os as _os
        web_ready = self.runtime_state == "ready" and bool(self._web_launch_url and self._web_origin)
        gateway_key_configured = gateway_api_key_configured(cfg)
        deepseek_key_configured = deepseek_api_key_configured(cfg)
        glm_key_configured = glm_api_key_configured(cfg)
        any_key_configured = any_llm_api_key_configured(cfg)
        display_state = self.runtime_state
        display_error = self.runtime_error
        return {
            "enabled": _os.environ.get("CRAWSHRIMP_AGENT_ENABLED", "1") not in ("0", "false", "no"),
            "state": display_state,
            "generation": self.generation,
            "model": select_default_model(cfg),
            "api_key_configured": any_key_configured,
            "gateway_api_key_configured": gateway_key_configured,
            "deepseek_api_key_configured": deepseek_key_configured,
            "glm_api_key_configured": glm_key_configured,
            "active_run": ((self.active_run or next(iter(self.active_runs_by_runtime.values()), {}))
                           or {}).get("run_id"),
            "queue_depth": self.queue.qsize(),
            "error": display_error,
            "node_executable": resolve_node_executable(),
            # The launch URL is a loopback-only authentication capability for
            # the trusted embedded iframe. Do not log or render it as text.
            # DSH can exchange it into a separate browser cookie, while the
            # Worker keeps its own cookie for Web RPC and native approvals.
            "web_port": self.web_port if web_ready else 0,
            "web_origin": self._web_origin if web_ready else "",
            "web_launch_url": self._web_launch_url if web_ready else "",
            "web_verified": web_ready,
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

    async def _interrupt_shadow_runs(self, error_code: str, message: str) -> None:
        """Close every native-Web shadow run when its owning runtime disappears."""
        code = str(error_code or "RUNTIME_INTERRUPTED")[:120]
        detail = str(message or "runtime interrupted")[:300]
        for runtime_session_id, run in list(self.shadow_runs.items()):
            run_id = str(run.get("run_id") or "")
            session_id = str(run.get("session_id") or "")
            try:
                await self._finalize_assistant_stream(run_id, mark_complete=True)
                db.update_run(
                    run_id,
                    status="interrupted",
                    error_code=code,
                    error_message=detail,
                    finished_at=_now_iso(),
                )
                db.update_turn(
                    str(run.get("turn_id") or ""),
                    status="interrupted",
                    completed_at=_now_iso(),
                )
                db.update_session(session_id, status="idle")
                await self.broadcast(session_id, 0, "run.interrupted", {
                    "run_id": run_id,
                    "status": "interrupted",
                    "error_code": code,
                    "error": detail,
                })
            except Exception as exc:  # noqa: BLE001
                # In-memory context still must be revoked even if a damaged DB
                # prevents terminal projection; startup recovery will repair
                # any durable nonterminal row on the next process start.
                print(f"[agent] native Web shadow run {run_id} 中断投影失败: {exc}", flush=True)
            finally:
                if self.shadow_runs.get(runtime_session_id) is run:
                    self.shadow_runs.pop(runtime_session_id, None)
                self.unregister_run_context(runtime_session_id, run_id)

    async def _on_worker_notification(self, method: str, params: dict) -> None:
        if method == "worker.status":
            state = params.get("status")
            if state in ("ready", "starting", "stopping", "stopped", "crashed"):
                self.runtime_state = state
            if state in ("stopped", "crashed"):
                await self._interrupt_shadow_runs(
                    "RUNTIME_CRASHED" if state == "crashed" else "RUNTIME_STOPPED",
                    str(params.get("message") or f"runtime {state}")[:300],
                )
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
                                self.generation_model_provider or resolve_provider_for_model(DEFAULT_MODEL),
                                self.generation_model or DEFAULT_MODEL)
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
                await self._finalize_assistant_stream(run["run_id"], mark_complete=True)
                db.update_run(run["run_id"], status="completed", finished_at=_now_iso())
                db.update_turn(run.get("turn_id") or "", status="completed", completed_at=_now_iso())
                await self.broadcast(session_id, 0, "run.completed", {"run_id": run["run_id"]})
                await self._broadcast_run_artifacts(run["run_id"], session_id)
            else:
                await self._finalize_assistant_stream(run["run_id"], mark_complete=True)
                error_code = None
                error_message = None
                if isinstance(reason.get("error"), dict):
                    error_code = reason["error"].get("code")
                    error_message = reason["error"].get("message")
                terminal_status = "interrupted" if kind == "interrupted" else "failed"
                db.update_run(
                    run["run_id"],
                    status=terminal_status,
                    error_code=error_code,
                    error_message=error_message,
                    finished_at=_now_iso(),
                )
                db.update_turn(
                    run.get("turn_id") or "",
                    status=terminal_status,
                    completed_at=_now_iso(),
                )
                await self.broadcast(session_id, 0, f"run.{terminal_status}", {
                    "run_id": run["run_id"], "kind": kind, "error_code": error_code,
                })
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
                await self._project_assistant_delta(session_id, run, delta)
            return

        if event_type == "assistant/message":
            if self._is_persisted_automation_receipt_event(session_id, data):
                return
            text = _extract_text(data)
            if text:
                if data.get("interrupted"):
                    await self._checkpoint_interrupted_assistant_message(session_id, run, text)
                else:
                    await self._complete_assistant_message(session_id, run, text)
            return

        if event_type == "tool/call":
            safe_arguments = _safe_tool_arguments(
                data.get("name") or "unknown",
                _parse_args(data.get("arguments")),
            )
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
                await self._finalize_assistant_stream(run_id, mark_complete=True)
                return  # run.completed 由 _run_one 收尾广播
            if _is_output_budget_turn_end(reason):
                await self._flush_assistant_delta(run_id)
                return
            await self._finalize_assistant_stream(run_id, mark_complete=True)
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
        """经 Worker 的认证 Web 会话走 DSH 原生审批卡;异常时安全失败。"""
        if self.worker is None or self.runtime_state != "ready":
            return "rejected"
        session = db.get_session((run or {}).get("session_id") or "")
        runtime_session_id = (session or {}).get("runtime_session_id") or ""
        if not runtime_session_id:
            return "rejected"
        tool_name = _approval_human_tool_name(summary, plan)
        reason = _approval_human_text(summary, plan, risk)
        call_id = _approval_runtime_call_id()
        payload = {
            "sessionId": runtime_session_id,
            "toolName": tool_name,
            "reason": reason,
            "timeoutMs": (APPROVAL_WAIT_SECONDS - 30) * 1000,
            "arguments": _approval_display_arguments(summary, plan, risk),
        }
        if call_id:
            payload["callId"] = call_id

        async with self._approval_slots:
            try:
                response = await self.worker.request(
                    "worker.request_approval", payload, timeout=APPROVAL_WAIT_SECONDS + 15,
                )
                result = response.get("result") if isinstance(response, dict) else {}
                if isinstance(response, dict) and response.get("ok") and isinstance(result, dict):
                    outcome = str(result.get("outcome") or "rejected")
                    # DSH 原生审批结果词汇:allowed-once(批准一次)/rejected/cancelled/unavailable
                    if outcome == "allowed-once":
                        return "approved"
                    if outcome == "cancelled":
                        return "expired"
                return "rejected"
            except Exception as exc:  # noqa: BLE001
                print(f"[agent] DSH 原生审批桥不可用({exc}),安全失败", flush=True)
                return "rejected"

    async def clear_agent_data(self) -> dict:
        """清除智能体投影及其受控附件、草稿、运行日志和智能体发布适配包。"""
        async with self._runtime_mutation_lock:
            return await self._clear_agent_data_unlocked()

    async def _clear_agent_data_unlocked(self) -> dict:
        if self.active_run is not None or self.active_runs_by_runtime:
            return {"ok": False, "error": "存在进行中的运行,请先停止后再清除"}
        await self._stop_worker()
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
                               "publish-backups", "review-backups"):
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
            self._clear_inherited_automation_wait(run_id)
            db.update_run(run_id, status="canceled", finished_at=_now_iso())
            db.update_turn(run.get("turn_id") or "", status="canceled", completed_at=_now_iso())
            await self._cancel_automation_tasks_for_agent_run(run_id)
            await self.broadcast(run["session_id"], 0, "run.canceled", {"run_id": run_id})
            return {"ok": True, "status": "canceled"}
        if run["status"] in RUN_FINAL_STATUSES:
            return {"ok": True, "status": run["status"], "idempotent": True}
        if self.active_run and self.active_run["run_id"] == run_id and self.worker:
            result = await self.worker.request("worker.cancel_active", {"runId": run_id}, timeout=15)
            await self._finalize_assistant_stream(run_id, mark_complete=True)
            db.update_run(run_id, status="canceled", finished_at=_now_iso())
            db.update_turn(run.get("turn_id") or "", status="canceled", completed_at=_now_iso())
            await self._cancel_automation_tasks_for_agent_run(run_id)
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


_BROWSER_CREDENTIAL_HINTS = _re.compile(
    r"(?:password|passwd|pwd|token|cookie|authorization|api[_-]?key|apikey|"
    r"access[_-]?key|accesskey|private[_-]?key|privatekey|client[_-]?secret|"
    r"clientsecret|session[_-]?key|sessionkey|secret|current-password|new-password)",
    _re.IGNORECASE,
)


def _safe_tool_arguments(tool_name: Any, arguments: Any) -> Any:
    safe_arguments = redact_value(arguments)
    if (
        str(tool_name or "") != "browser_act"
        or not isinstance(arguments, dict)
        or not isinstance(safe_arguments, dict)
    ):
        return safe_arguments
    if str(arguments.get("action") or "") != "type":
        return safe_arguments
    selector_hint = " ".join(str(arguments.get(key) or "") for key in (
        "selector", "name", "id", "autocomplete", "field", "field_name",
    ))
    authorized = bool(arguments.get("credential_authorized") or arguments.get("allow_credential_input"))
    if authorized or _BROWSER_CREDENTIAL_HINTS.search(selector_hint):
        safe_arguments["text"] = REDACTED
    return safe_arguments


def _get_message_by_id(message_id: str) -> Optional[dict]:
    with db._lock:
        conn = db._conn()
        try:
            row = conn.execute("SELECT * FROM agent_messages WHERE message_id = ?", (message_id,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()
