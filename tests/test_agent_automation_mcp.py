"""Agent/MCP contracts for durable Agent Automations."""
from __future__ import annotations

import asyncio

from core import data_sink, runtime_paths
from core.agent import db, mcp_gateway
from core.agent.service import AgentService


def _seed_agent_db(monkeypatch, tmp_path):
    monkeypatch.setenv("CRAWSHRIMP_DATA", str(tmp_path))
    monkeypatch.setattr(runtime_paths, "_runtime_data_root", None, raising=False)
    monkeypatch.setattr(runtime_paths, "_runtime_data_key", None, raising=False)
    runtime_paths.reset_runtime_data_root_cache()
    data_sink.init_db()
    db.init_agent_db()


def _restock_program():
    return {
        "config": {"reorder_point": 20},
        "branches": [{
            "id": "restock",
            "priority": 10,
            "when": {"all": [
                {"lt": [{"path": "facts.inventory.available"}, {"path": "config.reorder_point"}]},
                {"gt": [{"path": "facts.sales.last_7_days"}, 0]},
            ]},
        }],
        "checkpoint": {"last_available": {"path": "facts.inventory.available"}},
    }


def test_submit_automation_turn_uses_isolated_session_and_policy_toolset(monkeypatch, tmp_path):
    async def scenario():
        _seed_agent_db(monkeypatch, tmp_path)
        service = AgentService()
        queued = await service.submit_automation_turn(
            {
                "automation_uid": "a1",
                "title": "库存",
                "context_mode": "isolated",
                "execution_policy": {"toolset": ["observe", "verify"]},
            },
            {"run_uid": "ar1"},
            "执行 restock",
            ["observe"],
        )

        assert queued["session_id"] == "automation:a1:ar1"
        item = service.queue.get_nowait()
        assert item["grant_prefs"] == {"toolset": ["observe"]}
        assert item["automation_policy"]["toolset"] == ["observe"]
        assert item["automation_run_uid"] == "ar1"

    asyncio.run(scenario())


def test_automation_program_test_returns_branch_and_checkpoint():
    result = mcp_gateway.tool_automation_program_test(
        _restock_program(),
        {"inventory": {"available": 2}, "sales": {"last_7_days": 1}},
        {},
    )

    assert result["ok"] is True
    assert result["data"]["matched_branch"] == "restock"
    assert result["data"]["checkpoint_patch"] == {"last_available": 2}


def test_automation_tool_registry_exposes_management_surface():
    expected = {
        "automation_list", "automation_get", "automation_create", "automation_update",
        "automation_pause", "automation_resume", "automation_archive", "automation_run_now",
        "automation_runs", "automation_program_test", "automation_record_observation",
        "automation_record_verification",
    }
    assert expected.issubset(set(mcp_gateway.EXPECTED_TOOLS))


def test_automation_observation_requires_the_linked_agent_run(monkeypatch, tmp_path):
    class Controller:
        def __init__(self):
            self.calls = []

        async def record_observation(self, run_uid, facts, evidence_refs):
            self.calls.append((run_uid, facts, evidence_refs))
            return {"run_uid": run_uid, "status": "running"}

    _seed_agent_db(monkeypatch, tmp_path)
    automation = data_sink.create_agent_automation({
        "title": "库存", "objective_prompt": "检查", "automation_kind": "scheduled",
        "context_mode": "isolated", "schedule": {}, "loop_policy": {}, "execution_policy": {},
    })
    claimed = data_sink.claim_agent_automation_run(automation["automation_uid"], "manual", "manual:test")
    run = data_sink.update_agent_automation_run(claimed["run"]["run_uid"], agent_run_id="agent-linked")
    controller = Controller()
    previous = mcp_gateway.ctx.automation_controller
    mcp_gateway.set_automation_controller(controller)
    try:
        token = mcp_gateway.bind_tool_context({
            "active_run": {"run_id": "agent-other", "session_id": "s"},
            "grant": None,
            "current_tool_call_id": "",
            "automation_policy": {"toolset": ["observe"]},
            "automation_run_uid": run["run_uid"],
        })
        try:
            rejected = asyncio.run(mcp_gateway.tool_automation_record_observation({"available": 1}, []))
        finally:
            mcp_gateway.reset_tool_context(token)
    finally:
        mcp_gateway.set_automation_controller(previous)

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "AUTOMATION_RUN_LINK_MISMATCH"
    assert controller.calls == []


def test_automation_policy_mismatch_marks_needs_review_without_interactive_approval():
    class Controller:
        def __init__(self):
            self.calls = []

        def mark_needs_review(self, *args):
            self.calls.append(args)

    controller = Controller()
    previous = mcp_gateway.ctx.automation_controller
    mcp_gateway.set_automation_controller(controller)
    token = mcp_gateway.bind_tool_context({
        "active_run": {"run_id": "agent-1", "session_id": "s"},
        "grant": None,
        "current_tool_call_id": "",
        "automation_policy": {"allowed_tools": ["data_export"], "allowed_risks": ["local_write"]},
        "automation_run_uid": "automation-run-1",
    })
    try:
        decision = mcp_gateway._automation_approval_decision(
            {"risk": "external_write"}, {"tool_name": "fs_write"},
        )
    finally:
        mcp_gateway.reset_tool_context(token)
        mcp_gateway.set_automation_controller(previous)

    assert decision == "rejected"
    assert controller.calls == [
        ("automation-run-1", "AUTOMATION_POLICY_DENIED", "Automation policy does not authorize fs_write with risk external_write"),
    ]


def test_automation_policy_context_is_immutable_to_mcp_tools():
    token = mcp_gateway.bind_tool_context({
        "active_run": None,
        "grant": None,
        "current_tool_call_id": "",
        "automation_policy": {"execution_policy": {"allowed_risks": ["local_write"]}},
        "automation_run_uid": "automation-run-1",
    })
    try:
        observed = mcp_gateway.ctx.automation_policy
        observed["execution_policy"]["allowed_risks"].append("external_write")
        assert mcp_gateway.ctx.automation_policy == {
            "execution_policy": {"allowed_risks": ["local_write"]},
        }
    finally:
        mcp_gateway.reset_tool_context(token)
