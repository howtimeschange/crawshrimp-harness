"""Bounded flows with persistent per-step checkpoints. No mutation retries."""
import json
from pathlib import Path
import re
import time
from .feedback_session import activity
from .cancellation import Cancelled, check, marker, cancelled
from .common import Refused, check_expectation, digest, exclusive, same_target, write_json


def validate(plan):
    if not isinstance(plan, dict) or set(plan) != {"flow_id", "window_id", "steps"}:
        raise Refused("Flow requires flow_id/window_id/steps")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", plan["flow_id"]):
        raise Refused("Invalid flow_id")
    if type(plan["window_id"]) is not int or not isinstance(plan["steps"], list) or not 1 <= len(plan["steps"]) <= 30:
        raise Refused("Flow supports 1..30 steps and a numeric window_id")
    ids = set()
    for step in plan["steps"]:
        if not isinstance(step, dict) or set(step) - {"id", "op", "action", "expect", "timeout"}:
            raise Refused("Invalid flow step fields")
        sid = step.get("id", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,30}", sid) or sid in ids:
            raise Refused("Step ids must be unique")
        ids.add(sid)
        if step.get("op") not in {"observe", "wait", "act"}:
            raise Refused("Flow op must be observe/wait/act")
        if step["op"] == "act":
            if not isinstance(step.get("action"), dict) or {"action_id", "snapshot", "ref"} & set(step["action"]):
                raise Refused("Flow actions use selectors, never stale refs or fixed snapshots")
            if "expect" not in step:
                raise Refused("Each flow mutation requires its own readback expectation")
        if step["op"] == "wait":
            if "expect" not in step or type(step.get("timeout", 5)) not in (int, float) or not 0 < step.get("timeout", 5) <= 30:
                raise Refused("Wait requires expect and timeout in (0,30]")


def run_flow(plan, directory, execute, observe, perform, backend):
    validate(plan)
    if not execute:
        return {"status": "preview", "flow_id": plan["flow_id"], "steps": plan["steps"], "execution": False}
    directory = Path(directory)
    check(marker(directory))
    folder = directory / "flows" / plan["flow_id"]
    checkpoint = folder / "checkpoint.json"
    with exclusive(folder / "flow.lock"):
        if checkpoint.exists():
            state = json.loads(checkpoint.read_text(encoding="utf-8"))
            if state["plan_hash"] != digest(plan):
                raise Refused("Flow plan changed; existing operation must be inspected, not overwritten")
        else:
            initial = backend({"command": "observe", "window_id": plan["window_id"], "cancel_file": str(marker(directory))})
            state = {"flow_id": plan["flow_id"], "plan_hash": digest(plan), "window": initial["window"],
                     "status": "in_progress", "steps": {}, "business_success": False}
            write_json(checkpoint, state)
        if state["status"] == "verified_flow":
            return {**state, "replayed": True, "checkpoint": str(checkpoint)}
        for step in plan["steps"]:
            sid = step["id"]
            previous = state["steps"].get(sid, {})
            if previous.get("status") == "verified":
                continue
            if previous.get("status") == "unknown" and step["op"] == "act":
                return {**state, "checkpoint": str(checkpoint), "replayed": True}
            state["current_step"] = sid
            try:
                check(marker(directory))
                fresh = backend({"command": "observe", "window_id": plan["window_id"], "cancel_file": str(marker(directory))})
                same_target(state["window"], fresh["window"])
                state["steps"][sid] = {**previous, "status": "in_progress", "op": step["op"]}
                write_json(checkpoint, state)
                if step["op"] == "observe":
                    result = observe(plan["window_id"], directory)
                    same_target(state["window"], result["window"])
                    state["steps"][sid].update(status="verified", snapshot=result["snapshot"])
                elif step["op"] == "wait":
                    with activity(directory, 'waiting'):
                        deadline = time.monotonic() + step.get("timeout", 5)
                        while True:
                            check(marker(directory))
                            try:
                                current = backend({"command": "observe", "window_id": plan["window_id"], "cancel_file": str(marker(directory))})
                                same_target(state["window"], current["window"])
                                verification = check_expectation(current, step["expect"])
                            except Cancelled:
                                raise
                            except Refused as exc:
                                verification = {"passed": False, "error": str(exc)}
                            if verification["passed"] or time.monotonic() >= deadline:
                                break
                            time.sleep(.2)
                    state["steps"][sid].update(status="verified" if verification["passed"] else "waiting", verification=verification)
                else:
                    action_file = folder / f"{sid}-request.json"
                    if action_file.exists():
                        request = json.loads(action_file.read_text(encoding="utf-8"))
                    else:
                        snap = observe(plan["window_id"], directory)
                        same_target(state["window"], snap["window"])
                        request = {**step["action"], "expect": step["expect"], "snapshot": snap["snapshot"],
                                   "action_id": "flow-" + digest([plan["flow_id"], sid])[:32]}
                        write_json(action_file, request)
                    result = perform(request, directory, True)
                    state["steps"][sid].update(status="verified" if result["status"] == "verified_control" else "unknown",
                                               receipt=str(directory / "actions" / (request["action_id"] + ".json")), result=result["status"])
                check(marker(directory))
                if state["steps"][sid]["status"] != "verified":
                    state["status"] = state["steps"][sid]["status"]
                    write_json(checkpoint, state)
                    return {**state, "checkpoint": str(checkpoint)}
                write_json(checkpoint, state)
            except Exception as exc:
                # Never recreate a mutation request after an exception; persist the ambiguous boundary.
                state["status"] = "cancelled" if cancelled(marker(directory)) else ("unknown" if step["op"] == "act" else "waiting")
                state["steps"][sid] = {**state["steps"].get(sid, {}), "status": state["status"], "error": str(exc)}
                write_json(checkpoint, state)
                return {**state, "checkpoint": str(checkpoint)}
        state["status"] = "verified_flow"
        write_json(checkpoint, state)
        return {**state, "checkpoint": str(checkpoint)}
