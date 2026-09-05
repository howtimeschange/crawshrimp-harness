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
import logging
import math
import uuid
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from core import data_sink
from core.automation_program import ProgramValidationError, evaluate_program


logger = logging.getLogger(__name__)

DEFAULT_TIMEZONE = "Asia/Shanghai"
ACTIVE_RUN_STATUSES = {"claimed", "queued", "running", "retry_scheduled"}
TERMINAL_RUN_STATUSES = {
    "completed",
    "failed",
    "skipped_overlap",
    "canceled",
    "missed",
    "needs_review",
}
READ_ONLY_CAPABILITIES = {
    "observe",
    "read",
    "read_browser",
    "browser_observe",
    "capture_requests",
    "verify",
    "query",
    "list",
    "search",
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
        except (TypeError, ValueError) as exc:
            raise ValueError("loop interval must be a positive number of seconds") from exc
        if seconds > 0:
            return seconds
    for key, multiplier in (("cycle_interval_minutes", 60), ("interval_minutes", 60), ("minutes", 60)):
        value = policy.get(key)
        if value is None or str(value).strip() == "":
            continue
        try:
            seconds = int(float(value) * multiplier)
        except (TypeError, ValueError) as exc:
            raise ValueError("loop interval must be a positive number") from exc
        if seconds > 0:
            return seconds
    return 3600


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
    result["toolset"] = [item for item in allowed if item in READ_ONLY_CAPABILITIES]
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
            toolset = args[-1] if args else []
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
        kind = _kind(automation)
        schedule = _schedule(automation)
        zone = _timezone(schedule)
        try:
            previous = _as_datetime(trigger_at, zone, field_name="trigger_at")
            if kind == "at":
                data_sink.update_agent_automation(automation["automation_uid"], enabled=False, next_run_at="")
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
        self.scheduler.unregister_automation_schedule(uid)
        if not uid or int(automation.get("enabled") or 0) != 1 or int(automation.get("archived") or 0) == 1:
            return data_sink.get_agent_automation(uid) or automation
        if _kind(automation) == "loop" and not str(automation.get("next_run_at") or "").strip():
            return data_sink.get_agent_automation(uid) or automation

        current = _now_datetime(now)
        try:
            trigger, computed_next = self.scheduler._automation_trigger(automation, now=current)
            kind = _kind(automation)
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
            try:
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
                    data_sink.update_agent_automation(uid, **updates)
                    self.scheduler.unregister_automation_schedule(uid)
                    # Recurring schedules get their next future boundary only;
                    # no missed trigger is ever replayed.
                    if trigger_kind == "scheduled" and _kind(automation) in {"every", "cron"}:
                        fresh = data_sink.get_agent_automation(uid)
                        self._refresh_at(fresh, now=current)
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

    async def _claim_and_start(
        self,
        automation_uid: str,
        trigger_kind: str,
        trigger_uid: str,
        trigger_at: str,
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
            if trigger_kind == "loop":
                next_sequence = int(automation.get("cycle_seq") or 0) + 1
                data_sink.update_agent_automation(uid, cycle_seq=next_sequence)
                run = data_sink.update_agent_automation_run(run["run_uid"], cycle_seq=next_sequence)
            if data_sink.has_active_agent_automation_run(uid, exclude_run_uid=run["run_uid"]):
                return data_sink.update_agent_automation_run(
                    run["run_uid"],
                    status="skipped_overlap",
                    error_code="SKIPPED_OVERLAP",
                    error_message="Another Automation run is active",
                    finished_at=_iso_now(),
                )
        return await self._start_run(run)

    async def run_now(
        self,
        automation_uid: str,
        *,
        request_uid: str = "",
        trigger_uid: str = "",
    ) -> dict:
        automation = self._automation_or_raise(automation_uid)
        if int(automation.get("archived") or 0) == 1:
            raise ValueError("Automation is archived")
        request = str(trigger_uid or request_uid or "").strip() or uuid.uuid4().hex
        if not request.startswith("manual:"):
            request = f"manual:{request}"
        return await self._claim_and_start(
            automation_uid,
            "manual",
            request,
            _iso_now(),
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
        if _kind(automation) == "loop":
            # The DateTrigger is single-use, but explicit cancellation also
            # needs to revoke a manually registered loop job.
            self.scheduler.unregister_automation_schedule(automation["automation_uid"])

        program = automation.get("program")
        if isinstance(program, Mapping) and program:
            executor = self._default_executor(action=False)
            if executor is None:
                return self.mark_needs_review(run_uid, "OBSERVER_EXECUTOR_UNAVAILABLE", "No read-only observer executor is configured")
            policy = _read_only_policy(automation.get("execution_policy") or {})
            aliases = {
                "automation": automation,
                "automation_uid": automation["automation_uid"],
                "uid": automation["automation_uid"],
                "id": automation["automation_uid"],
                "run": started,
                "run_uid": run_uid,
                "policy": policy,
                "read_only_policy": policy,
            }
            try:
                result = await _invoke(executor, (automation, started, policy), aliases)
                if isinstance(result, Mapping):
                    facts = result.get("facts")
                    if isinstance(facts, Mapping):
                        return await self.record_observation(run_uid, facts, result.get("evidence_refs") or [])
                    if str(result.get("status") or "").strip().lower() in {"completed", "complete", "success"}:
                        return self.mark_needs_review(
                            run_uid,
                            "OBSERVATION_FACTS_REQUIRED",
                            "Observer completed without mapping facts",
                        )
                    # A bare mapping is a convenient injected-observer result
                    # for tests and remains subject to the mapping contract.
                    status = str(result.get("status") or "").strip().lower()
                    if result and status not in {"queued", "pending", "running", "completed", "complete", "success"}:
                        return await self.record_observation(run_uid, result, [])
                return data_sink.get_agent_automation_run(run_uid)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.exception("Automation observer failed: %s", run_uid)
                return self._record_run_failure(run_uid, "OBSERVER_EXECUTION_FAILED", str(exc))

        # A scheduled definition may intentionally omit a Program and execute
        # its objective directly.  Loops without a Program are unsafe because
        # they have no deterministic checkpoint/condition boundary.
        if str(automation.get("automation_kind") or "").strip().lower() == "loop":
            return self.mark_needs_review(run_uid, "PROGRAM_REQUIRED", "Loop Automation requires an active Program")
        executor = self._default_executor(action=True)
        toolset = _policy_toolset(automation.get("execution_policy") or {})
        if executor is None or not toolset:
            return self.mark_needs_review(run_uid, "ACTION_EXECUTOR_UNAVAILABLE", "No authorized action executor is configured")
        branch = {
            "id": "",
            "objective": automation.get("objective_prompt") or "",
            "allowed_capabilities": toolset,
        }
        aliases = {
            "automation": automation,
            "automation_uid": automation["automation_uid"],
            "uid": automation["automation_uid"],
            "id": automation["automation_uid"],
            "run": started,
            "run_uid": run_uid,
            "branch": branch,
            "toolset": toolset,
        }
        try:
            result = await _invoke(executor, (automation, started, branch, toolset), aliases)
            if isinstance(result, Mapping) and str(result.get("status") or "").strip().lower() in {
                "queued", "running", "pending", "retry_scheduled"
            }:
                return data_sink.update_agent_automation_run(run_uid, result_summary=dict(result))
            completed = self._finish_completed(run_uid, result_summary=dict(result) if isinstance(result, Mapping) else {})
            return completed
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception("Automation action failed: %s", run_uid)
            return self._record_run_failure(run_uid, "ACTION_EXECUTION_FAILED", str(exc))

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
            data_sink.update_agent_automation(
                automation_uid,
                last_status="failed",
                last_error=code,
            )
        return run

    def _finish_completed(self, run_uid: str, *, result_summary: Optional[Mapping[str, Any]] = None) -> dict:
        run = data_sink.update_agent_automation_run(
            run_uid,
            status="completed",
            result_summary=dict(result_summary or {}),
            finished_at=_iso_now(),
        )
        automation_uid = str(run.get("automation_uid") or "").strip()
        if automation_uid:
            data_sink.update_agent_automation(
                automation_uid,
                last_status="completed",
                last_error="",
            )
        return run

    def _branch_for(self, program: Mapping[str, Any], branch_id: str) -> dict:
        for branch in program.get("branches") or []:
            if isinstance(branch, Mapping) and str(branch.get("id") or "") == branch_id:
                return dict(branch)
        return {}

    def _branch_toolset(self, automation: Mapping[str, Any], branch: Mapping[str, Any]) -> list[str]:
        allowed = set(_policy_toolset(automation.get("execution_policy") or {}))
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
        existing_summary = run.get("result_summary")
        if isinstance(existing_summary, Mapping) and "reason" in existing_summary:
            # Observation callbacks may report through the Controller and
            # also return their payload.  Treat the second delivery as an
            # idempotent read so an action cannot execute twice.
            return run
        automation = self._automation_or_raise(str(run.get("automation_uid") or ""))
        program = automation.get("program")
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
            if str(automation.get("automation_kind") or "").strip().lower() == "scheduled":
                return self._finish_completed(run_uid, result_summary=summary)
            if str(automation.get("automation_kind") or "").strip().lower() == "loop":
                policy = automation.get("loop_policy") if isinstance(automation.get("loop_policy"), Mapping) else {}
                candidate = dict(checkpoint_after)
                if int(automation.get("enabled") or 0) == 1 and int(automation.get("archived") or 0) == 0:
                    next_at = datetime.now(timezone.utc) + timedelta(seconds=_interval_seconds(policy))
                    data_sink.update_agent_automation(
                        automation["automation_uid"],
                        checkpoint=candidate,
                        next_run_at=next_at.isoformat(),
                        last_status="completed",
                        last_error="",
                        loop_policy={**dict(policy), "failure_count": 0},
                    )
                    completed = self._finish_completed(run_uid, result_summary=summary)
                    self.refresh(automation["automation_uid"])
                    return completed
                data_sink.update_agent_automation(
                    automation["automation_uid"],
                    checkpoint=candidate,
                    next_run_at="",
                )
                return self._finish_completed(run_uid, result_summary=summary)
            return updated
        branch = self._branch_for(program, branch_id)
        toolset = self._branch_toolset(automation, branch)
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
            "automation": automation,
            "automation_uid": automation["automation_uid"],
            "uid": automation["automation_uid"],
            "id": automation["automation_uid"],
            "run": updated,
            "run_uid": run_uid,
            "branch": branch,
            "toolset": toolset,
        }
        try:
            action_result = await _invoke(executor, (automation, updated, branch, toolset), aliases)
            if isinstance(action_result, Mapping):
                summary = {**summary, "action": dict(action_result)}
                if str(action_result.get("status") or "").strip().lower() in {"failed", "error"}:
                    return self._record_run_failure(
                        run_uid,
                        str(action_result.get("error_code") or "ACTION_EXECUTION_FAILED"),
                        str(action_result.get("error_message") or "Action executor failed"),
                    )
            data_sink.update_agent_automation_run(run_uid, result_summary=summary)
            if str(automation.get("automation_kind") or "").strip().lower() == "scheduled":
                return self._finish_completed(run_uid, result_summary=summary)
            return data_sink.get_agent_automation_run(run_uid)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception("Automation action failed after observation: %s", run_uid)
            return self._record_run_failure(run_uid, "ACTION_EXECUTION_FAILED", str(exc))

    async def record_verification(self, run_uid: str, result: Mapping[str, Any]) -> dict:
        run = data_sink.get_agent_automation_run(run_uid)
        if not run:
            raise ValueError(f"Automation run not found: {run_uid}")
        if not isinstance(result, Mapping) or result.get("verified") is not True:
            return self.mark_needs_review(
                run_uid,
                "VERIFICATION_FAILED",
                "Verification must contain the boolean field verified=true",
            )
        automation = self._automation_or_raise(str(run.get("automation_uid") or ""))
        summary = run.get("result_summary") if isinstance(run.get("result_summary"), Mapping) else {}
        summary = {**summary, "verification": copy.deepcopy(dict(result))}
        candidate = run.get("checkpoint_after") if isinstance(run.get("checkpoint_after"), Mapping) else {}
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
        if str(automation.get("automation_kind") or "").strip().lower() == "loop":
            policy = automation.get("loop_policy") if isinstance(automation.get("loop_policy"), Mapping) else {}
            max_cycles = policy.get("max_cycles") or policy.get("max_rounds")
            cycle_seq = int(run.get("cycle_seq") or automation.get("cycle_seq") or 0)
            try:
                max_cycles_value = int(max_cycles) if max_cycles is not None else 0
            except (TypeError, ValueError):
                max_cycles_value = 0
            if max_cycles_value > 0 and cycle_seq >= max_cycles_value:
                data_sink.update_agent_automation(
                    uid,
                    checkpoint=dict(candidate),
                    next_run_at="",
                    last_status="completed_max_cycles",
                    last_error="",
                )
                self.scheduler.unregister_automation_schedule(uid)
            elif int(automation.get("enabled") or 0) == 1 and int(automation.get("archived") or 0) == 0:
                next_at = datetime.now(timezone.utc) + timedelta(seconds=_interval_seconds(policy))
                data_sink.update_agent_automation(
                    uid,
                    checkpoint=dict(candidate),
                    next_run_at=next_at.isoformat(),
                    last_status="completed",
                    last_error="",
                    loop_policy={**dict(policy), "failure_count": 0},
                )
                self.refresh(uid)
            else:
                data_sink.update_agent_automation(uid, checkpoint=dict(candidate), next_run_at="")
        else:
            data_sink.update_agent_automation(uid, last_status="completed", last_error="")
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
            data_sink.update_agent_automation(uid, last_status="needs_review", last_error=str(code or "NEEDS_REVIEW"))
            if _kind(data_sink.get_agent_automation(uid)) == "loop":
                self.scheduler.unregister_automation_schedule(uid)
                data_sink.update_agent_automation(uid, next_run_at="")
        return data_sink.get_agent_automation_run(run_uid)

    def pause(self, uid: str) -> dict:
        automation = self._automation_or_raise(uid)
        self.scheduler.unregister_automation_schedule(uid)
        return data_sink.update_agent_automation(automation["automation_uid"], enabled=False, next_run_at="")

    def resume(self, uid: str) -> dict:
        automation = self._automation_or_raise(uid)
        if int(automation.get("archived") or 0) == 1:
            return automation
        if _kind(automation) == "loop":
            next_run_at = str(automation.get("next_run_at") or "").strip()
            if not next_run_at:
                next_run_at = (datetime.now(timezone.utc) + timedelta(seconds=_interval_seconds(automation.get("loop_policy") or {}))).isoformat()
            automation = data_sink.update_agent_automation(uid, enabled=True, next_run_at=next_run_at)
        else:
            automation = data_sink.update_agent_automation(uid, enabled=True)
        return self._refresh_at(automation)

    def archive(self, uid: str) -> dict:
        self.scheduler.unregister_automation_schedule(uid)
        return data_sink.archive_agent_automation(uid)

    def record_execution_failure(self, automation_uid: str, code: str, retryable: bool) -> dict:
        automation = self._automation_or_raise(automation_uid)
        policy = dict(automation.get("loop_policy") or {})
        try:
            failure_count = int(policy.get("failure_count") or 0) + 1
        except (TypeError, ValueError):
            failure_count = 1
        policy["failure_count"] = failure_count
        threshold = policy.get("failure_threshold") or policy.get("max_consecutive_failures")
        try:
            threshold_value = int(threshold) if threshold is not None else 0
        except (TypeError, ValueError):
            threshold_value = 0
        runs = data_sink.list_agent_automation_runs(automation_uid, 100)
        current_run = next((item for item in runs if item.get("status") in ACTIVE_RUN_STATUSES), None)
        if retryable and threshold_value > 0 and failure_count >= threshold_value:
            if current_run:
                self._record_run_failure(current_run["run_uid"], str(code or "EXECUTION_FAILED"), "Failure threshold reached")
            self.scheduler.unregister_automation_schedule(automation_uid)
            return data_sink.update_agent_automation(
                automation_uid,
                loop_policy=policy,
                enabled=False,
                next_run_at="",
                last_status="paused_circuit_breaker",
                last_error=str(code or "EXECUTION_FAILED"),
            )
        if current_run:
            attempt = int(current_run.get("attempt") or 0) + 1
            if retryable:
                max_retries = int((automation.get("execution_policy") or {}).get("max_retries") or 0)
                if max_retries and attempt > max_retries:
                    self._record_run_failure(current_run["run_uid"], str(code or "EXECUTION_FAILED"), "Maximum retries exceeded")
                else:
                    backoff = int((automation.get("execution_policy") or {}).get("retry_backoff_seconds") or max(1, attempt * 60))
                    next_at = datetime.now(timezone.utc) + timedelta(seconds=backoff)
                    data_sink.update_agent_automation_run(
                        current_run["run_uid"],
                        status="retry_scheduled",
                        attempt=attempt,
                        error_code=str(code or "EXECUTION_FAILED"),
                        error_message="Retry scheduled",
                    )
                    automation = data_sink.update_agent_automation(
                        automation_uid,
                        loop_policy=policy,
                        next_run_at=next_at.isoformat(),
                        last_status="retry_scheduled",
                        last_error=str(code or "EXECUTION_FAILED"),
                    )
                    self.refresh(automation_uid)
                    return automation
            else:
                self._record_run_failure(current_run["run_uid"], str(code or "EXECUTION_FAILED"), "Execution failed")
        return data_sink.update_agent_automation(
            automation_uid,
            loop_policy=policy,
            last_status="failed" if not retryable else "retry_scheduled",
            last_error=str(code or "EXECUTION_FAILED"),
        )


__all__ = ["AutomationController"]
