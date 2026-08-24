"""Harness 智能体运行时关键生命周期回归。"""
from __future__ import annotations

import asyncio
import contextlib
import concurrent.futures
import json
import os
import re
import threading
import time
import uuid
import socket
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from core import data_sink
from core import runtime_paths
from core.agent import mcp_gateway
from core.agent import worker as worker_mod
from core.agent.service import AgentService, _cleanup_orphan_runtimes, _pick_free_port, _reserve_free_port
from core.agent.worker import AgentWorker, WORKER_STREAM_LIMIT_BYTES, WorkerProtocolError, resolve_node_executable


def _init_temp_agent_db(monkeypatch, tmp_path):
    monkeypatch.setenv("CRAWSHRIMP_DATA", str(tmp_path))
    monkeypatch.setattr(runtime_paths, "_runtime_data_root", None, raising=False)
    monkeypatch.setattr(runtime_paths, "_runtime_data_key", None, raising=False)
    runtime_paths.reset_runtime_data_root_cache()
    from core.agent import db
    db.init_agent_db()
    return db


def test_development_node_runtime_prefers_real_electron_executable(tmp_path, monkeypatch):
    app_root = tmp_path / "app"
    electron_root = app_root / "node_modules" / "electron"
    electron_dist = electron_root / "dist"
    electron_dist.mkdir(parents=True)
    packaged_executable = electron_dist / ("electron.exe" if os.name == "nt" else "electron")
    packaged_executable.write_text("", encoding="utf-8")
    (electron_root / "path.txt").write_text(packaged_executable.name + "\n", encoding="utf-8")

    shim_dir = app_root / "node_modules" / ".bin"
    shim_dir.mkdir(parents=True)
    (shim_dir / ("electron.cmd" if os.name == "nt" else "electron")).write_text("", encoding="utf-8")

    monkeypatch.delenv("CRAWSHRIMP_NODE_EXECUTABLE", raising=False)
    monkeypatch.delenv("CRAWSHRIMP_ELECTRON_NODE", raising=False)
    monkeypatch.setattr("core.agent.worker._app_root", lambda: app_root)
    monkeypatch.setattr("core.agent.worker.shutil.which", lambda _name: None)

    assert resolve_node_executable() == str(packaged_executable)


def test_native_approval_is_agent_service_method():
    service = AgentService()
    assert callable(service._ds_native_approval)


def test_agent_service_starts_shared_runtime_host_with_core_and_stops_it_on_shutdown(tmp_path, monkeypatch):
    monkeypatch.setenv("CRAWSHRIMP_DATA", str(tmp_path))
    service = AgentService()
    service._recover_on_startup = Mock()
    service._queue_loop = AsyncMock()
    service._start_mcp_server = AsyncMock()
    service.start_generation = AsyncMock(return_value=True)
    service._stop_worker = AsyncMock()
    service._stop_mcp_server = AsyncMock()

    async def scenario():
        await service.start()
        await asyncio.sleep(0)
        service.start_generation.assert_awaited_once_with()
        assert service._runtime_startup_task is not None
        await service.stop()
        assert service._runtime_startup_task is None

    asyncio.run(scenario())


@pytest.mark.parametrize(("url", "prefix", "matches"), [
    ("https://example.com/orders", "https://example.com", True),
    ("https://example.com:443/orders/1", "https://example.com/orders", True),
    ("https://example.com/orders-evil", "https://example.com/orders", False),
    ("https://example.com.evil/orders", "https://example.com/orders", False),
    ("http://example.com/orders", "https://example.com/orders", False),
    ("https://example.com:444/orders", "https://example.com/orders", False),
])
def test_browser_url_prefix_is_origin_and_path_bounded(url, prefix, matches):
    from core.agent.cdp import url_prefix_matches
    assert url_prefix_matches(url, prefix) is matches


def test_browser_observe_never_returns_password_values():
    from core.agent.cdp import ACT_TYPE_JS, OBSERVE_JS
    assert "credentialHints" in OBSERVE_JS
    assert "sensitive ? ''" in OBSERVE_JS
    assert "allowCredentialInput" in ACT_TYPE_JS
    assert "credentialBlocked" in ACT_TYPE_JS
    assert "HTMLInputElement.prototype" in ACT_TYPE_JS


def test_browser_act_credential_text_is_redacted_for_audit():
    from core.agent.redaction import REDACTED
    from core.agent.service import _safe_tool_arguments

    safe = _safe_tool_arguments("browser_act", {
        "action": "type",
        "selector": "#password",
        "text": "plain-secret-value",
        "credential_authorized": True,
    })

    assert safe["text"] == REDACTED
    assert safe["selector"] == "#password"


def test_browser_request_capture_redacts_query_and_body_secrets():
    from core.agent.cdp import _redact_post_data, _redact_url
    url = _redact_url("https://user:pass@example.com/api?q=visible&access_token=secret-token")
    body = _redact_post_data(json.dumps({"query": "visible", "password": "secret", "nested": {"apiKey": "key"}}))
    assert "visible" in url and "secret-token" not in url and "user:pass" not in url
    assert "visible" in body and "secret" not in body and '"apiKey":"***"' in body


def test_bound_browser_tab_closed_never_falls_back(monkeypatch):
    bridge = SimpleNamespace(get_tabs=lambda timeout=0: [
        {"id": "other", "type": "page", "url": "https://example.com", "webSocketDebuggerUrl": "ws://other"}
    ])
    monkeypatch.setattr("core.cdp_bridge.get_bridge", lambda: bridge)
    previous = mcp_gateway.ctx.grant
    mcp_gateway.ctx.grant = {"tab_id": "closed"}
    try:
        assert mcp_gateway._browser_tab() is None
    finally:
        mcp_gateway.ctx.grant = previous


def test_browser_client_ignores_legacy_url_prefix_but_keeps_exact_tab(monkeypatch):
    class FakeBridge:
        @staticmethod
        def get_tabs(timeout=0):
            return [{
                "id": "tab-bound",
                "type": "page",
                "url": "about:blank",
                "webSocketDebuggerUrl": "ws://bound",
            }]

    class FakeClient:
        def __init__(self, ws_url):
            self.ws_url = ws_url

    previous_run = mcp_gateway.ctx.active_run
    previous_grant = mcp_gateway.ctx.grant
    previous_emit = mcp_gateway.ctx.emit_event
    mcp_gateway.ctx.active_run = {"run_id": "run-prefix", "session_id": "session-prefix"}
    mcp_gateway.ctx.grant = {
        "tab_id": "tab-bound",
        "url_prefix": "about:blan",
    }
    mcp_gateway.ctx.emit_event = None
    monkeypatch.setattr("core.cdp_bridge.get_bridge", lambda: FakeBridge())
    monkeypatch.setattr(mcp_gateway, "CdpClient", FakeClient)
    try:
        client, tab, guard = mcp_gateway._browser_client()
    finally:
        mcp_gateway.ctx.active_run = previous_run
        mcp_gateway.ctx.grant = previous_grant
        mcp_gateway.ctx.emit_event = previous_emit

    assert guard is None
    assert tab["id"] == "tab-bound"
    assert client.ws_url == "ws://bound"


def test_browser_activity_exposes_only_granted_tab():
    events = []
    previous = mcp_gateway.ctx.emit_event
    mcp_gateway.ctx.emit_event = lambda event_type, payload: events.append((event_type, payload))
    try:
        mcp_gateway._signal_browser_activity({"id": "tab-a", "url": "https://a", "title": "A"})
    finally:
        mcp_gateway.ctx.emit_event = previous
    assert events == [("browser.activity", {
        "active_tab_id": "tab-a",
        "tabs": [{"id": "tab-a", "url": "https://a", "title": "A"}],
    })]


def test_service_browser_activity_keeps_only_active_session_tab(monkeypatch):
    service = AgentService()
    monkeypatch.setattr(
        "core.agent.service.db.list_granted_tab_ids_for_session",
        lambda session_id: ["tab-a", "tab-b"] if session_id == "session-a" else [],
    )
    bridge = SimpleNamespace(get_tabs=lambda timeout=0: [
        {"id": "tab-a", "type": "page", "url": "https://a", "title": "A"},
        {"id": "tab-b", "type": "page", "url": "https://b", "title": "B"},
        {"id": "tab-other", "type": "page", "url": "https://other", "title": "Other"},
    ])
    monkeypatch.setattr("core.cdp_bridge.get_bridge", lambda: bridge)

    tabs = service._session_browser_tabs("session-a", {
        "active_tab_id": "tab-b",
        "tabs": [{"id": "tab-b", "url": "https://old-b", "title": "Old B"}],
    })
    assert [tab["id"] for tab in tabs] == ["tab-b"]
    assert all(tab["id"] != "tab-other" for tab in tabs)
    assert tabs[0]["url"] == "https://b"


def test_service_browser_activity_uses_active_tab_when_payload_contains_global_tabs(monkeypatch):
    service = AgentService()
    monkeypatch.setattr(
        "core.agent.service.db.list_granted_tab_ids_for_session",
        lambda session_id: ["tab-active", "tab-old"] if session_id == "session-a" else [],
    )
    bridge = SimpleNamespace(get_tabs=lambda timeout=0: [
        {"id": "tab-active", "type": "page", "url": "https://active", "title": "Active"},
        {"id": "tab-old", "type": "page", "url": "https://old", "title": "Old"},
        {"id": "tab-other", "type": "page", "url": "https://other", "title": "Other"},
    ])
    monkeypatch.setattr("core.cdp_bridge.get_bridge", lambda: bridge)

    tabs = service._session_browser_tabs("session-a", {
        "active_tab_id": "tab-active",
        "tabs": [
            {"id": "tab-active", "url": "https://active", "title": "Active"},
            {"id": "tab-old", "url": "https://old", "title": "Old"},
            {"id": "tab-other", "url": "https://other", "title": "Other"},
        ],
    })
    assert tabs == [{"id": "tab-active", "url": "https://active", "title": "Active"}]


def test_generated_media_events_have_stable_nonempty_ids(tmp_path):
    image = tmp_path / "result.png"
    image.write_bytes(b"png-bytes")
    events = []
    previous = mcp_gateway.ctx.emit_event
    mcp_gateway.ctx.emit_event = lambda event_type, payload: events.append((event_type, payload))
    try:
        mcp_gateway._broadcast_media_artifacts([str(image)], "image")
        mcp_gateway._broadcast_media_artifacts([str(image)], "image")
    finally:
        mcp_gateway.ctx.emit_event = previous
    ids = [payload["artifact_id"] for _event, payload in events]
    assert len(ids) == 2
    assert ids[0].startswith("media-")
    assert ids[0] == ids[1]


def test_agent_image_generate_passes_free_size_quality_and_4k_key_tier(tmp_path, monkeypatch):
    monkeypatch.setattr("core.runtime_paths.data_root", lambda: tmp_path)
    data_sink.init_db()
    settings = {
        "base_url": "https://one-xm-proxy.example/v1",
        "ai.1xm.gpt_image_2k_key": "unit-2k-key",
        "ai.1xm.gpt_image_4k_key": "unit-4k-key",
    }
    captured = {}

    def fake_generate(job_uid, prompts, **kwargs):
        job = data_sink.get_ai_image_job(job_uid)
        captured["job"] = job
        captured["prompts"] = prompts
        captured["kwargs"] = kwargs
        return {
            "ok": True,
            "assets": [{"path": str(tmp_path / "result.png")}],
            "output_dir": str(tmp_path),
            "job_uid": job_uid,
        }

    previous_run = mcp_gateway.ctx.active_run
    monkeypatch.setattr("core.api_server._resolve_one_xm_settings", lambda: settings)
    monkeypatch.setattr("core.ai_image_service.generate_images_sync", fake_generate)
    mcp_gateway.ctx.active_run = {"run_id": "run-image", "session_id": "session-image"}
    try:
        result = mcp_gateway.tool_image_generate(
            "make a portrait",
            count=2,
            size="3840x2160",
            quality="high",
            output_format="jpeg",
            key_tier="4k",
        )
    finally:
        mcp_gateway.ctx.active_run = previous_run

    assert result["ok"] is True
    assert result["data"]["size"] == "3840x2160"
    assert result["data"]["quality"] == "high"
    assert result["data"]["output_format"] == "jpeg"
    assert result["data"]["key_tier"] == "4k"
    assert captured["prompts"] == [{"prompt": "make a portrait", "count": 2}]
    assert captured["kwargs"]["settings"] is settings
    job = captured["job"]
    assert job["model_key"] == "gpt-image-2"
    assert job["params"]["size"] == "3840x2160"
    assert job["params"]["quality"] == "high"
    assert job["params"]["output_format"] == "jpeg"
    assert job["params"]["model_key_tier"] == "4k"


def test_navigate_auto_executes_without_approval(monkeypatch):
    class Client:
        def __init__(self):
            self.navigated = []

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def navigate(self, url):
            self.navigated.append(url)
            return {"url": url}

    async def scenario():
        client = Client()

        async def fail_approval(*_args):
            raise AssertionError("browser_navigate should not request approval")

        previous = (mcp_gateway.ctx.active_run, mcp_gateway.ctx.grant, mcp_gateway.ctx.request_approval)
        mcp_gateway.ctx.active_run = {"run_id": "run", "session_id": "session"}
        mcp_gateway.ctx.grant = {"grant_id": "grant", "toolset_json": "[]"}
        mcp_gateway.ctx.request_approval = fail_approval
        monkeypatch.setattr(mcp_gateway, "_browser_client", lambda: (client, {"url": "https://from"}, None))
        monkeypatch.setattr(
            mcp_gateway.db,
            "update_grant_toolset",
            lambda *_args: (_ for _ in ()).throw(AssertionError("navigate should not update grant toolset")),
        )
        try:
            first = await mcp_gateway.tool_browser_navigate("https://example.com/one")
            second = await mcp_gateway.tool_browser_navigate("https://example.com/two")
        finally:
            mcp_gateway.ctx.active_run, mcp_gateway.ctx.grant, mcp_gateway.ctx.request_approval = previous
        assert first["ok"] and second["ok"]
        assert client.navigated == ["https://example.com/one", "https://example.com/two"]

    asyncio.run(scenario())


def test_missing_explicit_tab_creates_tombstone_grant(monkeypatch):
    service = AgentService()
    bridge = SimpleNamespace(get_tabs=lambda timeout=0: [
        {"id": "other", "type": "page", "url": "https://example.com"}
    ])
    monkeypatch.setattr("core.cdp_bridge.get_bridge", lambda: bridge)
    monkeypatch.setattr(
        "core.agent.service.db.create_grant",
        lambda grant_id, run_id, prefix, tab_id, toolset, expires: {
            "grant_id": grant_id, "run_id": run_id, "url_prefix": prefix, "tab_id": tab_id,
            "toolset_json": json.dumps(toolset), "expires_at": expires,
        },
    )
    grant = service._grant_for_run({
        "run_id": "run", "context_refs": [{"type": "browser_tab", "id": "closed-tab"}],
        "grant_prefs": {},
    })
    assert grant["tab_id"] == "closed-tab"
    assert grant["url_prefix"] is None


def test_fs_write_reaches_approval_instead_of_name_error(tmp_path, monkeypatch):
    previous_run = mcp_gateway.ctx.active_run
    mcp_gateway.ctx.active_run = {"run_id": "run-write", "session_id": "session-write"}
    monkeypatch.setattr(mcp_gateway, "_await_approval_blocking", lambda *_args: "rejected")
    try:
        result = mcp_gateway.tool_fs_write(str(tmp_path / "blocked.txt"), "content")
    finally:
        mcp_gateway.ctx.active_run = previous_run
    assert result["status"] == "rejected"
    assert not (tmp_path / "blocked.txt").exists()


def test_fs_write_retries_transient_windows_sharing_violation(tmp_path, monkeypatch):
    target = tmp_path / "approved.txt"
    original_write_text = Path.write_text
    attempts = 0

    def transient_write_text(path, *args, **kwargs):
        nonlocal attempts
        if path == target:
            attempts += 1
            if attempts == 1:
                error = PermissionError("[WinError 32] sharing violation")
                error.winerror = 32
                raise error
        return original_write_text(path, *args, **kwargs)

    previous_run = mcp_gateway.ctx.active_run
    mcp_gateway.ctx.active_run = {"run_id": "run-write-retry", "session_id": "session-write-retry"}
    monkeypatch.setattr(mcp_gateway, "_await_approval_blocking", lambda *_args: "approved")
    monkeypatch.setattr(Path, "write_text", transient_write_text)
    try:
        result = mcp_gateway.tool_fs_write(str(target), "content")
    finally:
        mcp_gateway.ctx.active_run = previous_run

    assert result["ok"] is True
    assert attempts == 2
    assert target.read_text(encoding="utf-8") == "content"


def _run_item() -> dict:
    return {
        "run_id": "run-1",
        "session_id": "session-1",
        "turn_id": "turn-1",
        "text": "hello",
        "model_id": "gpt-5.5",
        "provider_id": "provider",
        "context_refs": [],
        "grant_prefs": {},
    }


def test_completed_run_broadcasts_artifacts():
    async def scenario():
        service = AgentService()
        service.worker = SimpleNamespace(request=AsyncMock(return_value={
            "summary": {"status": "completed", "messageId": "m-1"},
        }))
        service._ensure_generation = AsyncMock(return_value=True)
        service._broadcast_run_artifacts = AsyncMock()
        service.broadcast = AsyncMock()
        run = {"run_id": "run-1", "session_id": "session-1", "status": "queued"}
        with (
            patch("core.agent.service.db.get_run", return_value=run),
            patch("core.agent.service.db.update_run"),
            patch("core.agent.service.db.update_turn"),
            patch("core.agent.service.db.update_session"),
        ):
            await service._run_one(_run_item())
        service._broadcast_run_artifacts.assert_awaited_once_with("run-1", "session-1")

    asyncio.run(scenario())


def test_run_failure_before_status_assignment_keeps_original_error():
    async def scenario():
        service = AgentService()
        service.worker = SimpleNamespace(request=AsyncMock(side_effect=RuntimeError("worker exploded")))
        service._ensure_generation = AsyncMock(return_value=True)
        service.broadcast = AsyncMock()
        service._note_crash = lambda message: None
        run = {"run_id": "run-1", "session_id": "session-1", "status": "queued"}
        with (
            patch("core.agent.service.db.get_run", return_value=run),
            patch("core.agent.service.db.update_run") as update_run,
            patch("core.agent.service.db.update_turn"),
            patch("core.agent.service.db.update_session"),
        ):
            await service._run_one(_run_item())
        assert any("worker exploded" in str(call.kwargs.get("error_message", ""))
                   for call in update_run.call_args_list)

    asyncio.run(scenario())


def test_generation_model_configuration_error_does_not_consume_crash_budget():
    async def scenario():
        service = AgentService()
        service._ensure_generation = AsyncMock(return_value=False)
        service.broadcast = AsyncMock()
        service.runtime_state = "needs_configuration"
        service.runtime_error = "智能体模型 gpt-5.6-terra(crawshrimp-overseas-openai) 没有可用 API Key"
        service.runtime_error_code = "MODEL_CONFIGURATION"
        service._note_crash = Mock()
        run = {"run_id": "run-1", "session_id": "session-1", "status": "queued"}
        with (
            patch("core.agent.service.db.get_run", return_value=run),
            patch("core.agent.service.db.update_run") as update_run,
            patch("core.agent.service.db.update_turn"),
            patch("core.agent.service.db.update_session"),
        ):
            await service._run_one(_run_item())

        service._note_crash.assert_not_called()
        assert any(call.kwargs.get("error_code") == "MODEL_CONFIGURATION_ERROR"
                   for call in update_run.call_args_list)

    asyncio.run(scenario())


class _SilentStdin:
    def write(self, _payload):
        return None

    async def drain(self):
        return None


class _EofStream:
    async def readline(self):
        return b""


def _worker() -> AgentWorker:
    return AgentWorker(
        runtime_root=".", data_root=".", cordis_path="cordis.yml",
        mcp_url="http://127.0.0.1/mcp", session_root=".",
    )


def test_worker_request_timeout_removes_pending_future():
    async def scenario():
        worker = _worker()
        worker.proc = SimpleNamespace(stdin=_SilentStdin())
        with pytest.raises(asyncio.TimeoutError):
            await worker.request("never.responds", timeout=0.001)
        assert worker._pending == {}

    asyncio.run(scenario())


def test_worker_eof_rejects_all_pending_requests():
    async def scenario():
        worker = _worker()
        worker.proc = SimpleNamespace(stdout=_EofStream(), stderr=_EofStream())
        future = asyncio.get_running_loop().create_future()
        worker._pending[1] = future
        await worker._read_loop()
        assert worker._pending == {}
        with pytest.raises(WorkerProtocolError, match="已退出"):
            future.result()

    asyncio.run(scenario())


def test_worker_subprocess_stream_limit_handles_vision_frames(tmp_path, monkeypatch):
    async def scenario():
        runtime_root = tmp_path / "runtime"
        worker_dir = runtime_root / "worker"
        worker_dir.mkdir(parents=True)
        (worker_dir / "worker.mjs").write_text("", encoding="utf-8")
        captured = {}

        async def fake_create_subprocess_exec(*_args, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(stdin=_SilentStdin(), stdout=_EofStream(), stderr=_EofStream())

        monkeypatch.setattr(worker_mod, "resolve_node_executable", lambda: "node")
        monkeypatch.setattr(worker_mod.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

        worker = AgentWorker(
            runtime_root=str(runtime_root),
            data_root=str(tmp_path),
            cordis_path="cordis.yml",
            mcp_url="http://127.0.0.1/mcp",
            session_root=str(tmp_path / "sessions"),
        )
        await worker.start()
        assert captured["limit"] == WORKER_STREAM_LIMIT_BYTES
        assert captured["limit"] > 4 * 1024 * 1024
        if worker._reader_task:
            worker._reader_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await worker._reader_task

    asyncio.run(scenario())


def test_mcp_context_leases_bind_parallel_sessions_independently():
    async def scenario():
        service = AgentService()
        run_a = {"run_id": "run-a", "session_id": "session-a", "status": "running"}
        run_b = {"run_id": "run-b", "session_id": "session-b", "status": "running"}
        grant_a = {"grant_id": "grant-a", "run_id": "run-a", "tab_id": "tab-a"}
        grant_b = {"grant_id": "grant-b", "run_id": "run-b", "tab_id": "tab-b"}
        service.register_run_context("runtime-a", run_a, grant_a)
        service.register_run_context("runtime-b", run_b, grant_b)

        lease_a = await service.acquire_mcp_context("runtime-a", "call-a")
        lease_b = await service.acquire_mcp_context("runtime-b", "call-b")

        token_a = service.bind_mcp_context_for_request(lease_a["lease_id"])
        try:
            assert mcp_gateway.ctx.active_run["run_id"] == "run-a"
            assert mcp_gateway.ctx.grant["tab_id"] == "tab-a"
            assert mcp_gateway.ctx.current_tool_call_id == "run-a:call-a"
        finally:
            service.reset_mcp_context_for_request(token_a)

        token_b = service.bind_mcp_context_for_request(lease_b["lease_id"])
        try:
            assert mcp_gateway.ctx.active_run["run_id"] == "run-b"
            assert mcp_gateway.ctx.grant["tab_id"] == "tab-b"
            assert mcp_gateway.ctx.current_tool_call_id == "run-b:call-b"
        finally:
            service.reset_mcp_context_for_request(token_b)

        assert service.release_mcp_context(lease_a["lease_id"])
        assert service.release_mcp_context(lease_b["lease_id"])

    asyncio.run(scenario())


def test_mcp_context_release_persists_approved_toolset_across_leases():
    async def scenario():
        service = AgentService()
        run = {"run_id": "run-approved", "session_id": "session-approved", "status": "running"}
        grant = {
            "grant_id": "grant-approved",
            "run_id": "run-approved",
            "toolset_json": "[]",
        }
        service.register_run_context("runtime-approved", run, grant)

        first = await service.acquire_mcp_context("runtime-approved", "call-one")
        token = service.bind_mcp_context_for_request(first["lease_id"])
        try:
            mcp_gateway.ctx.grant = dict(mcp_gateway.ctx.grant or {}, toolset_json=json.dumps(["act"]))
        finally:
            service.reset_mcp_context_for_request(token)
        assert service.release_mcp_context(first["lease_id"])

        second = await service.acquire_mcp_context("runtime-approved", "call-two")
        token = service.bind_mcp_context_for_request(second["lease_id"])
        try:
            assert json.loads(mcp_gateway.ctx.grant["toolset_json"]) == ["act"]
        finally:
            service.reset_mcp_context_for_request(token)
        assert service.release_mcp_context(second["lease_id"])

    asyncio.run(scenario())


def test_plan_is_claimed_before_creating_task_instance(monkeypatch):
    plan = {
        "plan_id": "plan-race",
        "session_id": "session-race",
        "run_id": "run-race",
        "adapter_id": "adapter-race",
        "task_id": "task-race",
        "params_json": json.dumps({"value": 1}),
        "params_sha256": "hash",
        "risk": "read_only",
        "approval_required": 0,
        "status": "ready",
        "expires_at": "2099-01-01T00:00:00+00:00",
        "task_instance_uid": None,
    }
    state = dict(plan)
    state_lock = threading.Lock()
    create_entered = threading.Event()
    release_create = threading.Event()
    created = []

    def get_plan(_plan_id):
        with state_lock:
            return dict(state)

    def claim_plan(_plan_id, task_instance_uid=""):
        with state_lock:
            if state["status"] != "ready":
                return None
            state["status"] = "executing"
            state["task_instance_uid"] = task_instance_uid
            return dict(state)

    def update_plan(_plan_id, **fields):
        with state_lock:
            state.update(fields)

    def create_instance(*_args, **kwargs):
        reserved_uid = kwargs["instance_uid"]
        created.append(reserved_uid)
        create_entered.set()
        release_create.wait(timeout=2)
        return {"uid": reserved_uid}

    previous_create = mcp_gateway.ctx.create_task_instance
    previous_start = mcp_gateway.ctx.run_task_instance
    mcp_gateway.ctx.create_task_instance = create_instance
    mcp_gateway.ctx.run_task_instance = None
    monkeypatch.setattr(mcp_gateway.db, "get_plan", get_plan)
    monkeypatch.setattr(mcp_gateway.db, "claim_plan", claim_plan, raising=False)
    monkeypatch.setattr(mcp_gateway.db, "update_plan", update_plan)

    def run_with_context():
        token = mcp_gateway.bind_tool_context({
            "active_run": {"run_id": "run-race", "session_id": "session-race"},
            "grant": None,
            "current_tool_call_id": "",
        })
        try:
            return mcp_gateway.tool_task_run("plan-race")
        finally:
            mcp_gateway.reset_tool_context(token)

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(run_with_context)
            assert create_entered.wait(timeout=1)
            second = executor.submit(run_with_context)
            second_result = second.result(timeout=1)
            release_create.set()
            first_result = first.result(timeout=1)
    finally:
        release_create.set()
        mcp_gateway.ctx.create_task_instance = previous_create
        mcp_gateway.ctx.run_task_instance = previous_start

    assert len(created) == 1
    assert first_result["data"]["task_instance_uid"] == created[0]
    assert second_result["data"]["task_instance_uid"] == created[0]


def test_plan_start_timeout_returns_starting_instead_of_failing(monkeypatch):
    plan = {
        "plan_id": "plan-slow-start",
        "adapter_id": "adapter",
        "task_id": "task",
        "status": "ready",
    }
    updates = []

    class RunningLoop:
        def is_running(self):
            return True

    class TimedOutFuture:
        callback = None

        def result(self, timeout=None):
            raise concurrent.futures.TimeoutError()

        def add_done_callback(self, callback):
            self.callback = callback

    async def slow_start(*_args):
        await asyncio.sleep(0)

    previous = (
        mcp_gateway.ctx.create_task_instance,
        mcp_gateway.ctx.run_task_instance,
        getattr(mcp_gateway.ctx, "main_loop", None),
    )
    mcp_gateway.ctx.create_task_instance = lambda *_args, **_kwargs: {"uid": "ti-slow"}
    mcp_gateway.ctx.run_task_instance = slow_start
    mcp_gateway.ctx.main_loop = RunningLoop()
    monkeypatch.setattr(
        mcp_gateway.db, "claim_plan",
        lambda _pid, task_instance_uid="": {
            **plan, "status": "executing", "task_instance_uid": task_instance_uid,
        },
        raising=False,
    )
    monkeypatch.setattr(mcp_gateway.db, "update_plan", lambda _pid, **fields: updates.append(fields))
    scheduled_future = TimedOutFuture()

    def schedule(coro, _loop):
        coro.close()
        return scheduled_future

    monkeypatch.setattr(asyncio, "run_coroutine_threadsafe", schedule)
    try:
        result = mcp_gateway._execute_plan(plan, {})
    finally:
        (mcp_gateway.ctx.create_task_instance,
         mcp_gateway.ctx.run_task_instance,
         mcp_gateway.ctx.main_loop) = previous

    assert result["ok"] is True
    assert result["status"] == "starting"
    assert result["data"]["task_instance_uid"] == "ti-slow"
    assert not any(update.get("status") == "failed" for update in updates)
    assert callable(scheduled_future.callback)
    scheduled_future.callback(SimpleNamespace(result=lambda: None))
    assert any(update.get("status") == "consumed" for update in updates)


def test_unknown_runtime_session_cannot_acquire_mcp_context():
    async def scenario():
        service = AgentService()
        with pytest.raises(LookupError, match="active run"):
            await service.acquire_mcp_context("missing-runtime", "call-x")
        assert service._mcp_context_leases == {}

    asyncio.run(scenario())


def test_mcp_context_lease_expires_if_bridge_never_releases(monkeypatch):
    async def scenario():
        import core.agent.service as service_module

        monkeypatch.setattr(service_module, "MCP_CONTEXT_LEASE_MAX_SECONDS", 0.01, raising=False)
        service = AgentService()
        run = {"run_id": "run-expire", "session_id": "session-expire", "status": "running"}
        service.register_run_context("runtime-expire", run)
        lease = await service.acquire_mcp_context("runtime-expire", "call-expire")
        token = service.bind_mcp_context_for_request(lease["lease_id"])
        try:
            assert mcp_gateway.ctx.active_run["run_id"] == "run-expire"
        finally:
            service.reset_mcp_context_for_request(token)
        await asyncio.sleep(0.03)
        assert service._mcp_context_leases == {}

    asyncio.run(scenario())


def test_unknown_mcp_context_lease_cannot_bind_request():
    async def scenario():
        service = AgentService()
        with pytest.raises(LookupError, match="Unknown MCP context lease"):
            service.bind_mcp_context_for_request("lease-missing")

    asyncio.run(scenario())


def test_pick_free_port_raises_when_range_is_exhausted(monkeypatch):
    class BusySocket:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def bind(self, _address):
            raise OSError("busy")

    monkeypatch.setattr(socket, "socket", lambda *_args, **_kwargs: BusySocket())
    with pytest.raises(RuntimeError, match="均已占用"):
        _pick_free_port(19000, 3)


def test_reserved_port_socket_prevents_second_bind():
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    reserved_port, reserved = _reserve_free_port(port, 1)
    challenger = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        assert reserved_port == port
        with pytest.raises(OSError):
            challenger.bind(("127.0.0.1", port))
    finally:
        challenger.close()
        reserved.close()


def test_settle_web_port_requires_dsh_boot_and_crawshrimp_slots(monkeypatch):
    import http.client

    bodies = {
        19300: "<script>window.__DSH_BOOT__={}</script>",
        19301: "__DSH_BOOT__ crawshrimp-slots",
    }
    probed = []

    class Response:
        status = 200

        def __init__(self, body):
            self.body = body

        def read(self, _limit):
            return self.body.encode()

    class Connection:
        def __init__(self, _host, port, timeout=0):
            self.port = port

        def request(self, *_args):
            probed.append(self.port)

        def getresponse(self):
            return Response(bodies.get(self.port, ""))

        def close(self):
            return None

    monkeypatch.setattr(http.client, "HTTPConnection", Connection)
    service = AgentService()
    service.web_port = 19300
    asyncio.run(service._settle_web_port(19300))
    assert service.web_port == 19301
    assert 19300 in probed and 19301 in probed


def test_runtime_status_withholds_unverified_ready_web_url(monkeypatch, tmp_path):
    service = AgentService()
    service.runtime_state = "ready"
    service.web_port = 19300
    service._web_port_verified = False
    monkeypatch.setattr("core.agent.service._find_crawshrimp_web_port", lambda *_args, **_kwargs: 0)
    monkeypatch.setattr("core.agent.service._data_root", lambda: tmp_path)
    monkeypatch.setattr("core.agent.service.load_config", lambda: {"ai": {"llm": {}}})

    status = service.runtime_status()

    assert status["state"] == "ready"
    assert status["web_port"] == 0
    assert status["web_url"] == ""
    assert status["web_candidate_port"] == 19300
    assert status["web_candidate_url"] == "http://127.0.0.1:19300/"
    assert status["web_verified"] is False
    assert status["web_verification_pending"] is True


def test_runtime_status_repairs_and_reports_drifted_web_port(monkeypatch, tmp_path):
    service = AgentService()
    service.runtime_state = "ready"
    service.web_port = 19300
    service._web_port_verified = False
    monkeypatch.setattr("core.agent.service._find_crawshrimp_web_port", lambda *_args, **_kwargs: 19301)
    monkeypatch.setattr("core.agent.service._data_root", lambda: tmp_path)
    monkeypatch.setattr("core.agent.service.load_config", lambda: {"ai": {"llm": {}}})

    status = service.runtime_status()

    assert status["web_port"] == 19301
    assert status["web_url"] == "http://127.0.0.1:19301/"
    assert status["web_candidate_port"] == 19301
    assert status["web_candidate_url"] == "http://127.0.0.1:19301/"
    assert status["web_verified"] is True
    assert status["web_verification_pending"] is False
    assert service.web_port == 19301
    assert service._web_port_verified is True


def test_runtime_status_without_any_model_key_keeps_runtime_startable(monkeypatch):
    service = AgentService()
    service.runtime_state = "stopped"
    monkeypatch.setattr("core.agent.service.load_config", lambda: {"ai": {"llm": {
        "api_key": "",
        "deepseek_api_key": "",
        "default_model": "deepseek-official-v4-flash",
    }}})
    monkeypatch.delenv("CRAWSHRIMP_LLM_API_KEY", raising=False)
    monkeypatch.delenv("CRAWSHRIMP_DEEPSEEK_API_KEY", raising=False)

    status = service.runtime_status()

    assert status["state"] == "stopped"
    assert status["api_key_configured"] is False
    assert status["error"] == ""


def test_orphan_cleanup_preserves_live_parent_and_terminates_true_orphan(tmp_path, monkeypatch):
    import core.agent.service as service_module

    session_root = str(tmp_path / "agent" / "harness-sessions")
    output = "\n".join((
        f"101 201 node worker/worker.mjs {session_root}",
        f"102 1 node dsh-sdk-jsonrpc-demo {session_root}",
    ))
    monkeypatch.setattr(
        "subprocess.run",
        lambda *_args, **_kwargs: SimpleNamespace(stdout=output),
    )
    monkeypatch.setattr(service_module, "_process_is_alive", lambda pid: pid == 201)
    killed = []
    monkeypatch.setattr(service_module.os, "kill", lambda pid, sig: killed.append((pid, sig)))
    _cleanup_orphan_runtimes(str(tmp_path))
    assert killed == [(102, 15)]


def test_windows_orphan_cleanup_preserves_live_parent_and_terminates_true_orphan(tmp_path, monkeypatch):
    import core.agent.service as service_module

    harness_root = tmp_path / "deepseek-harness"
    worker_entry = harness_root / "worker" / "worker.mjs"
    demo_entry = harness_root / "node_modules" / "@deepseek-ai" / "dsh-sdk-jsonrpc-demo" / "lib" / "bin.js"
    output = json.dumps([
        {"ProcessId": 501, "ParentProcessId": 601, "CommandLine": f"electron {worker_entry}"},
        {"ProcessId": 502, "ParentProcessId": 1, "CommandLine": f"electron {demo_entry}"},
    ])
    calls = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args[0] == "powershell":
            return SimpleNamespace(stdout=output)
        if args[0] == "taskkill":
            return SimpleNamespace(stdout="")
        raise AssertionError(args)

    monkeypatch.setattr(service_module, "resolve_harness_root", lambda: harness_root)
    monkeypatch.setattr(service_module, "_process_is_alive", lambda pid: pid == 601)
    monkeypatch.setattr("subprocess.run", fake_run)

    service_module._cleanup_orphan_runtimes_windows(str(tmp_path))

    taskkill_calls = [call for call in calls if call[0] == "taskkill"]
    assert taskkill_calls == [["taskkill", "/F", "/T", "/PID", "502"]]


def test_artifact_collection_is_dispatched_to_thread(monkeypatch):
    async def scenario():
        service = AgentService()
        calls = []

        async def fake_to_thread(fn, *args):
            calls.append((fn, args))
            return []

        monkeypatch.setattr(asyncio, "to_thread", fake_to_thread)
        previous = mcp_gateway.ctx.list_task_artifacts
        mcp_gateway.ctx.list_task_artifacts = lambda _uid: []
        try:
            await service._broadcast_run_artifacts("run", "session")
        finally:
            mcp_gateway.ctx.list_task_artifacts = previous
        assert calls == [(service._collect_run_artifacts, ("run",))]

    asyncio.run(scenario())


class _RevisionRowsConnection:
    def __init__(self, revisions):
        self.revisions = revisions

    def execute(self, _query):
        return self

    def fetchall(self):
        return self.revisions

    def close(self):
        return None


def test_clear_agent_data_removes_owned_files_and_agent_adapters(tmp_path, monkeypatch):
    service = AgentService()
    revisions = [
        {"status": "published", "adapter_id": "published", "target_adapter_id": "published",
         "test_adapter_id": None},
        {"status": "testing", "adapter_id": "target", "target_adapter_id": "target",
         "test_adapter_id": "review-test"},
    ]
    monkeypatch.setattr("core.agent.service.db._conn", lambda: _RevisionRowsConnection(revisions))
    cleared = []
    monkeypatch.setattr("core.agent.service.db.clear_agent_data", lambda: cleared.append(True))
    uninstalled = []
    monkeypatch.setattr("core.adapter_loader.uninstall", lambda adapter_id: uninstalled.append(adapter_id))
    monkeypatch.setattr("core.agent.service._data_root", lambda: tmp_path)
    for name in ("attachments", "workspace", "harness-sessions", "runtime-workdir", "review-backups",
                 "published-baselines"):
        directory = tmp_path / "agent" / name
        directory.mkdir(parents=True)
        (directory / "owned.txt").write_text("owned", encoding="utf-8")
    mcp_gateway.ctx.plan_params["plan-secret"] = {"token": "secret"}

    result = asyncio.run(service.clear_agent_data())

    assert result["ok"] is True
    assert uninstalled == ["published", "review-test"]
    assert cleared == [True]
    assert not any((tmp_path / "agent" / name).exists() for name in (
        "attachments", "workspace", "harness-sessions", "runtime-workdir", "review-backups",
        "published-baselines",
    ))
    assert mcp_gateway.ctx.plan_params == {}


def test_clear_agent_data_stops_idle_runtime_before_removing_files(tmp_path, monkeypatch):
    service = AgentService()
    service.worker = object()
    service.runtime_state = "ready"
    events = []

    async def stop_worker():
        events.append("stop-runtime")
        service.worker = None
        service.runtime_state = "stopped"

    monkeypatch.setattr(service, "_stop_worker", stop_worker)
    monkeypatch.setattr("core.agent.service.db._conn", lambda: _RevisionRowsConnection([]))
    monkeypatch.setattr("core.agent.service.db.clear_agent_data", lambda: events.append("clear-db"))
    monkeypatch.setattr("core.agent.service._data_root", lambda: tmp_path)
    monkeypatch.setattr(
        "core.agent.service._remove_owned_tree",
        lambda _path: events.append("remove-files"),
    )

    result = asyncio.run(service.clear_agent_data())

    assert result["ok"] is True
    assert events[0] == "stop-runtime"
    assert events.index("stop-runtime") < events.index("remove-files") < events.index("clear-db")
    assert service.worker is None
    assert service.runtime_state == "stopped"


def test_clear_agent_data_stops_before_files_and_db_when_uninstall_fails(tmp_path, monkeypatch):
    service = AgentService()
    revisions = [{"status": "published", "adapter_id": "published",
                  "target_adapter_id": "published", "test_adapter_id": None}]
    monkeypatch.setattr("core.agent.service.db._conn", lambda: _RevisionRowsConnection(revisions))
    monkeypatch.setattr(
        "core.agent.service.db.clear_agent_data",
        lambda: pytest.fail("适配器卸载失败后不得清数据库"),
    )
    monkeypatch.setattr(
        "core.adapter_loader.uninstall",
        lambda _adapter_id: (_ for _ in ()).throw(OSError("permission denied")),
    )
    monkeypatch.setattr("core.agent.service._data_root", lambda: tmp_path)
    owned = tmp_path / "agent" / "attachments" / "owned.txt"
    owned.parent.mkdir(parents=True)
    owned.write_text("owned", encoding="utf-8")

    result = asyncio.run(service.clear_agent_data())

    assert result["ok"] is False
    assert "permission denied" in result["error"]
    assert owned.exists()


def test_clear_agent_data_unlinks_owned_symlink_without_following_target(tmp_path, monkeypatch):
    service = AgentService()
    monkeypatch.setattr("core.agent.service.db._conn", lambda: _RevisionRowsConnection([]))
    monkeypatch.setattr("core.agent.service.db.clear_agent_data", lambda: None)
    monkeypatch.setattr("core.agent.service._data_root", lambda: tmp_path)
    external = tmp_path / "external"
    external.mkdir()
    marker = external / "keep.txt"
    marker.write_text("keep", encoding="utf-8")
    attachments = tmp_path / "agent" / "attachments"
    attachments.parent.mkdir(parents=True)
    attachments.symlink_to(external, target_is_directory=True)

    result = asyncio.run(service.clear_agent_data())

    assert result["ok"] is True
    assert not attachments.exists()
    assert not attachments.is_symlink()
    assert marker.read_text(encoding="utf-8") == "keep"


def test_media_signature_is_path_entry_and_expiry_bound(monkeypatch):
    import core.api_server as api_server

    monkeypatch.setattr(api_server, "_get_api_token", lambda: "test-master-token")
    monkeypatch.setattr(api_server, "MEDIA_SIGNATURE_TTL_SECONDS", 1800)
    signed = api_server._sign_media_access("/tmp/result.zip", "one.png", expires=2_000_000_000)
    assert api_server._media_signature_ok(
        "entry", "/tmp/result.zip", "one.png", str(signed["expires"]), signed["signature"]
    ) is False  # 过远的自造 expiry 不可用

    import time
    expiry = int(time.time()) + 60
    signed = api_server._sign_media_access("/tmp/result.zip", "one.png", expires=expiry)
    assert api_server._media_signature_ok(
        "entry", "/tmp/result.zip", "one.png", str(expiry), signed["signature"]
    )
    assert not api_server._media_signature_ok(
        "entry", "/tmp/other.zip", "one.png", str(expiry), signed["signature"]
    )
    assert not api_server._media_signature_ok(
        "entry", "/tmp/result.zip", "two.png", str(expiry), signed["signature"]
    )
    assert not api_server._media_signature_ok(
        "file", "/tmp/result.zip", "one.png", str(expiry), signed["signature"]
    )
    assert api_server._signed_media_request_ok(
        "GET", "/agent/artifacts/entry", "/tmp/result.zip", "one.png",
        str(expiry), signed["signature"],
    )
    assert not api_server._signed_media_request_ok(
        "POST", "/agent/artifacts/sign", "/tmp/result.zip", "one.png",
        str(expiry), signed["signature"],
    )


def test_browser_navigate_does_not_request_native_approval(monkeypatch):
    class FakeClient:
        def __init__(self):
            self.navigated = False

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def navigate(self, _target):
            self.navigated = True

    async def scenario():
        client = FakeClient()
        previous = mcp_gateway.ctx.request_approval

        async def fail_approval(*_args):
            raise AssertionError("browser_navigate should not request approval")

        mcp_gateway.ctx.request_approval = fail_approval
        monkeypatch.setattr(
            mcp_gateway, "_browser_client",
            lambda: (client, {"url": "https://before.example"}, None),
        )
        try:
            result = await mcp_gateway.tool_browser_navigate("https://after.example")
        finally:
            mcp_gateway.ctx.request_approval = previous
        assert result["ok"] is True
        assert client.navigated is True

    asyncio.run(scenario())


def test_task_control_uses_async_approval_without_blocking_event_loop(monkeypatch):
    async def scenario():
        previous_run = mcp_gateway.ctx.active_run
        previous_approval = mcp_gateway.ctx.request_approval
        previous_control = mcp_gateway.ctx.control_task_instance
        controlled = []

        async def reject(*_args):
            await asyncio.sleep(0)
            return "rejected"

        async def control(*args):
            controlled.append(args)

        mcp_gateway.ctx.active_run = {"run_id": "run-control", "session_id": "session-control"}
        mcp_gateway.ctx.request_approval = reject
        mcp_gateway.ctx.control_task_instance = control
        monkeypatch.setattr(
            mcp_gateway,
            "_await_approval_blocking",
            lambda *_args: (_ for _ in ()).throw(AssertionError("async tool must not block")),
        )
        try:
            result = await mcp_gateway.tool_task_control("ti-control", "stop")
        finally:
            mcp_gateway.ctx.active_run = previous_run
            mcp_gateway.ctx.request_approval = previous_approval
            mcp_gateway.ctx.control_task_instance = previous_control
        assert result["status"] == "rejected"
        assert controlled == []

    asyncio.run(scenario())


def test_browser_act_credential_fields_require_explicit_authorization(monkeypatch):
    class FakeClient:
        def __init__(self):
            self.actions = []

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def act(self, action, payload):
            self.actions.append((action, payload))
            return {"typed": True}

    async def scenario():
        client = FakeClient()
        previous_grant = mcp_gateway.ctx.grant
        mcp_gateway.ctx.grant = {"toolset_json": json.dumps(["act"])}
        monkeypatch.setattr(
            mcp_gateway, "_browser_client",
            lambda: (client, {"url": "https://before.example"}, None),
        )
        try:
            blocked = await mcp_gateway.tool_browser_act("type", selector="#api_key", text="value")
            allowed = await mcp_gateway.tool_browser_act(
                "type",
                selector="#api_key",
                text="value",
                credential_authorized=True,
            )
        finally:
            mcp_gateway.ctx.grant = previous_grant
        assert blocked["status"] == "rejected"
        assert allowed["ok"] is True
        assert client.actions == [("type", {
            "selector": "#api_key",
            "text": "value",
            "delta_y": 0,
            "ms": 0,
            "credential_authorized": True,
        })]

    asyncio.run(scenario())


def test_browser_navigate_does_not_mutate_grant_toolset(monkeypatch):
    class FakeClient:
        def __init__(self):
            self.navigated = []

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def navigate(self, target):
            self.navigated.append(target)

    async def scenario():
        client = FakeClient()
        previous_approval = mcp_gateway.ctx.request_approval
        previous_grant = mcp_gateway.ctx.grant

        async def fail_approval(*_args):
            raise AssertionError("browser_navigate should not request approval")

        mcp_gateway.ctx.request_approval = fail_approval
        mcp_gateway.ctx.grant = {
            "grant_id": "grant-nav",
            "toolset_json": "[]",
        }
        monkeypatch.setattr(
            mcp_gateway, "_browser_client",
            lambda: (client, {"url": "https://before.example"}, None),
        )
        monkeypatch.setattr(
            mcp_gateway.db,
            "update_grant_toolset",
            lambda *_args: (_ for _ in ()).throw(AssertionError("navigate should not update grant toolset")),
        )
        try:
            first = await mcp_gateway.tool_browser_navigate("https://one.example")
            second = await mcp_gateway.tool_browser_navigate("https://two.example")
            grant_toolset = json.loads(mcp_gateway.ctx.grant["toolset_json"])
        finally:
            mcp_gateway.ctx.request_approval = previous_approval
            mcp_gateway.ctx.grant = previous_grant
        assert first["ok"] is True
        assert second["ok"] is True
        assert client.navigated == ["https://one.example", "https://two.example"]
        assert grant_toolset == []

    asyncio.run(scenario())


def test_broadcast_uses_persisted_event_sequence_and_advances_cursor():
    async def scenario():
        from core.agent import db

        db.init_agent_db()
        session_id = f"session-events-{uuid.uuid4().hex[:10]}"
        db.create_session(session_id, f"runtime-events-{uuid.uuid4().hex[:10]}")
        previous = db.append_event(session_id, None, "before", {"n": 1})

        service = AgentService()
        queue = service.subscribe(session_id)
        try:
            await service.broadcast(session_id, 0, "after", {"n": 2})
            message = await asyncio.wait_for(queue.get(), timeout=1)
        finally:
            service.unsubscribe(session_id, queue)

        rows = db.list_events_after(session_id, previous)
        assert len(rows) == 1
        assert rows[0]["event_type"] == "after"
        assert message["seq"] == rows[0]["seq"]
        assert message["seq"] > previous
        assert message["payload"]["session_id"] == session_id
        assert db.get_session(session_id)["last_event_seq"] == message["seq"]

    asyncio.run(scenario())


def test_assistant_text_deltas_are_batched_before_persisting(monkeypatch, tmp_path):
    async def scenario():
        from core.agent import service as service_module

        db = _init_temp_agent_db(monkeypatch, tmp_path)
        monkeypatch.setattr(service_module, "AGENT_DELTA_FLUSH_BYTES", 64, raising=False)
        monkeypatch.setattr(service_module, "AGENT_DELTA_FLUSH_INTERVAL_SECONDS", 60, raising=False)
        session_id = f"session-stream-{uuid.uuid4().hex[:10]}"
        turn_id = f"turn-stream-{uuid.uuid4().hex[:10]}"
        run_id = f"run-stream-{uuid.uuid4().hex[:10]}"
        db.create_session(session_id, f"runtime-stream-{uuid.uuid4().hex[:10]}")
        db.create_turn(turn_id, session_id, 1, f"{run_id}:user")
        run = db.create_run(run_id, session_id, turn_id, "test", "test-model")
        service = AgentService()
        queue = service.subscribe(session_id)
        try:
            await service._project_event(session_id, run, {
                "type": "assistant/chunk",
                "data": {"chunk": {"type": "text-delta", "text": "你"}},
            })
            await service._project_event(session_id, run, {
                "type": "assistant/chunk",
                "data": {"chunk": {"type": "text-delta", "text": "好"}},
            })

            assert queue.empty()
            assert db.list_messages(session_id) == []

            await service._flush_assistant_delta(run_id)
            message = await asyncio.wait_for(queue.get(), timeout=1)
            assert message["event_type"] == "assistant.delta"
            assert message["payload"]["delta"] == "你好"
            rows = db.list_messages(session_id)
            assert len(rows) == 1
            assert json.loads(rows[0]["content_json"])["text"] == "你好"
            assert rows[0]["status"] == "streaming"

            await service._project_event(session_id, run, {
                "type": "assistant/message",
                "data": {"message": {"role": "assistant", "content": [
                    {"type": "text", "text": "你好，完成"}
                ]}},
            })
            completed = await asyncio.wait_for(queue.get(), timeout=1)
            assert completed["event_type"] == "assistant.completed"
            assert completed["payload"]["text"] == "你好，完成"
            rows = db.list_messages(session_id)
            assert len(rows) == 1
            assert json.loads(rows[0]["content_json"])["text"] == "你好，完成"
            assert rows[0]["status"] == "complete"
        finally:
            service.unsubscribe(session_id, queue)
            await service._finalize_assistant_stream(run_id)

    asyncio.run(scenario())


def test_output_budget_profiles_are_long_form_friendly_and_pressure_based():
    from core.agent import service as service_module

    source = Path(service_module.__file__).read_text(encoding="utf-8")
    assert '"CRAWSHRIMP_AGENT_MAX_TEXT_DELTAS", 12000' in source
    assert '"CRAWSHRIMP_AGENT_MAX_OUTPUT_CHARS", 240000' in source
    assert '"CRAWSHRIMP_AGENT_BROWSER_MAX_TEXT_DELTAS", 20000' in source
    assert '"CRAWSHRIMP_AGENT_BROWSER_MAX_OUTPUT_CHARS", 480000' in source
    assert '"CRAWSHRIMP_AGENT_MAX_OUTPUT_SEGMENTS", 6' in source
    assert '"CRAWSHRIMP_AGENT_MAX_TEXT_DELTA_RATE_PER_SECOND", 32.0' in source

    default_budget = service_module.BUDGET_PROFILES["default"]
    browser_budget = service_module.BUDGET_PROFILES["browser"]

    for budget in (default_budget, browser_budget):
        assert budget["maxOutputSegments"] > 0
        assert budget["minOutputDeltasBeforePause"] > 0
        assert budget["maxTextDeltaRatePerSecond"] > 0
        assert budget["outputRateWindowMs"] >= 1000


def test_output_budget_interruption_keeps_single_stream_for_auto_continuation(monkeypatch, tmp_path):
    async def scenario():
        from core.agent import service as service_module

        db = _init_temp_agent_db(monkeypatch, tmp_path)
        monkeypatch.setattr(service_module, "AGENT_DELTA_FLUSH_INTERVAL_SECONDS", 60, raising=False)
        session_id = f"session-budget-{uuid.uuid4().hex[:10]}"
        turn_id = f"turn-budget-{uuid.uuid4().hex[:10]}"
        run_id = f"run-budget-{uuid.uuid4().hex[:10]}"
        db.create_session(session_id, f"runtime-budget-{uuid.uuid4().hex[:10]}")
        db.create_turn(turn_id, session_id, 1, f"{run_id}:user")
        run = db.create_run(run_id, session_id, turn_id, "test", "test-model")
        service = AgentService()
        queue = service.subscribe(session_id)
        try:
            await service._project_event(session_id, run, {
                "type": "assistant/chunk",
                "data": {"chunk": {"type": "text-delta", "text": "第一段"}},
            })
            await service._project_event(session_id, run, {
                "type": "assistant/message",
                "data": {
                    "message": {"role": "assistant", "content": [{"type": "text", "text": "第一段"}]},
                    "interrupted": True,
                },
            })
            delta = await asyncio.wait_for(queue.get(), timeout=1)
            assert delta["event_type"] == "assistant.delta"
            assert delta["payload"]["delta"] == "第一段"
            assert queue.empty()
            rows = db.list_messages(session_id)
            assert len(rows) == 1
            assert json.loads(rows[0]["content_json"])["text"] == "第一段"
            assert rows[0]["status"] == "streaming"

            await service._project_event(session_id, run, {
                "type": "turn/end",
                "data": {"reason": {
                    "kind": "aborted",
                    "reason": {"kind": "hook", "reason": "OUTPUT_BUDGET_REACHED:文本增量预算耗尽"},
                }},
            })
            assert queue.empty()

            await service._project_event(session_id, run, {
                "type": "assistant/chunk",
                "data": {"chunk": {"type": "text-delta", "text": "第二段"}},
            })
            await service._project_event(session_id, run, {
                "type": "assistant/message",
                "data": {"message": {"role": "assistant", "content": [
                    {"type": "text", "text": "第二段"}
                ]}},
            })
            completed = await asyncio.wait_for(queue.get(), timeout=1)
            assert completed["event_type"] == "assistant.completed"
            assert completed["payload"]["text"] == "第一段第二段"
            rows = db.list_messages(session_id)
            assert len(rows) == 1
            assert json.loads(rows[0]["content_json"])["text"] == "第一段第二段"
            assert rows[0]["status"] == "complete"
        finally:
            service.unsubscribe(session_id, queue)
            await service._finalize_assistant_stream(run_id)

    asyncio.run(scenario())


def test_non_budget_interruption_completes_partial_assistant_message(monkeypatch, tmp_path):
    async def scenario():
        from core.agent import service as service_module

        db = _init_temp_agent_db(monkeypatch, tmp_path)
        monkeypatch.setattr(service_module, "AGENT_DELTA_FLUSH_BYTES", 1, raising=False)
        session_id = f"session-interrupted-{uuid.uuid4().hex[:10]}"
        turn_id = f"turn-interrupted-{uuid.uuid4().hex[:10]}"
        run_id = f"run-interrupted-{uuid.uuid4().hex[:10]}"
        db.create_session(session_id, f"runtime-interrupted-{uuid.uuid4().hex[:10]}")
        db.create_turn(turn_id, session_id, 1, f"{run_id}:user")
        run = db.create_run(run_id, session_id, turn_id, "test", "test-model")
        service = AgentService()
        queue = service.subscribe(session_id)
        try:
            await service._project_event(session_id, run, {
                "type": "assistant/chunk",
                "data": {"chunk": {"type": "text-delta", "text": "保留下来的部分回答"}},
            })
            await service._project_event(session_id, run, {
                "type": "turn/end",
                "data": {"reason": {
                    "kind": "aborted",
                    "reason": {"kind": "user"},
                }},
            })

            events = [await asyncio.wait_for(queue.get(), timeout=1) for _ in range(3)]
            assert [event["event_type"] for event in events] == [
                "assistant.delta", "assistant.completed", "run.failed",
            ]
            rows = db.list_messages(session_id)
            assert len(rows) == 1
            assert json.loads(rows[0]["content_json"])["text"] == "保留下来的部分回答"
            assert rows[0]["status"] == "complete"
        finally:
            service.unsubscribe(session_id, queue)
            await service._finalize_assistant_stream(run_id)

    asyncio.run(scenario())


def test_startup_recovery_completes_streaming_assistant_and_replays_terminal_events(monkeypatch, tmp_path):
    db = _init_temp_agent_db(monkeypatch, tmp_path)
    session_id = f"session-recovery-{uuid.uuid4().hex[:10]}"
    runtime_session_id = f"runtime-recovery-{uuid.uuid4().hex[:10]}"
    turn_id = f"turn-recovery-{uuid.uuid4().hex[:10]}"
    run_id = f"run-recovery-{uuid.uuid4().hex[:10]}"
    db.create_session(session_id, runtime_session_id)
    db.create_turn(turn_id, session_id, 1, f"{run_id}:user")
    db.create_run(run_id, session_id, turn_id, "test", "test-model")
    db.update_session(session_id, status="running")
    db.update_turn(turn_id, status="running")
    db.update_run(run_id, status="running")
    db.create_message(
        f"{run_id}:assistant", session_id, turn_id, run_id,
        "assistant", "text", {"text": "进程退出前已经生成的内容"}, status="streaming",
    )

    AgentService()._recover_on_startup()

    assert db.get_run(run_id)["status"] == "interrupted"
    assert db.get_turn(turn_id)["status"] == "interrupted"
    assert db.get_session(session_id)["status"] == "idle"
    message = next(row for row in db.list_messages(session_id) if row["message_id"] == f"{run_id}:assistant")
    assert message["status"] == "complete"
    assert message["completed_at"]
    events = db.list_events_after(session_id, 0)
    assert [event["event_type"] for event in events] == ["assistant.completed", "run.interrupted"]


def test_sse_global_subscriber_is_removed_after_repeated_overflow(monkeypatch, tmp_path):
    async def scenario():
        from core.agent import service as service_module

        db = _init_temp_agent_db(monkeypatch, tmp_path)
        monkeypatch.setattr(service_module, "SSE_QUEUE_MAX_OVERFLOWS", 2, raising=False)
        session_id = f"session-sse-{uuid.uuid4().hex[:10]}"
        db.create_session(session_id, f"runtime-sse-{uuid.uuid4().hex[:10]}")
        service = AgentService()
        queue = service.subscribe_all()
        for _ in range(queue.maxsize):
            queue.put_nowait({"seq": 0})

        await service.broadcast(session_id, 0, "probe", {"n": 1})
        assert queue in service.global_subscribers
        await service.broadcast(session_id, 0, "probe", {"n": 2})

        assert queue not in service.global_subscribers
        assert service.sse_dropped_events == 2
        assert queue.get_nowait() is service_module.SSE_DISCONNECT
        assert queue.empty()

    asyncio.run(scenario())


def test_sse_overflow_disconnects_global_stream_for_cursor_replay(monkeypatch, tmp_path):
    async def scenario():
        from core.agent import api as api_module
        from core.agent import service as service_module

        db = _init_temp_agent_db(monkeypatch, tmp_path)
        monkeypatch.setattr(service_module, "SSE_QUEUE_MAX_OVERFLOWS", 2, raising=False)
        session_id = f"session-sse-stream-{uuid.uuid4().hex[:10]}"
        db.create_session(session_id, f"runtime-sse-stream-{uuid.uuid4().hex[:10]}")
        service = AgentService()
        request = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))
        previous_service = api_module._service
        api_module.set_agent_service(service)
        stream = None
        try:
            response = await api_module.agent_events(request, after_seq=-1)
            stream = response.body_iterator
            first = await stream.__anext__()
            assert b"event: cursor" in first if isinstance(first, bytes) else "event: cursor" in first
            queue = next(iter(service.global_subscribers))
            for _ in range(queue.maxsize):
                queue.put_nowait({"seq": 0})
            await service.broadcast(session_id, 0, "probe", {"n": 1})
            await service.broadcast(session_id, 0, "probe", {"n": 2})

            with pytest.raises(StopAsyncIteration):
                await asyncio.wait_for(stream.__anext__(), timeout=1)
        finally:
            if stream is not None:
                await stream.aclose()
            api_module._service = previous_service

    asyncio.run(scenario())


def test_subprocess_output_decoder_falls_back_to_local_encoding(monkeypatch):
    import locale
    from core.agent.mcp_gateway import _decode_subprocess_output

    monkeypatch.setattr(locale, "getpreferredencoding", lambda _do_setlocale=False: "gbk")
    assert _decode_subprocess_output("中文".encode("gbk")) == "中文"


def test_dsh_model_catalog_declares_vision_without_widening_text_only_models():
    from core.agent.cordis_config import build_cordis_yaml, model_capabilities

    assert model_capabilities("gpt-5.5")["input_modalities"] == ["text", "image"]
    assert model_capabilities("deepseek-official-v4-flash-vision-exp")["input_modalities"] == ["text", "image"]
    assert "input_modalities" not in model_capabilities("deepseek-v4-pro")

    profile = build_cordis_yaml({"ai": {"llm": {"default_model": "gpt-5.5"}}})
    assert re.search(r"id: 'gpt-5\.5'[\s\S]*input: \['text', 'image'\]", profile)
    assert re.search(r"id: 'deepseek-v4-pro'[\s\S]*input: \['text'\]", profile)
    assert re.search(r"id: 'deepseek-v4-flash-vision-exp'[\s\S]*input: \['text', 'image'\]", profile)


def test_dsh_native_deepseek_route_is_hidden_in_favor_of_crawshrimp_route():
    from core.agent.cordis_config import build_cordis_yaml

    profile = build_cordis_yaml({"ai": {"llm": {"default_model": "deepseek-official-v4-flash"}}})
    default_block = profile.split("- id: agent-default-model", 1)[1].split("- id:", 1)[0]
    native_block = profile.split("- id: llm-deepseek", 1)[1].split("- id:", 1)[0]

    assert "provider: crawshrimp-deepseek-official" in default_block
    assert "provider: deepseek-official" not in default_block
    assert "disabled: true" in native_block


def test_dsh_deepseek_official_models_expose_reasoning_efforts():
    from core.agent.cordis_config import build_cordis_yaml

    profile = build_cordis_yaml({"ai": {"llm": {"default_model": "deepseek-official-v4-flash"}}})
    official_block = profile.split("providers['crawshrimp-deepseek-official']", 1)[1].split("if (hasGatewayKey)", 1)[0]
    efforts = "reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' }"
    vision_line = re.search(r"id: 'deepseek-v4-flash-vision-exp'[^\n]+", official_block).group(0)

    assert "reasoning: 'high'" in official_block
    assert re.search(r"id: 'deepseek-v4-flash'[\s\S]*" + re.escape(efforts), official_block)
    assert re.search(r"id: 'deepseek-v4-pro'[\s\S]*" + re.escape(efforts), official_block)
    assert official_block.count(efforts) == 2
    assert "input: ['text', 'image']" in vision_line
    assert "reasoningEfforts" not in vision_line


def test_dsh_runtime_patch_guards_deepseek_vision_reasoning_and_image_bridge():
    patcher = (Path(__file__).resolve().parents[1] / "integrations" / "deepseek-harness" / "scripts" / "patch-runtime-dependencies.mjs").read_text(encoding="utf-8")

    assert "DEEPSEEK_MULTIMODAL_FALLBACK_PATCH_MARKER" in patcher
    assert "HOST_APIPROXY_DEEPSEEK_IMAGE_SELECTION_PATCH_MARKER" in patcher
    assert "SDK_JSONRPC_IMAGE_ADMISSION_PATCH_MARKER" in patcher
    assert "crawshrimpBridgeDeepSeekImages" in patcher
    assert "deepseek-v4-flash-vision-exp" in patcher
    assert "vision_preflight: true" in patcher
    assert "process.stderr.write(\"crawshrimp.audit \"" in patcher
    assert "DEEPSEEK_VISION_REASONING_GUARD_PATCH_MARKER" in patcher
    assert "crawshrimpReasoningEffortForModel" in patcher
    assert "resolveReasoningLevel(model, crawshrimpReasoningEffortForModel" in patcher


def test_agent_default_model_prefers_deepseek_flash_when_key_is_configured(monkeypatch):
    from core.agent import service as service_mod

    monkeypatch.delenv("CRAWSHRIMP_LLM_API_KEY", raising=False)
    monkeypatch.delenv("CRAWSHRIMP_DEEPSEEK_API_KEY", raising=False)
    monkeypatch.setattr(service_mod, "load_config", lambda: {
        "ai": {"llm": {
            "api_key": "",
            "deepseek_api_key": "sk-ds-official-unit",
            "default_model": "deepseek-official-v4-flash",
        }}
    })

    service = service_mod.AgentService()

    assert service._resolve_model() == (
        "deepseek-official-v4-flash",
        "crawshrimp-deepseek-official",
    )


def test_agent_default_model_falls_back_to_gateway_when_deepseek_key_missing(monkeypatch):
    from core.agent import service as service_mod

    monkeypatch.delenv("CRAWSHRIMP_LLM_API_KEY", raising=False)
    monkeypatch.delenv("CRAWSHRIMP_DEEPSEEK_API_KEY", raising=False)
    monkeypatch.setattr(service_mod, "load_config", lambda: {
        "ai": {"llm": {
            "api_key": "gateway-key",
            "deepseek_api_key": "",
            "default_model": "deepseek-official-v4-flash",
        }}
    })

    service = service_mod.AgentService()

    assert service._resolve_model() == (
        "gpt-5.6-terra",
        "crawshrimp-overseas-openai",
    )


def test_agent_models_endpoint_hides_unconfigured_gateway_models(monkeypatch):
    from core import config as config_mod
    from core.agent import api as agent_api

    monkeypatch.delenv("CRAWSHRIMP_LLM_API_KEY", raising=False)
    monkeypatch.delenv("CRAWSHRIMP_DEEPSEEK_API_KEY", raising=False)
    monkeypatch.setattr(config_mod, "load_config", lambda: {
        "ai": {"llm": {
            "api_key": "",
            "deepseek_api_key": "sk-ds-official-unit",
            "default_model": "deepseek-official-v4-flash",
        }}
    })

    model_ids = [item["model_id"] for item in agent_api.list_agent_models()["models"]]

    assert model_ids == [
        "deepseek-official-v4-flash",
        "deepseek-official-v4-pro",
        "deepseek-official-v4-flash-vision-exp",
    ]


def test_agent_models_endpoint_keeps_official_deepseek_first_when_all_keys_exist(monkeypatch):
    from core import config as config_mod
    from core.agent import api as agent_api

    monkeypatch.delenv("CRAWSHRIMP_LLM_API_KEY", raising=False)
    monkeypatch.delenv("CRAWSHRIMP_DEEPSEEK_API_KEY", raising=False)
    monkeypatch.setattr(config_mod, "load_config", lambda: {
        "ai": {"llm": {
            "api_key": "gateway-key",
            "deepseek_api_key": "sk-ds-official-unit",
            "default_model": "deepseek-official-v4-flash",
        }}
    })

    model_ids = [item["model_id"] for item in agent_api.list_agent_models()["models"]]

    assert model_ids[:3] == [
        "deepseek-official-v4-flash",
        "deepseek-official-v4-pro",
        "deepseek-official-v4-flash-vision-exp",
    ]


def test_agent_start_generation_uses_packaged_web_cordis_without_install_write(tmp_path, monkeypatch):
    from core.agent import service as service_mod

    harness_root = tmp_path / "Program Files" / "crawshrimp-harness" / "resources" / "deepseek-harness"
    harness_root.mkdir(parents=True)
    web_cordis = harness_root / "web-cordis.yml"
    web_cordis.write_text("- id: agent-default-model\n", encoding="utf-8")
    data_root = tmp_path / "LocalAppData" / "crawshrimp"
    calls = {}

    class FakeWorker:
        def __init__(self, **kwargs):
            calls["worker_kwargs"] = kwargs

        async def start(self):
            calls["started"] = True

        async def request(self, method, params, timeout=None):
            calls[method] = {"params": params, "timeout": timeout}
            return {"ok": True}

        async def stop(self):
            calls["stopped"] = True

    async def settle_noop(_self, _preferred):
        calls["settled"] = True

    monkeypatch.setattr(service_mod, "resolve_harness_root", lambda: harness_root)
    monkeypatch.setattr(service_mod, "_data_root", lambda: data_root)
    monkeypatch.setattr(service_mod, "_cleanup_orphan_runtimes", lambda _root: None)
    monkeypatch.setattr(service_mod, "_pick_free_port", lambda port, _span: port or 19065)
    monkeypatch.setattr(service_mod, "load_config", lambda: {"ai": {"llm": {"api_key": "test-key"}}})
    monkeypatch.setattr(service_mod, "AgentWorker", FakeWorker)
    monkeypatch.setattr(service_mod.AgentService, "_settle_web_port", settle_noop)
    monkeypatch.setenv("CRAWSHRIMP_AGENT_PROVIDER", "stale-provider")
    monkeypatch.setenv("CRAWSHRIMP_AGENT_MODEL", "stale-model")

    service = service_mod.AgentService()
    service.mcp_port = 18965

    assert asyncio.run(service.start_generation("crawshrimp-overseas-openai", "gpt-5.6-terra"))
    assert calls["worker_kwargs"]["cordis_path"] == str(web_cordis)
    assert calls["worker.initialize"]["params"]["cordisPath"] == str(web_cordis)
    assert calls["worker.start_generation"]["params"]["model"] == "gpt-5.6-terra"
    assert service_mod.os.environ["CRAWSHRIMP_AGENT_PROVIDER"] == "crawshrimp-overseas-openai"
    assert service_mod.os.environ["CRAWSHRIMP_AGENT_MODEL"] == "gpt-5.6-terra"
    assert not (harness_root / "runtime-cordis.yml").exists()
    assert not (data_root / "agent" / "runtime-cordis.yml").exists()


def _patch_agent_generation_runtime(monkeypatch, service_mod, tmp_path, config):
    harness_root = tmp_path / "Program Files" / "crawshrimp-harness" / "resources" / "deepseek-harness"
    harness_root.mkdir(parents=True)
    web_cordis = harness_root / "web-cordis.yml"
    web_cordis.write_text("- id: agent-default-model\n", encoding="utf-8")
    data_root = tmp_path / "LocalAppData" / "crawshrimp"
    calls = {}

    class FakeWorker:
        def __init__(self, **kwargs):
            calls["worker_kwargs"] = kwargs

        async def start(self):
            calls["started"] = True

        async def request(self, method, params, timeout=None):
            calls[method] = {"params": params, "timeout": timeout}
            return {"ok": True}

        async def stop(self):
            calls["stopped"] = True

    async def settle_noop(_self, _preferred):
        calls["settled"] = True

    monkeypatch.setattr(service_mod, "resolve_harness_root", lambda: harness_root)
    monkeypatch.setattr(service_mod, "_data_root", lambda: data_root)
    monkeypatch.setattr(service_mod, "_cleanup_orphan_runtimes", lambda _root: None)
    monkeypatch.setattr(service_mod, "_pick_free_port", lambda port, _span: port or 19065)
    monkeypatch.setattr(service_mod, "load_config", lambda: config)
    monkeypatch.setattr(service_mod, "AgentWorker", FakeWorker)
    monkeypatch.setattr(service_mod.AgentService, "_settle_web_port", settle_noop)
    monkeypatch.delenv("CRAWSHRIMP_LLM_API_KEY", raising=False)
    monkeypatch.delenv("CRAWSHRIMP_DEEPSEEK_API_KEY", raising=False)
    return calls, harness_root, data_root


def test_agent_start_generation_overwrites_stale_dsh_default_model_settings_with_deepseek(tmp_path, monkeypatch):
    from core.agent import service as service_mod

    calls, _harness_root, data_root = _patch_agent_generation_runtime(
        monkeypatch,
        service_mod,
        tmp_path,
        {"ai": {"llm": {
            "api_key": "",
            "deepseek_api_key": "sk-ds-official-unit",
            "default_model": "deepseek-official-v4-flash",
        }}},
    )
    settings_path = data_root / "agent" / "dsh-home" / "settings.yaml"
    settings_path.parent.mkdir(parents=True)
    settings_path.write_text(
        "agent-default-model:\n"
        "  provider: crawshrimp-overseas-openai\n"
        "  model: gpt-5.6-terra\n"
        "unrelated:\n"
        "  keep: true\n",
        encoding="utf-8",
    )
    service = service_mod.AgentService()
    service.mcp_port = 18965

    assert asyncio.run(service.start_generation())

    assert calls["worker.start_generation"]["params"]["provider"] == "crawshrimp-deepseek-official"
    assert calls["worker.start_generation"]["params"]["model"] == "deepseek-v4-flash"
    settings = settings_path.read_text(encoding="utf-8")
    assert "provider: crawshrimp-deepseek-official" in settings
    assert "model: deepseek-v4-flash" in settings
    assert "keep: true" in settings


def test_agent_start_generation_falls_back_from_unkeyed_gateway_model_to_deepseek(tmp_path, monkeypatch):
    from core.agent import service as service_mod

    monkeypatch.delenv("CRAWSHRIMP_LLM_API_KEY", raising=False)
    monkeypatch.delenv("CRAWSHRIMP_OVERSEAS_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("CRAWSHRIMP_OVERSEAS_ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("CRAWSHRIMP_DOMESTIC_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("CRAWSHRIMP_DEEPSEEK_API_KEY", raising=False)
    calls, _harness_root, _data_root = _patch_agent_generation_runtime(
        monkeypatch,
        service_mod,
        tmp_path,
        {"ai": {"llm": {
            "api_key": "",
            "deepseek_api_key": "sk-ds-official-unit",
            "default_model": "gpt-5.6-terra",
        }}},
    )
    service = service_mod.AgentService()
    service.mcp_port = 18965

    assert asyncio.run(service.start_generation("crawshrimp-overseas-openai", "gpt-5.6-terra"))

    assert calls["worker.start_generation"]["params"]["provider"] == "crawshrimp-deepseek-official"
    assert calls["worker.start_generation"]["params"]["model"] == "deepseek-v4-flash"
    assert service_mod.os.environ["CRAWSHRIMP_AGENT_PROVIDER"] == "crawshrimp-deepseek-official"
    assert service_mod.os.environ["CRAWSHRIMP_AGENT_MODEL"] == "deepseek-v4-flash"


def test_agent_start_generation_uses_custom_provider_for_duplicate_builtin_model(tmp_path, monkeypatch):
    from core.agent import service as service_mod

    monkeypatch.delenv("CRAWSHRIMP_LLM_API_KEY", raising=False)
    monkeypatch.delenv("CRAWSHRIMP_OVERSEAS_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("CRAWSHRIMP_OVERSEAS_ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("CRAWSHRIMP_DOMESTIC_API_KEY", raising=False)
    monkeypatch.delenv("CRAWSHRIMP_DEEPSEEK_API_KEY", raising=False)
    calls, _harness_root, _data_root = _patch_agent_generation_runtime(
        monkeypatch,
        service_mod,
        tmp_path,
        {"ai": {"llm": {
            "api_key": "",
            "deepseek_api_key": "",
            "default_model": "deepseek-official-v4-flash",
            "custom_providers": [{
                "id": "custom-1xm",
                "name": "1xm",
                "protocol": "openai",
                "base_url": "https://api.1xm.ai/v1",
                "api_key": "custom-key",
                "models": [{"id": "gpt-5.6-luna"}],
            }],
        }}},
    )
    service = service_mod.AgentService()
    service.mcp_port = 18965

    assert asyncio.run(service.start_generation())

    assert service.runtime_state == "ready"
    assert service.runtime_error == ""
    assert calls["worker.start_generation"]["params"]["provider"] == "custom-1xm"
    assert calls["worker.start_generation"]["params"]["model"] == "gpt-5.6-luna"
    assert service_mod.os.environ["CRAWSHRIMP_AGENT_PROVIDER"] == "custom-1xm"
    assert service_mod.os.environ["CRAWSHRIMP_AGENT_MODEL"] == "gpt-5.6-luna"
    assert service_mod.os.environ["CRAWSHRIMP_CUSTOM_LLM_KEY_CUSTOM_1XM"] == "custom-key"
    assert service_mod.os.environ.get("CRAWSHRIMP_LLM_CONFIG_REQUIRED") != "1"


def test_agent_start_generation_missing_all_model_keys_launches_config_gate_runtime(tmp_path, monkeypatch):
    from core.agent import service as service_mod

    monkeypatch.delenv("CRAWSHRIMP_LLM_API_KEY", raising=False)
    monkeypatch.delenv("CRAWSHRIMP_OVERSEAS_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("CRAWSHRIMP_OVERSEAS_ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("CRAWSHRIMP_DOMESTIC_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("CRAWSHRIMP_DEEPSEEK_API_KEY", raising=False)
    calls, _harness_root, _data_root = _patch_agent_generation_runtime(
        monkeypatch,
        service_mod,
        tmp_path,
        {"ai": {"llm": {
            "api_key": "",
            "deepseek_api_key": "",
            "default_model": "gpt-5.6-terra",
        }}},
    )
    service = service_mod.AgentService()
    service.mcp_port = 18965

    assert asyncio.run(service.start_generation())

    assert "started" in calls
    assert service.runtime_state == "ready"
    assert service.runtime_error == ""
    assert os.environ["CRAWSHRIMP_LLM_CONFIG_REQUIRED"] == "1"
    assert os.environ["CRAWSHRIMP_LLM_CONFIG_PLACEHOLDER_KEY"] == "cs-config-required-placeholder"
    assert service.crash_budget == []
