from pathlib import Path

from core import data_sink


def _use_temp_product_db(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr("core.runtime_paths.data_root", lambda: tmp_path)


def _scheduled_values() -> dict:
    return {
        "title": "库存检查",
        "objective_prompt": "检查库存",
        "automation_kind": "scheduled",
        "context_mode": "isolated",
        "schedule": {"kind": "cron", "minute": "30"},
        "loop_policy": {},
        "execution_policy": {"toolset": ["observe"], "timeout_seconds": 300},
    }


def _restock_program() -> dict:
    return {
        "version": 1,
        "steps": [
            {"id": "observe-stock", "tool": "observe", "prompt": "读取库存状态"},
        ],
        "branches": [{"match": "low_stock", "next": "notify"}],
    }


def test_create_automation_round_trips_policy_and_program(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    data_sink.init_db()

    created = data_sink.create_agent_automation({
        "title": "库存检查",
        "objective_prompt": "检查库存",
        "automation_kind": "loop",
        "context_mode": "isolated",
        "schedule": {},
        "loop_policy": {"cycle_interval_seconds": 1800, "max_cycles": 3, "failure_threshold": 2},
        "execution_policy": {"toolset": ["observe"], "timeout_seconds": 300, "max_retries": 1},
    })
    version = data_sink.create_agent_automation_program(created["automation_uid"], _restock_program())
    stored = data_sink.update_agent_automation(
        created["automation_uid"],
        active_program_version_uid=version["program_version_uid"],
    )

    assert stored["loop_policy"]["cycle_interval_seconds"] == 1800
    assert stored["execution_policy"]["toolset"] == ["observe"]
    assert stored["program"] == _restock_program()
    assert stored["active_program_version_uid"] == version["program_version_uid"]


def test_claiming_same_trigger_is_idempotent(monkeypatch, tmp_path):
    _use_temp_product_db(monkeypatch, tmp_path)
    data_sink.init_db()
    automation = data_sink.create_agent_automation(_scheduled_values())

    first = data_sink.claim_agent_automation_run(
        automation["automation_uid"],
        "scheduled",
        "2026-09-06T00:30:00+00:00",
    )
    second = data_sink.claim_agent_automation_run(
        automation["automation_uid"],
        "scheduled",
        "2026-09-06T00:30:00+00:00",
    )

    assert first["created"] is True
    assert first["run"]["status"] == "claimed"
    assert first["run"]["execution_policy_snapshot"] == {"toolset": ["observe"], "timeout_seconds": 300}
    assert second == {"created": False, "run": first["run"]}
