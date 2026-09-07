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
    sched_module._automation_retry_callbacks.clear()
    sched_module._automation_retry_callback_tokens.clear()


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
                "allowed_tools": ["automation_record_verification"],
            }
        ],
    }


@pytest.mark.parametrize(("initial_mode", "requested_mode"), [
    ("isolated", "inherited"),
    ("inherited", "isolated"),
])
def test_context_mode_is_immutable_at_the_controller_boundary(
    monkeypatch, tmp_path, initial_mode, requested_mode,
):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    automation = controller.create({
        "title": "上下文边界",
        "objective_prompt": "保持创建时的会话隔离语义",
        "automation_kind": "scheduled",
        "context_mode": initial_mode,
        "source_session_id": "source-session" if initial_mode == "inherited" else "",
        "source_runtime_session_id": "source-runtime" if initial_mode == "inherited" else "",
        "schedule": {
            "kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai",
        },
        "execution_policy": {"toolset": ["automation_record_verification"]},
        "enabled": False,
    })

    with pytest.raises(ValueError, match="context_mode is immutable"):
        controller.update(automation["automation_uid"], {"context_mode": requested_mode})

    stored = data_sink.get_agent_automation(automation["automation_uid"])
    assert stored["context_mode"] == initial_mode


class _Executors:
    def __init__(self):
        self.observer_calls = []
        self.action_calls = []

    async def observe(self, automation, run, policy):
        self.observer_calls.append((automation["automation_uid"], run["run_uid"], policy))

    async def act(self, automation, run, branch, toolset):
        self.action_calls.append((run["run_uid"], branch["id"], list(toolset)))


def _controller_with_loop(monkeypatch, tmp_path, *, toolset=None, next_run_at="", failure_threshold=None):
    _use_temp_product_db(monkeypatch, tmp_path)
    values = {
        "automation_uid": "auto-loop",
        "title": "库存循环",
        "objective_prompt": "持续观察库存",
        "automation_kind": "loop",
        "context_mode": "isolated",
        "schedule": {},
        "loop_policy": {
            "cycle_interval_seconds": 60,
            **({"failure_threshold": failure_threshold} if failure_threshold is not None else {}),
        },
        "execution_policy": {
            "toolset": toolset or ["automation_record_observation", "automation_record_verification"],
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
        "execution_policy": {"toolset": ["automation_record_verification"]},
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
        (claimed["run_uid"], "restock", ["automation_record_verification"])
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


def test_restore_does_not_replay_an_overdue_retry_after_the_backend_was_offline(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    automation = controller.create({
        "title": "离线期间的重试",
        "objective_prompt": "只恢复下一次正常周期",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {
            "kind": "every",
            "interval_seconds": 3600,
            "anchor": now.isoformat(),
            "timezone": "Asia/Shanghai",
        },
        "execution_policy": {"toolset": ["automation_record_verification"]},
    }, now=now)
    retry = data_sink.create_agent_automation_run(
        automation["automation_uid"], "scheduled", "scheduled:failed-attempt", status="retry_scheduled",
    )
    data_sink.update_agent_automation(
        automation["automation_uid"],
        retry_at=(now - timedelta(minutes=2)).isoformat(),
    )
    sched_module.unregister_automation_schedule(automation["automation_uid"])

    controller.restore(now=now)

    stored = data_sink.get_agent_automation_run(retry["run_uid"])
    restored = data_sink.get_agent_automation(automation["automation_uid"])
    assert stored["status"] == "needs_review"
    assert stored["error_code"] == "RETRY_MISSED_WHILE_OFFLINE"
    assert restored["retry_at"] == ""
    assert sched_module.get_scheduler().get_job(f"automation-retry::{automation['automation_uid']}") is None
    assert sched_module.get_scheduler().get_job(f"automation::{automation['automation_uid']}") is not None


def test_create_rejects_a_one_time_schedule_that_has_already_passed(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)

    with pytest.raises(ValueError, match="must be in the future"):
        controller.create({
            "title": "本地自动化验收提醒",
            "objective_prompt": "到点后仅确认验收完成",
            "automation_kind": "scheduled",
            "context_mode": "isolated",
            "schedule": {
                "kind": "at",
                "value": "2026-09-06T00:01:00+08:00",
                "timezone": "Asia/Shanghai",
            },
            "execution_policy": {"toolset": ["automation_record_verification"]},
        }, now="2026-09-06T00:03:00+08:00")


def test_completed_one_time_automation_allows_metadata_edits_without_rescheduling(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    automation = controller.create({
        "title": "本地自动化验收提醒",
        "objective_prompt": "到点后仅确认验收完成",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {
            "kind": "at",
            "value": "2026-09-06T00:05:00+08:00",
            "timezone": "Asia/Shanghai",
        },
        "execution_policy": {"toolset": ["automation_record_verification"]},
    }, now="2026-09-06T00:00:00+08:00")
    data_sink.update_agent_automation(
        automation["automation_uid"],
        last_triggered_at="2026-09-06T00:05:00+08:00",
        next_run_at="",
    )

    updated = controller.update(
        automation["automation_uid"],
        {
            "title": "本地自动化验收提醒（已完成）",
            # Browser datetime-local returns this offset-free representation
            # even though it names the same Shanghai instant.
            "schedule": {"kind": "at", "value": "2026-09-06T00:05", "timezone": "Asia/Shanghai"},
        },
        now="2026-09-06T00:30:00+08:00",
    )

    assert updated["title"] == "本地自动化验收提醒（已完成）"
    assert updated["schedule"]["value"] == "2026-09-06T00:05:00+08:00"


def test_resuming_an_overdue_paused_one_time_automation_records_missed_without_replaying(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    due = datetime.now(ZoneInfo("Asia/Shanghai")) - timedelta(minutes=2)
    automation = controller.create({
        "title": "错过的一次性提醒",
        "objective_prompt": "过期时不应静默补跑",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "at", "value": due.isoformat(), "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_verification"]},
        "enabled": False,
    }, now=due - timedelta(minutes=1))

    resumed = controller.resume(automation["automation_uid"])

    assert resumed["enabled"] == 0
    assert resumed["last_status"] == "missed"
    assert resumed["last_error"] == "MISSED_WHILE_OFFLINE"
    runs = data_sink.list_agent_automation_runs(automation["automation_uid"], 1)
    assert runs[0]["status"] == "missed"
    assert sched_module.get_scheduler().get_job(f"automation::{automation['automation_uid']}") is None


def test_editing_one_time_schedule_still_requires_a_future_time(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    automation = controller.create({
        "title": "本地自动化验收提醒",
        "objective_prompt": "到点后仅确认验收完成",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {
            "kind": "at",
            "value": "2026-09-06T01:00:00+08:00",
            "timezone": "Asia/Shanghai",
        },
        "execution_policy": {"toolset": ["automation_record_verification"]},
    }, now="2026-09-06T00:00:00+08:00")

    with pytest.raises(ValueError, match="must be in the future"):
        controller.update(
            automation["automation_uid"],
            {"schedule": {"kind": "at", "value": "2026-09-06T00:05:00+08:00", "timezone": "Asia/Shanghai"}},
            now="2026-09-06T00:30:00+08:00",
        )


@pytest.mark.parametrize(
    ("loop_policy", "message"),
    [
        ({"cycle_interval_seconds": 0}, "cycle_interval_seconds"),
        ({"cycle_interval_seconds": 60, "max_cycles": "not-a-number"}, "max_cycles"),
        ({"cycle_interval_seconds": 60, "failure_threshold": "not-a-number"}, "failure_threshold"),
    ],
)
def test_loop_policy_rejects_invalid_controls_before_a_run_can_crash(monkeypatch, tmp_path, loop_policy, message):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)

    with pytest.raises(ValueError, match=message):
        controller.create({
            "title": "无效闭环控制",
            "objective_prompt": "不能把不安全配置写入运行时",
            "automation_kind": "loop",
            "context_mode": "isolated",
            "loop_policy": loop_policy,
            "execution_policy": {"toolset": ["automation_record_observation"]},
            "program": _program(),
            "enabled": False,
        })


def test_loop_policy_edit_preserves_the_durable_failure_streak_when_omitted(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    automation = controller.create({
        "title": "保留熔断状态",
        "objective_prompt": "编辑未来配置不能重置失败记录",
        "automation_kind": "loop",
        "context_mode": "isolated",
        "loop_policy": {"cycle_interval_seconds": 60, "failure_threshold": 3},
        "execution_policy": {"toolset": ["automation_record_observation"]},
        "program": _program(),
        "enabled": False,
    })
    data_sink.update_agent_automation(
        automation["automation_uid"],
        loop_policy={**automation["loop_policy"], "failure_count": 2},
    )

    updated = controller.update(automation["automation_uid"], {
        "loop_policy": {"cycle_interval_seconds": 300, "max_cycles": 12, "failure_threshold": 3},
    })

    assert updated["loop_policy"]["cycle_interval_seconds"] == 300
    assert updated["loop_policy"]["failure_count"] == 2


@pytest.mark.parametrize("field", ["enabled", "archived"])
def test_controller_rejects_ambiguous_string_lifecycle_flags(monkeypatch, tmp_path, field):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)

    with pytest.raises(ValueError, match=field):
        controller.create({
            "title": "不能意外启用的自动化",
            "objective_prompt": "拒绝模糊的生命周期配置",
            "automation_kind": "scheduled",
            "context_mode": "isolated",
            "schedule": {
                "kind": "at",
                "value": "2026-09-06T12:00:00+08:00",
                "timezone": "Asia/Shanghai",
            },
            "execution_policy": {"toolset": ["automation_record_verification"]},
            field: "false",
        }, now="2026-09-06T08:00:00+08:00")


def test_controller_rejects_unknown_unattended_risk_values(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)

    with pytest.raises(ValueError, match="allowed_risks"):
        controller.create({
            "title": "风险类别必须明确",
            "objective_prompt": "拒绝无法执行的无人值守授权",
            "automation_kind": "scheduled",
            "context_mode": "isolated",
            "schedule": {
                "kind": "at",
                "value": "2026-09-06T12:00:00+08:00",
                "timezone": "Asia/Shanghai",
            },
            "execution_policy": {
                "toolset": ["task_run"],
                "allowed_risks": ["mistyped_risk"],
            },
        }, now="2026-09-06T08:00:00+08:00")


def test_scheduler_rejects_fractional_every_interval_instead_of_truncating_it():
    with pytest.raises(ValueError, match="positive integer"):
        sched_module._automation_trigger({
            "automation_kind": "scheduled",
            "schedule": {"kind": "every", "interval_seconds": 1.5, "timezone": "Asia/Shanghai"},
        })


def test_editing_one_time_schedule_replaces_the_persisted_trigger_cursor(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    automation = controller.create({
        "title": "可改期的一次性提醒",
        "objective_prompt": "只在新时间运行",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "at", "value": "2026-09-06T10:00:00+08:00", "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_verification"]},
    }, now="2026-09-06T08:00:00+08:00")

    updated = controller.update(
        automation["automation_uid"],
        {"schedule": {"kind": "at", "value": "2026-09-06T11:00:00+08:00", "timezone": "Asia/Shanghai"}},
        now="2026-09-06T08:05:00+08:00",
    )

    assert updated["next_run_at"].startswith("2026-09-06T11:00:00")
    job = sched_module.get_scheduler().get_job(f"automation::{automation['automation_uid']}")
    assert job is not None


def test_switching_a_scheduled_automation_to_a_loop_discards_its_old_at_cursor(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    automation = controller.create({
        "title": "从定时改为闭环",
        "objective_prompt": "按新的闭环节奏观察",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "at", "value": "2026-09-06T12:00:00+08:00", "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_observation", "automation_record_verification"]},
        "program": _program(),
    }, now="2026-09-06T08:00:00+08:00")

    updated = controller.update(
        automation["automation_uid"],
        {
            "automation_kind": "loop",
            "schedule": {"timezone": "Asia/Shanghai"},
            "loop_policy": {"cycle_interval_seconds": 300},
        },
        now="2026-09-06T08:05:00+08:00",
    )

    assert updated["automation_kind"] == "loop"
    assert "kind" not in updated["schedule"]
    assert updated["next_run_at"].startswith("2026-09-06T08:10:00")
    job = sched_module.get_scheduler().get_job(f"automation::{automation['automation_uid']}")
    assert job is not None


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
        automation["automation_uid"], "loop", "loop:2", "2026-09-05T09:00:00+08:00"
    ))

    assert second["status"] == "skipped_overlap"
    assert controller._test_executors.observer_calls == []
    assert data_sink.has_active_agent_automation_run(
        automation["automation_uid"], exclude_run_uid=first["run_uid"]
    ) is False
    assert data_sink.get_agent_automation(automation["automation_uid"])["cycle_seq"] == 0


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


def test_observer_policy_excludes_arbitrary_browser_javascript(monkeypatch, tmp_path):
    controller, automation = _controller_with_loop(
        monkeypatch,
        tmp_path,
        toolset=["browser_observe", "browser_eval", "browser_verify", "automation_record_observation"],
    )

    _run(controller.run_now(automation["automation_uid"]))

    observed_policy = controller._test_executors.observer_calls[0][2]
    assert observed_policy["toolset"] == ["automation_record_observation", "browser_observe"]


def test_scheduled_program_no_match_commits_checkpoint_for_the_next_cycle(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)

    async def observer(_automation, _run, _policy):
        return None

    controller = AutomationController(None, sched_module, observer_executor=observer)
    automation = controller.create({
        "title": "每日库存阈值检查",
        "objective_prompt": "连续检查库存是否低于阈值",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "every", "interval_seconds": 3600, "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_observation"]},
        "program": {
            "branches": [{
                "id": "库存不足",
                "when": {"lt": [{"path": "facts.inventory.available"}, 20]},
                "allowed_tools": ["automation_record_observation"],
            }],
            "checkpoint": {"last_available": {"path": "facts.inventory.available"}},
        },
    })

    first = _run(controller.run_now(automation["automation_uid"], request_uid="首次库存检查"))
    result = _run(controller.record_observation(
        first["run_uid"], {"inventory": {"available": 99}}, [],
    ))

    assert result["status"] == "completed"
    assert data_sink.get_agent_automation(automation["automation_uid"])["checkpoint"] == {"last_available": 99}
    second = _run(controller.run_now(automation["automation_uid"], request_uid="第二次库存检查"))
    assert second["checkpoint_before"] == {"last_available": 99}


def test_successful_scheduled_program_resets_its_failure_streak(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)

    async def observer(_automation, _run, _policy):
        return {"facts": {"inventory": {"available": 99}}}

    controller = AutomationController(None, sched_module, observer_executor=observer)
    automation = controller.create({
        "title": "定时库存检查",
        "objective_prompt": "观察库存",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "every", "interval_seconds": 3600, "timezone": "Asia/Shanghai"},
        "loop_policy": {"failure_threshold": 3, "failure_count": 2},
        "execution_policy": {"toolset": ["automation_record_observation"]},
        "program": {
            "branches": [{
                "id": "库存不足",
                "when": {"lt": [{"path": "facts.inventory.available"}, 20]},
                "allowed_tools": ["automation_record_observation"],
            }],
        },
    })

    completed = _run(controller.run_now(automation["automation_uid"], request_uid="成功重置失败计数"))

    assert completed["status"] == "completed"
    assert data_sink.get_agent_automation(automation["automation_uid"])["loop_policy"]["failure_count"] == 0


def test_inflight_program_and_policy_use_the_claimed_snapshot(monkeypatch, tmp_path):
    controller, automation = _controller_with_loop(monkeypatch, tmp_path)
    run = _run(controller.run_now(automation["automation_uid"]))
    replacement = data_sink.create_agent_automation_program(automation["automation_uid"], {
        "branches": [{"id": "新规则", "when": {"eq": [False, True]}}],
    })
    data_sink.update_agent_automation(
        automation["automation_uid"],
        active_program_version_uid=replacement["program_version_uid"],
        execution_policy={"toolset": ["automation_record_observation"]},
    )

    _run(controller.record_observation(
        run["run_uid"],
        {"inventory": {"available": 1}, "sales": {"last_7_days": 1}},
        [],
    ))

    assert controller._test_executors.action_calls == [
        (run["run_uid"], "restock", ["automation_record_verification"]),
    ]


def test_queued_program_action_does_not_complete_before_verification(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)

    class Agent:
        def __init__(self):
            self.calls = 0

        async def submit_automation_turn(self, _automation, _run, _prompt, _toolset):
            self.calls += 1
            return {"run_id": f"agent-条件行动-{self.calls}", "session_id": "automation-session", "status": "queued"}

    controller = AutomationController(Agent(), sched_module)
    automation = controller.create({
        "title": "低库存后续处理",
        "objective_prompt": "观察库存并处理低库存",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_observation", "automation_record_verification"]},
        "program": _program(),
    })
    run = _run(controller.run_now(automation["automation_uid"], request_uid="低库存条件行动"))

    after_observation = _run(controller.record_observation(
        run["run_uid"], {"inventory": {"available": 1}, "sales": {"last_7_days": 1}}, [],
    ))

    assert after_observation["status"] == "queued"
    assert after_observation["agent_run_id"] == "agent-条件行动-2"
    assert data_sink.get_agent_automation(automation["automation_uid"])["enabled"] == 1

    terminal = controller.project_agent_run_terminal(
        run["run_uid"], "agent-条件行动-2", "completed",
    )
    assert terminal["status"] == "needs_review"
    assert terminal["error_code"] == "VERIFICATION_EVIDENCE_REQUIRED"


def test_inflight_failure_retry_keeps_its_claimed_policy_snapshot(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)

    class Agent:
        async def submit_automation_turn(self, _automation, _run, _prompt, _toolset):
            return {"run_id": "agent-重试快照", "session_id": "automation-session", "status": "queued"}

    controller = AutomationController(Agent(), sched_module)
    automation = controller.create({
        "title": "网络重试快照",
        "objective_prompt": "读取结果后回执",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "every", "interval_seconds": 3600, "timezone": "Asia/Shanghai"},
        "execution_policy": {
            "toolset": ["automation_record_verification"],
            "max_retries": 1,
            "retry_backoff_seconds": 7,
        },
    })
    run = _run(controller.run_now(automation["automation_uid"], request_uid="网络重试快照"))
    data_sink.update_agent_automation(
        automation["automation_uid"],
        execution_policy={"toolset": ["automation_record_verification"], "max_retries": 0},
    )

    retried = controller.project_agent_run_terminal(
        run["run_uid"], "agent-重试快照", "failed",
        error_code="NETWORK_ERROR", error_message="网络暂时不可用", retryable=True,
    )

    assert retried["status"] == "retry_scheduled"
    assert retried["attempt"] == 1
    retry_at = datetime.fromisoformat(data_sink.get_agent_automation(automation["automation_uid"])["retry_at"])
    assert 1 <= (retry_at - datetime.now(retry_at.tzinfo)).total_seconds() <= 10


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


def test_old_loop_run_does_not_write_its_policy_over_a_new_definition(monkeypatch, tmp_path):
    controller, automation = _controller_with_loop(monkeypatch, tmp_path)
    version = data_sink.create_agent_automation_program(automation["automation_uid"], {
        **_program(),
        "checkpoint": {"last_available": {"path": "facts.inventory.available"}},
    })
    data_sink.update_agent_automation(
        automation["automation_uid"], active_program_version_uid=version["program_version_uid"],
    )
    run = _run(controller.run_now(automation["automation_uid"], request_uid="旧循环运行"))
    controller.update(automation["automation_uid"], {
        "loop_policy": {
            "cycle_interval_seconds": 3600,
            "max_cycles": 12,
            "failure_threshold": 9,
        },
    })

    completed = _run(controller.record_observation(
        run["run_uid"], {"inventory": {"available": 99}, "sales": {"last_7_days": 0}}, [],
    ))

    assert completed["status"] == "completed"
    persisted = data_sink.get_agent_automation(automation["automation_uid"])
    assert persisted["loop_policy"]["cycle_interval_seconds"] == 3600
    assert persisted["loop_policy"]["max_cycles"] == 12
    assert persisted["loop_policy"]["failure_threshold"] == 9


def test_old_recurring_run_cannot_disable_a_replaced_one_time_schedule(monkeypatch, tmp_path):
    """A terminal old Run must not mutate a replacement definition."""
    _use_temp_product_db(monkeypatch, tmp_path)

    class Agent:
        async def submit_automation_turn(self, _automation, _run, _prompt, _toolset):
            return {"run_id": "agent-old-recurring", "session_id": "automation-session", "status": "queued"}

    controller = AutomationController(Agent(), sched_module)
    automation = controller.create({
        "title": "原来的周期检查",
        "objective_prompt": "完成后给出验证",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "every", "interval_seconds": 3600, "timezone": "Asia/Shanghai"},
        "loop_policy": {"failure_count": 2},
        "execution_policy": {"toolset": ["automation_record_verification"]},
    }, now="2026-09-06T08:00:00+08:00")

    old_run = _run(controller._claim_and_start(
        automation["automation_uid"],
        "scheduled",
        "scheduled:2026-09-06T09:00:00+08:00",
        "2026-09-06T09:00:00+08:00",
    ))
    updated = controller.update(
        automation["automation_uid"],
        {
            "schedule": {
                "kind": "at",
                "value": "2099-01-01T10:00:00+08:00",
                "timezone": "Asia/Shanghai",
            },
            "loop_policy": {"definition_version": "replacement"},
        },
        now="2026-09-06T09:01:00+08:00",
    )
    assert updated["next_run_at"].startswith("2099-01-01T10:00:00")

    completed = _run(controller.record_verification(old_run["run_uid"], {"verified": True}))

    assert completed["status"] == "completed"
    persisted = data_sink.get_agent_automation(automation["automation_uid"])
    assert persisted["enabled"] == 1
    assert persisted["next_run_at"].startswith("2099-01-01T10:00:00")
    assert persisted["loop_policy"] == {"failure_count": 2, "definition_version": "replacement"}
    assert sched_module.get_scheduler().get_job(f"automation::{automation['automation_uid']}") is not None


def test_definition_change_cancels_a_pending_retry_from_its_old_schedule(monkeypatch, tmp_path):
    """A retry belongs to its original definition, never the replacement."""
    _use_temp_product_db(monkeypatch, tmp_path)

    class Agent:
        async def submit_automation_turn(self, _automation, _run, _prompt, _toolset):
            return {"run_id": "agent-old-retry", "session_id": "automation-session", "status": "queued"}

    controller = AutomationController(Agent(), sched_module)
    automation = controller.create({
        "title": "旧计划的重试",
        "objective_prompt": "失败后允许重试",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "every", "interval_seconds": 3600, "timezone": "Asia/Shanghai"},
        "execution_policy": {
            "toolset": ["automation_record_verification"],
            "max_retries": 1,
            "retry_backoff_seconds": 60,
        },
    }, now="2026-09-06T08:00:00+08:00")
    old_run = _run(controller.run_now(automation["automation_uid"], request_uid="旧计划首次运行"))

    retried = controller.project_agent_run_terminal(
        old_run["run_uid"], "agent-old-retry", "failed",
        error_code="NETWORK_ERROR", error_message="网络暂时不可用", retryable=True,
    )
    assert retried["status"] == "retry_scheduled"
    assert data_sink.get_agent_automation(automation["automation_uid"])["retry_at"]

    updated = controller.update(automation["automation_uid"], {
        "schedule": {
            "kind": "at",
            "value": "2099-01-01T10:00:00+08:00",
            "timezone": "Asia/Shanghai",
        },
    }, now="2026-09-06T09:01:00+08:00")

    assert updated["retry_at"] == ""
    assert data_sink.get_agent_automation_run(old_run["run_uid"])["status"] == "canceled"
    assert sched_module.get_scheduler().get_job(
        f"automation-retry::{automation['automation_uid']}"
    ) is None
    assert sched_module.get_scheduler().get_job(f"automation::{automation['automation_uid']}") is not None


def test_recover_interrupted_agent_run_releases_its_automation_single_flight_lock(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    from core.agent import db as agent_db

    agent_db.init_agent_db()
    agent_db.create_session("recovery-source", "dsh-recovery-source", "恢复会话")
    agent_db.create_turn("turn-recovery", "recovery-source", 1, "msg-recovery")
    agent_db.create_run("agent-recovery", "recovery-source", "turn-recovery", "deepseek", "deepseek-chat")
    agent_db.update_run("agent-recovery", status="interrupted")
    automation = data_sink.create_agent_automation({
        "title": "恢复中的自动化",
        "objective_prompt": "运行中断后不应永久占用",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "every", "interval_seconds": 3600, "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_verification"]},
    })
    claimed = data_sink.claim_agent_automation_run(automation["automation_uid"], "scheduled", "scheduled:recover")
    data_sink.update_agent_automation_run(claimed["run"]["run_uid"], status="queued", agent_run_id="agent-recovery")
    controller = AutomationController(None, sched_module)

    reconciled = controller.reconcile_interrupted_agent_runs()

    assert reconciled == 1
    run = data_sink.get_agent_automation_run(claimed["run"]["run_uid"])
    assert run["status"] == "needs_review"
    assert run["error_code"] == "AGENT_DISPATCH_INTERRUPTED"
    assert not data_sink.has_active_agent_automation_run(automation["automation_uid"])


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
        "execution_policy": {"toolset": ["automation_record_observation"]},
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


def test_restore_marks_overdue_loop_missed_and_rearms_only_the_next_future_cycle(monkeypatch, tmp_path):
    future = "2026-09-05T10:00:00+08:00"
    controller, automation = _controller_with_loop(monkeypatch, tmp_path, next_run_at=future)
    overdue = "2026-09-05T08:00:00+08:00"
    data_sink.update_agent_automation(automation["automation_uid"], next_run_at=overdue)

    controller.restore(now="2026-09-05T09:00:00+08:00")

    run = data_sink.list_agent_automation_runs(automation["automation_uid"], 1)[0]
    assert run["status"] == "missed"
    restored = data_sink.get_agent_automation(automation["automation_uid"])
    assert datetime.fromisoformat(restored["next_run_at"]).astimezone(ZoneInfo("Asia/Shanghai")) > datetime.fromisoformat("2026-09-05T09:00:00+08:00")
    assert sched_module.get_scheduler().get_job("automation::auto-loop") is not None


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


def test_ungranted_branch_moves_run_to_needs_review_without_agent_action(monkeypatch, tmp_path):
    controller, automation = _controller_with_loop(monkeypatch, tmp_path, toolset=["automation_record_observation"])
    run = _run(controller.run_now(automation["automation_uid"]))

    _run(controller.record_observation(
        run["run_uid"],
        {"inventory": {"available": 1}, "sales": {"last_7_days": 1}},
        [],
    ))

    stored = data_sink.get_agent_automation_run(run["run_uid"])
    assert stored["status"] == "needs_review"
    assert stored["error_code"] == "UNAUTHORIZED_BRANCH_CAPABILITY"
    assert controller._test_executors.action_calls == []


def test_repeated_retryable_loop_failure_pauses_and_records_circuit_breaker(monkeypatch, tmp_path):
    controller, automation = _controller_with_loop(monkeypatch, tmp_path, failure_threshold=2)

    controller.record_execution_failure(automation["automation_uid"], "NETWORK", retryable=True)
    paused = controller.record_execution_failure(automation["automation_uid"], "NETWORK", retryable=True)

    assert paused["enabled"] == 0
    assert paused["last_status"] == "paused_circuit_breaker"
    assert paused["last_error"] == "NETWORK"
    assert sched_module.get_scheduler().get_job("automation::auto-loop") is None


def test_action_submission_records_agent_task_and_artifact_links(monkeypatch, tmp_path):
    controller, automation = _controller_with_loop(monkeypatch, tmp_path)

    async def linked_action(_automation, _run_value, _branch, _toolset):
        return {
            "run_id": "agent-run-1",
            "session_id": "agent-session-1",
            "task_instance_uid": "task-instance-1",
            "artifact_uid": "artifact-1",
            "status": "queued",
        }

    controller.action_executor = linked_action
    run = _run(controller.run_now(automation["automation_uid"]))
    _run(controller.record_observation(
        run["run_uid"],
        {"inventory": {"available": 1}, "sales": {"last_7_days": 1}},
        [],
    ))

    links = data_sink.list_agent_automation_run_links(run["run_uid"])
    assert {(link["link_kind"], link["link_uid"]) for link in links} == {
        ("agent_run", "agent-run-1"),
        ("agent_session", "agent-session-1"),
        ("task_instance", "task-instance-1"),
        ("artifact", "artifact-1"),
    }


def test_pause_cancels_linked_agent_run_and_prevents_late_observation(monkeypatch, tmp_path):
    class CancellableAgent:
        def __init__(self):
            self.calls = []

        async def cancel_run(self, run_id):
            self.calls.append(run_id)
            return {"ok": True, "status": "canceled"}

    controller, automation = _controller_with_loop(monkeypatch, tmp_path)
    agent = CancellableAgent()
    controller.agent_service = agent
    claimed = data_sink.claim_agent_automation_run(
        automation["automation_uid"], "manual", "manual:cancel-me"
    )["run"]
    run = data_sink.update_agent_automation_run(
        claimed["run_uid"], status="queued", agent_run_id="agent-run-cancel"
    )

    paused = _run(controller.pause(automation["automation_uid"]))
    late = _run(controller.record_observation(
        run["run_uid"],
        {"inventory": {"available": 1}, "sales": {"last_7_days": 1}},
        [],
    ))

    assert paused["enabled"] == 0
    assert agent.calls == ["agent-run-cancel"]
    assert late["status"] == "canceled"
    assert controller._test_executors.action_calls == []


def test_agent_terminal_without_verification_needs_review_instead_of_staying_queued(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)

    class Agent:
        async def submit_automation_turn(self, _automation, _run, _prompt, _toolset):
            return {"run_id": "agent-只说完成", "session_id": "automation-session", "status": "queued"}

    controller = AutomationController(Agent(), sched_module)
    automation = controller.create({
        "title": "只在完成后回执",
        "objective_prompt": "完成后必须留下可验证回执",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_verification"]},
    })
    queued = _run(controller.run_now(automation["automation_uid"], request_uid="只说完成"))
    assert queued["status"] == "queued"

    projected = controller.project_agent_run_terminal(
        queued["run_uid"], "agent-只说完成", "completed",
    )
    assert projected["status"] == "needs_review"
    assert projected["error_code"] == "VERIFICATION_EVIDENCE_REQUIRED"


def test_agent_queue_receipt_without_status_waits_for_its_verification(monkeypatch, tmp_path):
    """The live Agent service originally returned queued=true without status."""
    _use_temp_product_db(monkeypatch, tmp_path)

    class Agent:
        async def submit_automation_turn(self, _automation, _run, _prompt, _toolset):
            return {"run_id": "agent-queued-boolean", "session_id": "automation-session", "queued": True}

    controller = AutomationController(Agent(), sched_module)
    automation = controller.create({
        "title": "等待异步验证",
        "objective_prompt": "完成后必须留下可验证回执",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_verification"]},
    })

    queued = _run(controller.run_now(automation["automation_uid"], request_uid="布尔队列回执"))

    assert queued["status"] == "queued"
    assert queued["agent_run_id"] == "agent-queued-boolean"
    assert queued["error_code"] == ""
    completed = _run(controller.record_verification(
        queued["run_uid"], {"verified": True, "user_message": "本地自动化验收已完成"},
    ))
    assert completed["status"] == "completed"


def test_synchronous_action_without_verification_needs_review(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)

    async def action(_automation, _run, _branch, _toolset):
        return {"status": "completed", "message": "已执行"}

    controller = AutomationController(None, sched_module, action_executor=action)
    automation = controller.create({
        "title": "需要验证的本地确认",
        "objective_prompt": "执行后留下验证结果",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_verification"]},
    })

    run = _run(controller.run_now(automation["automation_uid"], request_uid="同步但未验证"))

    assert run["status"] == "needs_review"
    assert run["error_code"] == "VERIFICATION_EVIDENCE_REQUIRED"


def test_claimed_run_uses_its_original_objective_after_definition_is_edited(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    seen = {}

    async def action(automation, _run, _branch, _toolset):
        seen.update({
            "title": automation["title"],
            "objective": automation["objective_prompt"],
        })
        return {"status": "completed"}

    controller = AutomationController(None, sched_module, action_executor=action)
    automation = controller.create({
        "title": "原始自动化",
        "objective_prompt": "只执行原始目标",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_verification"]},
        "enabled": False,
    })
    claimed = data_sink.claim_agent_automation_run(
        automation["automation_uid"], "manual", "manual:definition-snapshot"
    )["run"]
    controller.update(automation["automation_uid"], {
        "title": "后来修改的标题",
        "objective_prompt": "这个目标不能影响已领取的运行",
    })

    result = _run(controller._start_run(claimed))

    assert result["status"] == "needs_review"
    assert seen == {"title": "原始自动化", "objective": "只执行原始目标"}
    assert data_sink.get_agent_automation_run(claimed["run_uid"])["definition_snapshot"]["objective_prompt"] == "只执行原始目标"


def test_claimed_run_uses_its_original_execution_policy_after_definition_is_edited(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)

    class Agent:
        def __init__(self):
            self.policies = []

        async def submit_automation_turn(self, automation, _run, _prompt, _toolset):
            self.policies.append(dict(automation["execution_policy"]))
            return {"run_id": "agent-frozen-policy", "session_id": "automation-session", "status": "queued"}

    initial_policy = {
        "toolset": ["task_run"],
        "allowed_risks": ["local_write"],
        "timeout_seconds": 300,
        "browser_tab_id": "tab-original",
    }
    agent = Agent()
    controller = AutomationController(agent, sched_module)
    automation = controller.create({
        "title": "授权快照",
        "objective_prompt": "按领取时的授权执行",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "every", "interval_seconds": 3600, "timezone": "Asia/Shanghai"},
        "execution_policy": initial_policy,
        "enabled": False,
    })
    claimed = data_sink.claim_agent_automation_run(
        automation["automation_uid"], "manual", "manual:frozen-policy",
    )["run"]
    controller.update(automation["automation_uid"], {
        "execution_policy": {
            "toolset": ["task_run"],
            "allowed_risks": ["external_write"],
            "timeout_seconds": 7200,
        },
    })

    queued = _run(controller._start_run(claimed))

    assert queued["status"] == "queued"
    assert agent.policies == [initial_policy]


def test_editing_an_automation_policy_keeps_its_browser_tab_binding_immutable(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    automation = controller.create({
        "title": "绑定页面的检查",
        "objective_prompt": "读取创建时选中的页面",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "every", "interval_seconds": 3600, "timezone": "Asia/Shanghai"},
        "execution_policy": {
            "toolset": ["browser_observe"],
            "browser_tab_id": "tab-created-with-automation",
            "timeout_seconds": 300,
        },
        "enabled": False,
    })

    edited = controller.update(automation["automation_uid"], {
        "execution_policy": {"toolset": ["browser_observe"], "timeout_seconds": 600},
    })

    assert edited["execution_policy"]["browser_tab_id"] == "tab-created-with-automation"
    with pytest.raises(ValueError, match="browser_tab_id"):
        controller.update(automation["automation_uid"], {
            "execution_policy": {"toolset": ["browser_observe"], "browser_tab_id": "another-tab"},
        })


def test_partial_execution_policy_patch_preserves_unspecified_safety_controls(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    automation = controller.create({
        "title": "保留策略的定时检查",
        "objective_prompt": "按原有工具和重试策略执行检查",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "every", "interval_seconds": 3600, "timezone": "Asia/Shanghai"},
        "execution_policy": {
            "toolset": ["automation_record_verification"],
            "allowed_risks": ["local_write"],
            "timeout_seconds": 300,
            "max_retries": 2,
            "retry_backoff_seconds": 60,
            "allow_filesystem": True,
        },
        "enabled": False,
    })

    edited = controller.update(automation["automation_uid"], {
        "execution_policy": {"timeout_seconds": 90},
    })

    assert edited["execution_policy"] == {
        "toolset": ["automation_record_verification"],
        "allowed_risks": ["local_write"],
        "timeout_seconds": 90,
        "max_retries": 2,
        "retry_backoff_seconds": 60,
        "allow_filesystem": True,
    }


def test_editing_an_unbound_automation_cannot_add_a_browser_tab_binding(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    controller = AutomationController(None, sched_module)
    automation = controller.create({
        "title": "无页面绑定的检查",
        "objective_prompt": "读取本地运行结果",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "every", "interval_seconds": 3600, "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_verification"], "timeout_seconds": 300},
        "enabled": False,
    })

    with pytest.raises(ValueError, match="browser_tab_id"):
        controller.update(automation["automation_uid"], {
            "execution_policy": {
                "toolset": ["browser_observe"],
                "browser_tab_id": "tab-added-after-creation",
                "timeout_seconds": 300,
            },
        })


def test_claimed_run_keeps_its_original_failure_threshold_after_definition_is_edited(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)

    class Agent:
        async def submit_automation_turn(self, _automation, _run, _prompt, _toolset):
            return {"run_id": "agent-threshold", "session_id": "automation-session", "status": "queued"}

    controller = AutomationController(Agent(), sched_module)
    automation = controller.create({
        "title": "原始熔断阈值",
        "objective_prompt": "失败后按原始阈值处理",
        "automation_kind": "loop",
        "context_mode": "isolated",
        "loop_policy": {"cycle_interval_seconds": 60, "failure_threshold": 1},
        "execution_policy": {"toolset": ["automation_record_verification"], "max_retries": 1},
        "program": _program(),
        "enabled": False,
    })
    queued = _run(controller.run_now(automation["automation_uid"], request_uid="frozen-threshold"))
    controller.update(automation["automation_uid"], {
        "loop_policy": {"cycle_interval_seconds": 3600, "failure_threshold": 9},
    })

    terminal = controller.project_agent_run_terminal(
        queued["run_uid"], "agent-threshold", "failed", error_code="NETWORK_ERROR", retryable=True,
    )

    assert terminal["status"] == "failed"
    persisted = data_sink.get_agent_automation(automation["automation_uid"])
    assert persisted["enabled"] == 0
    assert persisted["last_status"] == "paused_circuit_breaker"
    # Future-definition settings remain intact except the independently
    # maintained failure counter.
    assert persisted["loop_policy"]["cycle_interval_seconds"] == 3600
    assert persisted["loop_policy"]["failure_threshold"] == 9


def test_synchronous_program_action_without_verification_needs_review(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)

    async def action(_automation, _run, _branch, _toolset):
        return {"status": "completed", "message": "已执行条件行动"}

    async def observer(_automation, _run, _policy):
        return None

    controller = AutomationController(
        None,
        sched_module,
        observer_executor=observer,
        action_executor=action,
    )
    automation = controller.create({
        "title": "低库存条件行动",
        "objective_prompt": "先观察库存，再执行处理",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_verification"]},
        "program": _program(),
    })
    run = _run(controller.run_now(automation["automation_uid"], request_uid="条件行动未验证"))

    result = _run(controller.record_observation(
        run["run_uid"],
        {"inventory": {"available": 1}, "sales": {"last_7_days": 1}},
        [],
    ))

    assert result["status"] == "needs_review"
    assert result["error_code"] == "VERIFICATION_EVIDENCE_REQUIRED"


def test_failed_observer_result_never_becomes_condition_facts(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)

    async def observer(_automation, _run, _policy):
        return {"status": "failed", "error_code": "OBSERVE_FAILED", "error_message": "上游暂不可用"}

    controller = AutomationController(None, sched_module, observer_executor=observer)
    automation = controller.create({
        "title": "异常观察不能误完成",
        "objective_prompt": "观察库存",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_observation"]},
        "program": {
            "branches": [{
                "id": "库存不足",
                "when": {"lt": [{"path": "facts.inventory.available"}, 20]},
                "allowed_tools": ["automation_record_observation"],
            }],
        },
    })

    run = _run(controller.run_now(automation["automation_uid"], request_uid="观察失败"))

    assert run["status"] == "needs_review"
    assert run["error_code"] == "OBSERVE_FAILED"
    assert run["facts_summary"] == {}


def test_transient_failure_retries_the_same_run_and_respects_zero_retry_budget(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)

    class Agent:
        def __init__(self):
            self.calls = 0

        async def submit_automation_turn(self, _automation, _run, _prompt, _toolset):
            self.calls += 1
            return {"run_id": f"agent-网络重试-{self.calls}", "session_id": "automation-session", "status": "queued"}

    agent = Agent()
    controller = AutomationController(agent, sched_module)
    automation = controller.create({
        "title": "每小时读取库存",
        "objective_prompt": "读取库存后给出可验证结果",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "every", "interval_seconds": 3600, "timezone": "Asia/Shanghai"},
        "execution_policy": {
            "toolset": ["automation_record_verification"],
            "max_retries": 1,
            "retry_backoff_seconds": 1,
        },
    })
    queued = _run(controller.run_now(automation["automation_uid"], request_uid="网络失败"))
    first = controller.project_agent_run_terminal(
        queued["run_uid"], "agent-网络重试-1", "failed",
        error_code="NETWORK_ERROR", error_message="网络暂时不可用", retryable=True,
    )
    stored = data_sink.get_agent_automation_run(queued["run_uid"])
    assert first["status"] == "retry_scheduled"
    assert stored["attempt"] == 1
    assert data_sink.get_agent_automation(automation["automation_uid"])["retry_at"]
    # The normal interval job survives; retry has its own durable DateTrigger.
    assert sched_module.get_scheduler().get_job(f"automation::{automation['automation_uid']}") is not None
    assert sched_module.get_scheduler().get_job(f"automation-retry::{automation['automation_uid']}") is not None

    retried = _run(controller._retry_callback(automation["automation_uid"]))
    assert retried["run_uid"] == queued["run_uid"]
    assert retried["agent_run_id"] == "agent-网络重试-2"
    assert retried["attempt"] == 1
    assert len(data_sink.list_agent_automation_runs(automation["automation_uid"], 10)) == 1

    exhausted = controller.project_agent_run_terminal(
        queued["run_uid"], "agent-网络重试-2", "failed",
        error_code="NETWORK_ERROR", error_message="网络仍不可用", retryable=True,
    )
    assert exhausted["status"] == "needs_review"
    assert exhausted["error_code"] == "RETRY_EXHAUSTED"
    assert data_sink.get_agent_automation(automation["automation_uid"])["retry_at"] == ""

    no_retry = controller.create({
        "title": "不重试的本地确认",
        "objective_prompt": "只在可验证时完成",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "at", "value": "2099-01-02T00:00:00+08:00", "timezone": "Asia/Shanghai"},
        "execution_policy": {"toolset": ["automation_record_verification"], "max_retries": 0},
    })
    no_retry_run = _run(controller.run_now(no_retry["automation_uid"], request_uid="不重试"))
    no_retry_result = controller.project_agent_run_terminal(
        no_retry_run["run_uid"], "agent-网络重试-3", "failed",
        error_code="NETWORK_ERROR", error_message="网络暂时不可用", retryable=True,
    )
    assert no_retry_result["status"] == "needs_review"
    assert no_retry_result["error_code"] == "RETRY_EXHAUSTED"


def test_pause_cancels_a_pending_retry_without_replaying_it(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)

    class Agent:
        async def submit_automation_turn(self, _automation, _run, _prompt, _toolset):
            return {"run_id": "agent-pending-retry", "session_id": "automation-session", "status": "queued"}

    controller = AutomationController(Agent(), sched_module)
    automation = controller.create({
        "title": "网络恢复后再核对库存",
        "objective_prompt": "仅在网络恢复后重试一次",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "every", "interval_seconds": 3600, "timezone": "Asia/Shanghai"},
        "execution_policy": {
            "toolset": ["automation_record_verification"],
            "max_retries": 1,
            "retry_backoff_seconds": 60,
        },
    })
    queued = _run(controller.run_now(automation["automation_uid"], request_uid="网络暂时不可用"))
    controller.project_agent_run_terminal(
        queued["run_uid"], "agent-pending-retry", "failed",
        error_code="NETWORK_ERROR", error_message="网络暂时不可用", retryable=True,
    )

    paused = _run(controller.pause(automation["automation_uid"]))

    assert paused["enabled"] == 0
    assert paused["retry_at"] == ""
    assert data_sink.get_agent_automation_run(queued["run_uid"])["status"] == "canceled"
    assert sched_module.get_scheduler().get_job(f"automation-retry::{automation['automation_uid']}") is None


def test_one_time_scheduled_failure_keeps_its_retry_wakeup_armed(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)

    class Agent:
        async def submit_automation_turn(self, _automation, _run, _prompt, _toolset):
            return {"run_id": "agent-one-time-retry", "session_id": "automation-session", "status": "queued"}

    controller = AutomationController(Agent(), sched_module)
    automation = controller.create({
        "title": "一次性验收提醒",
        "objective_prompt": "到点后给出验收结果",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "at", "value": "2099-01-01T00:00:00+08:00", "timezone": "Asia/Shanghai"},
        "execution_policy": {
            "toolset": ["automation_record_verification"],
            "max_retries": 1,
            "retry_backoff_seconds": 60,
        },
    })

    queued = _run(controller._scheduled_callback(automation["automation_uid"]))
    retry = controller.project_agent_run_terminal(
        queued["run_uid"], "agent-one-time-retry", "failed",
        error_code="NETWORK_ERROR", error_message="网络暂时不可用", retryable=True,
    )

    persisted = data_sink.get_agent_automation(automation["automation_uid"])
    assert retry["status"] == "retry_scheduled"
    assert persisted["enabled"] == 1
    assert persisted["next_run_at"] == ""
    assert persisted["retry_at"]
    assert sched_module.get_scheduler().get_job(f"automation-retry::{automation['automation_uid']}") is not None
