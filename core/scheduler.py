"""
APScheduler task scheduling engine
Supports three trigger types: manual / interval / cron

Design:
- Adapters declare triggers in manifest.yaml
- Scheduler reads loaded adapters and registers jobs on startup
- Manual tasks are triggered on-demand via API
- State (last run, next run, status) persisted to SQLite via data_sink
"""
import asyncio
import inspect
import logging
import math
import uuid
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger

from core.models import AdapterManifest, TriggerType

logger = logging.getLogger(__name__)
APP_TIMEZONE = timezone(timedelta(hours=8), "UTC+08:00")

# job_id format: "{adapter_id}::{task_id}"
_scheduler: Optional[AsyncIOScheduler] = None
_task_callbacks: Dict[str, Callable] = {}  # job_id -> async callable
_automation_callbacks: Dict[str, Callable] = {}  # automation_uid -> async callable
_automation_callback_tokens: Dict[str, str] = {}
_automation_retry_callbacks: Dict[str, Callable] = {}  # automation_uid -> async callable
_automation_retry_callback_tokens: Dict[str, str] = {}
_begin_runtime_operation: Callable[[str, str, str, str], str] | None = None
_end_runtime_operation: Callable[[str], None] | None = None
AUTOMATION_JOB_PREFIX = "automation::"
AUTOMATION_RETRY_JOB_PREFIX = "automation-retry::"
DEFAULT_AUTOMATION_TIMEZONE = "Asia/Shanghai"
WEEKDAY_NAMES = {
    1: "mon",
    2: "tue",
    3: "wed",
    4: "thu",
    5: "fri",
    6: "sat",
    7: "sun",
}


def get_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is None:
        # Windows Python builds do not always ship an IANA timezone database.
        # Crawshrimp only needs China standard time, so use a fixed UTC+8 tzinfo.
        _scheduler = AsyncIOScheduler(timezone=APP_TIMEZONE)
    return _scheduler


def start():
    sched = get_scheduler()
    if not sched.running:
        sched.start()
        logger.info("Scheduler started")


def shutdown():
    sched = get_scheduler()
    if sched.running:
        sched.shutdown(wait=False)
        logger.info("Scheduler stopped")


def job_id(adapter_id: str, task_id: str) -> str:
    return f"{adapter_id}::{task_id}"


def schedule_job_id(schedule_uid: str) -> str:
    return f"schedule::{str(schedule_uid or '').strip()}"


def automation_job_id(automation_uid: str) -> str:
    """Return the isolated APScheduler id for one Agent Automation.

    Automation jobs deliberately use a namespace disjoint from both manifest
    jobs (``adapter::task``) and persisted Adapter Task Schedules
    (``schedule::uid``).  The scheduler is only a wake-up mechanism; the
    Controller remains the authority for claiming and executing a trigger.
    """
    uid = str(automation_uid or "").strip()
    if not uid:
        raise ValueError("automation_uid is required")
    return f"{AUTOMATION_JOB_PREFIX}{uid}"


def automation_retry_job_id(automation_uid: str) -> str:
    """Return the separate retry wake-up id for one Agent Automation.

    The regular recurring schedule must remain armed while a transient failure
    waits to retry, so a retry cannot replace or shift the next cron/interval
    boundary.
    """
    uid = str(automation_uid or "").strip()
    if not uid:
        raise ValueError("automation_uid is required")
    return f"{AUTOMATION_RETRY_JOB_PREFIX}{uid}"


def set_runtime_operation_hooks(begin_operation=None, end_operation=None) -> None:
    global _begin_runtime_operation, _end_runtime_operation
    _begin_runtime_operation = begin_operation
    _end_runtime_operation = end_operation


def _begin_scheduled_runtime_operation(kind: str, operation_id: str, label: str) -> str:
    if _begin_runtime_operation is None:
        return ""
    return str(_begin_runtime_operation(kind, operation_id, label, "running") or "")


def _end_scheduled_runtime_operation(token: str) -> None:
    if token and _end_runtime_operation is not None:
        _end_runtime_operation(token)


def _parse_time_of_day(value: str) -> tuple[int, int]:
    text = str(value or "").strip()
    parts = text.split(":")
    if len(parts) != 2:
        raise ValueError("time_of_day must use HH:MM")
    hour = int(parts[0])
    minute = int(parts[1])
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        raise ValueError("time_of_day must be a valid HH:MM value")
    return hour, minute


def _task_schedule_trigger(schedule: dict) -> CronTrigger:
    frequency = str((schedule or {}).get("frequency") or "").strip().lower()
    hour, minute = _parse_time_of_day(str((schedule or {}).get("time_of_day") or ""))
    if frequency == "daily":
        return CronTrigger(hour=hour, minute=minute, timezone=APP_TIMEZONE)
    if frequency == "weekly":
        weekday = int((schedule or {}).get("weekday") or 0)
        day_name = WEEKDAY_NAMES.get(weekday)
        if not day_name:
            raise ValueError("weekday must be 1..7 for weekly schedules")
        return CronTrigger(day_of_week=day_name, hour=hour, minute=minute, timezone=APP_TIMEZONE)
    raise ValueError("frequency must be daily or weekly")


def register_adapter(manifest: AdapterManifest, run_callback: Callable) -> int:
    """
    Register all scheduled tasks for an adapter.
    run_callback: async fn(adapter_id, task_id) -> None
    Returns number of jobs registered.
    """
    sched = get_scheduler()
    count = 0
    for task in manifest.tasks:
        jid = job_id(manifest.id, task.id)
        trigger = task.trigger

        if trigger.type == TriggerType.manual:
            # Manual tasks are not auto-scheduled; triggered on-demand via API
            _task_callbacks[jid] = run_callback
            continue

        missing_required = [p.id for p in task.params if p.required and p.default is None]
        if missing_required:
            logger.warning(
                f"Task {jid} 需要运行参数 {missing_required}，当前调度器无持久化参数来源，跳过自动注册"
            )
            _task_callbacks[jid] = run_callback
            continue

        if trigger.type == TriggerType.interval:
            minutes = trigger.interval_minutes or 30
            apc_trigger = IntervalTrigger(minutes=minutes)
        elif trigger.type == TriggerType.cron:
            if not trigger.cron:
                logger.warning(f"Task {jid} has cron trigger but no cron expression, skipping")
                continue
            apc_trigger = CronTrigger.from_crontab(trigger.cron)
        else:
            continue

        # Wrap async callback
        async def _job(a=manifest.id, t=task.id):
            token = _begin_scheduled_runtime_operation("scheduled_task", job_id(a, t), f"{a}::{t}")
            if _begin_runtime_operation is not None and not token:
                return
            try:
                await run_callback(a, t)
            except Exception as e:
                logger.error(f"Scheduled job {a}::{t} failed: {e}")
            finally:
                _end_scheduled_runtime_operation(token)

        if sched.get_job(jid):
            sched.remove_job(jid)

        sched.add_job(_job, trigger=apc_trigger, id=jid, replace_existing=True)
        _task_callbacks[jid] = run_callback
        count += 1
        logger.info(f"Registered job {jid} ({trigger.type.value})")

    return count


def unregister_adapter(adapter_id: str):
    """Remove all scheduled jobs for an adapter"""
    sched = get_scheduler()
    removed = 0
    for job in sched.get_jobs():
        if job.id.startswith(f"{adapter_id}::"):
            sched.remove_job(job.id)
            removed += 1
    # Clear callbacks
    for jid in list(_task_callbacks.keys()):
        if jid.startswith(f"{adapter_id}::"):
            del _task_callbacks[jid]
    logger.info(f"Unregistered {removed} jobs for adapter {adapter_id}")


def register_task_schedule(schedule: dict, run_callback: Callable) -> int:
    """
    Register one persisted task schedule.
    run_callback: async fn(schedule_uid) -> None
    Returns 1 when a job is registered, otherwise 0.
    """
    schedule_uid = str((schedule or {}).get("schedule_uid") or "").strip()
    if not schedule_uid:
        raise ValueError("schedule_uid is required")
    jid = schedule_job_id(schedule_uid)
    sched = get_scheduler()

    if sched.get_job(jid):
        sched.remove_job(jid)

    _task_callbacks[jid] = run_callback
    if int((schedule or {}).get("enabled") or 0) != 1 or int((schedule or {}).get("archived") or 0) == 1:
        logger.info("Task schedule %s is disabled or archived; callback registered without APScheduler job", schedule_uid)
        return 0

    trigger = _task_schedule_trigger(schedule)

    async def _job(uid=schedule_uid):
        token = _begin_scheduled_runtime_operation("task_schedule", jid, f"schedule::{uid}")
        if _begin_runtime_operation is not None and not token:
            return
        try:
            result = run_callback(uid)
            if inspect.isawaitable(result):
                await result
        except Exception as e:
            logger.error("Scheduled task schedule %s failed: %s", uid, e)
        finally:
            _end_scheduled_runtime_operation(token)

    sched.add_job(_job, trigger=trigger, id=jid, replace_existing=True)
    logger.info("Registered task schedule job %s", jid)
    return 1


def register_task_schedules(schedules: list[dict], run_callback: Callable) -> int:
    count = 0
    for schedule in schedules or []:
        count += register_task_schedule(schedule, run_callback)
    return count


def unregister_task_schedule(schedule_uid: str) -> int:
    """Remove one persisted schedule job and callback."""
    jid = schedule_job_id(schedule_uid)
    sched = get_scheduler()
    removed = 0
    if sched.get_job(jid):
        sched.remove_job(jid)
        removed = 1
    _task_callbacks.pop(jid, None)
    return removed


def _automation_schedule_value(automation: dict) -> dict:
    schedule = (automation or {}).get("schedule")
    return schedule if isinstance(schedule, dict) else {}


def _automation_timezone(schedule: dict) -> ZoneInfo:
    name = str(
        (schedule or {}).get("timezone")
        or (schedule or {}).get("iana_timezone")
        or (schedule or {}).get("tz")
        or DEFAULT_AUTOMATION_TIMEZONE
    ).strip()
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"automation schedule timezone must be an IANA name: {name}") from exc


def _automation_datetime(value, timezone_value: ZoneInfo, *, field_name: str) -> datetime:
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


def _automation_now(timezone_value: ZoneInfo) -> datetime:
    return datetime.now(timezone_value)


def _positive_seconds(schedule: dict) -> int:
    def _parse(value, message: str) -> int:
        if isinstance(value, bool):
            raise ValueError(message)
        try:
            seconds_float = float(value)
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError(message) from exc
        if not math.isfinite(seconds_float) or not seconds_float.is_integer():
            raise ValueError(message)
        seconds = int(seconds_float)
        if seconds <= 0:
            raise ValueError(message)
        return seconds

    candidates = (
        (schedule or {}).get("seconds"),
        (schedule or {}).get("interval_seconds"),
        (schedule or {}).get("every_seconds"),
        (schedule or {}).get("interval"),
    )
    for candidate in candidates:
        if candidate is None or str(candidate).strip() == "":
            continue
        return _parse(candidate, "every schedule interval must be a positive integer number of seconds")
    for key, multiplier in (("minutes", 60), ("interval_minutes", 60), ("hours", 3600)):
        candidate = (schedule or {}).get(key)
        if candidate is None or str(candidate).strip() == "":
            continue
        try:
            return _parse(float(candidate) * multiplier, "every schedule interval must be a positive integer number of seconds")
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError("every schedule interval must be a positive integer number of seconds") from exc
    value = str((schedule or {}).get("value") or "").strip().lower()
    if value:
        try:
            if value.endswith("h"):
                return _parse(float(value[:-1]) * 3600, "every schedule interval must be a positive integer duration")
            if value.endswith("m"):
                return _parse(float(value[:-1]) * 60, "every schedule interval must be a positive integer duration")
            if value.endswith("s"):
                return _parse(value[:-1], "every schedule interval must be a positive integer duration")
            return _parse(value, "every schedule interval must be a positive integer duration")
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError("every schedule interval must be a positive integer duration") from exc
    raise ValueError("every schedule requires a positive interval")


def _every_next_boundary(schedule: dict, now: Optional[datetime] = None) -> datetime:
    timezone_value = _automation_timezone(schedule)
    current = now.astimezone(timezone_value) if isinstance(now, datetime) and now.tzinfo else now
    if not isinstance(current, datetime):
        current = _automation_now(timezone_value)
    elif current.tzinfo is None:
        current = current.replace(tzinfo=timezone_value)
    seconds = _positive_seconds(schedule)
    anchor_value = (
        (schedule or {}).get("anchor")
        or (schedule or {}).get("anchor_at")
        or (schedule or {}).get("start_at")
        or (schedule or {}).get("first_run_at")
    )
    anchor = _automation_datetime(anchor_value, timezone_value, field_name="every anchor") if anchor_value else current
    if anchor > current:
        return anchor
    elapsed = max(0.0, (current - anchor).total_seconds())
    periods = math.floor(elapsed / seconds) + 1
    return anchor + timedelta(seconds=periods * seconds)


def _automation_trigger(automation: dict, *, now: Optional[datetime] = None):
    """Build an APScheduler trigger and its first persisted boundary.

    This helper intentionally accepts the normalized Automation detail rather
    than raw API payloads.  It still tolerates the small aliases used by early
    persisted rows so a restart can safely reconstruct jobs created by an
    earlier build.
    """
    schedule = _automation_schedule_value(automation)
    kind = str(schedule.get("kind") or schedule.get("type") or "").strip().lower()
    timezone_value = _automation_timezone(schedule)
    if str((automation or {}).get("automation_kind") or "").strip().lower() == "loop":
        kind = "loop"

    if kind == "at":
        run_value = (
            schedule.get("value")
            or schedule.get("at")
            or schedule.get("run_at")
            or (automation or {}).get("next_run_at")
        )
        run_at = _automation_datetime(run_value, timezone_value, field_name="at value")
        return DateTrigger(run_date=run_at, timezone=timezone_value), run_at

    if kind == "every":
        current = now
        if current is None:
            persisted = str((automation or {}).get("next_run_at") or "").strip()
            if persisted:
                # A persisted next_run_at is a useful lower bound, but the
                # anchor remains the source of truth for calculating the next
                # non-past boundary.
                current = _automation_now(timezone_value)
        next_at = _every_next_boundary(schedule, current)
        interval = _positive_seconds(schedule)
        return (
            IntervalTrigger(seconds=interval, start_date=next_at, timezone=timezone_value),
            next_at,
        )

    if kind == "cron":
        expression = str(
            schedule.get("value") or schedule.get("cron") or schedule.get("expression") or ""
        ).strip()
        if len(expression.split()) != 5:
            raise ValueError("cron schedule requires a five-field expression")
        return CronTrigger.from_crontab(expression, timezone=timezone_value), None

    if kind == "loop":
        run_value = str((automation or {}).get("next_run_at") or "").strip()
        if not run_value:
            raise ValueError("loop schedule requires next_run_at")
        run_at = _automation_datetime(run_value, timezone_value, field_name="next_run_at")
        return DateTrigger(run_date=run_at, timezone=timezone_value), run_at

    raise ValueError("automation schedule kind must be at, every, or cron")


def register_automation_schedule(automation: dict, callback: Callable) -> int:
    """Register one Agent Automation wake-up in its isolated job namespace.

    The callback receives only ``automation_uid``.  It must claim the durable
    trigger through the Controller before doing any work.  Replacing a job
    rotates a private generation token, so a callback already queued by an old
    APScheduler job cannot run after cancellation/re-registration.
    """
    automation_uid = str((automation or {}).get("automation_uid") or "").strip()
    if not automation_uid:
        raise ValueError("automation_uid is required")
    if not callable(callback):
        raise TypeError("automation callback must be callable")
    jid = automation_job_id(automation_uid)
    sched = get_scheduler()

    # Remove the old callback before touching the scheduler.  This ordering is
    # important when a running DateTrigger is concurrently canceled.
    _automation_callback_tokens.pop(automation_uid, None)
    _automation_callbacks.pop(automation_uid, None)
    try:
        if sched.get_job(jid):
            sched.remove_job(jid)
    except Exception:
        logger.debug("Automation job %s disappeared while replacing", jid, exc_info=True)

    token = uuid.uuid4().hex
    _automation_callback_tokens[automation_uid] = token
    _automation_callbacks[automation_uid] = callback
    if int((automation or {}).get("enabled") or 0) != 1 or int((automation or {}).get("archived") or 0) == 1:
        return 0

    trigger, _ = _automation_trigger(automation)

    async def _job(uid=automation_uid, generation=token):
        if _automation_callback_tokens.get(uid) != generation:
            return
        current_callback = _automation_callbacks.get(uid)
        if current_callback is None:
            return
        try:
            result = current_callback(uid)
            if inspect.isawaitable(result):
                await result
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("Scheduled Agent Automation %s failed: %s", uid, exc)

    sched.add_job(_job, trigger=trigger, id=jid, replace_existing=True)
    logger.info("Registered Agent Automation job %s", jid)
    return 1


def unregister_automation_schedule(automation_uid: str) -> int:
    """Cancel one Automation wake-up, even if its APScheduler job is racing."""
    uid = str(automation_uid or "").strip()
    if not uid:
        return 0
    jid = automation_job_id(uid)
    _automation_callback_tokens.pop(uid, None)
    _automation_callbacks.pop(uid, None)
    sched = get_scheduler()
    try:
        if sched.get_job(jid):
            sched.remove_job(jid)
            return 1
    except Exception:
        # JobLookupError and scheduler shutdown races are cancellation-safe:
        # callback state has already been revoked above.
        logger.debug("Automation job %s disappeared during unregister", jid, exc_info=True)
    return 0


def register_automation_retry(automation: dict, callback: Callable) -> int:
    """Register a durable one-shot retry without replacing the normal schedule."""
    automation_uid = str((automation or {}).get("automation_uid") or "").strip()
    retry_at = str((automation or {}).get("retry_at") or "").strip()
    if not automation_uid or not retry_at or not callable(callback):
        return 0
    if int((automation or {}).get("enabled") or 0) != 1 or int((automation or {}).get("archived") or 0) == 1:
        return 0
    timezone_value = _automation_timezone(_automation_schedule_value(automation))
    run_at = _automation_datetime(retry_at, timezone_value, field_name="retry_at")
    jid = automation_retry_job_id(automation_uid)
    sched = get_scheduler()
    _automation_retry_callback_tokens.pop(automation_uid, None)
    _automation_retry_callbacks.pop(automation_uid, None)
    try:
        if sched.get_job(jid):
            sched.remove_job(jid)
    except Exception:
        logger.debug("Automation retry job %s disappeared while replacing", jid, exc_info=True)
    token = uuid.uuid4().hex
    _automation_retry_callback_tokens[automation_uid] = token
    _automation_retry_callbacks[automation_uid] = callback

    async def _job(uid=automation_uid, generation=token):
        if _automation_retry_callback_tokens.get(uid) != generation:
            return
        current_callback = _automation_retry_callbacks.get(uid)
        if current_callback is None:
            return
        try:
            result = current_callback(uid)
            if inspect.isawaitable(result):
                await result
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("Scheduled Agent Automation retry %s failed: %s", uid, exc)

    sched.add_job(_job, trigger=DateTrigger(run_date=run_at, timezone=timezone_value), id=jid, replace_existing=True)
    logger.info("Registered Agent Automation retry job %s", jid)
    return 1


def unregister_automation_retry(automation_uid: str) -> int:
    """Cancel one pending retry; normal Automation schedule remains untouched."""
    uid = str(automation_uid or "").strip()
    if not uid:
        return 0
    jid = automation_retry_job_id(uid)
    _automation_retry_callback_tokens.pop(uid, None)
    _automation_retry_callbacks.pop(uid, None)
    sched = get_scheduler()
    try:
        if sched.get_job(jid):
            sched.remove_job(jid)
            return 1
    except Exception:
        logger.debug("Automation retry job %s disappeared during unregister", jid, exc_info=True)
    return 0


def list_automation_next_runs() -> list[dict]:
    """List only Agent Automation jobs; fixed Task Schedule jobs stay separate."""
    result = []
    for job in get_scheduler().get_jobs():
        if job.id.startswith(AUTOMATION_JOB_PREFIX):
            job_kind = "agent_automation"
            automation_uid = job.id[len(AUTOMATION_JOB_PREFIX):]
        elif job.id.startswith(AUTOMATION_RETRY_JOB_PREFIX):
            job_kind = "agent_automation_retry"
            automation_uid = job.id[len(AUTOMATION_RETRY_JOB_PREFIX):]
        else:
            continue
        try:
            next_run = job.next_run_time
        except AttributeError:
            # APScheduler keeps jobs pending until the scheduler starts and
            # consequently does not expose ``next_run_time`` yet.  The
            # trigger still contains enough information for an accurate
            # read-only projection, which is useful to the Automation Center
            # before backend startup completes.
            trigger = getattr(job, "trigger", None)
            next_run = getattr(trigger, "start_date", None) or getattr(trigger, "run_date", None)
            if next_run is None and isinstance(trigger, CronTrigger):
                zone = getattr(trigger, "timezone", timezone.utc)
                next_run = trigger.get_next_fire_time(None, datetime.now(zone))
        result.append({
            "job_id": job.id,
            "kind": job_kind,
            "automation_uid": automation_uid,
            "next_run": next_run.isoformat() if next_run else None,
        })
    return result


async def trigger_now(adapter_id: str, task_id: str):
    """Immediately execute a task (manual trigger)"""
    jid = job_id(adapter_id, task_id)
    cb = _task_callbacks.get(jid)
    if cb is None:
        raise ValueError(f"No callback registered for {jid}")
    await cb(adapter_id, task_id)


def list_jobs() -> list:
    """List all scheduled jobs with next run time"""
    sched = get_scheduler()
    result = []
    for job in sched.get_jobs():
        next_run = getattr(job, "next_run_time", None)
        if job.id.startswith("schedule::"):
            result.append({
                "job_id": job.id,
                "kind": "task_schedule",
                "schedule_uid": job.id.split("::", 1)[1],
                "adapter_id": "",
                "task_id": "",
                "next_run": next_run.isoformat() if next_run else None,
            })
        elif job.id.startswith(AUTOMATION_JOB_PREFIX):
            result.append({
                "job_id": job.id,
                "kind": "agent_automation",
                "automation_uid": job.id[len(AUTOMATION_JOB_PREFIX):],
                "adapter_id": "",
                "task_id": "",
                "schedule_uid": "",
                "next_run": next_run.isoformat() if next_run else None,
            })
        elif job.id.startswith(AUTOMATION_RETRY_JOB_PREFIX):
            result.append({
                "job_id": job.id,
                "kind": "agent_automation_retry",
                "automation_uid": job.id[len(AUTOMATION_RETRY_JOB_PREFIX):],
                "adapter_id": "",
                "task_id": "",
                "schedule_uid": "",
                "next_run": next_run.isoformat() if next_run else None,
            })
        else:
            parts = job.id.split("::", 1)
            result.append({
                "job_id": job.id,
                "kind": "manifest_task",
                "adapter_id": parts[0] if len(parts) == 2 else "",
                "task_id": parts[1] if len(parts) == 2 else "",
                "schedule_uid": "",
                "next_run": next_run.isoformat() if next_run else None,
            })
    return result
