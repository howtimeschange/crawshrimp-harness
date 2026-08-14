"""agent db 回归:create_* 内嵌 get_* 不得死锁(RLock 修复)。"""
import os
import sys
import uuid

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
                                  plan["params_sha256"], "2099-01-01T00:00:00+00:00")
    assert approval["status"] == "pending"
    decided = db.decide_approval(approval["approval_id"], "approved")
    assert decided["status"] == "approved"


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
    db.bump_session_seq(session_id, seq2)
    assert db.get_session(session_id)["last_event_seq"] == seq2
