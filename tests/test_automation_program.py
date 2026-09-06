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


@pytest.mark.parametrize("program", [
    {"branches": [{"id": "bad", "when": {"gt": [{"path": "facts.count"}, float("nan")]}}]},
    {"config": {"limit": float("inf")}, "branches": [{"id": "bad", "when": {"eq": [1, 1]}}]},
    {"branches": [{"id": "bad", "when": {"cooldown_elapsed": {
        "last_at": {"path": "checkpoint.last_at"}, "seconds": float("inf"),
    }}}]},
])
def test_validate_rejects_non_finite_numbers_before_persistence_or_fingerprinting(program):
    with pytest.raises(ProgramValidationError, match="non-finite"):
        validate_program(program)


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


@pytest.mark.parametrize("value", [["queued"], {"queued": True}])
def test_evaluate_membership_treats_unhashable_facts_as_a_non_match(value):
    program = {
        "branches": [
            {"id": "bad-membership", "when": {"in": [{"path": "facts.value"}, {"queued": True}]}},
        ]
    }

    result = evaluate_program(
        program,
        facts={"value": value},
        checkpoint={},
        now="2026-09-05T00:00:00+00:00",
    )

    assert result["matched_branch"] == ""
    assert result["reason"] == "no_match"


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


def test_all_evaluates_later_consecutive_match_and_resets_when_earlier_clause_is_false():
    consecutive_node = {
        "consecutive_matches": {
            "id": "low_stock",
            "condition": {"lt": [{"path": "facts.inventory.available"}, {"path": "config.reorder_point"}]},
            "threshold": 3,
            "checkpoint_path": "checkpoint.condition_state.low_stock",
        }
    }
    program = {
        "config": {"reorder_point": 20},
        "branches": [
            {
                "id": "ready",
                "when": {
                    "all": [
                        {"eq": [{"path": "facts.window_open"}, True]},
                        consecutive_node,
                    ]
                },
            }
        ],
    }

    reset_result = evaluate_program(
        program,
        facts={"window_open": False, "inventory": {"available": 5}},
        checkpoint={"condition_state": {"low_stock": {"count": 2}}},
        now="2026-09-05T00:00:00+00:00",
    )
    next_cycle_result = evaluate_program(
        program,
        facts={"window_open": True, "inventory": {"available": 5}},
        checkpoint={"condition_state": {"low_stock": {"count": 0}}},
        now="2026-09-05T00:01:00+00:00",
    )

    assert reset_result["matched_branch"] == ""
    assert reset_result["checkpoint_patch"] == {"condition_state": {"low_stock": {"count": 0}}}
    assert next_cycle_result["matched_branch"] == ""
    assert next_cycle_result["checkpoint_patch"] == {"condition_state": {"low_stock": {"count": 1}}}


def test_selected_branch_patch_excludes_matching_lower_priority_branch_state():
    program = {
        "branches": [
            {
                "id": "lower_priority_stateful",
                "priority": 1,
                "when": {
                    "consecutive_matches": {
                        "id": "low",
                        "condition": {"eq": [{"path": "facts.ready"}, True]},
                        "threshold": 1,
                        "checkpoint_path": "checkpoint.condition_state.low",
                    }
                },
            },
            {
                "id": "higher_priority",
                "priority": 10,
                "when": {"eq": [{"path": "facts.ready"}, True]},
            },
        ],
    }

    result = evaluate_program(
        program,
        facts={"ready": True},
        checkpoint={"condition_state": {"low": {"count": 0}}},
        now="2026-09-05T00:00:00+00:00",
    )

    assert result["matched_branch"] == "higher_priority"
    assert result["checkpoint_patch"] == {}


def test_validate_rejects_bool_priority_and_bool_consecutive_threshold():
    with pytest.raises(ProgramValidationError, match="branch priority must be an integer"):
        validate_program({"branches": [{"id": "bad", "priority": True, "when": {"eq": [1, 1]}}]})
    with pytest.raises(ProgramValidationError, match="consecutive_matches threshold must be a positive integer"):
        validate_program(
            {
                "branches": [
                    {
                        "id": "bad",
                        "when": {
                            "consecutive_matches": {
                                "id": "bad",
                                "condition": {"eq": [1, 1]},
                                "threshold": True,
                                "checkpoint_path": "checkpoint.condition_state.bad",
                            }
                        },
                    }
                ]
            }
        )


def test_validate_rejects_ambiguous_program_state_and_unconditional_empty_boolean_nodes():
    with pytest.raises(ProgramValidationError, match="branch ids must be unique"):
        validate_program({
            "branches": [
                {"id": "同一提醒", "when": {"eq": [1, 1]}},
                {"id": "同一提醒", "when": {"eq": [2, 2]}},
            ]
        })
    with pytest.raises(ProgramValidationError, match="non-empty list"):
        validate_program({"branches": [{"id": "空条件", "when": {"all": []}}]})
    with pytest.raises(ProgramValidationError, match="config must be an object"):
        validate_program({"config": "库存不足", "branches": [{"id": "提醒", "when": {"eq": [1, 1]}}]})

    counter = lambda node_id, path: {
        "consecutive_matches": {
            "id": node_id,
            "condition": {"eq": [{"path": "facts.库存充足"}, False]},
            "threshold": 2,
            "checkpoint_path": path,
        }
    }
    with pytest.raises(ProgramValidationError, match="ids must be unique"):
        validate_program({
            "branches": [{"id": "库存提醒", "when": {"all": [
                counter("连续低库存", "checkpoint.低库存.a"),
                counter("连续低库存", "checkpoint.低库存.b"),
            ]}}]
        })
    with pytest.raises(ProgramValidationError, match="checkpoint_path must be unique"):
        validate_program({
            "branches": [{"id": "库存提醒", "when": {"all": [
                counter("低库存一", "checkpoint.低库存.count"),
                counter("低库存二", "checkpoint.低库存.count"),
            ]}}]
        })
