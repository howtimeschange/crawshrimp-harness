"""Durable controller for local Agent Automations.

The controller is intentionally a thin orchestration layer around the
SQLite-backed automation tables and the isolated scheduler namespace.  It
does not know how to browse, call an external API, or mutate a business
system.  Those capabilities are supplied by the observer/action executors
(the AgentService bridge is added by a later task).
"""

from __future__ import annotations

import asyncio
import copy
import inspect
import json
import logging
import math
import uuid
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from core import data_sink
from core.automation_policy import automation_policy_error
from core.automation_program import ProgramValidationError, evaluate_program, validate_program


logger = logging.getLogger(__name__)

DEFAULT_TIMEZONE = "Asia/Shanghai"
MAX_LOOP_INTERVAL_SECONDS = 7 * 24 * 60 * 60
MAX_LOOP_COUNT = 1_000_000
AUTOMATION_UNATTENDED_RISKS = {
    "read_only",
    "local_write",
    "external_write",
    "destructive",
}
ACTIVE_RUN_STATUSES = {"claimed", "queued", "running", "retry_scheduled"}
TERMINAL_RUN_STATUSES = {
    "completed",
    "failed",
    "skipped_overlap",
    "canceled",
    "missed",
    "needs_review",
}
# These are concrete MCP tool names, not abstract labels such as ``observe``.
# The active Automation policy is also enforced at MCP registration time, but
# this phase boundary prevents a loop's observation turn from receiving a
# write-capable tool in the first place.
READ_ONLY_MCP_TOOLS = {
    "tasks_search", "task_describe", "task_status", "task_wait",
    "artifacts_list", "data_preview", "data_analyze",
    "browser_observe", "browser_capture_requests",
    "script_list", "script_describe", "skill_list", "skill_read",
    "attachment_read", "fs_read", "fs_list", "image_assets", "video_assets",
    "repo_list", "automation_record_observation",
}


def _now_datetime(now: Any = None, timezone_value: Optional[ZoneInfo] = None) -> datetime:
    zone = timezone_value or ZoneInfo(DEFAULT_TIMEZONE)
    if isinstance(now, datetime):
        value = now
    elif now is None or str(now).strip() == "":
        return datetime.now(timezone.utc)
    else:
        text = str(now).strip()
        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"
        try:
            value = datetime.fromisoformat(text)
        except (TypeError, ValueError) as exc:
            raise ValueError("now must be an ISO-8601 datetime") from exc
    if value.tzinfo is None:
        return value.replace(tzinfo=zone)
    return value


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _as_datetime(value: Any, timezone_value: ZoneInfo, *, field_name: str) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value or "").strip()
        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"
        try:
            parsed = datetime.fromisoformat(text)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{field_name} must be an ISO-8601 datetime") from exc
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone_value)
    return parsed.astimezone(timezone_value)


def _schedule(automation: Mapping[str, Any]) -> dict:
    value = automation.get("schedule")
    return dict(value) if isinstance(value, Mapping) else {}


def _timezone(schedule: Mapping[str, Any]) -> ZoneInfo:
    name = str(
        schedule.get("timezone")
        or schedule.get("iana_timezone")
        or schedule.get("tz")
        or DEFAULT_TIMEZONE
    ).strip()
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"automation schedule timezone must be an IANA name: {name}") from exc


def _kind(automation: Mapping[str, Any]) -> str:
    if str(automation.get("automation_kind") or "").strip().lower() == "loop":
        return "loop"
    schedule = _schedule(automation)
    return str(schedule.get("kind") or schedule.get("type") or "").strip().lower()


def _interval_seconds(policy: Mapping[str, Any]) -> int:
    for key in (
        "cycle_interval_seconds",
        "interval_seconds",
        "every_seconds",
        "seconds",
        "cycle_interval",
        "interval",
    ):
        value = policy.get(key)
        if value is None or str(value).strip() == "":
            continue
        try:
            seconds = int(float(value))
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError("loop interval must be a positive number of seconds") from exc
        if seconds > MAX_LOOP_INTERVAL_SECONDS:
            raise ValueError(f"loop interval must be at most {MAX_LOOP_INTERVAL_SECONDS} seconds")
        if seconds > 0:
            return seconds
    for key, multiplier in (("cycle_interval_minutes", 60), ("interval_minutes", 60), ("minutes", 60)):
        value = policy.get(key)
        if value is None or str(value).strip() == "":
            continue
        try:
            seconds = int(float(value) * multiplier)
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError("loop interval must be a positive number") from exc
        if seconds > MAX_LOOP_INTERVAL_SECONDS:
            raise ValueError(f"loop interval must be at most {MAX_LOOP_INTERVAL_SECONDS} seconds")
        if seconds > 0:
            return seconds
    return 3600


def _strict_integer(value: Any, *, field_name: str, minimum: int, maximum: int) -> int:
    """Normalize a bounded integer without silently truncating user input."""
    if isinstance(value, bool) or (isinstance(value, float) and not math.isfinite(value)):
        raise ValueError(f"{field_name} must be an integer")
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{field_name} must be an integer") from exc
    if str(value).strip() not in {str(parsed), f"{parsed}.0"}:
        raise ValueError(f"{field_name} must be an integer")
    if parsed < minimum or parsed > maximum:
        raise ValueError(f"{field_name} must be between {minimum} and {maximum}")
    return parsed


def _lifecycle_flag(value: Any, *, field_name: str, default: bool) -> bool:
    """Normalize storage booleans without treating arbitrary JSON strings as true."""
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in {0, 1}:
        # SQLite readbacks use 0/1.  Keep the Controller usable with its own
        # persisted definitions while refusing ambiguous MCP JSON values.
        return bool(value)
    raise ValueError(f"{field_name} must be a boolean")


def _merge_patch(base: Mapping[str, Any], patch: Mapping[str, Any]) -> dict:
    result = copy.deepcopy(dict(base))
    for key, value in patch.items():
        if isinstance(value, Mapping) and isinstance(result.get(key), Mapping):
            result[key] = _merge_patch(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def _policy_toolset(policy: Mapping[str, Any]) -> list[str]:
    raw = policy.get("toolset")
    if raw is None:
        raw = policy.get("allowed_capabilities")
    if not isinstance(raw, (list, tuple, set)):
        return []
    return sorted({str(item).strip() for item in raw if str(item).strip()})


def _read_only_policy(policy: Mapping[str, Any]) -> dict:
    result = copy.deepcopy(dict(policy))
    allowed = _policy_toolset(policy)
    result["risk"] = "read_only"
    result["toolset"] = [item for item in allowed if item in READ_ONLY_MCP_TOOLS]
    if "allowed_capabilities" in result:
        result["allowed_capabilities"] = list(result["toolset"])
    return result


def _executor_args(executor: Callable, canonical: tuple[Any, ...], aliases: Mapping[str, Any]) -> tuple[Any, ...]:
    """Adapt the small test-executor API without swallowing executor errors."""
    try:
        signature = inspect.signature(executor)
    except (TypeError, ValueError):
        return canonical
    parameters = list(signature.parameters.values())
    if any(param.kind == inspect.Parameter.VAR_POSITIONAL for param in parameters):
        return canonical
    positional = [
        param for param in parameters
        if param.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
    ]
    if len(positional) >= len(canonical):
        return canonical
    args: list[Any] = []
    for index, param in enumerate(positional):
        name = str(param.name or "").lower()
        args.append(aliases.get(name, canonical[min(index, len(canonical) - 1)]))
    return tuple(args)


async def _invoke(executor: Callable, canonical: tuple[Any, ...], aliases: Mapping[str, Any]):
    args = _executor_args(executor, canonical, aliases)
    result = executor(*args)
    if inspect.isawaitable(result):
        return await result
    return result


class AutomationController:
    """Own Automation lifecycle, durable trigger claiming and checkpoints."""

    def __init__(
        self,
        agent_service: Any,
        scheduler_module: Any,
        *,
        observer_executor: Optional[Callable] = None,
        action_executor: Optional[Callable] = None,
    ) -> None:
        self.agent_service = agent_service
        self.scheduler = scheduler_module
        self.observer_executor = observer_executor
        self.action_executor = action_executor
        self._claim_locks: dict[str, asyncio.Lock] = {}

    def _lock(self, automation_uid: str) -> asyncio.Lock:
        uid = str(automation_uid or "").strip()
        lock = self._claim_locks.get(uid)
        if lock is None:
            lock = asyncio.Lock()
            self._claim_locks[uid] = lock
        return lock

    def _default_executor(self, *, action: bool) -> Optional[Callable]:
        if action and self.action_executor is not None:
            return self.action_executor
        if not action and self.observer_executor is not None:
            return self.observer_executor
        # Task 4 adds submit_automation_turn to AgentService.  Until then a
        # missing method is an explicit unavailable-executor boundary rather
        # than permission to fake a successful external action.
        if self.agent_service is None:
            return None
        submit = getattr(self.agent_service, "submit_automation_turn", None)
        if not callable(submit):
            return None

        async def _submit(automation, run, *args):
            branch = args[0] if action and args else None
            if action:
                toolset = args[-1] if args else []
            else:
                observer_policy = args[0] if args and isinstance(args[0], Mapping) else {}
                toolset = _policy_toolset(observer_policy)
            objective = str(automation.get("objective_prompt") or "")
            if isinstance(branch, Mapping):
                objective = str(branch.get("objective") or branch.get("action") or objective)
            return await _invoke(
                submit,
                (automation, run, objective, list(toolset)),
                {
                    "automation": automation,
                    "run": run,
                    "prompt": objective,
                    "toolset": list(toolset),
                },
            )

        return _submit

    @staticmethod
    def _automation_or_raise(uid: str) -> dict:
        automation = data_sink.get_agent_automation(uid)
        if not automation:
            raise ValueError(f"Automation not found: {uid}")
        return automation

    @staticmethod
    def _normalized_definition(
        values: Mapping[str, Any],
        *,
        now: Any = None,
        validate_one_time_future: bool = True,
    ) -> dict:
        """Validate the durable definition shape before it reaches SQLite."""
        source = copy.deepcopy(dict(values or {}))
        title = str(source.get("title") or "").strip()
        objective_prompt = str(source.get("objective_prompt") or "").strip()
        if not title:
            raise ValueError("automation title is required")
        if len(title) > 120:
            raise ValueError("automation title must be at most 120 characters")
        if not objective_prompt:
            raise ValueError("automation objective_prompt is required")
        if len(objective_prompt) > 20_000:
            raise ValueError("automation objective_prompt must be at most 20000 characters")
        source["title"] = title
        source["objective_prompt"] = objective_prompt
        kind = str(source.get("automation_kind") or "").strip().lower()
        if kind not in {"scheduled", "loop"}:
            raise ValueError("automation_kind must be scheduled or loop")
        source["enabled"] = _lifecycle_flag(
            source.get("enabled"), field_name="enabled", default=True,
        )
        source["archived"] = _lifecycle_flag(
            source.get("archived"), field_name="archived", default=False,
        )
        context_mode = str(source.get("context_mode") or "isolated").strip().lower()
        if context_mode not in {"isolated", "inherited"}:
            raise ValueError("context_mode must be isolated or inherited")
        source["context_mode"] = context_mode
        schedule = source.get("schedule")
        if schedule is None:
            schedule = {}
        if not isinstance(schedule, Mapping):
            raise ValueError("schedule must be an object")
        normalized_schedule = dict(schedule)
        normalized_schedule.setdefault("timezone", DEFAULT_TIMEZONE)
        schedule_timezone = _timezone(normalized_schedule)
        if kind == "scheduled":
            schedule_kind = str(normalized_schedule.get("kind") or normalized_schedule.get("type") or "").strip().lower()
            if schedule_kind not in {"at", "every", "cron"}:
                raise ValueError("scheduled Automation requires schedule kind at, every, or cron")
            normalized_schedule["kind"] = schedule_kind
            if schedule_kind == "at":
                at_value = (
                    normalized_schedule.get("value")
                    or normalized_schedule.get("at")
                    or normalized_schedule.get("run_at")
                )
                scheduled_at = _as_datetime(at_value, schedule_timezone, field_name="at value")
                current = _now_datetime(now, schedule_timezone).astimezone(schedule_timezone)
                if validate_one_time_future and scheduled_at <= current:
                    raise ValueError("one-time Automation schedule must be in the future")
            if schedule_kind == "every" and not any(normalized_schedule.get(key) for key in ("anchor", "anchor_at", "start_at", "first_run_at")):
                normalized_schedule["anchor"] = _now_datetime(now, schedule_timezone).isoformat()
            probe = {"automation_kind": "scheduled", "schedule": normalized_schedule, "next_run_at": source.get("next_run_at") or ""}
            # Reuse the scheduler parser so cron grammar, at values, and every
            # duration stay identical at API/MCP/controller boundaries.
            from core import scheduler as scheduler_module
            scheduler_module._automation_trigger(probe, now=_now_datetime(now, schedule_timezone))
        source["schedule"] = normalized_schedule
        loop_policy = source.get("loop_policy")
        if loop_policy is None:
            loop_policy = {}
        if not isinstance(loop_policy, Mapping):
            raise ValueError("loop_policy must be an object")
        source["loop_policy"] = dict(loop_policy)
        if kind == "loop":
            source["loop_policy"].setdefault("cycle_interval_seconds", 1800)
            source["loop_policy"].setdefault("max_cycles", 0)
            source["loop_policy"].setdefault("failure_threshold", 3)
        for field, minimum, maximum in (
            ("cycle_interval_seconds", 1, MAX_LOOP_INTERVAL_SECONDS),
            ("max_cycles", 0, MAX_LOOP_COUNT),
            ("failure_threshold", 1, MAX_LOOP_COUNT),
            ("failure_count", 0, MAX_LOOP_COUNT),
        ):
            if field in source["loop_policy"]:
                source["loop_policy"][field] = _strict_integer(
                    source["loop_policy"][field],
                    field_name=f"loop_policy.{field}",
                    minimum=minimum,
                    maximum=maximum,
                )
        execution_policy = source.get("execution_policy")
        if execution_policy is None:
            execution_policy = {}
        if not isinstance(execution_policy, Mapping):
            raise ValueError("execution_policy must be an object")
        source["execution_policy"] = dict(execution_policy)
        for field, minimum, maximum in (
            ("timeout_seconds", 1, 2 * 60 * 60),
            ("max_retries", 0, 20),
            ("retry_backoff_seconds", 1, 24 * 60 * 60),
            ("inherited_wait_seconds", 1, 2 * 60 * 60),
        ):
            if field not in source["execution_policy"]:
                continue
            source["execution_policy"][field] = _strict_integer(
                source["execution_policy"][field],
                field_name=f"execution_policy.{field}",
                minimum=minimum,
                maximum=maximum,
            )
        allowed_tools = _policy_toolset(source["execution_policy"])
        if allowed_tools:
            # Keep the durable definition honest: a capability label can never
            # become a callable permission.  Import lazily to keep the
            # Controller independent from MCP startup order.
            from core.agent.mcp_gateway import EXPECTED_TOOLS
            unknown_tools = sorted(set(allowed_tools) - set(EXPECTED_TOOLS))
            if unknown_tools:
                raise ValueError(
                    "execution_policy.toolset contains unknown MCP tools: "
                    + ", ".join(unknown_tools)
                )
        source["execution_policy"]["toolset"] = allowed_tools
        policy_error = automation_policy_error(source["execution_policy"])
        if policy_error:
            raise ValueError(policy_error)
        raw_risks = source["execution_policy"].get("allowed_risks")
        if raw_risks is not None:
            if not isinstance(raw_risks, (list, tuple, set)):
                raise ValueError("execution_policy.allowed_risks must be an array")
            allowed_risks = sorted({str(value).strip() for value in raw_risks if str(value).strip()})
            unknown_risks = sorted(set(allowed_risks) - AUTOMATION_UNATTENDED_RISKS)
            if unknown_risks:
                raise ValueError(
                    "execution_policy.allowed_risks contains unknown values: "
                    + ", ".join(unknown_risks)
                )
            source["execution_policy"]["allowed_risks"] = allowed_risks
        program = source.get("program")
        if program is not None:
            if not isinstance(program, Mapping):
                raise ProgramValidationError("program must be an object")
            source["program"] = validate_program(program)
        if kind == "loop" and not source.get("program") and not source.get("active_program_version_uid"):
            raise ValueError("loop Automation requires a Program")
        return source

    def create(self, values: Mapping[str, Any], *, now: Any = None) -> dict:
        """Persist a normalized definition, version its Program, then register it."""
        normalized = self._normalized_definition(values, now=now)
        program = normalized.pop("program", None)
        if normalized.get("automation_kind") == "loop" and not str(normalized.get("next_run_at") or "").strip():
            zone = _timezone(normalized["schedule"])
            normalized["next_run_at"] = (
                _now_datetime(now, zone) + timedelta(seconds=_interval_seconds(normalized["loop_policy"]))
            ).isoformat()
        automation = data_sink.create_agent_automation(normalized)
        if program:
            version = data_sink.create_agent_automation_program(
                automation["automation_uid"],
                program,
                created_by_session_id=str(normalized.get("source_session_id") or ""),
            )
            automation = data_sink.update_agent_automation(
                automation["automation_uid"],
                active_program_version_uid=version["program_version_uid"],
            )
        return self._refresh_at(automation, now=now)

    def update(self, automation_uid: str, values: Mapping[str, Any], *, now: Any = None) -> dict:
        """Update a definition through the Controller and version a new Program."""
        existing = self._automation_or_raise(automation_uid)
        if "context_mode" in values:
            previous_mode = str(existing.get("context_mode") or "isolated").strip().lower()
            proposed_mode = str(values.get("context_mode") or "").strip().lower()
            if proposed_mode != previous_mode:
                raise ValueError("context_mode is immutable after Automation creation")
        # The source conversation is an auditable origin binding, not mutable
        # delivery routing.  Allowing a later PATCH to replace it lets an
        # untrusted model turn redirect a scheduled receipt into a different
        # local conversation even though the MCP surface rejects that change.
        # Enforce the invariant at the Controller boundary as well, so HTTP
        # and future callers cannot bypass it.
        for field in ("source_session_id", "source_runtime_session_id"):
            if field not in values:
                continue
            previous = str(existing.get(field) or "").strip()
            proposed = str(values.get(field) or "").strip()
            if proposed != previous:
                raise ValueError(f"{field} is immutable after Automation creation")
        candidate = {**existing, **copy.deepcopy(dict(values or {}))}
        incoming_policy = values.get("execution_policy")
        if isinstance(incoming_policy, Mapping):
            existing_policy = existing.get("execution_policy")
            existing_policy = existing_policy if isinstance(existing_policy, Mapping) else {}
            # The management surfaces use PATCH semantics.  An editor may
            # change just a timeout or retry control; treating that small
            # object as a replacement silently drops the previously approved
            # tool/risk policy and can make a valid Automation unable to
            # complete.  Merge first, while retaining explicit empty arrays
            # or false values supplied by the caller as deliberate changes.
            candidate["execution_policy"] = {
                **copy.deepcopy(dict(existing_policy)),
                **copy.deepcopy(dict(incoming_policy)),
            }
            bound_tab_id = str(existing_policy.get("browser_tab_id") or "").strip()
            proposed_tab_id = str(incoming_policy.get("browser_tab_id") or "").strip()
            if bound_tab_id:
                # A browser grant belongs to the context that created this
                # Automation.  A PATCH may omit it while changing other
                # policy fields, but may never redirect or remove it.
                if "browser_tab_id" in incoming_policy and proposed_tab_id != bound_tab_id:
                    raise ValueError("execution_policy.browser_tab_id is immutable after Automation creation")
                candidate["execution_policy"]["browser_tab_id"] = bound_tab_id
            elif proposed_tab_id:
                # The MCP creation boundary captures the current authorized
                # tab before persistence.  Adding one later would let a
                # definition edit acquire an unrelated browser grant.
                raise ValueError("execution_policy.browser_tab_id can only be set when creating an Automation")
        incoming_loop_policy = values.get("loop_policy")
        if isinstance(incoming_loop_policy, Mapping):
            # API PATCH and the Automation Center send only editable loop
            # controls.  ``failure_count`` is Controller-owned runtime state,
            # so no definition edit may silently reset the circuit breaker.
            current_loop_policy = existing.get("loop_policy") if isinstance(existing.get("loop_policy"), Mapping) else {}
            candidate["loop_policy"] = {
                **copy.deepcopy(dict(current_loop_policy)),
                **copy.deepcopy(dict(incoming_loop_policy)),
            }
            if "failure_count" in current_loop_policy:
                candidate["loop_policy"]["failure_count"] = current_loop_policy["failure_count"]
            else:
                candidate["loop_policy"].pop("failure_count", None)
        previous_automation_kind = str(existing.get("automation_kind") or "").strip().lower()
        requested_automation_kind = str(candidate.get("automation_kind") or "").strip().lower()
        # ``get_agent_automation`` exposes the active Program as a decoded
        # readback field.  A scheduled Automation with no Program therefore
        # reads back as ``{}``; treating that derived empty object as a PATCH
        # input makes unrelated updates fail validation.  Only validate/version
        # Program data when the caller explicitly supplied it.  An existing
        # loop still retains its durable active_program_version_uid.
        if "program" not in values:
            candidate.pop("program", None)
        clear_program = "program" in values and values.get("program") is None
        if clear_program and str(candidate.get("automation_kind") or "").strip().lower() == "loop":
            raise ValueError("loop Automation requires a Program")
        if requested_automation_kind == "loop" and previous_automation_kind != "loop":
            # A loop is completion-driven and must never inherit an old
            # scheduled DateTrigger cursor. Preserve the explicit timezone so
            # its future DateTrigger remains correctly localized.
            previous_schedule = existing.get("schedule") if isinstance(existing.get("schedule"), Mapping) else {}
            requested_schedule = candidate.get("schedule") if isinstance(candidate.get("schedule"), Mapping) else {}
            candidate["schedule"] = {
                "timezone": str(requested_schedule.get("timezone") or previous_schedule.get("timezone") or DEFAULT_TIMEZONE),
            }
            loop_policy = candidate.get("loop_policy") if isinstance(candidate.get("loop_policy"), Mapping) else {}
            zone = _timezone(candidate["schedule"])
            candidate["next_run_at"] = (
                _now_datetime(now, zone) + timedelta(seconds=_interval_seconds(loop_policy))
            ).isoformat()
        # A completed one-time schedule keeps its original trigger as audit
        # history. Editing unrelated metadata must not turn that immutable
        # past timestamp into a validation failure. Any schedule edit (or a
        # switch into scheduled mode) still requires a future one-time value.
        schedule_changed = "schedule" in values
        if schedule_changed:
            previous_schedule = existing.get("schedule") if isinstance(existing.get("schedule"), Mapping) else {}
            proposed_schedule = candidate.get("schedule") if isinstance(candidate.get("schedule"), Mapping) else {}
            previous_kind = str(previous_schedule.get("kind") or previous_schedule.get("type") or "").strip().lower()
            proposed_kind = str(proposed_schedule.get("kind") or proposed_schedule.get("type") or "").strip().lower()
            # datetime-local controls omit the original offset on PATCH. Treat
            # equivalent one-time instants as unchanged so a title edit after
            # completion does not fail merely because the UI round-tripped it.
            if previous_kind == proposed_kind == "at":
                try:
                    previous_at = _as_datetime(
                        previous_schedule.get("value") or previous_schedule.get("at") or previous_schedule.get("run_at"),
                        _timezone(previous_schedule),
                        field_name="existing at value",
                    )
                    proposed_at = _as_datetime(
                        proposed_schedule.get("value") or proposed_schedule.get("at") or proposed_schedule.get("run_at"),
                        _timezone(proposed_schedule),
                        field_name="at value",
                    )
                    schedule_changed = proposed_at != previous_at
                except (TypeError, ValueError, ZoneInfoNotFoundError):
                    # Let normal definition validation return the precise
                    # invalid-schedule error below.
                    schedule_changed = True
            else:
                schedule_changed = proposed_schedule != previous_schedule
            if not schedule_changed:
                candidate["schedule"] = copy.deepcopy(previous_schedule)
        elif requested_automation_kind != previous_automation_kind:
            schedule_changed = True
        if schedule_changed:
            # Retry wake-ups belong to the definition that produced the
            # failure.  A schedule edit supersedes that definition, so never
            # let a persisted retry reattach to the replacement schedule.
            candidate["retry_at"] = ""
        if schedule_changed and requested_automation_kind != "loop":
            # A changed schedule owns a new trigger bucket. Leaving the former
            # cursor in place makes the new APScheduler job run at one time
            # while the durable Run records another.
            candidate["next_run_at"] = ""
            candidate_schedule = candidate.get("schedule") if isinstance(candidate.get("schedule"), Mapping) else {}
            if str(
                candidate_schedule.get("kind")
                or candidate_schedule.get("type")
                or ""
            ).strip().lower() == "at":
                # ``last_triggered_at`` belongs to the old trigger cursor. A
                # new one-time definition must not inherit that historical
                # marker, otherwise _trigger_time treats its future DateTrigger
                # as already consumed and never registers it.
                candidate["last_triggered_at"] = ""
        validate_one_time_future = schedule_changed or (
            "automation_kind" in values
            and str(candidate.get("automation_kind") or "").strip().lower() == "scheduled"
        )
        normalized = self._normalized_definition(
            candidate,
            now=now,
            validate_one_time_future=validate_one_time_future,
        )
        program = normalized.pop("program", None)
        update_fields = {
            key: normalized[key]
            for key in (
                "title", "objective_prompt", "automation_kind", "enabled", "archived", "context_mode",
                "source_session_id", "source_runtime_session_id", "schedule", "loop_policy", "execution_policy",
                "next_run_at", "retry_at", "last_triggered_at",
            )
            if key in normalized
        }
        automation = data_sink.update_agent_automation(automation_uid, **update_fields)
        if schedule_changed:
            # A retry-scheduled row has no live Agent Run, so it can be
            # closed synchronously. Running/queued old work is intentionally
            # kept as immutable audit history; its later terminal projection
            # is prevented from changing this replacement definition below.
            for run in data_sink.list_agent_automation_runs(automation_uid, 500):
                if str(run.get("status") or "") == "retry_scheduled":
                    data_sink.update_agent_automation_run(
                        str(run.get("run_uid") or ""),
                        status="canceled",
                        error_code="CANCELED_BY_DEFINITION_CHANGE",
                        error_message="Retry canceled because the Automation definition changed",
                        finished_at=_iso_now(),
                    )
        if clear_program:
            automation = data_sink.update_agent_automation(
                automation_uid,
                active_program_version_uid="",
            )
        elif program and program != existing.get("program"):
            version = data_sink.create_agent_automation_program(
                automation_uid,
                program,
                created_by_session_id=str(automation.get("source_session_id") or ""),
            )
            automation = data_sink.update_agent_automation(
                automation_uid,
                active_program_version_uid=version["program_version_uid"],
            )
        return self._refresh_at(automation, now=now)

    def get(self, automation_uid: str) -> dict:
        return self._automation_or_raise(automation_uid)

    def list(self, *, include_archived: bool = False) -> list[dict]:
        return data_sink.list_agent_automations(include_archived=include_archived)

    def runs(self, automation_uid: str, *, limit: int = 50) -> list[dict]:
        self._automation_or_raise(automation_uid)
        return data_sink.list_agent_automation_runs(automation_uid, limit)

    async def wait_for_run(self, run_uid: str, *, timeout_seconds: int = 30) -> dict:
        """Wait briefly for one persisted run without creating another Agent Turn."""
        timeout = _strict_integer(
            timeout_seconds,
            field_name="timeout_seconds",
            minimum=1,
            maximum=60,
        )
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            run = data_sink.get_agent_automation_run(str(run_uid or "").strip())
            if not run:
                raise ValueError(f"Automation run not found: {run_uid}")
            if str(run.get("status") or "") in TERMINAL_RUN_STATUSES:
                return run
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                return {**run, "wait_timed_out": True}
            await asyncio.sleep(min(1.0, remaining))

    def state_for_run(self, run_uid: str) -> dict:
        """Return the compact persistent state available to the current run."""
        run = data_sink.get_agent_automation_run(str(run_uid or "").strip())
        if not run:
            raise ValueError(f"Automation run not found: {run_uid}")
        automation = self._automation_or_raise(str(run.get("automation_uid") or ""))
        checkpoint = automation.get("checkpoint")
        return dict(checkpoint) if isinstance(checkpoint, Mapping) else {}

    def reconcile_interrupted_agent_runs(self) -> int:
        """Release Automation Runs whose Agent turns were interrupted on boot.

        AgentService intentionally performs its own SQLite recovery before the
        Controller is constructed. Without this handoff, a durable Automation
        Run can remain queued/running forever after a backend restart and block
        every later single-flight trigger.  We do not replay uncertain work:
        the Controller projects it to the existing review boundary.
        """
        try:
            from core.agent import db as agent_db
        except Exception:  # noqa: BLE001
            logger.exception("Unable to load Agent DB for Automation recovery")
            return 0
        reconciled = 0
        # Query unfinished runs directly: a history-page limit can hide an
        # orphan behind hundreds of skipped triggers. Persisted retries have
        # their own recovery path and must not be treated as crash orphans.
        for run in data_sink.list_agent_automation_dispatch_runs():
            agent_run_id = str(run.get("agent_run_id") or "").strip()
            agent_run = (agent_db.get_run(agent_run_id) or {}) if agent_run_id else {}
            if str(agent_run.get("status") or "") in {"queued", "running"}:
                continue
            result = self.mark_needs_review(
                str(run.get("run_uid") or ""),
                "AGENT_DISPATCH_INTERRUPTED",
                "Agent dispatch did not survive backend restart; previous work requires review",
            )
            if result and str(result.get("status") or "") in TERMINAL_RUN_STATUSES:
                reconciled += 1
        return reconciled

    def mark_inherited_wait_timeout(self, run_uid: str, agent_run_id: str, message: str) -> dict:
        """Finish one expired inherited-session queue wait without an action."""
        run = data_sink.get_agent_automation_run(run_uid)
        if not run or str(run.get("status") or "") in TERMINAL_RUN_STATUSES:
            return run
        if str(run.get("agent_run_id") or "") != str(agent_run_id or ""):
            return run
        skipped = data_sink.update_agent_automation_run(
            run_uid,
            status="skipped_overlap",
            error_code="INHERITED_CONTEXT_WAIT_TIMEOUT",
            error_message=str(message or "")[:500],
            finished_at=_iso_now(),
        )
        automation = self._automation_or_raise(str(skipped.get("automation_uid") or ""))
        execution_automation = self._definition_for_run(automation, skipped)
        updates: dict[str, Any] = {
            "last_status": "skipped_overlap",
            "last_error": "INHERITED_CONTEXT_WAIT_TIMEOUT",
        }
        execution_kind = _kind(execution_automation)
        owns_current_schedule = self._run_schedule_is_current(automation, skipped)
        if (
            execution_kind == "at"
            and owns_current_schedule
            and _kind(automation) == "at"
            and str(skipped.get("trigger_kind") or "") == "scheduled"
        ):
            updates.update({"enabled": False, "next_run_at": "", "retry_at": ""})
            self.scheduler.unregister_automation_schedule(automation["automation_uid"])
            self.scheduler.unregister_automation_retry(automation["automation_uid"])
        elif (
            execution_kind == "loop"
            and owns_current_schedule
            and _kind(automation) == "loop"
            and int(automation.get("enabled") or 0) == 1
            and int(automation.get("archived") or 0) == 0
        ):
            policy = automation.get("loop_policy") if isinstance(automation.get("loop_policy"), Mapping) else {}
            updates["next_run_at"] = (datetime.now(timezone.utc) + timedelta(seconds=_interval_seconds(policy))).isoformat()
        updated = data_sink.update_agent_automation(automation["automation_uid"], **updates)
        if execution_kind == "loop" and owns_current_schedule and _kind(automation) == "loop" and str(updated.get("next_run_at") or ""):
            self.refresh(automation["automation_uid"])
        return data_sink.get_agent_automation_run(run_uid)

    def _trigger_time(self, automation: Mapping[str, Any], *, now: Any = None) -> Optional[datetime]:
        schedule = _schedule(automation)
        zone = _timezone(schedule)
        persisted = str(automation.get("next_run_at") or "").strip()
        kind = _kind(automation)
        if persisted:
            return _as_datetime(persisted, zone, field_name="next_run_at")
        if kind == "loop":
            return None
        if kind == "at":
            # Once an ``at`` Automation has been claimed, its original date is
            # historical metadata, not a new wake-up to reconstruct on every
            # refresh/restart. Retries have their own ``retry_at`` job.
            if str(automation.get("last_triggered_at") or "").strip():
                return None
            value = schedule.get("value") or schedule.get("at") or schedule.get("run_at")
            return _as_datetime(value, zone, field_name="at value") if value else None
        if kind == "every":
            _, next_at = self.scheduler._automation_trigger(automation, now=_now_datetime(now, zone))
            return next_at
        if kind == "cron":
            trigger, _ = self.scheduler._automation_trigger(automation, now=_now_datetime(now, zone))
            return trigger.get_next_fire_time(None, _now_datetime(now, zone).astimezone(zone))
        return None

    def _is_overdue(self, automation: Mapping[str, Any], now: Any = None) -> bool:
        due = self._trigger_time(automation, now=now)
        if due is None:
            return False
        current = _now_datetime(now).astimezone(due.tzinfo)
        return due <= current

    def _next_cron_after(self, automation: Mapping[str, Any], previous: datetime) -> Optional[datetime]:
        trigger, _ = self.scheduler._automation_trigger(automation, now=previous)
        return trigger.get_next_fire_time(previous, previous)

    def _advance_scheduled_cursor(self, automation: Mapping[str, Any], trigger_at: str) -> None:
        if str(automation.get("automation_kind") or "").strip().lower() == "loop":
            return
        # The scheduler callback retains the definition that registered its
        # job. If a user edits the schedule while the callback is awaiting an
        # Agent submission, that old callback must not consume the new cursor.
        current = data_sink.get_agent_automation(str(automation.get("automation_uid") or ""))
        if not current or not self._run_schedule_is_current(
            current,
            {
                "definition_snapshot": {
                    "automation_kind": automation.get("automation_kind"),
                    "schedule": copy.deepcopy(_schedule(automation)),
                },
            },
        ):
            return
        automation = current
        kind = _kind(automation)
        schedule = _schedule(automation)
        zone = _timezone(schedule)
        try:
            previous = _as_datetime(trigger_at, zone, field_name="trigger_at")
            if kind == "at":
                # Keep the definition enabled while its one in-flight run is
                # eligible for a bounded retry. Completion/needs-review is the
                # terminal boundary that disables a one-time Automation.
                data_sink.update_agent_automation(automation["automation_uid"], next_run_at="")
                self.scheduler.unregister_automation_schedule(automation["automation_uid"])
                return
            if kind == "every":
                _, next_at = self.scheduler._automation_trigger(automation, now=previous)
            elif kind == "cron":
                next_at = self._next_cron_after(automation, previous)
            else:
                next_at = None
            if next_at is not None:
                data_sink.update_agent_automation(
                    automation["automation_uid"],
                    next_run_at=next_at.isoformat(),
                )
        except (TypeError, ValueError, ZoneInfoNotFoundError):
            logger.exception("Unable to advance Automation %s schedule cursor", automation.get("automation_uid"))

    def _refresh_at(self, automation: dict, *, now: Any = None) -> dict:
        uid = str(automation.get("automation_uid") or "").strip()
        # A retry is a second one-shot wake-up.  It must not replace a normal
        # cron/interval schedule, otherwise a transient failure silently moves
        # the next regular boundary.  The persisted retry_at makes recovery
        # after a backend restart deterministic.
        self.scheduler.unregister_automation_retry(uid)
        self.scheduler.unregister_automation_schedule(uid)
        policy_error = automation_policy_error(automation.get("execution_policy") or {})
        if policy_error:
            for run in data_sink.list_agent_automation_dispatch_runs(include_retries=True):
                if run.get("automation_uid") == uid and run.get("status") == "retry_scheduled":
                    self.mark_needs_review(run["run_uid"], "AUTOMATION_POLICY_CONFLICT", policy_error)
            return data_sink.update_agent_automation(
                uid, enabled=False, next_run_at="", retry_at="",
                last_status="needs_review", last_error=policy_error,
            )
        if not uid or int(automation.get("enabled") or 0) != 1 or int(automation.get("archived") or 0) == 1:
            return data_sink.get_agent_automation(uid) or automation
        if str(automation.get("retry_at") or "").strip():
            try:
                self.scheduler.register_automation_retry(automation, self._retry_callback)
            except (TypeError, ValueError, ZoneInfoNotFoundError):
                logger.exception("Unable to register Agent Automation retry %s", uid)
        kind = _kind(automation)
        if kind == "loop" and not str(automation.get("next_run_at") or "").strip():
            return data_sink.get_agent_automation(uid) or automation

        # Persist the initial one-time boundary. After it fires,
        # ``_advance_scheduled_cursor`` clears it and ``last_triggered_at``
        # prevents the historical schedule value from being registered again.
        if kind == "at" and not str(automation.get("next_run_at") or "").strip():
            due = self._trigger_time(automation, now=now)
            if due is None:
                return data_sink.get_agent_automation(uid) or automation
            automation = data_sink.update_agent_automation(uid, next_run_at=due.isoformat())

        current = _now_datetime(now)
        try:
            trigger, computed_next = self.scheduler._automation_trigger(automation, now=current)
            if kind == "every" and computed_next is not None:
                automation = data_sink.update_agent_automation(uid, next_run_at=computed_next.isoformat())
            elif kind == "cron" and not str(automation.get("next_run_at") or "").strip():
                zone = _timezone(_schedule(automation))
                next_at = trigger.get_next_fire_time(None, current.astimezone(zone))
                if next_at is not None:
                    automation = data_sink.update_agent_automation(uid, next_run_at=next_at.isoformat())
            callback = self._loop_callback if kind == "loop" else self._scheduled_callback
            self.scheduler.register_automation_schedule(automation, callback)
        except (TypeError, ValueError, ZoneInfoNotFoundError):
            logger.exception("Unable to register Agent Automation %s", uid)
        return data_sink.get_agent_automation(uid) or automation

    def refresh(self, automation_uid: str, *, now: Any = None) -> dict:
        """Rebuild one Automation's scheduler job from its SQLite definition."""
        automation = self._automation_or_raise(automation_uid)
        return self._refresh_at(automation, now=now)

    def restore(self, now: Any = None) -> list[dict]:
        """Rehydrate enabled Automations without catching up missed triggers."""
        current = _now_datetime(now)
        restored: list[dict] = []
        for automation in data_sink.list_agent_automations(enabled=True, include_archived=False):
            uid = str(automation.get("automation_uid") or "").strip()
            if automation_policy_error(automation.get("execution_policy") or {}):
                restored.append(self._refresh_at(automation, now=current))
                continue
            try:
                retry_at = str(automation.get("retry_at") or "").strip()
                if retry_at:
                    retry_due = _as_datetime(
                        retry_at,
                        _timezone(_schedule(automation)),
                        field_name="retry_at",
                    )
                    if retry_due <= current.astimezone(retry_due.tzinfo):
                        # A persisted retry is an attempt at an uncertain
                        # action, not a catch-up schedule. Replaying it after
                        # an offline interval can perform work at an
                        # unexpected time, so make the gap explicit instead.
                        self.scheduler.unregister_automation_retry(uid)
                        missed_retry = None
                        for run in data_sink.list_agent_automation_runs(uid, 500):
                            if str(run.get("status") or "") != "retry_scheduled":
                                continue
                            missed_retry = data_sink.update_agent_automation_run(
                                run["run_uid"],
                                status="needs_review",
                                error_code="RETRY_MISSED_WHILE_OFFLINE",
                                error_message="Automation retry was overdue when the backend started",
                                finished_at=current.isoformat(),
                            )
                            break
                        updates: dict[str, Any] = {
                            "retry_at": "",
                            "last_status": "needs_review",
                            "last_error": "RETRY_MISSED_WHILE_OFFLINE",
                        }
                        automation_kind = _kind(automation)
                        if automation_kind == "at":
                            updates.update({"enabled": False, "next_run_at": ""})
                            self.scheduler.unregister_automation_schedule(uid)
                        elif automation_kind == "loop":
                            # A loop retry has lost its exact execution
                            # boundary. Hold it for review; resume is an
                            # explicit user action that creates a new future
                            # cycle instead of replaying the old one.
                            updates["next_run_at"] = ""
                            self.scheduler.unregister_automation_schedule(uid)
                        restored_automation = data_sink.update_agent_automation(uid, **updates)
                        if automation_kind in {"every", "cron"}:
                            self._refresh_at(restored_automation, now=current)
                        restored.append(missed_retry or restored_automation)
                        continue
                due = self._trigger_time(automation, now=current)
                if due is not None and due <= current.astimezone(due.tzinfo):
                    trigger_kind = "loop" if _kind(automation) == "loop" else "scheduled"
                    trigger_uid = f"{trigger_kind}:{due.isoformat()}"
                    claimed = data_sink.claim_agent_automation_run(
                        uid,
                        trigger_kind,
                        trigger_uid,
                        trigger_at=due.isoformat(),
                        scheduled_at=due.isoformat(),
                    )
                    previous_run = claimed["run"]
                    if claimed["created"] or previous_run.get("status") in ACTIVE_RUN_STATUSES:
                        missed = data_sink.update_agent_automation_run(
                            previous_run["run_uid"],
                            status="missed",
                            error_code="MISSED_WHILE_OFFLINE",
                            error_message="Automation trigger was overdue when the backend started",
                            finished_at=current.isoformat(),
                        )
                    else:
                        missed = previous_run
                    updates = {
                        "next_run_at": "",
                        "last_status": "missed",
                        "last_error": "MISSED_WHILE_OFFLINE",
                    }
                    if _kind(automation) == "at":
                        updates["enabled"] = False
                    elif _kind(automation) == "loop":
                        # Do not replay work that was missed while offline,
                        # but a periodic loop must resume at its next future
                        # boundary instead of stopping permanently.
                        updates["next_run_at"] = (
                            current.astimezone(timezone.utc)
                            + timedelta(seconds=_interval_seconds(automation.get("loop_policy") or {}))
                        ).isoformat()
                    restored_automation = data_sink.update_agent_automation(uid, **updates)
                    self.scheduler.unregister_automation_schedule(uid)
                    # Recurring schedules get their next future boundary only;
                    # no missed trigger is ever replayed.
                    if _kind(automation) == "loop" or (
                        trigger_kind == "scheduled" and _kind(automation) in {"every", "cron"}
                    ):
                        self._refresh_at(restored_automation, now=current)
                    restored.append(missed)
                    continue
                restored.append(self._refresh_at(automation, now=current))
            except (TypeError, ValueError, ZoneInfoNotFoundError):
                logger.exception("Unable to restore Agent Automation %s", uid)
        return restored

    async def _scheduled_callback(self, automation_uid: str) -> dict:
        automation = data_sink.get_agent_automation(automation_uid)
        if not automation or int(automation.get("enabled") or 0) != 1 or int(automation.get("archived") or 0) == 1:
            return automation or {}
        zone = _timezone(_schedule(automation))
        trigger_at = str(automation.get("next_run_at") or "").strip()
        if not trigger_at:
            due = self._trigger_time(automation)
            trigger_at = due.isoformat() if due else _iso_now()
        trigger_uid = f"scheduled:{trigger_at}"
        result = await self._claim_and_start(automation_uid, "scheduled", trigger_uid, trigger_at)
        self._advance_scheduled_cursor(automation, trigger_at)
        return result

    async def _loop_callback(self, automation_uid: str) -> dict:
        automation = data_sink.get_agent_automation(automation_uid)
        if not automation or int(automation.get("enabled") or 0) != 1 or int(automation.get("archived") or 0) == 1:
            return automation or {}
        next_at = str(automation.get("next_run_at") or "").strip()
        if not next_at:
            return automation
        sequence = int(automation.get("cycle_seq") or 0) + 1
        return await self._claim_and_start(
            automation_uid,
            "loop",
            f"loop:{sequence}",
            next_at,
        )

    async def _retry_callback(self, automation_uid: str) -> dict:
        """Resume the same durable run after a bounded transient failure."""
        automation = data_sink.get_agent_automation(automation_uid)
        if not automation or int(automation.get("enabled") or 0) != 1 or int(automation.get("archived") or 0) == 1:
            return automation or {}
        async with self._lock(automation_uid):
            retries = [
                run for run in data_sink.list_agent_automation_runs(automation_uid, 500)
                if str(run.get("status") or "") == "retry_scheduled"
            ]
            if len(retries) != 1:
                self.scheduler.unregister_automation_retry(automation_uid)
                if str(automation.get("retry_at") or "").strip():
                    data_sink.update_agent_automation(automation_uid, retry_at="")
                return retries[0] if retries else automation
            retry = retries[0]
            # Clear the old Agent link before submitting a fresh Agent Run.
            # A late completion from the failed attempt then cannot mutate the
            # same Automation Run after its retry has begun.
            retry = data_sink.update_agent_automation_run(
                retry["run_uid"],
                status="claimed",
                agent_run_id="",
                agent_session_id="",
                error_code="",
                error_message="",
                finished_at="",
            )
            data_sink.update_agent_automation(automation_uid, retry_at="", last_status="claimed", last_error="")
            self.scheduler.unregister_automation_retry(automation_uid)
        return await self._start_run(retry)

    async def _claim_and_start(
        self,
        automation_uid: str,
        trigger_kind: str,
        trigger_uid: str,
        trigger_at: str,
        *,
        count_toward_max_cycles: bool = False,
    ) -> dict:
        uid = str(automation_uid or "").strip()
        automation = self._automation_or_raise(uid)
        if int(automation.get("archived") or 0) == 1:
            raise ValueError("Automation is archived")
        if trigger_kind != "manual" and int(automation.get("enabled") or 0) != 1:
            return automation

        async with self._lock(uid):
            claimed = data_sink.claim_agent_automation_run(
                uid,
                trigger_kind,
                trigger_uid,
                trigger_at=trigger_at,
                scheduled_at=trigger_at,
            )
            run = claimed["run"]
            if not claimed["created"]:
                return run
            if data_sink.has_active_agent_automation_run(uid, exclude_run_uid=run["run_uid"]):
                return data_sink.update_agent_automation_run(
                    run["run_uid"],
                    status="skipped_overlap",
                    error_code="SKIPPED_OVERLAP",
                    error_message="Another Automation run is active",
                    finished_at=_iso_now(),
                )
            if trigger_kind == "loop" or count_toward_max_cycles:
                next_sequence = int(automation.get("cycle_seq") or 0) + 1
                data_sink.update_agent_automation(uid, cycle_seq=next_sequence)
                run = data_sink.update_agent_automation_run(run["run_uid"], cycle_seq=next_sequence)
        return await self._start_run(run)

    async def run_now(
        self,
        automation_uid: str,
        *,
        request_uid: str = "",
        trigger_uid: str = "",
        count_toward_max_cycles: bool = False,
    ) -> dict:
        automation = self._automation_or_raise(automation_uid)
        if int(automation.get("archived") or 0) == 1:
            raise ValueError("Automation is archived")
        if count_toward_max_cycles and _kind(automation) != "loop":
            raise ValueError("count_toward_max_cycles is only valid for loop Automations")
        request = str(trigger_uid or request_uid or "").strip() or uuid.uuid4().hex
        if not request.startswith("manual:"):
            request = f"manual:{request}"
        return await self._claim_and_start(
            automation_uid,
            "manual",
            request,
            _iso_now(),
            count_toward_max_cycles=count_toward_max_cycles,
        )

    async def _start_run(self, run: Mapping[str, Any]) -> dict:
        run_uid = str(run.get("run_uid") or "").strip()
        if not run_uid:
            return dict(run)
        automation = self._automation_or_raise(str(run.get("automation_uid") or ""))
        started = data_sink.update_agent_automation_run(
            run_uid,
            status="running",
            started_at=_iso_now(),
            error_code="",
            error_message="",
        )
        execution_automation = self._definition_for_run(automation, started)
        policy_error = automation_policy_error(self._execution_policy_for_run(execution_automation, started))
        if policy_error:
            self.scheduler.unregister_automation_schedule(automation["automation_uid"])
            self.scheduler.unregister_automation_retry(automation["automation_uid"])
            data_sink.update_agent_automation(automation["automation_uid"], enabled=False, next_run_at="", retry_at="")
            return self.mark_needs_review(run_uid, "AUTOMATION_POLICY_CONFLICT", policy_error)
        if _kind(execution_automation) == "loop":
            # The DateTrigger is single-use, but explicit cancellation also
            # needs to revoke a manually registered loop job.
            self.scheduler.unregister_automation_schedule(automation["automation_uid"])

        program = self._program_for_run(execution_automation, started)
        if isinstance(program, Mapping) and program:
            executor = self._default_executor(action=False)
            if executor is None:
                return self.mark_needs_review(run_uid, "OBSERVER_EXECUTOR_UNAVAILABLE", "No read-only observer executor is configured")
            policy = _read_only_policy(self._execution_policy_for_run(execution_automation, started))
            aliases = {
                "automation": execution_automation,
                "automation_uid": execution_automation["automation_uid"],
                "uid": execution_automation["automation_uid"],
                "id": execution_automation["automation_uid"],
                "run": started,
                "run_uid": run_uid,
                "policy": policy,
                "read_only_policy": policy,
            }
            try:
                result = await _invoke(executor, (execution_automation, started, policy), aliases)
                if isinstance(result, Mapping):
                    if self._is_agent_queue_receipt(result):
                        self._record_agent_submission(run_uid, result)
                        return data_sink.update_agent_automation_run(run_uid, result_summary=dict(result))
                    facts = result.get("facts")
                    if isinstance(facts, Mapping):
                        return await self.record_observation(run_uid, facts, result.get("evidence_refs") or [])
                    status = str(result.get("status") or "").strip().lower()
                    if status in {"failed", "error"}:
                        return self._record_execution_failure_for_run(
                            run_uid,
                            str(result.get("error_code") or "OBSERVER_EXECUTION_FAILED"),
                            str(result.get("error_message") or result.get("error") or "Observer failed"),
                            retryable=bool(result.get("retryable")),
                        )
                    if status in {"completed", "complete", "success"}:
                        return self.mark_needs_review(
                            run_uid,
                            "OBSERVATION_FACTS_REQUIRED",
                            "Observer completed without mapping facts",
                        )
                    # A bare mapping is a convenient injected-observer result
                    # for tests and remains subject to the mapping contract.
                    if result and status not in {"queued", "pending", "running", "retry_scheduled", "completed", "complete", "success"}:
                        return await self.record_observation(run_uid, result, [])
                return data_sink.get_agent_automation_run(run_uid)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.exception("Automation observer failed: %s", run_uid)
                return self._record_execution_failure_for_run(
                    run_uid, "OBSERVER_EXECUTION_FAILED", str(exc), retryable=True
                )

        # A scheduled definition may intentionally omit a Program and execute
        # its objective directly.  Loops without a Program are unsafe because
        # they have no deterministic checkpoint/condition boundary.
        if str(execution_automation.get("automation_kind") or "").strip().lower() == "loop":
            return self.mark_needs_review(run_uid, "PROGRAM_REQUIRED", "Loop Automation requires an active Program")
        executor = self._default_executor(action=True)
        toolset = _policy_toolset(self._execution_policy_for_run(execution_automation, started))
        if executor is None or not toolset:
            return self.mark_needs_review(run_uid, "ACTION_EXECUTOR_UNAVAILABLE", "No authorized action executor is configured")
        branch = {
            "id": "",
            "objective": execution_automation.get("objective_prompt") or "",
            "allowed_tools": toolset,
        }
        aliases = {
            "automation": execution_automation,
            "automation_uid": execution_automation["automation_uid"],
            "uid": execution_automation["automation_uid"],
            "id": execution_automation["automation_uid"],
            "run": started,
            "run_uid": run_uid,
            "branch": branch,
            "toolset": toolset,
        }
        try:
            result = await _invoke(executor, (execution_automation, started, branch, toolset), aliases)
            if isinstance(result, Mapping) and self._is_agent_queue_receipt(result):
                self._record_agent_submission(run_uid, result)
                return data_sink.update_agent_automation_run(run_uid, result_summary=dict(result))
            if isinstance(result, Mapping) and result.get("verified") is True:
                return await self.record_verification(run_uid, result)
            # A synchronous executor result can report transport completion,
            # but it is not proof that the requested outcome was verified.
            # Keep the same durable verification requirement as Agent-backed
            # runs instead of fabricating a completed one-time Automation.
            return self.mark_needs_review(
                run_uid,
                "VERIFICATION_EVIDENCE_REQUIRED",
                "Action completed without a verification result",
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception("Automation action failed: %s", run_uid)
            return self._record_execution_failure_for_run(
                run_uid, "ACTION_EXECUTION_FAILED", str(exc), retryable=True
            )

    def _record_run_failure(self, run_uid: str, code: str, message: str) -> dict:
        run = data_sink.update_agent_automation_run(
            run_uid,
            status="failed",
            error_code=code,
            error_message=str(message or "")[:500],
            finished_at=_iso_now(),
        )
        automation_uid = str(run.get("automation_uid") or "").strip()
        if automation_uid:
            automation = data_sink.get_agent_automation(automation_uid)
            if automation and self._run_schedule_is_current(automation, run):
                data_sink.update_agent_automation(
                    automation_uid,
                    last_status="failed",
                    last_error=code,
                )
        return run

    def _record_agent_submission(self, run_uid: str, result: Mapping[str, Any]) -> dict:
        """Project an AgentService queue receipt into the Controller-owned Run."""
        agent_run_id = str(result.get("run_id") or "").strip()
        agent_session_id = str(result.get("session_id") or "").strip()
        self._record_result_resource_links(run_uid, result)
        if not agent_run_id:
            return data_sink.get_agent_automation_run(run_uid)
        linked = data_sink.update_agent_automation_run(
            run_uid,
            status="queued",
            agent_run_id=agent_run_id,
            agent_session_id=agent_session_id,
        )
        data_sink.link_agent_automation_run(run_uid, "agent_run", agent_run_id)
        if agent_session_id:
            data_sink.link_agent_automation_run(run_uid, "agent_session", agent_session_id)
        return linked

    @staticmethod
    def _is_agent_queue_receipt(result: Mapping[str, Any]) -> bool:
        """Recognize an AgentService queue receipt without guessing completion.

        ``submit_turn`` historically returned ``queued=true`` rather than a
        string status. It is a durable hand-off to a linked Agent Run, not a
        synchronous action result; treating it as completed would close the
        Automation before the Agent can record observation or verification.
        """
        run_id = str(result.get("run_id") or "").strip()
        session_id = str(result.get("session_id") or "").strip()
        status = str(result.get("status") or "").strip().lower()
        return bool(run_id and session_id) and (
            result.get("queued") is True
            or status in {"queued", "running", "pending", "retry_scheduled"}
        )

    @staticmethod
    def _link_values(value: Any) -> list[str]:
        """Normalize lightweight resource IDs without assigning new authority."""
        source = value if isinstance(value, (list, tuple, set)) else [value]
        values: list[str] = []
        for item in source:
            if isinstance(item, Mapping):
                item = item.get("uid") or item.get("id") or item.get("artifact_uid") or item.get("task_instance_uid")
            text = str(item or "").strip()
            if text and text not in values:
                values.append(text)
        return values

    def _record_result_resource_links(self, run_uid: str, result: Mapping[str, Any]) -> None:
        """Persist result references for audit/readback, never as executable inputs."""
        resource_fields = {
            "task_instance": ("task_instance_uid", "task_instance_id", "task_instance_uids"),
            "task_run": ("task_run_uid", "task_run_id", "task_run_uids"),
            "artifact": ("artifact_uid", "artifact_id", "artifact_uids", "artifacts"),
        }
        for link_kind, fields in resource_fields.items():
            for field in fields:
                for link_uid in self._link_values(result.get(field)):
                    data_sink.link_agent_automation_run(run_uid, link_kind, link_uid)

    def _finish_completed(self, run_uid: str, *, result_summary: Optional[Mapping[str, Any]] = None) -> dict:
        run = data_sink.update_agent_automation_run(
            run_uid,
            status="completed",
            result_summary=dict(result_summary or {}),
            finished_at=_iso_now(),
        )
        automation_uid = str(run.get("automation_uid") or "").strip()
        if automation_uid:
            automation = self._automation_or_raise(automation_uid)
            if not self._run_schedule_is_current(automation, run):
                return run
            policy = dict(automation.get("loop_policy") or {})
            updates: dict[str, Any] = {
                "last_status": "completed",
                "last_error": "",
                # Circuit breaking counts consecutive failures. Any successful
                # terminal run starts the streak over, including an every/cron
                # scheduled Automation that has no loop Program.
                "loop_policy": {**policy, "failure_count": 0},
            }
            program = self._program_for_run(automation, run)
            if isinstance(program, Mapping) and program and self._run_program_is_current(automation, run):
                checkpoint_after = run.get("checkpoint_after")
                if isinstance(checkpoint_after, Mapping):
                    updates["checkpoint"] = dict(checkpoint_after)
            if (
                self._run_schedule_is_current(automation, run)
                and _kind(automation) == "at"
                and str(run.get("trigger_kind") or "") == "scheduled"
            ):
                updates.update({"enabled": False, "next_run_at": "", "retry_at": ""})
                self.scheduler.unregister_automation_retry(automation_uid)
            data_sink.update_agent_automation(automation_uid, **updates)
        return run

    def _branch_for(self, program: Mapping[str, Any], branch_id: str) -> dict:
        for branch in program.get("branches") or []:
            if isinstance(branch, Mapping) and str(branch.get("id") or "") == branch_id:
                return dict(branch)
        return {}

    @staticmethod
    def _execution_policy_for_run(automation: Mapping[str, Any], run: Mapping[str, Any]) -> dict:
        snapshot = run.get("execution_policy_snapshot")
        if isinstance(snapshot, Mapping):
            return dict(snapshot)
        policy = automation.get("execution_policy")
        return dict(policy) if isinstance(policy, Mapping) else {}

    @staticmethod
    def _definition_for_run(automation: Mapping[str, Any], run: Mapping[str, Any]) -> dict:
        """Overlay the durable claim-time definition onto current lifecycle state."""
        definition = dict(automation)
        snapshot = run.get("definition_snapshot")
        if not isinstance(snapshot, Mapping):
            return definition
        for field in (
            "title", "objective_prompt", "automation_kind", "context_mode",
            "source_session_id", "source_runtime_session_id", "schedule", "loop_policy",
        ):
            if field in snapshot:
                definition[field] = copy.deepcopy(snapshot[field])
        policy_snapshot = run.get("execution_policy_snapshot")
        if isinstance(policy_snapshot, Mapping):
            # AgentService receives this definition to build its own MCP
            # policy, timeout and browser context. Reapply the durable policy
            # snapshot here as well as at the Controller's local toolset
            # checks, so an edit to a future Automation definition can never
            # expand an already-claimed run's authority.
            definition["execution_policy"] = copy.deepcopy(dict(policy_snapshot))
        return definition

    @staticmethod
    def _run_schedule_is_current(automation: Mapping[str, Any], run: Mapping[str, Any]) -> bool:
        """Whether this Run still owns the definition's future trigger cursor.

        Runs intentionally retain their claim-time definition so a user can
        safely edit future work while a turn is in flight.  Terminal handling
        may always update the Run's own audit record, but it must not disable,
        clear, or re-arm a newer schedule merely because the older run ends.
        Older rows without a snapshot retain the pre-snapshot behavior.
        """
        snapshot = run.get("definition_snapshot")
        if not isinstance(snapshot, Mapping):
            return True
        if "automation_kind" not in snapshot and "schedule" not in snapshot:
            return True
        return (
            str(snapshot.get("automation_kind") or "").strip().lower()
            == str(automation.get("automation_kind") or "").strip().lower()
            and _schedule(snapshot) == _schedule(automation)
        )

    @staticmethod
    def _run_program_is_current(automation: Mapping[str, Any], run: Mapping[str, Any]) -> bool:
        """Avoid committing an old Program's checkpoint into a new Program."""
        run_version = str(run.get("program_version_uid") or "").strip()
        if not run_version:
            return not str(automation.get("active_program_version_uid") or "").strip()
        return run_version == str(automation.get("active_program_version_uid") or "").strip()

    @staticmethod
    def _program_for_run(automation: Mapping[str, Any], run: Mapping[str, Any]) -> dict:
        version_uid = str(run.get("program_version_uid") or "").strip()
        if version_uid:
            version = data_sink.get_agent_automation_program(version_uid)
            program = version.get("program") if isinstance(version, Mapping) else None
            if isinstance(program, Mapping):
                return dict(program)
        program = automation.get("program")
        return dict(program) if isinstance(program, Mapping) else {}

    def _branch_toolset(
        self,
        automation: Mapping[str, Any],
        branch: Mapping[str, Any],
        *,
        execution_policy: Optional[Mapping[str, Any]] = None,
    ) -> list[str]:
        allowed = set(_policy_toolset(execution_policy or automation.get("execution_policy") or {}))
        branch_value = branch.get("allowed_tools")
        if branch_value is None:
            # Backward-compatible read of early Program drafts.  Values still
            # must intersect actual MCP tool names in the definition policy.
            branch_value = branch.get("allowed_capabilities")
        if branch_value is None:
            branch_value = branch.get("toolset")
        branch_allowed = set(
            str(item).strip() for item in (branch_value or allowed) if str(item).strip()
        )
        return sorted(allowed & branch_allowed)

    async def record_observation(
        self,
        run_uid: str,
        facts: Mapping[str, Any],
        evidence_refs: Any,
    ) -> dict:
        if not isinstance(facts, Mapping):
            raise TypeError("observation facts must be a mapping")
        run = data_sink.get_agent_automation_run(run_uid)
        if not run:
            raise ValueError(f"Automation run not found: {run_uid}")
        if str(run.get("status") or "") in TERMINAL_RUN_STATUSES:
            return run
        existing_summary = run.get("result_summary")
        if isinstance(existing_summary, Mapping) and "reason" in existing_summary:
            # Observation callbacks may report through the Controller and
            # also return their payload.  Treat the second delivery as an
            # idempotent read so an action cannot execute twice.
            return run
        automation = self._automation_or_raise(str(run.get("automation_uid") or ""))
        execution_automation = self._definition_for_run(automation, run)
        program = self._program_for_run(execution_automation, run)
        if not isinstance(program, Mapping) or not program:
            return data_sink.update_agent_automation_run(
                run_uid,
                facts_summary=dict(facts),
                result_summary={"evidence_refs": list(evidence_refs) if isinstance(evidence_refs, list) else []},
            )
        try:
            result = evaluate_program(
                program,
                facts=dict(facts),
                checkpoint=run.get("checkpoint_before") if isinstance(run.get("checkpoint_before"), Mapping) else {},
                now=_iso_now(),
            )
        except ProgramValidationError as exc:
            return self.mark_needs_review(run_uid, "PROGRAM_INVALID", str(exc))
        checkpoint_before = run.get("checkpoint_before") if isinstance(run.get("checkpoint_before"), Mapping) else {}
        checkpoint_after = _merge_patch(checkpoint_before, result.get("checkpoint_patch") or {})
        evidence = list(evidence_refs) if isinstance(evidence_refs, list) else []
        summary = {
            "reason": result.get("reason") or "",
            "loop_decision": result.get("loop_decision") or "",
            "evidence_refs": evidence,
        }
        updated = data_sink.update_agent_automation_run(
            run_uid,
            facts_summary=dict(facts),
            matched_branch=str(result.get("matched_branch") or ""),
            checkpoint_after=checkpoint_after,
            result_summary=summary,
        )
        branch_id = str(result.get("matched_branch") or "").strip()
        if not branch_id:
            if str(execution_automation.get("automation_kind") or "").strip().lower() == "scheduled":
                return self._finish_completed(run_uid, result_summary=summary)
            if str(execution_automation.get("automation_kind") or "").strip().lower() == "loop":
                candidate = dict(checkpoint_after)
                if (
                    self._run_schedule_is_current(automation, run)
                    and _kind(automation) == "loop"
                    and int(automation.get("enabled") or 0) == 1
                    and int(automation.get("archived") or 0) == 0
                ):
                    current_policy = automation.get("loop_policy") if isinstance(automation.get("loop_policy"), Mapping) else {}
                    next_at = datetime.now(timezone.utc) + timedelta(seconds=_interval_seconds(current_policy))
                    updates: dict[str, Any] = {
                        "next_run_at": next_at.isoformat(),
                        "last_status": "completed",
                        "last_error": "",
                        # The running Program is snapshotted, but a user edit
                        # made while it was in flight defines the *next* loop.
                        # Never write the old policy back over that new
                        # definition merely because this run completed.
                        "loop_policy": {**dict(current_policy), "failure_count": 0},
                    }
                    if self._run_program_is_current(automation, run):
                        updates["checkpoint"] = candidate
                    data_sink.update_agent_automation(
                        automation["automation_uid"],
                        **updates,
                    )
                    completed = self._finish_completed(run_uid, result_summary=summary)
                    self.refresh(automation["automation_uid"])
                    return completed
                return self._finish_completed(run_uid, result_summary=summary)
            return updated
        branch = self._branch_for(program, branch_id)
        toolset = self._branch_toolset(
            execution_automation,
            branch,
            execution_policy=self._execution_policy_for_run(execution_automation, run),
        )
        executor = self._default_executor(action=True)
        if not toolset:
            return self.mark_needs_review(
                run_uid,
                "UNAUTHORIZED_BRANCH_CAPABILITY",
                f"Branch {branch_id} has no capability in the Automation policy",
            )
        if executor is None:
            return self.mark_needs_review(run_uid, "ACTION_EXECUTOR_UNAVAILABLE", "No authorized action executor is configured")
        aliases = {
            "automation": execution_automation,
            "automation_uid": execution_automation["automation_uid"],
            "uid": execution_automation["automation_uid"],
            "id": execution_automation["automation_uid"],
            "run": updated,
            "run_uid": run_uid,
            "branch": branch,
            "toolset": toolset,
        }
        try:
            action_result = await _invoke(executor, (execution_automation, updated, branch, toolset), aliases)
            if isinstance(action_result, Mapping):
                summary = {**summary, "action": dict(action_result)}
                action_status = str(action_result.get("status") or "").strip().lower()
                if self._is_agent_queue_receipt(action_result):
                    self._record_agent_submission(run_uid, action_result)
                    data_sink.update_agent_automation_run(run_uid, result_summary=summary)
                    return data_sink.get_agent_automation_run(run_uid)
                if action_status in {"failed", "error"}:
                    return self._record_execution_failure_for_run(
                        run_uid,
                        str(action_result.get("error_code") or "ACTION_EXECUTION_FAILED"),
                        str(action_result.get("error_message") or "Action executor failed"),
                        retryable=bool(action_result.get("retryable")),
                    )
                # The Program observer and its selected action are separate
                # Agent turns. A queued action has not produced the required
                # verification evidence yet, so it must remain active until
                # that linked Agent Run records verification or reaches its
                # own terminal projection.
                data_sink.update_agent_automation_run(run_uid, result_summary=summary)
                if action_result.get("verified") is True:
                    return await self.record_verification(run_uid, action_result)
                # Legacy injected loop executors may hand verification back to
                # their caller instead of returning a queue receipt. Keep that
                # Run active so the caller can submit its explicit evidence;
                # a structured synchronous result, by contrast, has already
                # declared that execution ended and must be reviewed below.
            elif str(execution_automation.get("automation_kind") or "").strip().lower() == "loop":
                return data_sink.get_agent_automation_run(run_uid)
            # A branch action may synchronously return after doing work, but
            # that return value alone is never evidence that the requested
            # outcome was achieved. Keep its completion contract identical to
            # direct scheduled actions: only an explicit verified result can
            # close the durable Automation Run successfully.
            return self.mark_needs_review(
                run_uid,
                "VERIFICATION_EVIDENCE_REQUIRED",
                "Action completed without a verification result",
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception("Automation action failed after observation: %s", run_uid)
            return self._record_execution_failure_for_run(
                run_uid, "ACTION_EXECUTION_FAILED", str(exc), retryable=True
            )

    async def record_verification(self, run_uid: str, result: Mapping[str, Any]) -> dict:
        run = data_sink.get_agent_automation_run(run_uid)
        if not run:
            raise ValueError(f"Automation run not found: {run_uid}")
        if str(run.get("status") or "") in TERMINAL_RUN_STATUSES:
            return run
        if not isinstance(result, Mapping) or result.get("verified") is not True:
            return self.mark_needs_review(
                run_uid,
                "VERIFICATION_FAILED",
                "Verification must contain the boolean field verified=true",
            )
        automation = self._automation_or_raise(str(run.get("automation_uid") or ""))
        execution_automation = self._definition_for_run(automation, run)
        state_value = result.get("state")
        if state_value is not None:
            if _kind(execution_automation) == "loop":
                return self.mark_needs_review(
                    run_uid,
                    "STATE_NOT_SUPPORTED_FOR_LOOP",
                    "Loop Automations must use their Program checkpoint instead of result.state",
                )
            if not isinstance(state_value, Mapping):
                return self.mark_needs_review(
                    run_uid,
                    "STATE_INVALID",
                    "Verification result.state must be a JSON object",
                )
            try:
                state_size = len(json.dumps(state_value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
            except (TypeError, ValueError):
                return self.mark_needs_review(
                    run_uid,
                    "STATE_INVALID",
                    "Verification result.state must be JSON-serializable",
                )
            if state_size > 16 * 1024:
                return self.mark_needs_review(
                    run_uid,
                    "STATE_TOO_LARGE",
                    "Verification result.state must be at most 16 KiB",
                )
        self._record_result_resource_links(run_uid, result)
        summary = run.get("result_summary") if isinstance(run.get("result_summary"), Mapping) else {}
        summary = {**summary, "verification": copy.deepcopy(dict(result))}
        candidate = (
            dict(state_value)
            if isinstance(state_value, Mapping)
            else run.get("checkpoint_after") if isinstance(run.get("checkpoint_after"), Mapping) else {}
        )
        data_sink.update_agent_automation_run(
            run_uid,
            status="completed",
            checkpoint_after=dict(candidate),
            result_summary=summary,
            error_code="",
            error_message="",
            finished_at=_iso_now(),
        )
        uid = automation["automation_uid"]
        if not self._run_schedule_is_current(automation, run):
            # The Run remains completed and its evidence is durable, but an
            # old schedule must not reset lifecycle state, re-arm work, or
            # commit a checkpoint into a replacement definition.
            return data_sink.get_agent_automation_run(run_uid)
        if (
            _kind(execution_automation) == "loop"
            and self._run_schedule_is_current(automation, run)
            and _kind(automation) == "loop"
        ):
            policy = automation.get("loop_policy") if isinstance(automation.get("loop_policy"), Mapping) else {}
            max_cycles = policy.get("max_cycles") or policy.get("max_rounds")
            cycle_seq = int(run.get("cycle_seq") or automation.get("cycle_seq") or 0)
            try:
                max_cycles_value = int(max_cycles) if max_cycles is not None else 0
            except (TypeError, ValueError):
                max_cycles_value = 0
            if max_cycles_value > 0 and cycle_seq >= max_cycles_value:
                updates: dict[str, Any] = {
                    "next_run_at": "",
                    "last_status": "completed_max_cycles",
                    "last_error": "",
                }
                if self._run_program_is_current(automation, run):
                    updates["checkpoint"] = dict(candidate)
                data_sink.update_agent_automation(uid, **updates)
                self.scheduler.unregister_automation_schedule(uid)
            elif int(automation.get("enabled") or 0) == 1 and int(automation.get("archived") or 0) == 0:
                next_at = datetime.now(timezone.utc) + timedelta(seconds=_interval_seconds(policy))
                updates = {
                    "next_run_at": next_at.isoformat(),
                    "last_status": "completed",
                    "last_error": "",
                    "loop_policy": {**dict(policy), "failure_count": 0},
                }
                if self._run_program_is_current(automation, run):
                    updates["checkpoint"] = dict(candidate)
                data_sink.update_agent_automation(uid, **updates)
                self.refresh(uid)
            else:
                updates = {"next_run_at": ""}
                if self._run_program_is_current(automation, run):
                    updates["checkpoint"] = dict(candidate)
                data_sink.update_agent_automation(uid, **updates)
        else:
            policy = dict(automation.get("loop_policy") or {})
            updates: dict[str, Any] = {
                "last_status": "completed",
                "last_error": "",
                "loop_policy": {**policy, "failure_count": 0},
            }
            if isinstance(state_value, Mapping) or (
                self._program_for_run(automation, run) and self._run_program_is_current(automation, run)
            ):
                updates["checkpoint"] = dict(candidate)
            if (
                self._run_schedule_is_current(automation, run)
                and _kind(automation) == "at"
                and str(run.get("trigger_kind") or "") == "scheduled"
            ):
                updates.update({"enabled": False, "next_run_at": "", "retry_at": ""})
                self.scheduler.unregister_automation_retry(uid)
            data_sink.update_agent_automation(uid, **updates)
        return data_sink.get_agent_automation_run(run_uid)

    def mark_needs_review(self, run_uid: str, code: str, message: str) -> dict:
        run = data_sink.update_agent_automation_run(
            run_uid,
            status="needs_review",
            error_code=str(code or "NEEDS_REVIEW"),
            error_message=str(message or "")[:500],
            finished_at=_iso_now(),
        )
        if not run:
            return run
        uid = str(run.get("automation_uid") or "").strip()
        if uid:
            automation = data_sink.get_agent_automation(uid)
            if not automation or not self._run_schedule_is_current(automation, run):
                return data_sink.get_agent_automation_run(run_uid)
            updates: dict[str, Any] = {
                "last_status": "needs_review",
                "last_error": str(code or "NEEDS_REVIEW"),
            }
            if (
                self._run_schedule_is_current(automation, run)
                and _kind(automation) == "at"
                and str(run.get("trigger_kind") or "") == "scheduled"
            ):
                updates.update({"enabled": False, "next_run_at": "", "retry_at": ""})
                self.scheduler.unregister_automation_retry(uid)
            data_sink.update_agent_automation(uid, **updates)
            if self._run_schedule_is_current(automation, run) and _kind(automation) == "loop":
                self.scheduler.unregister_automation_schedule(uid)
                data_sink.update_agent_automation(uid, next_run_at="")
        return data_sink.get_agent_automation_run(run_uid)

    async def _cancel_active_runs(self, automation_uid: str, *, reason: str) -> None:
        """Cancel queue-backed Agent Runs before a paused/archived definition can detach.

        The Controller records cancellation itself because AgentService owns a
        separate database.  If a linked run cannot be cancelled, it remains a
        visible ``needs_review`` boundary rather than being silently ignored.
        """
        for run in data_sink.list_agent_automation_runs(automation_uid, 500):
            run_status = str(run.get("status") or "")
            if run_status not in ACTIVE_RUN_STATUSES:
                continue
            run_uid = str(run.get("run_uid") or "")
            # ``retry_scheduled`` retains the previous attempt's Agent Run ID
            # for audit, but it has no live Agent Run to cancel.  Treat it like
            # an unstarted claim so pause/archive cannot turn a cleanly
            # cancelled retry into a misleading needs-review state.
            if run_status in {"claimed", "retry_scheduled"}:
                data_sink.update_agent_automation_run(
                    run_uid,
                    status="canceled",
                    error_code="CANCELED_BY_AUTOMATION",
                    error_message=reason,
                    finished_at=_iso_now(),
                )
                continue
            agent_run_id = str(run.get("agent_run_id") or "").strip()
            if not agent_run_id:
                self.mark_needs_review(
                    run_uid,
                    "AUTOMATION_CANCEL_UNAVAILABLE",
                    f"{reason}; run has no linked Agent Run to cancel",
                )
                continue
            cancel = getattr(self.agent_service, "cancel_run", None)
            if not callable(cancel):
                self.mark_needs_review(
                    run_uid,
                    "AUTOMATION_CANCEL_UNAVAILABLE",
                    f"{reason}; AgentService cancellation is unavailable",
                )
                continue
            try:
                result = cancel(agent_run_id)
                if inspect.isawaitable(result):
                    result = await result
                status = str((result or {}).get("status") or "").strip().lower() if isinstance(result, Mapping) else ""
                if isinstance(result, Mapping) and result.get("ok") and status == "canceled":
                    data_sink.update_agent_automation_run(
                        run_uid,
                        status="canceled",
                        error_code="CANCELED_BY_AUTOMATION",
                        error_message=reason,
                        finished_at=_iso_now(),
                    )
                else:
                    self.mark_needs_review(
                        run_uid,
                        "AUTOMATION_CANCEL_UNCONFIRMED",
                        f"{reason}; AgentService did not confirm cancellation",
                    )
            except Exception as exc:  # noqa: BLE001
                logger.exception("Automation Agent Run cancellation failed: %s", run_uid)
                self.mark_needs_review(
                    run_uid,
                    "AUTOMATION_CANCEL_FAILED",
                    f"{reason}; {str(exc)[:300]}",
                )

    async def pause(self, uid: str) -> dict:
        automation = self._automation_or_raise(uid)
        self.scheduler.unregister_automation_schedule(uid)
        self.scheduler.unregister_automation_retry(uid)
        await self._cancel_active_runs(automation["automation_uid"], reason="Automation paused")
        return data_sink.update_agent_automation(
            automation["automation_uid"], enabled=False, next_run_at="", retry_at=""
        )

    def resume(self, uid: str) -> dict:
        automation = self._automation_or_raise(uid)
        policy_error = automation_policy_error(automation.get("execution_policy") or {})
        if policy_error:
            raise ValueError(policy_error)
        if int(automation.get("archived") or 0) == 1:
            return automation
        if _kind(automation) == "at":
            # A one-time trigger is never a catch-up mechanism.  In
            # particular, resuming a draft that stayed paused past its due
            # time must take the same durable missed boundary as startup
            # recovery; the user can still make an explicit run_now request.
            due = self._trigger_time(automation)
            if due is None:
                return automation
            current = _now_datetime().astimezone(due.tzinfo)
            if due <= current:
                trigger_at = due.isoformat()
                claimed = data_sink.claim_agent_automation_run(
                    uid,
                    "scheduled",
                    f"scheduled:{trigger_at}",
                    trigger_at=trigger_at,
                    scheduled_at=trigger_at,
                )
                run = claimed["run"]
                if claimed["created"] or str(run.get("status") or "") in ACTIVE_RUN_STATUSES:
                    data_sink.update_agent_automation_run(
                        run["run_uid"],
                        status="missed",
                        error_code="MISSED_WHILE_OFFLINE",
                        error_message="One-time Automation was overdue when resumed",
                        finished_at=current.isoformat(),
                    )
                self.scheduler.unregister_automation_schedule(uid)
                self.scheduler.unregister_automation_retry(uid)
                return data_sink.update_agent_automation(
                    uid,
                    enabled=False,
                    next_run_at="",
                    retry_at="",
                    last_status="missed",
                    last_error="MISSED_WHILE_OFFLINE",
                )
        if _kind(automation) == "loop":
            next_run_at = str(automation.get("next_run_at") or "").strip()
            if not next_run_at:
                next_run_at = (datetime.now(timezone.utc) + timedelta(seconds=_interval_seconds(automation.get("loop_policy") or {}))).isoformat()
            automation = data_sink.update_agent_automation(uid, enabled=True, next_run_at=next_run_at)
        else:
            automation = data_sink.update_agent_automation(uid, enabled=True)
        return self._refresh_at(automation)

    async def archive(self, uid: str) -> dict:
        automation = self._automation_or_raise(uid)
        self.scheduler.unregister_automation_schedule(uid)
        self.scheduler.unregister_automation_retry(uid)
        await self._cancel_active_runs(automation["automation_uid"], reason="Automation archived")
        return data_sink.update_agent_automation(uid, archived=True, enabled=False, next_run_at="", retry_at="")

    def _record_execution_failure_for_run(self, run_uid: str, code: str, message: str, retryable: bool) -> dict:
        """Close one exact Automation Run, retrying it at most max_retries times.

        A retry retains the same ``run_uid`` and idempotency key.  This keeps
        audit history coherent and, critically, prevents a late completion
        from a first Agent attempt being mistaken for a second Automation run.
        """
        run = data_sink.get_agent_automation_run(run_uid)
        if not run or str(run.get("status") or "") in TERMINAL_RUN_STATUSES:
            return run
        automation = self._automation_or_raise(str(run.get("automation_uid") or ""))
        error_code = str(code or "EXECUTION_FAILED")
        if not self._run_schedule_is_current(automation, run):
            # The old execution is still auditable, but its retry policy and
            # failure streak no longer own the replacement definition.
            return self._record_run_failure(run_uid, error_code, str(message or "Execution failed"))
        current_policy = dict(automation.get("loop_policy") or {})
        execution_automation = self._definition_for_run(automation, run)
        execution_loop_policy = dict(execution_automation.get("loop_policy") or {})
        try:
            failure_count = int(current_policy.get("failure_count") or 0) + 1
        except (TypeError, ValueError):
            failure_count = 1
        current_policy["failure_count"] = failure_count
        # The failure boundary is part of the run's safety contract.  Editing
        # a future loop definition must not retroactively make an in-flight
        # retry less strict (or unexpectedly more strict).
        threshold = (
            execution_loop_policy.get("failure_threshold")
            or execution_loop_policy.get("max_consecutive_failures")
        )
        try:
            threshold_value = int(threshold) if threshold is not None else 0
        except (TypeError, ValueError):
            threshold_value = 0
        if retryable and threshold_value > 0 and failure_count >= threshold_value:
            # A user may replace a loop with a new scheduled definition while
            # this older loop turn is still in flight. Its frozen failure
            # threshold still closes the old Run, but it must not trip a
            # circuit breaker that disables the replacement schedule.
            if not (
                _kind(execution_automation) == "loop"
                and self._run_schedule_is_current(automation, run)
                and _kind(automation) == "loop"
            ):
                return self._record_run_failure(run_uid, error_code, "Failure threshold reached")
            self._record_run_failure(run_uid, error_code, "Failure threshold reached")
            self.scheduler.unregister_automation_schedule(automation["automation_uid"])
            self.scheduler.unregister_automation_retry(automation["automation_uid"])
            data_sink.update_agent_automation(
                automation["automation_uid"],
                loop_policy=current_policy,
                enabled=False,
                next_run_at="",
                retry_at="",
                last_status="paused_circuit_breaker",
                last_error=error_code,
            )
            return data_sink.get_agent_automation_run(run_uid)

        execution_policy = self._execution_policy_for_run(automation, run)
        try:
            max_retries = max(0, int(execution_policy.get("max_retries") or 0))
        except (TypeError, ValueError):
            max_retries = 0
        attempts_used = max(0, int(run.get("attempt") or 0))
        if retryable and attempts_used < max_retries:
            next_attempt = attempts_used + 1
            try:
                configured_backoff = int(execution_policy.get("retry_backoff_seconds") or 0)
            except (TypeError, ValueError):
                configured_backoff = 0
            backoff = configured_backoff if configured_backoff > 0 else max(1, next_attempt * 60)
            next_at = datetime.now(timezone.utc) + timedelta(seconds=backoff)
            data_sink.update_agent_automation_run(
                run_uid,
                status="retry_scheduled",
                attempt=next_attempt,
                error_code=error_code,
                error_message=f"Retry {next_attempt}/{max_retries} scheduled: {str(message or '')[:380]}",
                finished_at="",
            )
            automation = data_sink.update_agent_automation(
                automation["automation_uid"],
                loop_policy=current_policy,
                retry_at=next_at.isoformat(),
                last_status="retry_scheduled",
                last_error=error_code,
            )
            self._refresh_at(automation)
            return data_sink.get_agent_automation_run(run_uid)

        # An unattended failure with no remaining retry budget is a human
        # decision boundary, not a failed run that remains silently active.
        data_sink.update_agent_automation(
            automation["automation_uid"],
            loop_policy=current_policy,
            retry_at="",
        )
        return self.mark_needs_review(
            run_uid,
            "RETRY_EXHAUSTED" if retryable else error_code,
            "Maximum retries exhausted" if retryable else str(message or "Execution failed"),
        )

    def record_execution_failure(self, automation_uid: str, code: str, retryable: bool) -> dict:
        """Compatibility entry point for direct Controller integrations.

        AgentService uses ``project_agent_run_terminal`` below, which carries
        the exact Automation Run UID.  Older callers only have an Automation
        UID, so resolve its one active run without creating a second run.
        """
        automation = self._automation_or_raise(automation_uid)
        current_run = next(
            (item for item in data_sink.list_agent_automation_runs(automation_uid, 500)
             if str(item.get("status") or "") in ACTIVE_RUN_STATUSES),
            None,
        )
        if current_run:
            self._record_execution_failure_for_run(
                current_run["run_uid"], code, "Execution failed", retryable,
            )
            return data_sink.get_agent_automation(automation_uid)
        # Preserve the circuit-breaker accounting even when an integration
        # reports a failure after its run was already closed.
        policy = dict(automation.get("loop_policy") or {})
        policy["failure_count"] = int(policy.get("failure_count") or 0) + 1
        threshold = int(policy.get("failure_threshold") or policy.get("max_consecutive_failures") or 0)
        if retryable and threshold > 0 and policy["failure_count"] >= threshold:
            self.scheduler.unregister_automation_schedule(automation_uid)
            self.scheduler.unregister_automation_retry(automation_uid)
            return data_sink.update_agent_automation(
                automation_uid, loop_policy=policy, enabled=False, next_run_at="", retry_at="",
                last_status="paused_circuit_breaker", last_error=str(code or "EXECUTION_FAILED"),
            )
        return data_sink.update_agent_automation(
            automation_uid, loop_policy=policy, last_status="failed", last_error=str(code or "EXECUTION_FAILED"),
        )

    def project_agent_run_terminal(
        self,
        automation_run_uid: str,
        agent_run_id: str,
        status: str,
        *,
        error_code: str = "",
        error_message: str = "",
        retryable: bool = False,
    ) -> dict:
        """Project a terminal Agent Run onto its Controller-owned Run.

        Tool callbacks may have already completed the Automation Run.  If an
        Agent finishes without durable observation or verification evidence,
        make the missing evidence visible as needs_review rather than leaving
        the run queued forever or emitting a false completion receipt.
        """
        run = data_sink.get_agent_automation_run(automation_run_uid)
        if not run or str(run.get("agent_run_id") or "") != str(agent_run_id or ""):
            return run
        if str(run.get("status") or "") in TERMINAL_RUN_STATUSES:
            return run
        terminal = str(status or "").strip().lower()
        if terminal == "completed":
            return self.mark_needs_review(
                automation_run_uid,
                "VERIFICATION_EVIDENCE_REQUIRED",
                "Agent completed without automation_record_observation or automation_record_verification evidence",
            )
        if str(error_code or "").strip().upper() == "AUTOMATION_POLICY_DENIED":
            # Native DSH pre-execute policy rejection is deliberate authority
            # containment, never a transient worker failure.  Keep its exact
            # audit reason and do not schedule an unattended retry.
            return self.mark_needs_review(
                automation_run_uid,
                "AUTOMATION_POLICY_DENIED",
                error_message or "A native DSH tool was outside the Automation execution policy",
            )
        if terminal == "failed":
            return self._record_execution_failure_for_run(
                automation_run_uid,
                error_code or "AGENT_RUN_FAILED",
                error_message or "Agent run failed",
                retryable=bool(retryable),
            )
        if terminal in {"canceled", "interrupted"}:
            return self.mark_needs_review(
                automation_run_uid,
                error_code or terminal.upper(),
                error_message or f"Agent run {terminal}",
            )
        return self.mark_needs_review(
            automation_run_uid,
            "AGENT_RUN_TERMINAL_UNKNOWN",
            f"Unsupported Agent terminal status: {terminal or 'empty'}",
        )


__all__ = ["AutomationController"]
