import asyncio
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from zoneinfo import ZoneInfo

from core import data_sink
from core import scheduler as sched_module
from core.automation_controller import AutomationController


def _use_temp_product_db(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr("core.runtime_paths.data_root", lambda: tmp_path)
    data_sink.init_db()


def _reset_scheduler() -> None:
    try:
        if sched_module._scheduler and sched_module._scheduler.running:
            sched_module._scheduler.shutdown(wait=False)
    except Exception:
        pass
    sched_module._scheduler = None
    sched_module._task_callbacks.clear()
    sched_module._automation_callbacks.clear()


@pytest.fixture(autouse=True)
def _clean_scheduler():
    _reset_scheduler()
    yield
    _reset_scheduler()


def _run(coro):
    return asyncio.run(coro)


def _program() -> dict:
    return {
        "config": {"reorder_point": 20},
        "branches": [
            {
                "id": "restock",
                "priority": 10,
                "when": {
                    "all": [
                        {"lt": [{"path": "facts.inventory.available"}, {"path": "config.reorder_point"}]},
                        {"gt": [{"path": "facts.sales.last_7_days"}, 0]},
                    ]
                },
                "allowed_capabilities": ["write_workspace", "notify"],
            }
        ],
    }


class _Executors:
    def __init__(self):
        self.observer_calls = []
        self.action_calls = []

    async def observe(self, automation, run, policy):
        self.observer_calls.append((automation["automation_uid"], run["run_uid"], policy))

    async def act(self, automation, run, branch, toolset):
        self.action_calls.append((run["run_uid"], branch["id"], list(toolset)))


def _controller_with_loop(monkeypatch, tmp_path, *, toolset=None, next_run_at=""):
    _use_temp_product_db(monkeypatch, tmp_path)
    values = {
        "automation_uid": "auto-loop",
        "title": "库存循环",
        "objective_prompt": "持续观察库存",
        "automation_kind": "loop",
        "context_mode": "isolated",
        "schedule": {},
        "loop_policy": {"cycle_interval_seconds": 60},
        "execution_policy": {
            "toolset": toolset or ["observe", "write_workspace", "notify"],
            "timeout_seconds": 300,
        },
        "next_run_at": next_run_at,
    }
    automation = data_sink.create_agent_automation(values)
    version = data_sink.create_agent_automation_program(automation["automation_uid"], _program())
    automation = data_sink.update_agent_automation(
        automation["automation_uid"],
        active_program_version_uid=version["program_version_uid"],
    )
    executors = _Executors()
    controller = AutomationController(
        None,
        sched_module,
        observer_executor=executors.observe,
        action_executor=executors.act,
    )
    controller._test_executors = executors
    return controller, automation


def _controller_with_overdue_schedule(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    automation = data_sink.create_agent_automation({
        "automation_uid": "auto-overdue",
        "title": "过期计划",
        "objective_prompt": "检查库存",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {
            "kind": "at",
            "value": "2026-09-05T08:00:00+08:00",
            "timezone": "Asia/Shanghai",
        },
        "execution_policy": {"toolset": ["observe", "notify"]},
        "next_run_at": "2026-09-05T08:00:00+08:00",
    })
    executors = _Executors()
    controller = AutomationController(
        None,
        sched_module,
        observer_executor=executors.observe,
        action_executor=executors.act,
    )
    controller._test_executors = executors
    return controller, automation


def test_loop_rearms_only_after_verified_checkpoint(monkeypatch, tmp_path):
    controller, automation = _controller_with_loop(monkeypatch, tmp_path)

    claimed = _run(controller.run_now(automation["automation_uid"]))
    _run(controller.record_observation(
        claimed["run_uid"],
        {"inventory": {"available": 5}, "sales": {"last_7_days": 1}},
        [],
    ))

    assert controller._test_executors.action_calls == [
        (claimed["run_uid"], "restock", ["notify", "write_workspace"])
    ]
    assert data_sink.get_agent_automation(automation["automation_uid"])["next_run_at"] == ""

    _run(controller.record_verification(claimed["run_uid"], {"verified": True}))
    assert data_sink.get_agent_automation(automation["automation_uid"])["next_run_at"]


def test_restore_marks_overdue_schedule_missed_without_running_executor(monkeypatch, tmp_path):
    controller, automation = _controller_with_overdue_schedule(monkeypatch, tmp_path)

    controller.restore(now="2026-09-05T09:00:00+08:00")

    assert controller._test_executors.action_calls == []
    assert controller._test_executors.observer_calls == []
    assert data_sink.list_agent_automation_runs(automation["automation_uid"], 1)[0]["status"] == "missed"


def test_scheduler_uses_iana_timezone_for_cron_and_isolated_job_id():
    automation = {
        "automation_uid": "cron-1",
        "automation_kind": "scheduled",
        "enabled": 1,
        "archived": 0,
        "schedule": {"kind": "cron", "value": "30 9 * * 1-5", "timezone": "America/New_York"},
    }
    sched_module.register_automation_schedule(automation, lambda _uid: None)

    job = sched_module.get_scheduler().get_job("automation::cron-1")
    assert job is not None
    assert job.trigger.timezone == ZoneInfo("America/New_York")
    assert sched_module.list_automation_next_runs()[0]["automation_uid"] == "cron-1"


def test_scheduler_every_uses_persisted_anchor_and_skips_past_boundaries():
    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    anchor = (now - timedelta(minutes=25)).isoformat()
    automation = {
        "automation_uid": "every-1",
        "automation_kind": "scheduled",
        "enabled": 1,
        "archived": 0,
        "schedule": {
            "kind": "every",
            "seconds": 600,
            "anchor": anchor,
            "timezone": "Asia/Shanghai",
        },
        "next_run_at": anchor,
    }
    sched_module.register_automation_schedule(automation, lambda _uid: None)

    job = sched_module.get_scheduler().get_job("automation::every-1")
    assert job is not None
    assert job.trigger.start_date > now
    assert job.trigger.start_date - now < timedelta(minutes=10, seconds=2)


def test_single_flight_marks_overlap_and_excludes_new_claim(monkeypatch, tmp_path):
    controller, automation = _controller_with_loop(monkeypatch, tmp_path)
    first = data_sink.create_agent_automation_run(
        automation["automation_uid"], "manual", "existing", status="running"
    )

    second = _run(controller._claim_and_start(
        automation["automation_uid"], "manual", "new-trigger", "2026-09-05T09:00:00+08:00"
    ))

    assert second["status"] == "skipped_overlap"
    assert controller._test_executors.observer_calls == []
    assert data_sink.has_active_agent_automation_run(
        automation["automation_uid"], exclude_run_uid=first["run_uid"]
    ) is False


def test_no_matching_branch_never_calls_action(monkeypatch, tmp_path):
    controller, automation = _controller_with_loop(monkeypatch, tmp_path)
    run = _run(controller.run_now(automation["automation_uid"]))

    _run(controller.record_observation(
        run["run_uid"],
        {"inventory": {"available": 99}, "sales": {"last_7_days": 0}},
        [],
    ))

    assert controller._test_executors.action_calls == []
    assert data_sink.get_agent_automation_run(run["run_uid"])["matched_branch"] == ""


def test_loop_no_match_completes_and_rearms_with_checkpoint(monkeypatch, tmp_path):
    controller, automation = _controller_with_loop(monkeypatch, tmp_path)
    program = {
        **_program(),
        "checkpoint": {"last_available": {"path": "facts.inventory.available"}},
    }
    version = data_sink.create_agent_automation_program(automation["automation_uid"], program)
    data_sink.update_agent_automation(
        automation["automation_uid"],
        active_program_version_uid=version["program_version_uid"],
    )

    run = _run(controller.run_now(automation["automation_uid"]))
    result = _run(controller.record_observation(
        run["run_uid"],
        {"inventory": {"available": 99}, "sales": {"last_7_days": 0}},
        [],
    ))

    assert result["status"] == "completed"
    assert result["matched_branch"] == ""
    assert result["checkpoint_after"] == {"last_available": 99}
    persisted = data_sink.get_agent_automation(automation["automation_uid"])
    assert persisted["checkpoint"] == {"last_available": 99}
    assert persisted["next_run_at"]
    assert sched_module.get_scheduler().get_job("automation::auto-loop") is not None
    assert controller._test_executors.action_calls == []


def test_bad_verification_does_not_commit_checkpoint_or_rearm(monkeypatch, tmp_path):
    controller, automation = _controller_with_loop(monkeypatch, tmp_path)
    run = _run(controller.run_now(automation["automation_uid"]))
    _run(controller.record_observation(
        run["run_uid"],
        {"inventory": {"available": 5}, "sales": {"last_7_days": 1}},
        [],
    ))

    result = _run(controller.record_verification(run["run_uid"], {"verified": False}))

    assert result["status"] == "needs_review"
    assert data_sink.get_agent_automation(automation["automation_uid"])["next_run_at"] == ""
    assert data_sink.get_agent_automation(automation["automation_uid"])["checkpoint"] == {}


def test_completed_observer_without_mapping_facts_needs_review(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    automation = data_sink.create_agent_automation({
        "automation_uid": "auto-no-facts",
        "title": "无事实",
        "objective_prompt": "观察",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {},
        "execution_policy": {"toolset": ["observe"]},
    })
    version = data_sink.create_agent_automation_program(automation["automation_uid"], _program())
    automation = data_sink.update_agent_automation(
        automation["automation_uid"], active_program_version_uid=version["program_version_uid"]
    )

    async def completed_observer(_automation, _run, _policy):
        return {"status": "completed"}

    controller = AutomationController(None, sched_module, observer_executor=completed_observer)
    run = _run(controller.run_now(automation["automation_uid"]))

    assert run["status"] == "needs_review"
    assert data_sink.get_agent_automation_run(run["run_uid"])["error_code"] == "OBSERVATION_FACTS_REQUIRED"


def test_restore_marks_overdue_loop_missed_and_does_not_rehydrate_job(monkeypatch, tmp_path):
    future = "2026-09-05T10:00:00+08:00"
    controller, automation = _controller_with_loop(monkeypatch, tmp_path, next_run_at=future)
    overdue = "2026-09-05T08:00:00+08:00"
    data_sink.update_agent_automation(automation["automation_uid"], next_run_at=overdue)

    controller.restore(now="2026-09-05T09:00:00+08:00")

    run = data_sink.list_agent_automation_runs(automation["automation_uid"], 1)[0]
    assert run["status"] == "missed"
    assert sched_module.get_scheduler().get_job("automation::auto-loop") is None


def test_unregister_automation_schedule_is_cancellation_safe(monkeypatch):
    automation = {
        "automation_uid": "cancel-1",
        "automation_kind": "scheduled",
        "enabled": 1,
        "archived": 0,
        "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
    }
    sched_module.register_automation_schedule(automation, lambda _uid: None)
    assert sched_module.unregister_automation_schedule("cancel-1") == 1
    assert sched_module.unregister_automation_schedule("cancel-1") == 0
    assert sched_module.get_scheduler().get_job("automation::cancel-1") is None
