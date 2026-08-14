"""crawshrimp-harness 智能体数据层。

抓虾 SQLite 是产品真值:会话、轮次、Run、消息、事件投影、工具调用、
审批、执行计划、能力授权、脚本修订。Harness JSONL 是模型上下文真值,
本模块不触碰。

模式与 core/data_sink.py 一致:每操作独立连接、Row factory、UTC ISO 时间。
"""
from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from core.data_sink import _db_path, _now_iso  # noqa: F401  (复用产品库路径与时间格式)

_local = threading.local()
# 不使用进程级共享锁:跨线程(事件循环线程 + executor 线程 + anyio 线程)共享 RLock
# 会产生死锁类问题;并发安全交给 sqlite 文件锁 + busy_timeout。
from contextlib import nullcontext as _nullcontext
_lock = _nullcontext()  # noqa: A001  (保留 with _lock: 调用点形状,语义变为无锁)

AGENT_TABLES = """
CREATE TABLE IF NOT EXISTS agent_sessions (
    session_id TEXT PRIMARY KEY,
    runtime_session_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL DEFAULT '新会话',
    status TEXT NOT NULL DEFAULT 'idle',
    continuation_available INTEGER NOT NULL DEFAULT 1,
    last_event_seq INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
);
CREATE TABLE IF NOT EXISTS agent_turns (
    turn_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    user_message_id TEXT,
    active_run_id TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE TABLE IF NOT EXISTS agent_runs (
    run_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    turn_id TEXT,
    runtime_generation INTEGER,
    status TEXT NOT NULL DEFAULT 'queued',
    provider_id TEXT,
    model_id TEXT,
    dsh_message_id TEXT,
    dsh_start_seq INTEGER,
    dsh_end_seq INTEGER,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT '',
    started_at TEXT,
    finished_at TEXT
);
CREATE TABLE IF NOT EXISTS agent_messages (
    message_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    turn_id TEXT,
    run_id TEXT,
    role TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'text',
    content_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'complete',
    created_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE TABLE IF NOT EXISTS agent_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    run_id TEXT,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_tool_calls (
    tool_call_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    dsh_call_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested',
    arguments_json TEXT,
    result_json TEXT,
    plan_id TEXT,
    approval_id TEXT,
    task_instance_uid TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    UNIQUE(run_id, dsh_call_id)
);
CREATE TABLE IF NOT EXISTS agent_execution_plans (
    plan_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    adapter_id TEXT,
    task_id TEXT NOT NULL,
    params_json TEXT NOT NULL,
    params_sha256 TEXT NOT NULL,
    risk TEXT NOT NULL DEFAULT 'read_only',
    approval_required INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ready',
    expires_at TEXT NOT NULL,
    consumed_at TEXT
);
CREATE TABLE IF NOT EXISTS agent_approvals (
    approval_id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    tool_call_id TEXT,
    summary_json TEXT NOT NULL,
    risk TEXT NOT NULL,
    params_sha256 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    decided_by TEXT,
    decided_at TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_capability_grants (
    grant_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    url_prefix TEXT,
    tab_id TEXT,
    toolset_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_workspace_files (
    file_id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_run_id TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_script_revisions (
    rev_id TEXT PRIMARY KEY,
    draft_path TEXT NOT NULL,
    adapter_id TEXT,
    source_sha256 TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    created_run_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_turns_session ON agent_turns(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_agent_messages_session ON agent_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_session ON agent_events(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_run ON agent_tool_calls(run_id);
"""


def init_agent_db() -> None:
    with _lock:
        conn = _conn()
        try:
            conn.executescript(AGENT_TABLES)
            _ensure_agent_columns(conn)
            conn.commit()
        finally:
            conn.close()


def _ensure_agent_columns(conn: sqlite3.Connection) -> None:
    """增量迁移:补齐历史表缺失列(与 data_sink._ensure_column 同模式)。"""
    migrations = {
        "agent_runs": [("created_at", "TEXT NOT NULL DEFAULT ''")],
    }
    for table, columns in migrations.items():
        existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        for name, definition in columns:
            if name not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_db_path()), timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 15000")
    return conn


def _row(row: Optional[sqlite3.Row]) -> Optional[dict]:
    return dict(row) if row is not None else None


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _loads(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


def _fetch(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict]:
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


# ---------- 会话 ----------

def create_session(session_id: str, runtime_session_id: str, title: str = "新会话") -> dict:
    now = _now_iso()
    with _lock:
        conn = _conn()
        try:
            conn.execute(
                "INSERT INTO agent_sessions (session_id, runtime_session_id, title, status, last_event_seq, created_at, updated_at)"
                " VALUES (?, ?, ?, 'idle', 0, ?, ?)",
                (session_id, runtime_session_id, title, now, now),
            )
            conn.commit()
            return get_session(session_id)  # type: ignore[return-value]
        finally:
            conn.close()


def list_sessions(include_archived: bool = False) -> list[dict]:
    sql = "SELECT * FROM agent_sessions"
    if not include_archived:
        sql += " WHERE archived_at IS NULL"
    sql += " ORDER BY updated_at DESC"
    with _lock:
        conn = _conn()
        try:
            return _fetch(conn, sql)
        finally:
            conn.close()


def get_session(session_id: str) -> Optional[dict]:
    with _lock:
        conn = _conn()
        try:
            return _row(conn.execute("SELECT * FROM agent_sessions WHERE session_id = ?", (session_id,)).fetchone())
        finally:
            conn.close()


def update_session(session_id: str, **fields: Any) -> None:
    allowed = {"title", "status", "continuation_available", "archived_at"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return
    updates["updated_at"] = _now_iso()
    sets = ", ".join(f"{k} = ?" for k in updates)
    with _lock:
        conn = _conn()
        try:
            conn.execute(f"UPDATE agent_sessions SET {sets} WHERE session_id = ?", (*updates.values(), session_id))
            conn.commit()
        finally:
            conn.close()


def bump_session_seq(session_id: str, seq: int) -> None:
    with _lock:
        conn = _conn()
        try:
            conn.execute(
                "UPDATE agent_sessions SET last_event_seq = MAX(last_event_seq, ?), updated_at = ? WHERE session_id = ?",
                (seq, _now_iso(), session_id),
            )
            conn.commit()
        finally:
            conn.close()


# ---------- 轮次与 Run ----------

def create_turn(turn_id: str, session_id: str, ordinal: int, user_message_id: str) -> dict:
    now = _now_iso()
    with _lock:
        conn = _conn()
        try:
            conn.execute(
                "INSERT INTO agent_turns (turn_id, session_id, ordinal, status, user_message_id, created_at)"
                " VALUES (?, ?, ?, 'queued', ?, ?)",
                (turn_id, session_id, ordinal, user_message_id, now),
            )
            conn.commit()
            return _row(conn.execute("SELECT * FROM agent_turns WHERE turn_id = ?", (turn_id,)).fetchone())  # type: ignore[return-value]
        finally:
            conn.close()


def create_run(run_id: str, session_id: str, turn_id: Optional[str], provider_id: str, model_id: str) -> dict:
    now = _now_iso()
    with _lock:
        conn = _conn()
        try:
            conn.execute(
                "INSERT INTO agent_runs (run_id, session_id, turn_id, status, provider_id, model_id, created_at)"
                " VALUES (?, ?, ?, 'queued', ?, ?, ?)",
                (run_id, session_id, turn_id, provider_id, model_id, now),
            )
            conn.commit()
            return _row(conn.execute("SELECT * FROM agent_runs WHERE run_id = ?", (run_id,)).fetchone())  # type: ignore[return-value]
        finally:
            conn.close()


def update_run(run_id: str, **fields: Any) -> None:
    allowed = {"status", "runtime_generation", "dsh_message_id", "dsh_start_seq", "dsh_end_seq",
               "error_code", "error_message", "started_at", "finished_at"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return
    sets = ", ".join(f"{k} = ?" for k in updates)
    with _lock:
        conn = _conn()
        try:
            conn.execute(f"UPDATE agent_runs SET {sets} WHERE run_id = ?", (*updates.values(), run_id))
            conn.commit()
        finally:
            conn.close()


def get_run(run_id: str) -> Optional[dict]:
    with _lock:
        conn = _conn()
        try:
            return _row(conn.execute("SELECT * FROM agent_runs WHERE run_id = ?", (run_id,)).fetchone())
        finally:
            conn.close()


def list_nonterminal_runs() -> list[dict]:
    with _lock:
        conn = _conn()
        try:
            return _fetch(conn, "SELECT * FROM agent_runs WHERE status NOT IN ('completed','failed','canceled','interrupted')")
        finally:
            conn.close()


def get_turn(turn_id: str) -> Optional[dict]:
    with _lock:
        conn = _conn()
        try:
            return _row(conn.execute("SELECT * FROM agent_turns WHERE turn_id = ?", (turn_id,)).fetchone())
        finally:
            conn.close()


def update_turn(turn_id: str, **fields: Any) -> None:
    allowed = {"status", "active_run_id", "completed_at"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return
    sets = ", ".join(f"{k} = ?" for k in updates)
    with _lock:
        conn = _conn()
        try:
            conn.execute(f"UPDATE agent_turns SET {sets} WHERE turn_id = ?", (*updates.values(), turn_id))
            conn.commit()
        finally:
            conn.close()


def next_turn_ordinal(session_id: str) -> int:
    with _lock:
        conn = _conn()
        try:
            row = conn.execute("SELECT COALESCE(MAX(ordinal), 0) + 1 AS n FROM agent_turns WHERE session_id = ?", (session_id,)).fetchone()
            return int(row["n"])
        finally:
            conn.close()


# ---------- 消息 ----------

def create_message(message_id: str, session_id: str, turn_id: Optional[str], run_id: Optional[str],
                   role: str, kind: str, content: Any, status: str = "complete") -> dict:
    now = _now_iso()
    with _lock:
        conn = _conn()
        try:
            conn.execute(
                "INSERT INTO agent_messages (message_id, session_id, turn_id, run_id, role, kind, content_json, status, created_at, completed_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (message_id, session_id, turn_id, run_id, role, kind, _json(content), status, now, now if status == "complete" else None),
            )
            conn.commit()
            return _row(conn.execute("SELECT * FROM agent_messages WHERE message_id = ?", (message_id,)).fetchone())  # type: ignore[return-value]
        finally:
            conn.close()


def update_message(message_id: str, **fields: Any) -> None:
    allowed = {"content_json", "status", "completed_at"}
    updates = {}
    for k, v in fields.items():
        if k == "content_json":
            updates[k] = _json(v)
        elif k in allowed:
            updates[k] = v
    if not updates:
        return
    sets = ", ".join(f"{k} = ?" for k in updates)
    with _lock:
        conn = _conn()
        try:
            conn.execute(f"UPDATE agent_messages SET {sets} WHERE message_id = ?", (*updates.values(), message_id))
            conn.commit()
        finally:
            conn.close()


def list_messages(session_id: str) -> list[dict]:
    with _lock:
        conn = _conn()
        try:
            return _fetch(conn, "SELECT * FROM agent_messages WHERE session_id = ? ORDER BY created_at", (session_id,))
        finally:
            conn.close()


# ---------- 事件投影 ----------

def append_event(session_id: str, run_id: Optional[str], event_type: str, payload: Any) -> int:
    with _lock:
        conn = _conn()
        try:
            cur = conn.execute(
                "INSERT INTO agent_events (session_id, run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
                (session_id, run_id, event_type, _json(payload), _now_iso()),
            )
            conn.commit()
            return int(cur.lastrowid)
        finally:
            conn.close()


def list_events_after(session_id: str, after_seq: int, limit: int = 500) -> list[dict]:
    with _lock:
        conn = _conn()
        try:
            return _fetch(
                conn,
                "SELECT * FROM agent_events WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT ?",
                (session_id, after_seq, limit),
            )
        finally:
            conn.close()


# ---------- 工具调用 ----------

def upsert_tool_call(run_id: str, dsh_call_id: str, tool_name: str, arguments: Any) -> dict:
    now = _now_iso()
    with _lock:
        conn = _conn()
        try:
            conn.execute(
                "INSERT INTO agent_tool_calls (tool_call_id, run_id, dsh_call_id, tool_name, status, arguments_json, created_at)"
                " VALUES (?, ?, ?, ?, 'requested', ?, ?)"
                " ON CONFLICT(run_id, dsh_call_id) DO NOTHING",
                (f"{run_id}:{dsh_call_id}", run_id, dsh_call_id, tool_name, _json(arguments), now),
            )
            conn.commit()
            return _row(conn.execute(
                "SELECT * FROM agent_tool_calls WHERE run_id = ? AND dsh_call_id = ?", (run_id, dsh_call_id)
            ).fetchone())  # type: ignore[return-value]
        finally:
            conn.close()


def update_tool_call(tool_call_id: str, **fields: Any) -> None:
    allowed = {"status", "result_json", "plan_id", "approval_id", "task_instance_uid", "error_code", "started_at", "finished_at"}
    updates = {}
    for k, v in fields.items():
        if k == "result_json":
            updates[k] = _json(v)
        elif k in allowed:
            updates[k] = v
    if not updates:
        return
    sets = ", ".join(f"{k} = ?" for k in updates)
    with _lock:
        conn = _conn()
        try:
            conn.execute(f"UPDATE agent_tool_calls SET {sets} WHERE tool_call_id = ?", (*updates.values(), tool_call_id))
            conn.commit()
        finally:
            conn.close()


def get_tool_call(run_id: str, dsh_call_id: str) -> Optional[dict]:
    with _lock:
        conn = _conn()
        try:
            return _row(conn.execute(
                "SELECT * FROM agent_tool_calls WHERE run_id = ? AND dsh_call_id = ?", (run_id, dsh_call_id)
            ).fetchone())
        finally:
            conn.close()


# ---------- 计划 / 审批 ----------

def create_plan(plan_id: str, session_id: str, run_id: str, task_id: str, adapter_id: Optional[str],
                params: dict, risk: str, approval_required: bool, expires_at: str) -> dict:
    with _lock:
        conn = _conn()
        try:
            conn.execute(
                "INSERT INTO agent_execution_plans (plan_id, session_id, run_id, adapter_id, task_id, params_json, params_sha256, risk, approval_required, status, expires_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)",
                (plan_id, session_id, run_id, adapter_id, task_id, _json(params),
                 params_sha256(params), risk, 1 if approval_required else 0, expires_at),
            )
            conn.commit()
            return _row(conn.execute("SELECT * FROM agent_execution_plans WHERE plan_id = ?", (plan_id,)).fetchone())  # type: ignore[return-value]
        finally:
            conn.close()


def get_plan(plan_id: str) -> Optional[dict]:
    with _lock:
        conn = _conn()
        try:
            return _row(conn.execute("SELECT * FROM agent_execution_plans WHERE plan_id = ?", (plan_id,)).fetchone())
        finally:
            conn.close()


def params_sha256(params: dict) -> str:
    import hashlib
    return hashlib.sha256(
        json.dumps(params, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def update_plan(plan_id: str, **fields: Any) -> None:
    allowed = {"status", "consumed_at"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return
    sets = ", ".join(f"{k} = ?" for k in updates)
    with _lock:
        conn = _conn()
        try:
            conn.execute(f"UPDATE agent_execution_plans SET {sets} WHERE plan_id = ?", (*updates.values(), plan_id))
            conn.commit()
        finally:
            conn.close()


def create_approval(approval_id: str, plan_id: str, tool_call_id: Optional[str], summary: dict,
                    risk: str, params_hash: str, expires_at: str) -> dict:
    with _lock:
        conn = _conn()
        try:
            conn.execute(
                "INSERT INTO agent_approvals (approval_id, plan_id, tool_call_id, summary_json, risk, params_sha256, status, created_at, expires_at)"
                " VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
                (approval_id, plan_id, tool_call_id, _json(summary), risk, params_hash, _now_iso(), expires_at),
            )
            conn.commit()
            return _row(conn.execute("SELECT * FROM agent_approvals WHERE approval_id = ?", (approval_id,)).fetchone())  # type: ignore[return-value]
        finally:
            conn.close()


def get_approval(approval_id: str) -> Optional[dict]:
    with _lock:
        conn = _conn()
        try:
            return _row(conn.execute("SELECT * FROM agent_approvals WHERE approval_id = ?", (approval_id,)).fetchone())
        finally:
            conn.close()


def decide_approval(approval_id: str, decision: str, decided_by: str = "user") -> dict:
    now = _now_iso()
    with _lock:
        conn = _conn()
        try:
            conn.execute(
                "UPDATE agent_approvals SET status = ?, decided_by = ?, decided_at = ? WHERE approval_id = ? AND status = 'pending'",
                (decision, decided_by, now, approval_id),
            )
            conn.commit()
            return _row(conn.execute("SELECT * FROM agent_approvals WHERE approval_id = ?", (approval_id,)).fetchone())  # type: ignore[return-value]
        finally:
            conn.close()


def cancel_pending_approvals() -> int:
    with _lock:
        conn = _conn()
        try:
            cur = conn.execute("UPDATE agent_approvals SET status = 'canceled', decided_at = ? WHERE status = 'pending'", (_now_iso(),))
            conn.commit()
            return cur.rowcount
        finally:
            conn.close()


# ---------- 授权 / 工作区 / 脚本修订 ----------

def create_grant(grant_id: str, run_id: str, url_prefix: Optional[str], tab_id: Optional[str],
                 toolset: list[str], expires_at: str) -> dict:
    with _lock:
        conn = _conn()
        try:
            conn.execute(
                "INSERT INTO agent_capability_grants (grant_id, run_id, url_prefix, tab_id, toolset_json, status, created_at, expires_at)"
                " VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
                (grant_id, run_id, url_prefix, tab_id, _json(toolset), _now_iso(), expires_at),
            )
            conn.commit()
            return _row(conn.execute("SELECT * FROM agent_capability_grants WHERE grant_id = ?", (grant_id,)).fetchone())  # type: ignore[return-value]
        finally:
            conn.close()


def get_grant(grant_id: str) -> Optional[dict]:
    with _lock:
        conn = _conn()
        try:
            return _row(conn.execute("SELECT * FROM agent_capability_grants WHERE grant_id = ?", (grant_id,)).fetchone())
        finally:
            conn.close()


def update_grant_toolset(grant_id: str, toolset: list[str]) -> None:
    with _lock:
        conn = _conn()
        try:
            conn.execute("UPDATE agent_capability_grants SET toolset_json = ? WHERE grant_id = ?",
                         (_json(toolset), grant_id))
            conn.commit()
        finally:
            conn.close()


def revoke_grant(grant_id: str) -> None:
    with _lock:
        conn = _conn()
        try:
            conn.execute("UPDATE agent_capability_grants SET status = 'revoked' WHERE grant_id = ?", (grant_id,))
            conn.commit()
        finally:
            conn.close()


def create_workspace_file(file_id: str, path: str, sha256: str, size: int, created_run_id: Optional[str], expires_at: str) -> None:
    with _lock:
        conn = _conn()
        try:
            conn.execute(
                "INSERT INTO agent_workspace_files (file_id, path, sha256, size, created_run_id, created_at, expires_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (file_id, path, sha256, size, created_run_id, _now_iso(), expires_at),
            )
            conn.commit()
        finally:
            conn.close()


def create_script_revision(rev_id: str, draft_path: str, created_run_id: Optional[str]) -> None:
    now = _now_iso()
    with _lock:
        conn = _conn()
        try:
            conn.execute(
                "INSERT INTO agent_script_revisions (rev_id, draft_path, status, created_run_id, created_at, updated_at)"
                " VALUES (?, ?, 'draft', ?, ?, ?)",
                (rev_id, draft_path, created_run_id, now, now),
            )
            conn.commit()
        finally:
            conn.close()


def update_script_revision(rev_id: str, **fields: Any) -> None:
    allowed = {"status", "adapter_id", "source_sha256"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return
    updates["updated_at"] = _now_iso()
    sets = ", ".join(f"{k} = ?" for k in updates)
    with _lock:
        conn = _conn()
        try:
            conn.execute(f"UPDATE agent_script_revisions SET {sets} WHERE rev_id = ?", (*updates.values(), rev_id))
            conn.commit()
        finally:
            conn.close()


def get_script_revision(rev_id: str) -> Optional[dict]:
    with _lock:
        conn = _conn()
        try:
            return _row(conn.execute("SELECT * FROM agent_script_revisions WHERE rev_id = ?", (rev_id,)).fetchone())
        finally:
            conn.close()


# ---------- 清理 ----------

def delete_all_agent_data() -> None:
    with _lock:
        conn = _conn()
        try:
            conn.executescript(
                "DELETE FROM agent_events; DELETE FROM agent_tool_calls; DELETE FROM agent_approvals;"
                " DELETE FROM agent_execution_plans; DELETE FROM agent_capability_grants;"
                " DELETE FROM agent_workspace_files; DELETE FROM agent_script_revisions;"
                " DELETE FROM agent_messages; DELETE FROM agent_runs; DELETE FROM agent_turns; DELETE FROM agent_sessions;"
            )
            conn.commit()
        finally:
            conn.close()
