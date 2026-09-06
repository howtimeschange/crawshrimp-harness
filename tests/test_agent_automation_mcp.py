"""Agent/MCP contracts for durable Agent Automations."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime
from zoneinfo import ZoneInfo

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
                "execution_policy": {"toolset": ["automation_record_observation", "automation_record_verification"]},
            },
            {"run_uid": "ar1"},
            "执行 restock",
            ["automation_record_observation"],
        )

        assert queued["session_id"] == "automation:a1:ar1"
        assert queued["status"] == "queued"
        item = service.queue.get_nowait()
        assert item["grant_prefs"] == {"toolset": ["automation_record_observation"]}
        assert item["automation_policy"]["toolset"] == ["automation_record_observation"]
        assert item["automation_run_uid"] == "ar1"

    asyncio.run(scenario())


def test_browser_automation_turn_queues_only_its_bound_tab(monkeypatch, tmp_path):
    async def scenario():
        _seed_agent_db(monkeypatch, tmp_path)
        service = AgentService()

        await service.submit_automation_turn(
            {
                "automation_uid": "browser-a1",
                "title": "读取已选页面",
                "context_mode": "isolated",
                "execution_policy": {
                    "toolset": ["browser_observe"],
                    "browser_tab_id": "tab-owned-by-automation",
                },
            },
            {"run_uid": "browser-ar1"},
            "读取已授权页面",
            ["browser_observe"],
        )

        item = service.queue.get_nowait()
        assert item["context_refs"] == [{"type": "browser_tab", "id": "tab-owned-by-automation"}]

    asyncio.run(scenario())


def test_inherited_automation_wait_timeout_cancels_only_the_queued_turn_and_marks_overlap(monkeypatch, tmp_path):
    async def scenario():
        _seed_agent_db(monkeypatch, tmp_path)
        db.create_session("source-session", "dsh-source", "创建自动化")

        class Controller:
            def __init__(self):
                self.calls = []

            def mark_inherited_wait_timeout(self, run_uid, agent_run_id, message):
                self.calls.append((run_uid, agent_run_id, message))
                return {"run_uid": run_uid, "status": "skipped_overlap"}

        service = AgentService()
        controller = Controller()
        service.set_automation_controller(controller)
        queued = await service.submit_automation_turn(
            {
                "automation_uid": "inherit-1",
                "title": "等待原会话的自动化",
                "context_mode": "inherited",
                "source_session_id": "source-session",
                "execution_policy": {
                    "toolset": ["automation_record_verification"],
                    "inherited_wait_seconds": 30,
                },
            },
            {"run_uid": "automation-run-1"},
            "仅在原会话空闲后运行",
            ["automation_record_verification"],
        )

        skipped = await service._expire_inherited_automation_wait(
            queued["run_id"], "automation-run-1", "source-session",
        )

        assert skipped is True
        assert db.get_run(queued["run_id"])["status"] == "canceled"
        assert db.get_turn(queued["turn_id"])["status"] == "canceled"
        assert controller.calls == [
            ("automation-run-1", queued["run_id"], "继承会话在 30 秒内未空闲，本次自动化已跳过"),
        ]
        # Queue removal is intentionally lazy. A later dequeue must observe the
        # canceled durable run and never start the expired inherited turn.
        await service._run_one(service.queue.get_nowait())
        assert db.get_run(queued["run_id"])["status"] == "canceled"

        task = service._inherited_automation_wait_tasks.pop(queued["run_id"], None)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

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
        "automation_current_time",
        "automation_pause", "automation_resume", "automation_archive", "automation_run_now",
        "automation_runs", "automation_program_test", "automation_record_observation",
        "automation_record_verification",
    }
    assert expected.issubset(set(mcp_gateway.EXPECTED_TOOLS))


def test_automation_create_contract_guides_a_real_chinese_reminder_without_schema_probe():
    description = mcp_gateway.automation_create_tool_description()

    # This is the wording a real user uses in the client.  The tool contract
    # must let the model convert it to a safe one-off schedule directly, rather
    # than searching local files for an undocumented values shape.
    assert "automation_current_time" in description
    assert "今天/明天/几点" in description
    assert "automation_kind=\"scheduled\"" in description
    assert '"kind":"at"' in description
    assert "Asia/Shanghai" in description
    assert "context_mode=\"isolated\"" in description
    assert "automation_record_verification" in description
    assert "fs_read、fs_list、fs_exec、browser_*、script_* 或 repo_*" in description
    assert "本地自动化验收提醒" in description


def test_automation_current_time_is_live_and_explicitly_zoned():
    result = mcp_gateway.tool_automation_current_time()

    assert result["ok"] is True
    assert result["data"]["timezone"] == "Asia/Shanghai"
    now = datetime.fromisoformat(result["data"]["now"])
    assert now.utcoffset() == ZoneInfo("Asia/Shanghai").utcoffset(now)


def test_automation_policy_uses_its_exact_toolset_and_explicit_risk_for_unattended_approval():
    class Controller:
        def mark_needs_review(self, *_args):
            raise AssertionError("the explicitly authorized action must not require review")

    previous = mcp_gateway.ctx.automation_controller
    mcp_gateway.set_automation_controller(Controller())
    token = mcp_gateway.bind_tool_context({
        "active_run": {"run_id": "agent-run", "session_id": "automation-session"},
        "grant": None,
        "current_tool_call_id": "",
        "automation_run_uid": "automation-run",
        "automation_policy": {
            "toolset": ["task_run"],
            "execution_policy": {
                "toolset": ["task_run"],
                "allowed_risks": ["local_write"],
            },
        },
    })
    try:
        decision = mcp_gateway._automation_approval_decision(
            {"risk": "local_write"}, {"tool_name": "task_run", "risk": "local_write"},
        )
    finally:
        mcp_gateway.reset_tool_context(token)
        mcp_gateway.set_automation_controller(previous)

    assert decision == "approved"


def test_automation_create_binds_the_current_conversation_instead_of_model_values(monkeypatch, tmp_path):
    class Controller:
        def __init__(self):
            self.payload = None

        def create(self, payload):
            self.payload = dict(payload)
            return self.payload

    _seed_agent_db(monkeypatch, tmp_path)
    db.create_session("source-session", "dsh-source", "创建自动化")
    controller = Controller()
    previous = mcp_gateway.ctx.automation_controller
    mcp_gateway.set_automation_controller(controller)
    token = mcp_gateway.bind_tool_context({
        "active_run": {"run_id": "agent-create", "session_id": "source-session"},
        "grant": None,
        "current_tool_call_id": "",
    })
    try:
        result = mcp_gateway.tool_automation_create({
            "title": "本地自动化验收提醒",
            "source_session_id": "model-supplied-session",
            "source_runtime_session_id": "model-supplied-runtime",
        })
    finally:
        mcp_gateway.reset_tool_context(token)
        mcp_gateway.set_automation_controller(previous)

    assert result["ok"] is True
    assert controller.payload["source_session_id"] == "source-session"
    assert controller.payload["source_runtime_session_id"] == "dsh-source"


def test_browser_automation_creation_binds_the_current_exact_browser_tab(monkeypatch, tmp_path):
    class Controller:
        def __init__(self):
            self.payload = None

        def create(self, payload):
            self.payload = dict(payload)
            return self.payload

    _seed_agent_db(monkeypatch, tmp_path)
    db.create_session("source-session", "dsh-source", "创建自动化")
    controller = Controller()
    previous = mcp_gateway.ctx.automation_controller
    mcp_gateway.set_automation_controller(controller)
    token = mcp_gateway.bind_tool_context({
        "active_run": {"run_id": "agent-create", "session_id": "source-session"},
        "grant": {"tab_id": "tab-owned-by-source"},
        "current_tool_call_id": "",
    })
    try:
        result = mcp_gateway.tool_automation_create({
            "title": "读取当前店铺页面",
            "execution_policy": {"toolset": ["browser_observe"]},
        })
    finally:
        mcp_gateway.reset_tool_context(token)
        mcp_gateway.set_automation_controller(previous)

    assert result["ok"] is True
    assert controller.payload["execution_policy"]["browser_tab_id"] == "tab-owned-by-source"


def test_browser_automation_creation_without_a_bound_browser_tab_is_rejected(monkeypatch, tmp_path):
    class Controller:
        def create(self, _payload):
            raise AssertionError("unbound browser automation must not be created")

    _seed_agent_db(monkeypatch, tmp_path)
    controller = Controller()
    previous = mcp_gateway.ctx.automation_controller
    mcp_gateway.set_automation_controller(controller)
    token = mcp_gateway.bind_tool_context({
        "active_run": {"run_id": "agent-create", "session_id": "source-session"},
        "grant": None,
        "current_tool_call_id": "",
    })
    try:
        result = mcp_gateway.tool_automation_create({
            "title": "没有页面绑定的读取",
            "execution_policy": {"toolset": ["browser_observe"]},
        })
    finally:
        mcp_gateway.reset_tool_context(token)
        mcp_gateway.set_automation_controller(previous)

    assert result["ok"] is False
    assert result["error"]["code"] == "AUTOMATION_BROWSER_CONTEXT_REQUIRED"


def test_automation_create_drops_model_supplied_source_without_an_active_conversation(monkeypatch, tmp_path):
    class Controller:
        def __init__(self):
            self.payload = None

        def create(self, payload):
            self.payload = dict(payload)
            return self.payload

    _seed_agent_db(monkeypatch, tmp_path)
    controller = Controller()
    previous = mcp_gateway.ctx.automation_controller
    mcp_gateway.set_automation_controller(controller)
    try:
        result = mcp_gateway.tool_automation_create({
            "title": "不允许伪造回执来源",
            "source_session_id": "another-session",
            "source_runtime_session_id": "dsh-another",
        })
    finally:
        mcp_gateway.set_automation_controller(previous)

    assert result["ok"] is True
    assert "source_session_id" not in controller.payload
    assert "source_runtime_session_id" not in controller.payload


def test_automation_program_mutation_requires_the_matching_mcp_test_proof(monkeypatch, tmp_path):
    class Controller:
        def __init__(self):
            self.payload = None

        def create(self, payload):
            self.payload = dict(payload)
            return self.payload

    _seed_agent_db(monkeypatch, tmp_path)
    controller = Controller()
    previous = mcp_gateway.ctx.automation_controller
    mcp_gateway.set_automation_controller(controller)
    program = _restock_program()
    values = {
        "title": "库存闭环",
        "objective_prompt": "观察库存并处理",
        "automation_kind": "loop",
        "context_mode": "isolated",
        "loop_policy": {"cycle_interval_seconds": 60},
        "execution_policy": {"toolset": ["automation_record_observation", "automation_record_verification"]},
        "program": program,
    }
    try:
        rejected = mcp_gateway.tool_automation_create(dict(values))
        tested = mcp_gateway.tool_automation_program_test(program, {"inventory": {"available": 1}, "sales": {"last_7_days": 1}}, {})
        accepted = mcp_gateway.tool_automation_create({
            **values,
            "program_test_proof": tested["data"]["program_test_proof"],
        })
    finally:
        mcp_gateway.set_automation_controller(previous)

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "AUTOMATION_PROGRAM_TEST_REQUIRED"
    assert accepted["ok"] is True
    assert controller.payload["program"] == program
    assert "program_test_proof" not in controller.payload


def test_automation_update_cannot_redirect_the_source_conversation(monkeypatch, tmp_path):
    class Controller:
        def update(self, _uid, _payload):
            raise AssertionError("source-session update must be rejected before reaching the controller")

    _seed_agent_db(monkeypatch, tmp_path)
    previous = mcp_gateway.ctx.automation_controller
    mcp_gateway.set_automation_controller(Controller())
    try:
        result = mcp_gateway.tool_automation_update("automation-1", {
            "source_session_id": "another-user-session",
        })
    finally:
        mcp_gateway.set_automation_controller(previous)

    assert result["ok"] is False
    assert result["error"]["code"] == "AUTOMATION_SOURCE_SESSION_IMMUTABLE"


def test_one_off_automation_completion_returns_a_redacted_receipt_to_source_session(monkeypatch, tmp_path):
    async def scenario():
        _seed_agent_db(monkeypatch, tmp_path)
        db.create_session("source-session", "dsh-source", "创建自动化")
        db.create_session("isolated-session", "dsh-isolated", "自动化运行")
        automation = data_sink.create_agent_automation({
            "title": "本地自动化验收提醒",
            "objective_prompt": "到时只确认验收完成",
            "automation_kind": "scheduled",
            "context_mode": "isolated",
            "source_session_id": "source-session",
            "source_runtime_session_id": "dsh-source",
            "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
            "loop_policy": {},
            "execution_policy": {"toolset": ["automation_record_verification"]},
        })
        claimed = data_sink.claim_agent_automation_run(automation["automation_uid"], "scheduled", "scheduled:test")
        automation_run = data_sink.update_agent_automation_run(
            claimed["run"]["run_uid"], agent_run_id="agent-run-1"
        )
        call = db.upsert_tool_call(
            "agent-run-1",
            "verification-call",
            "mcp__crawshrimp__automation_record_verification",
            {"result": {"verified": True, "user_message": "本地自动化验收已完成"}},
        )
        db.update_tool_call(call["tool_call_id"], status="succeeded")
        data_sink.update_agent_automation_run(automation_run["run_uid"], status="completed")
        service = AgentService()
        service._project_automation_receipt_to_runtime = lambda *_args: asyncio.sleep(0, result=True)
        await service._publish_automation_source_receipt(
            "isolated-session",
            {"run_id": "agent-run-1", "automation_run_uid": automation_run["run_uid"]},
            status="completed",
        )
        # A duplicate completion event must not send or persist a second reply.
        await service._publish_automation_source_receipt(
            "isolated-session",
            {"run_id": "agent-run-1", "automation_run_uid": automation_run["run_uid"]},
            status="completed",
        )

        messages = db.list_messages("source-session")
        assert len(messages) == 1
        content = json.loads(messages[0]["content_json"])
        assert content["text"] == "本地自动化验收已完成"
        events = db.list_events_after("source-session", 0)
        assert len(events) == 1
        assert events[0]["event_type"] == "assistant.completed"
        assert "tool" not in events[0]["payload_json"]

    asyncio.run(scenario())


def test_one_off_automation_completion_projects_the_same_structured_receipt_to_dsh(monkeypatch, tmp_path):
    async def scenario():
        _seed_agent_db(monkeypatch, tmp_path)
        db.create_session("source-session", "dsh-source", "创建自动化")
        service = AgentService()
        observed = {}

        async def project(session_id, receipt_id, receipt_text):
            observed.update({
                "session_id": session_id,
                "receipt_id": receipt_id,
                "receipt_text": receipt_text,
            })
            return True

        service._project_automation_receipt_to_runtime = project
        automation = data_sink.create_agent_automation({
            "title": "本地自动化回执验收",
            "objective_prompt": "到时只确认验收完成",
            "automation_kind": "scheduled",
            "context_mode": "isolated",
            "source_session_id": "source-session",
            "source_runtime_session_id": "dsh-source",
            "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
            "loop_policy": {},
            "execution_policy": {"toolset": ["automation_record_verification"]},
        })
        claimed = data_sink.claim_agent_automation_run(automation["automation_uid"], "scheduled", "scheduled:test")
        automation_run = data_sink.update_agent_automation_run(claimed["run"]["run_uid"], agent_run_id="agent-run-2")
        call = db.upsert_tool_call(
            "agent-run-2", "verification-call", "mcp__crawshrimp__automation_record_verification",
            {"result": {"verified": True, "user_message": "本地自动化验收已完成"}},
        )
        db.update_tool_call(call["tool_call_id"], status="succeeded")
        data_sink.update_agent_automation_run(automation_run["run_uid"], status="completed")

        await service._publish_automation_source_receipt(
            "isolated-session",
            {"run_id": "agent-run-2", "automation_run_uid": automation_run["run_uid"]},
            status="completed",
        )

        assert observed == {
            "session_id": "source-session",
            "receipt_id": "agent-run-2:automation-source-receipt",
            "receipt_text": "本地自动化验收已完成",
        }

    asyncio.run(scenario())


def test_dsh_shadow_projection_does_not_duplicate_a_persisted_automation_receipt(monkeypatch, tmp_path):
    async def scenario():
        _seed_agent_db(monkeypatch, tmp_path)
        db.create_session("source-session", "dsh-source", "创建自动化")
        db.create_turn("turn-web-receipt", "source-session", 1, "run-web-receipt:user")
        shadow_run = db.create_run(
            "run-web-receipt", "source-session", "turn-web-receipt", "provider", "model"
        )
        db.create_message(
            "agent-run-receipt:automation-source-receipt",
            "source-session",
            None,
            "agent-run-receipt",
            "assistant",
            "automation_receipt",
            {"text": "本地自动化验收已完成"},
        )
        service = AgentService()
        service.shadow_runs["dsh-source"] = shadow_run

        await service._project_shadow_event("dsh-source", {
            "type": "assistant/message",
            "data": {
                "message": {
                    "content": [{"type": "text", "text": "本地自动化验收已完成"}],
                    "source": {
                        "provider": "crawshrimp-automation",
                        "model": "receipt:agent-run-receipt:automation-source-receipt",
                    },
                },
            },
        })

        messages = db.list_messages("source-session")
        assert len(messages) == 1
        assert messages[0]["message_id"] == "agent-run-receipt:automation-source-receipt"

    asyncio.run(scenario())


def test_one_off_receipt_uses_the_claimed_schedule_snapshot_after_definition_edit(monkeypatch, tmp_path):
    async def scenario():
        _seed_agent_db(monkeypatch, tmp_path)
        db.create_session("source-session", "dsh-source", "创建自动化")
        automation = data_sink.create_agent_automation({
            "title": "原始一次性提醒",
            "objective_prompt": "到点后确认完成",
            "automation_kind": "scheduled",
            "context_mode": "isolated",
            "source_session_id": "source-session",
            "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
            "execution_policy": {"toolset": ["automation_record_verification"]},
        })
        claimed = data_sink.claim_agent_automation_run(automation["automation_uid"], "scheduled", "scheduled:original-at")
        run = data_sink.update_agent_automation_run(claimed["run"]["run_uid"], status="completed", agent_run_id="agent-original-at")
        call = db.upsert_tool_call(
            "agent-original-at", "verification-call", "mcp__crawshrimp__automation_record_verification",
            {"result": {"verified": True, "user_message": "原始定时任务已完成"}},
        )
        db.update_tool_call(call["tool_call_id"], status="succeeded")
        # A future edit changes the definition to a periodic schedule. The
        # historical at-run must still produce exactly its own source receipt.
        data_sink.update_agent_automation(
            automation["automation_uid"],
            title="更新后的周期任务",
            schedule={"kind": "every", "interval_seconds": 3600, "timezone": "Asia/Shanghai"},
        )
        service = AgentService()
        service._project_automation_receipt_to_runtime = lambda *_args: asyncio.sleep(0, result=True)

        await service._publish_automation_source_receipt(
            "isolated-session",
            {"run_id": "agent-original-at", "automation_run_uid": run["run_uid"]},
            status="completed",
        )

        messages = db.list_messages("source-session")
        assert len(messages) == 1
        assert json.loads(messages[0]["content_json"])["text"] == "原始定时任务已完成"

    asyncio.run(scenario())


def test_unprojected_agent_failure_does_not_send_a_premature_source_receipt(monkeypatch, tmp_path):
    async def scenario():
        _seed_agent_db(monkeypatch, tmp_path)
        db.create_session("source-session", "dsh-source", "创建自动化")
        automation = data_sink.create_agent_automation({
            "title": "本地自动化回执验收",
            "objective_prompt": "到时只确认验收完成",
            "automation_kind": "scheduled",
            "context_mode": "isolated",
            "source_session_id": "source-session",
            "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
            "execution_policy": {"toolset": ["automation_record_verification"]},
        })
        claimed = data_sink.claim_agent_automation_run(automation["automation_uid"], "scheduled", "scheduled:pending")
        run = data_sink.update_agent_automation_run(claimed["run"]["run_uid"], agent_run_id="agent-pending")
        service = AgentService()
        delivered = []

        async def project(*args):
            delivered.append(args)
            return True

        service._project_automation_receipt_to_runtime = project
        await service._publish_automation_source_receipt(
            "isolated-session",
            {"run_id": "agent-pending", "automation_run_uid": run["run_uid"]},
            status="failed",
        )

        assert delivered == []
        assert db.list_messages("source-session") == []
        assert data_sink.get_agent_automation_run(run["run_uid"])["status"] == "claimed"

    asyncio.run(scenario())


def test_busy_source_receipt_is_persisted_and_recovers_without_replaying_the_automation(monkeypatch, tmp_path):
    async def scenario():
        _seed_agent_db(monkeypatch, tmp_path)
        db.create_session("source-session", "dsh-source", "创建自动化")
        automation = data_sink.create_agent_automation({
            "title": "库存核对回执",
            "objective_prompt": "核对完成后告知用户",
            "automation_kind": "scheduled",
            "context_mode": "isolated",
            "source_session_id": "source-session",
            "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
            "execution_policy": {"toolset": ["automation_record_verification"]},
        })
        claimed = data_sink.claim_agent_automation_run(automation["automation_uid"], "scheduled", "scheduled:库存核对")
        run = data_sink.update_agent_automation_run(
            claimed["run"]["run_uid"], status="completed", agent_run_id="agent-库存核对",
        )
        call = db.upsert_tool_call(
            "agent-库存核对", "verification-call", "mcp__crawshrimp__automation_record_verification",
            {"result": {"verified": True, "user_message": "库存核对已完成"}},
        )
        db.update_tool_call(call["tool_call_id"], status="succeeded")
        service = AgentService()
        service._project_automation_receipt_to_runtime = lambda *_args: asyncio.sleep(0, result=False)
        await service._publish_automation_source_receipt(
            "isolated-session", {"run_id": "agent-库存核对", "automation_run_uid": run["run_uid"]}, status="completed",
        )
        assert data_sink.get_agent_automation_run(run["run_uid"])["notification_status"] == "pending_source_receipt"
        assert db.list_messages("source-session") == []
        retry_tasks = list(service._automation_receipt_retry_tasks.values())
        for task in retry_tasks:
            task.cancel()
        await asyncio.gather(*retry_tasks, return_exceptions=True)

        delivered = {}

        async def project(session_id, receipt_id, receipt_text):
            delivered.update({"session_id": session_id, "receipt_id": receipt_id, "text": receipt_text})
            return True

        service._project_automation_receipt_to_runtime = project
        await service.recover_automation_receipts()
        assert delivered == {
            "session_id": "source-session",
            "receipt_id": "agent-库存核对:automation-source-receipt",
            "text": "库存核对已完成",
        }
        assert data_sink.get_agent_automation_run(run["run_uid"])["notification_status"] == "delivered"
        assert len(db.list_messages("source-session")) == 1

    asyncio.run(scenario())


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
            "automation_policy": {"toolset": ["automation_record_observation"]},
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


def test_registered_mcp_tools_enforce_the_exact_automation_toolset_before_tool_execution():
    class Controller:
        def __init__(self):
            self.calls = []

        def mark_needs_review(self, *args):
            self.calls.append(args)

    controller = Controller()
    previous = mcp_gateway.ctx.automation_controller
    mcp_gateway.set_automation_controller(controller)
    token = mcp_gateway.bind_tool_context({
        "active_run": {"run_id": "agent-受限", "session_id": "s"},
        "grant": None,
        "current_tool_call_id": "",
        "automation_policy": {"toolset": ["automation_record_verification"]},
        "automation_run_uid": "automation-run-受限",
    })
    try:
        server = mcp_gateway.create_agent_mcp_server()
        # This invokes the registered MCP callable, not tool_fs_read directly;
        # the wrapper keeps its original schema but rejects before touching disk.
        result = asyncio.run(server._tool_manager._tools["fs_read"].fn("/does-not-matter"))
    finally:
        mcp_gateway.reset_tool_context(token)
        mcp_gateway.set_automation_controller(previous)

    assert result["ok"] is False
    assert result["error"]["code"] == "AUTOMATION_TOOL_DENIED"
    assert controller.calls == [
        ("automation-run-受限", "AUTOMATION_TOOL_DENIED", "Automation policy does not authorize MCP tool fs_read"),
    ]
