from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any, Mapping, MutableMapping


ALLOWED_PATH_ROOTS = {"config", "facts", "checkpoint"}
COMPARATORS = {"eq", "ne", "lt", "lte", "gt", "gte", "in"}
OPERATORS = COMPARATORS | {"all", "any", "not", "exists", "changed", "consecutive_matches", "cooldown_elapsed"}


class ProgramValidationError(ValueError):
    pass


class _Missing:
    pass


MISSING = _Missing()


def validate_program(program: Mapping[str, Any]) -> dict:
    if not isinstance(program, Mapping):
        raise ProgramValidationError("program must be an object")
    branches = program.get("branches")
    if not isinstance(branches, list) or not branches:
        raise ProgramValidationError("program must include branches")

    for branch in branches:
        if not isinstance(branch, Mapping):
            raise ProgramValidationError("branch must be an object")
        branch_id = branch.get("id")
        if not isinstance(branch_id, str) or not branch_id:
            raise ProgramValidationError("branch id must be a non-empty string")
        if "priority" in branch and (not isinstance(branch["priority"], int) or isinstance(branch["priority"], bool)):
            raise ProgramValidationError("branch priority must be an integer")
        if "when" not in branch:
            raise ProgramValidationError("branch when is required")
        _validate_node(branch["when"], "when")

    checkpoint = program.get("checkpoint", {})
    if checkpoint is not None:
        if not isinstance(checkpoint, Mapping):
            raise ProgramValidationError("checkpoint must be an object")
        for name, operand in checkpoint.items():
            if not isinstance(name, str) or not name:
                raise ProgramValidationError("checkpoint keys must be non-empty strings")
            _validate_operand(operand)

    return copy.deepcopy(dict(program))


def evaluate_program(program: Mapping[str, Any], *, facts: Mapping[str, Any], checkpoint: Mapping[str, Any], now: str) -> dict:
    normalized = validate_program(program)
    base_context = {
        "config": normalized.get("config", {}),
        "facts": facts,
        "checkpoint": checkpoint,
        "now": now,
    }

    evaluated_branches = []
    for branch in normalized["branches"]:
        branch_context = {**base_context, "_checkpoint_patch": {}}
        matched = _truth(branch["when"], branch_context)
        evaluated_branches.append((branch, matched, branch_context["_checkpoint_patch"]))

    branch, selected_patch = _selected_branch(evaluated_branches)

    checkpoint_patch: dict[str, Any] = {}
    if branch:
        _merge_patch(checkpoint_patch, selected_patch)
    else:
        for _branch, _matched, branch_patch in evaluated_branches:
            _merge_patch(checkpoint_patch, branch_patch)
    _merge_patch(checkpoint_patch, _checkpoint_patch(normalized.get("checkpoint", {}), base_context))

    return {
        "matched_branch": branch["id"] if branch else "",
        "reason": "matched" if branch else "no_match",
        "evidence_refs": [],
        "checkpoint_patch": checkpoint_patch,
        "loop_decision": "continue",
    }


def _validate_node(node: Any, field_name: str = "node") -> None:
    if isinstance(node, str) and field_name == "when":
        raise ProgramValidationError("when must be an AST object")
    if not isinstance(node, Mapping):
        raise ProgramValidationError(f"{field_name} must be an AST object")
    if len(node) != 1:
        raise ProgramValidationError("AST node must contain exactly one operator")
    operator, value = next(iter(node.items()))
    if operator not in OPERATORS:
        raise ProgramValidationError(f"unsupported operator: {operator}")

    if operator in {"all", "any"}:
        if not isinstance(value, list):
            raise ProgramValidationError(f"{operator} requires a list")
        for child in value:
            _validate_node(child)
        return
    if operator == "not":
        _validate_node(value)
        return
    if operator in COMPARATORS:
        _validate_operands(value, operator, count=2)
        return
    if operator == "exists":
        _validate_operand(value)
        return
    if operator == "changed":
        _validate_operands(value, operator, count=2)
        return
    if operator == "consecutive_matches":
        _validate_consecutive_matches(value)
        return
    if operator == "cooldown_elapsed":
        _validate_cooldown_elapsed(value)


def _validate_operands(value: Any, operator: str, *, count: int) -> None:
    if not isinstance(value, list) or len(value) != count:
        raise ProgramValidationError(f"{operator} requires {count} operands")
    for operand in value:
        _validate_operand(operand)


def _validate_operand(value: Any) -> None:
    if isinstance(value, Mapping):
        if set(value) == {"path"}:
            _validate_path(value["path"])
            return
        if "path" in value:
            raise ProgramValidationError("path operand must contain only path")
        for child in value.values():
            _validate_operand(child)
    elif isinstance(value, list):
        for child in value:
            _validate_operand(child)


def _validate_path(path: Any) -> None:
    if not isinstance(path, str) or not path:
        raise ProgramValidationError("path must be a non-empty string")
    parts = path.split(".")
    if not parts or parts[0] not in ALLOWED_PATH_ROOTS:
        raise ProgramValidationError("unknown operand root")
    if any(not part for part in parts):
        raise ProgramValidationError("path parts must be non-empty")


def _validate_consecutive_matches(value: Any) -> None:
    if not isinstance(value, Mapping):
        raise ProgramValidationError("consecutive_matches requires an object")
    if set(value) != {"id", "condition", "threshold", "checkpoint_path"}:
        raise ProgramValidationError("consecutive_matches requires id, condition, threshold, and checkpoint_path")
    if not isinstance(value["id"], str) or not value["id"]:
        raise ProgramValidationError("consecutive_matches id must be a non-empty string")
    if not isinstance(value["threshold"], int) or isinstance(value["threshold"], bool) or value["threshold"] < 1:
        raise ProgramValidationError("consecutive_matches threshold must be a positive integer")
    checkpoint_path = value["checkpoint_path"]
    _validate_path(checkpoint_path)
    if not str(checkpoint_path).startswith("checkpoint."):
        raise ProgramValidationError("consecutive_matches checkpoint_path must start with checkpoint")
    _validate_node(value["condition"], "condition")


def _validate_cooldown_elapsed(value: Any) -> None:
    if not isinstance(value, Mapping):
        raise ProgramValidationError("cooldown_elapsed requires an object")
    if set(value) != {"last_at", "seconds"}:
        raise ProgramValidationError("cooldown_elapsed requires last_at and seconds")
    _validate_operand(value["last_at"])
    seconds = value["seconds"]
    if not isinstance(seconds, (int, float)) or isinstance(seconds, bool) or seconds < 0:
        raise ProgramValidationError("cooldown_elapsed seconds must be a non-negative number")


def _truth(node: Mapping[str, Any], context: MutableMapping[str, Any]) -> bool:
    operator, value = next(iter(node.items()))
    if operator == "all":
        results = [_truth(child, context) for child in value]
        matched = all(results)
        failed_gate = any(not result and not _contains_consecutive_matches(child) for child, result in zip(value, results))
        if failed_gate:
            for child in value:
                _reset_consecutive_matches(child, context)
        return matched
    if operator == "any":
        return any([_truth(child, context) for child in value])
    if operator == "not":
        return not _truth(value, context)
    if operator in COMPARATORS:
        left = _resolve(value[0], context)
        right = _resolve(value[1], context)
        return _compare(operator, left, right)
    if operator == "exists":
        return _resolve(value, context) is not MISSING
    if operator == "changed":
        current = _resolve(value[0], context)
        previous = _resolve(value[1], context)
        return current is not MISSING and previous is not MISSING and current != previous
    if operator == "consecutive_matches":
        return _consecutive_matches(value, context)
    if operator == "cooldown_elapsed":
        return _cooldown_elapsed(value, context)
    raise ProgramValidationError(f"unsupported operator: {operator}")


def _selected_branch(evaluated_branches: list[tuple[Mapping[str, Any], bool, dict]]) -> tuple[Mapping[str, Any] | None, dict]:
    matches = [(branch, patch) for branch, matched, patch in evaluated_branches if matched]
    if not matches:
        return None, {}
    return max(matches, key=lambda item: (int(item[0].get("priority", 0)), item[0]["id"]))


def _reset_consecutive_matches(node: Mapping[str, Any], context: MutableMapping[str, Any]) -> None:
    operator, value = next(iter(node.items()))
    if operator == "consecutive_matches":
        _set_patch_path(context["_checkpoint_patch"], value["checkpoint_path"], {"count": 0})
        return
    if operator in {"all", "any"}:
        for child in value:
            _reset_consecutive_matches(child, context)
        return
    if operator == "not":
        _reset_consecutive_matches(value, context)


def _contains_consecutive_matches(node: Mapping[str, Any]) -> bool:
    operator, value = next(iter(node.items()))
    if operator == "consecutive_matches":
        return True
    if operator in {"all", "any"}:
        return any(_contains_consecutive_matches(child) for child in value)
    if operator == "not":
        return _contains_consecutive_matches(value)
    return False


def _resolve(value: Any, context: Mapping[str, Any]) -> Any:
    if not isinstance(value, Mapping) or set(value) != {"path"}:
        return value
    parts = str(value["path"]).split(".")
    if not parts or parts[0] not in ALLOWED_PATH_ROOTS:
        raise ProgramValidationError("unknown operand root")
    current: Any = context
    for part in parts:
        if not isinstance(current, Mapping) or part not in current:
            return MISSING
        current = current[part]
    return current


def _compare(operator: str, left: Any, right: Any) -> bool:
    if left is MISSING or right is MISSING:
        return False
    if operator == "eq":
        return left == right
    if operator == "ne":
        return left != right
    if operator == "in":
        if isinstance(right, (str, list, tuple, set, frozenset, dict)):
            return left in right
        return False
    if not _comparable(left, right):
        return False
    if operator == "lt":
        return left < right
    if operator == "lte":
        return left <= right
    if operator == "gt":
        return left > right
    if operator == "gte":
        return left >= right
    return False


def _comparable(left: Any, right: Any) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        return False
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return True
    return type(left) is type(right) and isinstance(left, str)


def _consecutive_matches(value: Mapping[str, Any], context: MutableMapping[str, Any]) -> bool:
    matched = _truth(value["condition"], context)
    current_state = _resolve({"path": value["checkpoint_path"]}, context)
    if isinstance(current_state, Mapping):
        prior_count = current_state.get("count", 0)
    else:
        prior_count = 0
    if not isinstance(prior_count, int) or isinstance(prior_count, bool) or prior_count < 0:
        prior_count = 0

    count = prior_count + 1 if matched else 0
    _set_patch_path(context["_checkpoint_patch"], value["checkpoint_path"], {"count": count})
    return count >= value["threshold"]


def _cooldown_elapsed(value: Mapping[str, Any], context: Mapping[str, Any]) -> bool:
    last_at = _resolve(value["last_at"], context)
    if last_at is MISSING or last_at in (None, ""):
        return True
    last_dt = _parse_datetime(last_at)
    now_dt = _parse_datetime(context["now"])
    if last_dt is None or now_dt is None:
        return False
    return (now_dt - last_dt).total_seconds() >= float(value["seconds"])


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _checkpoint_patch(checkpoint_spec: Mapping[str, Any], context: Mapping[str, Any]) -> dict:
    patch: dict[str, Any] = {}
    for name, operand in checkpoint_spec.items():
        value = _resolve(operand, context)
        if value is not MISSING:
            patch[name] = value
    return patch


def _set_patch_path(patch: MutableMapping[str, Any], checkpoint_path: str, value: Any) -> None:
    parts = checkpoint_path.split(".")
    if not parts or parts[0] != "checkpoint":
        raise ProgramValidationError("checkpoint patch path must start with checkpoint")
    current = patch
    for part in parts[1:-1]:
        next_value = current.setdefault(part, {})
        if not isinstance(next_value, MutableMapping):
            next_value = {}
            current[part] = next_value
        current = next_value
    current[parts[-1]] = value


def _merge_patch(target: MutableMapping[str, Any], patch: Mapping[str, Any]) -> None:
    for key, value in patch.items():
        if isinstance(value, Mapping) and isinstance(target.get(key), MutableMapping):
            _merge_patch(target[key], value)
        else:
            target[key] = value
