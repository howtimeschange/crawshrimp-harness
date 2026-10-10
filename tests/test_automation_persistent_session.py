from __future__ import annotations

import asyncio

from unittest.mock import AsyncMock

from core import data_sink, runtime_paths
from core.agent.service import AgentService, _automation_worker_timeout_seconds


def _init_temp_state(monkeypatch, tmp_path):
    monkeypatch.setenv("CRAWSHRIMP_DATA", str(tmp_path))
    monkeypatch.setattr(runtime_paths, "_runtime_data_root", None, raising=False)
    monkeypatch.setattr(runtime_paths, "_runtime_data_key", None, raising=False)
    runtime_paths.reset_runtime_data_root_cache()
    from core.agent import db
    db.init_agent_db()
    data_sink.init_db()
    return db


def _service() -> AgentService:
    service = AgentService()
    service._resolve_model = lambda _session_id: ("model", "provider")
    service.broadcast = AsyncMock()
    return service


def _automation(kind: str = "scheduled") -> dict:
    return {
        "automation_uid": "auto-fixed",
        "title": "巡检公告",
        "objective_prompt": "检查公告",
        "automation_kind": kind,
        "context_mode": "isolated",
        "execution_policy": {"toolset": ["browser_observe"]},
    }


def _run(run_uid: str) -> dict:
    return {"run_uid": run_uid, "automation_uid": "auto-fixed"}


def test_isolated_automation_reuses_one_dedicated_session(monkeypatch, tmp_path):
    db = _init_temp_state(monkeypatch, tmp_path)
    service = _service()
    automation = _automation()

    async def scenario():
        first = await service.submit_automation_turn(automation, _run("run-a"), "第一次", ["browser_observe"])
        second = await service.submit_automation_turn(automation, _run("run-b"), "第二次", ["browser_observe"])
        return first, second

    first, second = asyncio.run(scenario())

    assert first["session_id"] == "automation:auto-fixed"
    assert second["session_id"] == "automation:auto-fixed"
    assert db.get_session("automation:auto-fixed") is not None
    assert len([item for item in db.list_sessions(include_archived=True) if item["session_id"] == "automation:auto-fixed"]) == 1


def test_isolated_automation_prefers_existing_historical_agent_session(monkeypatch, tmp_path):
    db = _init_temp_state(monkeypatch, tmp_path)
    db.create_session("automation:auto-fixed:old-run", "dsh-old", "旧自动化会话")
    data_sink.create_agent_automation_run(
        "auto-fixed",
        "scheduled",
        "scheduled:old",
        agent_session_id="automation:auto-fixed:old-run",
        agent_run_id="agent-old",
        status="completed",
    )
    service = _service()

    result = asyncio.run(
        service.submit_automation_turn(_automation(), _run("run-new"), "继续", ["browser_observe"])
    )

    assert result["session_id"] == "automation:auto-fixed:old-run"
    assert db.get_session("automation:auto-fixed") is None


def test_dedicated_session_does_not_replace_source_receipt_session(monkeypatch, tmp_path):
    db = _init_temp_state(monkeypatch, tmp_path)
    db.create_session("source-session", "dsh-source", "创建会话")
    service = _service()
    automation = {**_automation(), "source_session_id": "source-session"}

    result = asyncio.run(
        service.submit_automation_turn(automation, _run("run-source"), "执行", ["browser_observe"])
    )

    assert result["session_id"] == "automation:auto-fixed"
    assert automation["source_session_id"] == "source-session"
    assert db.get_session("source-session") is not None


def test_loop_automation_uses_same_dedicated_session_for_observe_and_action(monkeypatch, tmp_path):
    _init_temp_state(monkeypatch, tmp_path)
    service = _service()
    automation = _automation(kind="loop")

    async def scenario():
        observe = await service.submit_automation_turn(automation, _run("run-observe"), "观察", ["browser_observe"])
        action = await service.submit_automation_turn(automation, _run("run-action"), "动作", ["browser_observe"])
        return observe, action

    observe, action = asyncio.run(scenario())

    assert observe["session_id"] == "automation:auto-fixed"
    assert action["session_id"] == "automation:auto-fixed"


def test_next_cycle_uses_recovered_page_and_current_permission_snapshot(monkeypatch, tmp_path):
    db = _init_temp_state(monkeypatch, tmp_path)
    db.create_session("automation:auto-fixed", "dsh-fixed", "自动化")
    db.update_session("automation:auto-fixed", browser_tab_id="recovered-tab")
    service = _service()
    automation = _automation()
    automation["execution_policy"] = {
        "toolset": ["browser_navigate", "browser_observe"],
        "browser_tab_id": "closed-creation-tab",
        "browser_url": "https://example.com/updates",
        "native_toolset": ["web_fetch"],
        "allowed_risks": ["read_only"],
        "allow_network": True,
    }
    asyncio.run(service.submit_automation_turn(automation, _run("run-next"), "继续", automation["execution_policy"]["toolset"]))
    item = service.queue.get_nowait()
    assert item["context_refs"] == [{"type": "browser_tab", "id": "recovered-tab"}]
    assert item["automation_policy"]["execution_policy"]["native_toolset"] == ["web_fetch"]
    assert "web_fetch" in item["text"]
    automation["execution_policy"]["native_toolset"].append("bash")
    assert item["automation_policy"]["execution_policy"]["native_toolset"] == ["web_fetch"]



def test_inherited_session_mode_uses_source_session_authority(monkeypatch, tmp_path):
    db = _init_temp_state(monkeypatch, tmp_path)
    db.create_session("source-session", "dsh-source", "创建会话")
    db.update_session("source-session", provider_id="source-provider", model_id="source-model")
    service = AgentService()
    resolved_sessions: list[str] = []

    def resolve(session_id: str):
        resolved_sessions.append(session_id)
        session = db.get_session(session_id) or {}
        return session.get("model_id") or "fallback-model", session.get("provider_id") or "fallback-provider"

    service._resolve_model = resolve
    service.broadcast = AsyncMock()
    automation = {
        **_automation(),
        "context_mode": "inherited",
        "source_session_id": "source-session",
        "execution_policy": {"permission_mode": "session", "toolset": ["browser_act"]},
    }

    result = asyncio.run(service.submit_automation_turn(automation, _run("run-session"), "检查公告", ["browser_act"]))
    item = service.queue.get_nowait()

    assert result["session_id"] == "source-session"
    assert item["session_id"] == "source-session"
    assert item["provider_id"] == "source-provider"
    assert item["model_id"] == "source-model"
    assert resolved_sessions == ["source-session"]
    assert item["automation_policy"] is None
    assert item["grant_prefs"] == {}
    assert item["automation_permission_mode"] == "session"
    assert item["automation_run_uid"] == "run-session"
    assert "[定时任务触发：巡检公告]" in item["text"]
    assert "本轮已预授权" not in item["text"]


def test_isolated_session_mode_inherits_source_settings_only_on_first_creation(monkeypatch, tmp_path):
    db = _init_temp_state(monkeypatch, tmp_path)
    db.create_session("source-session", "dsh-source", "创建会话")
    db.update_session(
        "source-session",
        provider_id="source-provider",
        model_id="source-model",
        browser_tab_id="source-tab",
    )
    service = AgentService()
    service._resolve_model = lambda session_id: (
        (db.get_session(session_id) or {}).get("model_id") or "fallback-model",
        (db.get_session(session_id) or {}).get("provider_id") or "fallback-provider",
    )
    service.broadcast = AsyncMock()
    automation = {
        **_automation(),
        "source_session_id": "source-session",
        "execution_policy": {"permission_mode": "session", "toolset": ["browser_act"]},
    }

    first = asyncio.run(service.submit_automation_turn(automation, _run("run-first"), "第一次", ["browser_act"]))
    first_item = service.queue.get_nowait()
    dedicated = db.get_session("automation:auto-fixed") or {}
    assert first["session_id"] == "automation:auto-fixed"
    assert dedicated["provider_id"] == "source-provider"
    assert dedicated["model_id"] == "source-model"
    assert dedicated["browser_tab_id"] == "source-tab"
    assert first_item["automation_policy"] is None
    assert first_item["grant_prefs"] == {}
    assert first_item["provider_id"] == "source-provider"
    assert first_item["model_id"] == "source-model"

    db.update_session(
        "source-session",
        provider_id="changed-provider",
        model_id="changed-model",
        browser_tab_id="changed-tab",
    )
    second = asyncio.run(service.submit_automation_turn(automation, _run("run-second"), "第二次", ["browser_act"]))
    second_item = service.queue.get_nowait()
    dedicated_after = db.get_session("automation:auto-fixed") or {}

    assert second["session_id"] == "automation:auto-fixed"
    assert dedicated_after["provider_id"] == "source-provider"
    assert dedicated_after["model_id"] == "source-model"
    assert dedicated_after["browser_tab_id"] == "source-tab"
    assert second_item["provider_id"] == "source-provider"
    assert second_item["model_id"] == "source-model"


def test_missing_permission_mode_keeps_scoped_policy_and_preauthorization_prompt(monkeypatch, tmp_path):
    _init_temp_state(monkeypatch, tmp_path)
    service = _service()
    automation = _automation()

    asyncio.run(service.submit_automation_turn(automation, _run("run-scoped"), "检查公告", ["browser_observe"]))
    item = service.queue.get_nowait()

    assert item["session_id"] == "automation:auto-fixed"
    assert item["automation_permission_mode"] == "scoped"
    assert item["automation_policy"] == {
        "toolset": ["browser_observe"],
        "execution_policy": {"toolset": ["browser_observe"]},
    }
    assert item["grant_prefs"] == {"toolset": ["browser_observe"]}
    assert "本轮已预授权 MCP 工具：browser_observe" in item["text"]


def test_session_mode_completion_projects_assistant_terminal_without_verification(monkeypatch, tmp_path):
    db = _init_temp_state(monkeypatch, tmp_path)
    db.create_session("source-session", "dsh-source", "创建会话")
    db.create_turn("turn-session", "source-session", 1, "message-user")
    db.create_run("agent-run-session", "source-session", "turn-session", "provider", "model")
    db.create_message(
        "message-assistant",
        "source-session",
        "turn-session",
        "agent-run-session",
        "assistant",
        "text",
        {"text": "公告检查完成"},
    )
    service = _service()
    calls: list[dict] = []

    class Controller:
        def project_agent_run_terminal(self, *args, **kwargs):  # pragma: no cover - should be bypassed
            raise AssertionError("session mode without schema should not require verification projection")

        def _finish_completed(self, run_uid, *, result_summary=None):
            calls.append({"run_uid": run_uid, "result_summary": result_summary})
            return {"status": "completed", "run_uid": run_uid, "result_summary": result_summary}

    service.set_automation_controller(Controller())
    result = asyncio.run(service._project_automation_agent_terminal(
        {
            "session_id": "source-session",
            "run_id": "agent-run-session",
            "automation_run_uid": "run-session",
            "automation_permission_mode": "session",
            "automation_has_verification_schema": False,
        },
        status="completed",
    ))

    assert result["status"] == "completed"
    assert calls[0]["result_summary"] == {
        "assistant_terminal": {
            "status": "completed",
            "text": "公告检查完成",
            "provenance": "session_permission_mode",
        }
    }


def test_session_mode_completion_can_finish_without_controller_projection_method(monkeypatch, tmp_path):
    db = _init_temp_state(monkeypatch, tmp_path)
    db.create_session("source-session", "dsh-source", "创建会话")
    db.create_turn("turn-session", "source-session", 1, "message-user")
    db.create_run("agent-run-session", "source-session", "turn-session", "provider", "model")
    db.create_message(
        "message-assistant",
        "source-session",
        "turn-session",
        "agent-run-session",
        "assistant",
        "text",
        {"text": "普通完成"},
    )
    service = _service()

    class Controller:
        def _finish_completed(self, run_uid, *, result_summary=None):
            return {"status": "completed", "result_summary": result_summary}

    service.set_automation_controller(Controller())
    result = asyncio.run(service._project_automation_agent_terminal(
        {
            "session_id": "source-session",
            "run_id": "agent-run-session",
            "automation_run_uid": "run-session",
            "automation_permission_mode": "session",
            "automation_has_verification_schema": False,
        },
        status="completed",
    ))

    assert result["status"] == "completed"
    assert result["result_summary"]["assistant_terminal"]["text"] == "普通完成"


def test_session_mode_with_explicit_verification_schema_uses_controller_projection(monkeypatch, tmp_path):
    _init_temp_state(monkeypatch, tmp_path)
    service = _service()
    calls: list[tuple] = []

    class Controller:
        def project_agent_run_terminal(self, *args, **kwargs):
            calls.append((args, kwargs))
            return {"status": "needs_review", "marker": "schema-required"}

        def _finish_completed(self, *args, **kwargs):  # pragma: no cover - should be bypassed
            raise AssertionError("schema-backed session mode must use controller verification projection")

    service.set_automation_controller(Controller())
    result = asyncio.run(service._project_automation_agent_terminal(
        {
            "session_id": "source-session",
            "run_id": "agent-run-session",
            "automation_run_uid": "run-session",
            "automation_permission_mode": "session",
            "automation_has_verification_schema": True,
        },
        status="completed",
    ))

    assert result == {"status": "needs_review", "marker": "schema-required"}
    assert calls == [(('run-session', 'agent-run-session', 'completed'), {
        'error_code': '',
        'error_message': '',
        'retryable': False,
    })]



def test_session_mode_timeout_metadata_uses_config_without_policy_injection(monkeypatch, tmp_path):
    _init_temp_state(monkeypatch, tmp_path)
    service = _service()
    automation = {
        **_automation(),
        "execution_policy": {
            "permission_mode": "session",
            "toolset": ["browser_act"],
            "timeout_seconds": 45,
        },
    }

    asyncio.run(service.submit_automation_turn(automation, _run("run-timeout"), "检查公告", ["browser_act"]))
    item = service.queue.get_nowait()

    assert item["automation_permission_mode"] == "session"
    assert item["automation_policy"] is None
    assert item["automation_timeout_seconds"] == 45
    assert _automation_worker_timeout_seconds(item) == 45.0


def test_session_mode_timeout_metadata_defaults_to_automation_default(monkeypatch, tmp_path):
    _init_temp_state(monkeypatch, tmp_path)
    service = _service()
    automation = {
        **_automation(),
        "execution_policy": {
            "permission_mode": "session",
            "toolset": ["browser_act"],
        },
    }

    asyncio.run(service.submit_automation_turn(automation, _run("run-timeout-default"), "检查公告", ["browser_act"]))
    item = service.queue.get_nowait()

    assert item["automation_policy"] is None
    assert item["automation_timeout_seconds"] is None
    assert _automation_worker_timeout_seconds(item) == 300.0


def test_interactive_timeout_default_and_scoped_policy_snapshot_remain_unchanged():
    assert _automation_worker_timeout_seconds({}) == float(30 * 60 + 60)
    assert _automation_worker_timeout_seconds({"automation_run_uid": "run-scoped"}) == 300.0
    assert _automation_worker_timeout_seconds({
        "automation_run_uid": "run-scoped",
        "automation_policy": {"execution_policy": {"timeout_seconds": 77}},
    }) == 77.0
