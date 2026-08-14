"""agent db 回归:create_* 内嵌 get_* 不得死锁(RLock 修复)。"""
import os
import sys
import uuid
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "core"))

os.environ.setdefault("CRAWSHRIMP_DATA", os.path.join(os.path.dirname(__file__), "..", "..", ".tmp-agent-db-test"))

from core.agent import db  # noqa: E402


def _uid(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def test_create_session_reads_back_without_deadlock():
    db.init_agent_db()
    session = db.create_session(_uid("s"), _uid("r"), "标题")
    assert session["title"] == "标题"


def test_create_turn_and_run_read_back():
    session_id = _uid("s")
    db.create_session(session_id, _uid("r"))
    turn = db.create_turn(_uid("t"), session_id, 1, _uid("m"))
    assert turn["status"] == "queued"
    run = db.create_run(_uid("run"), session_id, turn["turn_id"], "crawshrimp-overseas-openai", "gpt-5.6-terra")
    assert run["status"] == "queued"


def test_plan_approval_roundtrip():
    session_id = _uid("s")
    run_id = _uid("run")
    db.create_session(session_id, _uid("r"))
    db.create_run(run_id, session_id, None, "p", "m")
    plan = db.create_plan(_uid("plan"), session_id, run_id, "task-1", "adapter-1",
                          {"a": 1}, "read_only", False, "2099-01-01T00:00:00+00:00")
    assert plan["status"] == "ready"
    approval = db.create_approval(_uid("apv"), plan["plan_id"], None, {"x": 1}, "read_only",
                                  plan["params_sha256"], "2099-01-01T00:00:00+00:00",
                                  session_id=session_id, run_id=run_id)
    assert approval["status"] == "pending"
    assert approval["session_id"] == session_id
    assert approval["run_id"] == run_id
    decided = db.decide_approval(approval["approval_id"], "approved")
    assert decided["status"] == "approved"


def test_granted_browser_tabs_are_scoped_to_session():
    session_a = _uid("s")
    session_b = _uid("s")
    run_a1 = _uid("run")
    run_a2 = _uid("run")
    run_b = _uid("run")
    db.create_session(session_a, _uid("runtime"))
    db.create_session(session_b, _uid("runtime"))
    db.create_run(run_a1, session_a, None, "p", "m")
    db.create_run(run_a2, session_a, None, "p", "m")
    db.create_run(run_b, session_b, None, "p", "m")
    db.create_grant(_uid("grant"), run_a1, None, "tab-a", ["observe"], "2099-01-01T00:00:00+00:00")
    db.create_grant(_uid("grant"), run_a2, None, "tab-b", ["observe"], "2099-01-01T00:00:00+00:00")
    db.create_grant(_uid("grant"), run_b, None, "tab-other", ["observe"], "2099-01-01T00:00:00+00:00")

    assert set(db.list_granted_tab_ids_for_session(session_a)) == {"tab-a", "tab-b"}


def test_sensitive_audit_fields_are_redacted_at_rest():
    session_id = _uid("s")
    run_id = _uid("run")
    db.create_session(session_id, _uid("r"))
    db.create_run(run_id, session_id, None, "p", "m")
    plan = db.create_plan(
        _uid("plan"), session_id, run_id, "task-1", "adapter-1",
        {"api_key": "plain-api-key", "nested": {"password": "plain-password"}},
        "external_write", True, "2099-01-01T00:00:00+00:00",
    )
    approval = db.create_approval(
        _uid("apv"), plan["plan_id"], None,
        {"params": {"accessToken": "plain-token", "query": "visible"}},
        "external_write", plan["params_sha256"], "2099-01-01T00:00:00+00:00",
    )
    call = db.upsert_tool_call(
        run_id, _uid("call"), "script_run",
        {"password": "tool-password", "query": "visible"},
    )
    persisted = "\n".join((plan["params_json"], approval["summary_json"], call["arguments_json"]))
    assert "plain-api-key" not in persisted
    assert "plain-password" not in persisted
    assert "plain-token" not in persisted
    assert "tool-password" not in persisted
    assert json.loads(plan["params_json"])["api_key"] == "[REDACTED]"


def test_tool_call_upsert_idempotent():
    session_id = _uid("s")
    run_id = _uid("run")
    db.create_session(session_id, _uid("r"))
    db.create_run(run_id, session_id, None, "p", "m")
    first = db.upsert_tool_call(run_id, "call-1", "tasks_search", {})
    second = db.upsert_tool_call(run_id, "call-1", "tasks_search", {})
    assert first["tool_call_id"] == second["tool_call_id"]


def test_events_seq_and_session_cursor():
    session_id = _uid("s")
    db.create_session(session_id, _uid("r"))
    seq1 = db.append_event(session_id, None, "turn.queued", {"a": 1})
    seq2 = db.append_event(session_id, None, "run.started", {"b": 2})
    assert seq2 > seq1
    rows = db.list_events_after(session_id, seq1)
    assert [r["event_type"] for r in rows] == ["run.started"]
    assert db.get_session(session_id)["last_event_seq"] == seq2


def test_plan_claim_is_atomic_and_persists_task_instance_uid():
    session_id = _uid("s")
    run_id = _uid("run")
    db.create_session(session_id, _uid("r"))
    db.create_run(run_id, session_id, None, "p", "m")
    plan = db.create_plan(_uid("plan"), session_id, run_id, "task-1", "adapter-1",
                          {}, "read_only", False, "2099-01-01T00:00:00+00:00")
    claimed = db.claim_plan(plan["plan_id"])
    assert claimed["status"] == "executing"
    assert db.claim_plan(plan["plan_id"]) is None
    db.update_plan(plan["plan_id"], status="consumed", task_instance_uid="ti-123")
    stored = db.get_plan(plan["plan_id"])
    assert stored["status"] == "consumed"
    assert stored["task_instance_uid"] == "ti-123"
