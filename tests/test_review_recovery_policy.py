"""Crash-window and explicit-deny regressions from the project review."""
import asyncio
from unittest.mock import AsyncMock

import pytest

from core import data_sink, runtime_paths, scheduler
from core.agent import db, mcp_gateway
from core.automation_controller import AutomationController
from core.automation_policy import DENIED_TOOLS, automation_policy_error


@pytest.fixture
def controller(monkeypatch, tmp_path):
    monkeypatch.setattr(runtime_paths, "data_root", lambda: tmp_path)
    data_sink.init_db()
    db.init_agent_db()
    scheduler._scheduler = None
    value = AutomationController(None, scheduler)
    yield value
    scheduler._scheduler = None
    scheduler._automation_callbacks.clear()
    scheduler._automation_retry_callbacks.clear()


def definition(**policy):
    return {
        "title": "Review regression", "objective_prompt": "Local verification",
        "automation_kind": "scheduled", "enabled": False,
        "schedule": {"kind": "every", "interval_seconds": 3600},
        "execution_policy": {"toolset": ["automation_record_verification"], **policy},
    }


@pytest.mark.parametrize("status", ["claimed", "queued", "running"])
@pytest.mark.parametrize("agent_status", [None, "missing", "interrupted", "completed", "failed"])
def test_recover_orphans_without_replaying_work(controller, status, agent_status):
    auto = controller.create(definition())
    uid = auto["automation_uid"]
    run = data_sink.claim_agent_automation_run(uid, "manual", "before-crash")["run"]
    agent_id = "agent" if agent_status else ""
    if agent_status not in {None, "missing"}:
        db.create_session("session", "runtime", "Review")
        db.create_turn("turn", "session", 1, "message")
        db.create_run(agent_id, "session", "turn", "provider", "model")
        db.update_run(agent_id, status=agent_status)
    data_sink.update_agent_automation_run(run["run_uid"], status=status, agent_run_id=agent_id)
    assert controller.reconcile_interrupted_agent_runs() == 1
    assert controller.reconcile_interrupted_agent_runs() == 0
    assert data_sink.get_agent_automation_run(run["run_uid"])["status"] == "needs_review"
    assert not data_sink.has_active_agent_automation_run(uid)
    assert len(controller.runs(uid)) == 1  # Recovery submits no replacement.


def test_recovery_finds_orphan_behind_history_limit(controller):
    auto = controller.create(definition())
    uid = auto["automation_uid"]
    run = data_sink.claim_agent_automation_run(uid, "manual", "old")["run"]
    with data_sink._get_conn() as conn:
        for index in range(501):
            conn.execute("INSERT INTO agent_automation_runs (run_uid, automation_uid, trigger_kind, trigger_uid, trigger_at, status, created_at, updated_at) VALUES (?, ?, 'manual', ?, '2999', 'skipped_overlap', '2999', '2999')", (f"skipped-{index}", uid, f"skipped-{index}"))
        conn.commit()
    assert run["run_uid"] not in {item["run_uid"] for item in controller.runs(uid, limit=500)}
    assert controller.reconcile_interrupted_agent_runs() == 1


@pytest.mark.parametrize("status", ["queued", "running"])
def test_recovery_preserves_known_live_agent(controller, status):
    auto = controller.create(definition())
    db.create_session("session", "runtime", "Review")
    db.create_turn("turn", "session", 1, "message")
    db.create_run("agent", "session", "turn", "provider", "model")
    db.update_run("agent", status=status)
    run = data_sink.claim_agent_automation_run(auto["automation_uid"], "manual", "live")["run"]
    data_sink.update_agent_automation_run(run["run_uid"], status="running", agent_run_id="agent")
    assert controller.reconcile_interrupted_agent_runs() == 0
    assert data_sink.has_active_agent_automation_run(auto["automation_uid"])


@pytest.mark.parametrize("flag,tool", [(flag, sorted(tools)[0]) for flag, tools in DENIED_TOOLS.items()])
def test_policy_conflicts_rejected_on_create_and_patch(controller, flag, tool):
    with pytest.raises(ValueError, match=flag):
        controller.create(definition(**{flag: False, "toolset": [tool]}))
    auto = controller.create(definition(**{flag: False}))
    with pytest.raises(ValueError, match=flag):
        controller.update(auto["automation_uid"], {"execution_policy": {"toolset": [tool]}})
    assert controller.get(auto["automation_uid"])["execution_policy"][flag] is False


@pytest.mark.parametrize("flag", list(DENIED_TOOLS))
def test_general_execution_cannot_bypass_explicit_deny(flag):
    assert automation_policy_error({flag: False, "toolset": ["fs_exec"]})
    assert not automation_policy_error({flag: True, "toolset": ["fs_exec"]})


@pytest.mark.parametrize("invalid", [0, 1, "false", None])
def test_non_boolean_flag_is_rejected(controller, invalid):
    with pytest.raises(ValueError, match="boolean"):
        controller.create(definition(allow_filesystem=invalid))


def test_legacy_conflict_is_disabled_on_restore_and_manual_run(controller):
    auto = data_sink.create_agent_automation({**definition(allow_filesystem=False, toolset=["fs_read"]), "enabled": True})
    retry = data_sink.claim_agent_automation_run(auto["automation_uid"], "manual", "retry")["run"]
    data_sink.update_agent_automation_run(retry["run_uid"], status="retry_scheduled")
    data_sink.update_agent_automation(auto["automation_uid"], retry_at="2999-01-01T00:00:00Z")
    controller.restore()
    stored = controller.get(auto["automation_uid"])
    assert not stored["enabled"]
    assert stored["last_status"] == "needs_review"
    assert stored["execution_policy"]["allow_filesystem"] is False
    assert data_sink.get_agent_automation_run(retry["run_uid"])["status"] == "needs_review"
    assert not data_sink.has_active_agent_automation_run(auto["automation_uid"])
    with pytest.raises(ValueError, match="allow_filesystem"):
        controller.resume(auto["automation_uid"])
    run = asyncio.run(controller.run_now(auto["automation_uid"]))
    assert run["status"] == "needs_review"
    assert run["error_code"] == "AUTOMATION_POLICY_CONFLICT"


def test_runtime_wrapper_rejects_immutable_conflicting_policy_before_file_read(tmp_path):
    sample = tmp_path / "private.txt"
    sample.write_text("must-not-be-read")
    controller = type("Recorder", (), {"mark_needs_review": lambda *args: None})()
    original = mcp_gateway.ctx.automation_controller
    mcp_gateway.ctx.automation_controller = controller
    token = mcp_gateway._TOOL_CONTEXT_CTX.set({
        "active_run": {"run_id": "agent"}, "automation_run_uid": "run",
        "automation_policy": {"toolset": ["fs_read"], "execution_policy": {"allow_filesystem": False}},
    })
    called = AsyncMock(wraps=mcp_gateway.tool_fs_read)
    try:
        result = asyncio.run(mcp_gateway._automation_tool_wrapper("fs_read", called)(str(sample)))
        assert result["ok"] is False
        called.assert_not_called()
        assert "must-not-be-read" not in str(result)
    finally:
        mcp_gateway._TOOL_CONTEXT_CTX.reset(token)
        mcp_gateway.ctx.automation_controller = original
