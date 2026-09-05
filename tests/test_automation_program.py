import pytest

from core.automation_program import ProgramValidationError, evaluate_program, validate_program


def test_evaluate_selects_highest_priority_branch_without_eval(monkeypatch):
    program = {
        "config": {"reorder_point": 20},
        "branches": [
            {
                "id": "notify",
                "priority": 1,
                "when": {"lt": [{"path": "facts.inventory.available"}, {"path": "config.reorder_point"}]},
            },
            {
                "id": "restock",
                "priority": 10,
                "when": {
                    "all": [
                        {"lt": [{"path": "facts.inventory.available"}, {"path": "config.reorder_point"}]},
                        {"gt": [{"path": "facts.sales.last_7_days"}, 0]},
                    ]
                },
            },
        ],
        "checkpoint": {"last_available": {"path": "facts.inventory.available"}},
    }
    monkeypatch.setattr("builtins.eval", lambda *_: (_ for _ in ()).throw(AssertionError("eval forbidden")))

    result = evaluate_program(
        program,
        facts={"inventory": {"available": 5}, "sales": {"last_7_days": 3}},
        checkpoint={},
        now="2026-09-05T00:00:00+00:00",
    )

    assert result["matched_branch"] == "restock"
    assert result["checkpoint_patch"] == {"last_available": 5}


def test_validate_rejects_unknown_path_root_and_unknown_operator():
    with pytest.raises(ProgramValidationError, match="unknown operand root"):
        validate_program({"branches": [{"id": "bad", "when": {"eq": [{"path": "os.environ"}, 1]}}]})
    with pytest.raises(ProgramValidationError, match="unsupported operator"):
        validate_program({"branches": [{"id": "bad", "when": {"shell": "rm -rf"}}]})


def test_validate_rejects_string_when_expression():
    with pytest.raises(ProgramValidationError, match="when must be an AST object"):
        validate_program({"branches": [{"id": "bad", "when": "facts.total > 0"}]})


def test_evaluate_supports_boolean_comparison_membership_and_exists_operators():
    program = {
        "branches": [
            {
                "id": "ok",
                "when": {
                    "all": [
                        {"not": {"eq": [{"path": "facts.status"}, "blocked"]}},
                        {"ne": [{"path": "facts.status"}, "failed"]},
                        {"lte": [{"path": "facts.count"}, 10]},
                        {"gte": [{"path": "facts.count"}, 1]},
                        {"in": [{"path": "facts.status"}, ["queued", "running"]]},
                        {"exists": {"path": "facts.owner"}},
                    ]
                },
            }
        ]
    }

    result = evaluate_program(
        program,
        facts={"status": "queued", "count": 3, "owner": None},
        checkpoint={},
        now="2026-09-05T00:00:00+00:00",
    )

    assert result["matched_branch"] == "ok"
    assert result["reason"] == "matched"


def test_evaluate_changed_uses_explicit_current_and_previous_operands():
    program = {
        "branches": [
            {
                "id": "changed",
                "when": {"changed": [{"path": "facts.inventory.available"}, {"path": "checkpoint.last_available"}]},
            }
        ],
        "checkpoint": {"last_available": {"path": "facts.inventory.available"}},
    }

    changed_result = evaluate_program(
        program,
        facts={"inventory": {"available": 4}},
        checkpoint={"last_available": 5},
        now="2026-09-05T00:00:00+00:00",
    )
    unchanged_result = evaluate_program(
        program,
        facts={"inventory": {"available": 5}},
        checkpoint={"last_available": 5},
        now="2026-09-05T00:00:00+00:00",
    )
    missing_baseline_result = evaluate_program(
        program,
        facts={"inventory": {"available": 5}},
        checkpoint={},
        now="2026-09-05T00:00:00+00:00",
    )

    assert changed_result["matched_branch"] == "changed"
    assert changed_result["checkpoint_patch"] == {"last_available": 4}
    assert unchanged_result["matched_branch"] == ""
    assert missing_baseline_result["matched_branch"] == ""


def test_evaluate_consecutive_matches_updates_named_counter_in_checkpoint():
    condition = {"lt": [{"path": "facts.inventory.available"}, {"path": "config.reorder_point"}]}
    program = {
        "config": {"reorder_point": 20},
        "branches": [
            {
                "id": "sustained_low_stock",
                "when": {
                    "consecutive_matches": {
                        "id": "low_stock",
                        "condition": condition,
                        "threshold": 3,
                        "checkpoint_path": "checkpoint.condition_state.low_stock",
                    }
                },
            }
        ],
    }

    result = evaluate_program(
        program,
        facts={"inventory": {"available": 5}},
        checkpoint={"condition_state": {"low_stock": {"count": 2}}},
        now="2026-09-05T00:00:00+00:00",
    )
    reset_result = evaluate_program(
        program,
        facts={"inventory": {"available": 25}},
        checkpoint={"condition_state": {"low_stock": {"count": 2}}},
        now="2026-09-05T00:00:00+00:00",
    )

    assert result["matched_branch"] == "sustained_low_stock"
    assert result["checkpoint_patch"] == {"condition_state": {"low_stock": {"count": 3}}}
    assert reset_result["matched_branch"] == ""
    assert reset_result["checkpoint_patch"] == {"condition_state": {"low_stock": {"count": 0}}}


def test_evaluate_cooldown_elapsed_compares_checkpoint_timestamp_to_now():
    program = {
        "branches": [
            {
                "id": "ready",
                "when": {
                    "cooldown_elapsed": {
                        "last_at": {"path": "checkpoint.last_notified_at"},
                        "seconds": 3600,
                    }
                },
            }
        ]
    }

    ready_result = evaluate_program(
        program,
        facts={},
        checkpoint={"last_notified_at": "2026-09-05T00:00:00+00:00"},
        now="2026-09-05T01:00:00+00:00",
    )
    waiting_result = evaluate_program(
        program,
        facts={},
        checkpoint={"last_notified_at": "2026-09-05T00:30:00+00:00"},
        now="2026-09-05T01:00:00+00:00",
    )
    missing_result = evaluate_program(
        program,
        facts={},
        checkpoint={},
        now="2026-09-05T01:00:00+00:00",
    )

    assert ready_result["matched_branch"] == "ready"
    assert waiting_result["matched_branch"] == ""
    assert missing_result["matched_branch"] == "ready"
