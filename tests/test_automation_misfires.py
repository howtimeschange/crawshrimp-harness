"""Exercise real APScheduler wake-ups against an isolated product database."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from apscheduler.events import EVENT_JOB_EXECUTED, EVENT_JOB_MISSED

from core import data_sink, scheduler
from core.automation_controller import AutomationController


@pytest.fixture
def controller(monkeypatch, tmp_path):
    monkeypatch.setattr("core.runtime_paths.data_root", lambda: tmp_path)
    data_sink.init_db()
    monkeypatch.setattr(scheduler, "_scheduler", None)
    return AutomationController(None, scheduler)


def definition(kind="at", seconds_ago=3):
    past = (datetime.now(timezone.utc) - timedelta(seconds=seconds_ago)).isoformat()
    return data_sink.create_agent_automation({
        "title": "misfire regression", "objective_prompt": "read only",
        "enabled": True, "automation_kind": "scheduled", "context_mode": "isolated",
        "schedule": {"kind": kind, "value": past, "interval_seconds": 3600,
                     "timezone": "Asia/Shanghai"},
        "next_run_at": past,
        "execution_policy": {"toolset": ["automation_record_verification"]},
    })


async def settle_job(register):
    sched = scheduler.get_scheduler()
    finished = asyncio.Event()
    sched.add_listener(lambda event: finished.set(), EVENT_JOB_EXECUTED | EVENT_JOB_MISSED)
    sched.start()
    try:
        register()
        await asyncio.wait_for(finished.wait(), 3)
    finally:
        sched.shutdown(wait=False)
        await asyncio.sleep(0)


def test_at_late_within_grace_executes(controller):
    automation = definition()
    called = []
    asyncio.run(settle_job(lambda: scheduler.register_automation_schedule(automation, called.append)))
    assert called == [automation["automation_uid"]]


def test_at_beyond_grace_is_durably_missed_and_held_for_review(controller):
    automation = definition(seconds_ago=4000)
    called = []
    asyncio.run(settle_job(lambda: scheduler.register_automation_schedule(automation, called.append)))
    assert called == []
    asyncio.run(controller.sweep())
    asyncio.run(controller.sweep())
    runs = data_sink.list_agent_automation_runs(automation["automation_uid"])
    assert len(runs) == 1
    assert runs[0]["status"] == "missed"
    assert runs[0]["error_code"] == "MISSED_WHILE_RUNNING"
    current = data_sink.get_agent_automation(automation["automation_uid"])
    assert current["enabled"] == 0
    assert current["last_status"] == "needs_review"


@pytest.mark.parametrize("recover", ["sweep", "refresh"])
def test_expired_retry_releases_overlap(controller, recover):
    automation = definition("every", seconds_ago=-3600)
    uid = automation["automation_uid"]
    run = data_sink.claim_agent_automation_run(uid, "manual", "failed-attempt")["run"]
    data_sink.update_agent_automation_run(run["run_uid"], status="retry_scheduled")
    data_sink.update_agent_automation(uid, retry_at=(datetime.now(timezone.utc) - timedelta(seconds=400)).isoformat())
    if recover == "sweep":
        asyncio.run(controller.sweep())
    else:
        controller.refresh(uid)
    assert data_sink.get_agent_automation_run(run["run_uid"])["status"] == "needs_review"
    assert data_sink.get_agent_automation(uid)["retry_at"] == ""
    assert not data_sink.has_active_agent_automation_run(uid)
    assert scheduler.get_scheduler().get_job(scheduler.automation_job_id(uid)) is not None


@pytest.mark.parametrize("kind", ["every", "cron"])
def test_sweep_records_missed_boundary_and_rearms_future(controller, kind):
    automation = definition(kind, seconds_ago=4000)
    uid = automation["automation_uid"]
    if kind == "cron":
        data_sink.update_agent_automation(uid, schedule={"kind": "cron", "value": "0 * * * *", "timezone": "Asia/Shanghai"})
    asyncio.run(controller.sweep())
    asyncio.run(controller.sweep())
    runs = data_sink.list_agent_automation_runs(uid)
    assert len(runs) == 1
    assert runs[0]["status"] == "missed"
    assert datetime.fromisoformat(data_sink.get_agent_automation(uid)["next_run_at"]) > datetime.now(timezone.utc)
    assert scheduler.get_scheduler().get_job(scheduler.automation_job_id(uid)) is not None


def test_sweep_does_not_terminalize_a_running_claim(controller):
    automation = definition(seconds_ago=4000)
    uid = automation["automation_uid"]
    run = data_sink.claim_agent_automation_run(uid, "scheduled", "scheduled:" + automation["next_run_at"])["run"]
    data_sink.update_agent_automation_run(run["run_uid"], status="running")
    asyncio.run(controller.sweep())
    assert data_sink.get_agent_automation_run(run["run_uid"])["status"] == "running"


def test_retry_registration_rejects_expired_wakeup(controller):
    automation = definition("every")
    automation["retry_at"] = (datetime.now(timezone.utc) - timedelta(seconds=400)).isoformat()
    with pytest.raises(ValueError, match="expired"):
        scheduler.register_automation_retry(automation, lambda uid: None)


def test_retry_within_grace_still_executes(controller):
    automation = definition("every")
    automation["retry_at"] = (datetime.now(timezone.utc) - timedelta(seconds=3)).isoformat()
    called = []
    asyncio.run(settle_job(lambda: scheduler.register_automation_retry(automation, called.append)))
    assert called == [automation["automation_uid"]]


def test_retry_lost_after_registration_is_recovered(controller):
    automation = definition("every", seconds_ago=-3600)
    uid = automation["automation_uid"]
    run = data_sink.claim_agent_automation_run(uid, "manual", "original")["run"]
    data_sink.update_agent_automation_run(run["run_uid"], status="retry_scheduled")
    future = (datetime.now(timezone.utc) + timedelta(seconds=60)).isoformat()
    automation = data_sink.update_agent_automation(uid, retry_at=future)
    called = []

    def register():
        scheduler.register_automation_retry(automation, called.append)
        past = datetime.now(timezone.utc) - timedelta(seconds=400)
        data_sink.update_agent_automation(uid, retry_at=past.isoformat())
        scheduler.get_scheduler().get_job(scheduler.automation_retry_job_id(uid)).modify(next_run_time=past)

    asyncio.run(settle_job(register))
    assert called == []
    assert data_sink.get_agent_automation_run(run["run_uid"])["status"] == "retry_scheduled"
    asyncio.run(controller.sweep())
    assert data_sink.get_agent_automation_run(run["run_uid"])["status"] == "needs_review"
    assert not data_sink.has_active_agent_automation_run(uid)


def test_sweep_rearms_loop_without_spending_executed_cycle_budget(controller):
    automation = definition(seconds_ago=4000)
    uid = automation["automation_uid"]
    data_sink.update_agent_automation(uid, automation_kind="loop", loop_policy={"interval_seconds": 60, "max_cycles": 2})
    asyncio.run(controller.sweep())
    current = data_sink.get_agent_automation(uid)
    assert current["cycle_seq"] == 0
    assert datetime.fromisoformat(current["next_run_at"]) > datetime.now(timezone.utc)
    assert data_sink.list_agent_automation_runs(uid)[0]["status"] == "missed"


def test_watchdog_survives_scan_failure_and_stops_cleanly(controller, monkeypatch, caplog):
    async def scenario():
        real_sleep = asyncio.sleep
        completed = asyncio.Event()
        scans = []

        async def fast_tick(seconds):
            assert seconds == 60
            await real_sleep(0)

        async def scan():
            scans.append(True)
            if len(scans) == 1:
                raise RuntimeError("temporary database failure")
            completed.set()

        monkeypatch.setattr(asyncio, "sleep", fast_tick)
        monkeypatch.setattr(controller, "sweep", scan)
        controller.start_watchdog()
        task = controller._watchdog_task
        controller.start_watchdog()
        assert controller._watchdog_task is task
        await asyncio.wait_for(completed.wait(), 1)
        await controller.stop_watchdog()
        assert task.done()
        assert controller._watchdog_task is None

    asyncio.run(scenario())
    assert "Automation watchdog scan failed" in caplog.text
