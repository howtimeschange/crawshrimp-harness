#!/usr/bin/env python3
"""JSON desktop CLI with compact observations, guarded focus leases and durable flows."""
from __future__ import annotations
from contextlib import nullcontext

import argparse
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import tempfile
import time
import uuid

from cu.common import (Refused, check_expectation, digest, exclusive, validate_action, write_json)
from cu.observation import annotate, compact, resolve_ref
from cu.diagnostics import diagnose, observation_diagnostics
from cu.discovery import enrich
from cu.feedback_session import activity
from cu.feedback_copy import PUBLIC_PHASES
from cu.cancellation import Cancelled, check, marker, cancelled, run_process

ROOT = Path(__file__).resolve().parent.parent


def backend(payload):
    system = platform.system()
    if system == "Darwin":
        executable = ROOT / "scripts" / "native" / "mac"
        if not executable.exists():
            raise Refused("Run: python3 scripts/setup.py (compiles macOS helper)")
        command = [str(executable)]
    elif system == "Windows":
        command = [sys.executable, str(ROOT / "scripts" / "cu" / "windows.py")]
    else:
        raise Refused(f"Unsupported desktop OS: {system}")
    result = run_process(command, json.dumps(payload, ensure_ascii=False), payload.get("cancel_file"), text=True,
                            encoding="utf-8",
                            env={**os.environ,"PYTHONIOENCODING":"utf-8","PYTHONUTF8":"1"})
    try:
        data = json.loads(result.stdout)
    except ValueError as exc:
        raise RuntimeError(f"Backend failed: {result.stderr[-1500:]} {result.stdout[-500:]}") from exc
    if result.returncode or data.get("error"):
        if data.get("status") == "refused":
            error = Refused(data.get("error", "Backend refused"))
            error.details = data
            raise error
        error = RuntimeError(data.get("error", result.stderr[-1500:]))
        error.details = data
        raise error
    return data


def observe(window_id, run, capture=True):
    check(marker(run))
    with activity(run, 'observing'):
        return _observe(window_id, run, capture)


def _observe(window_id, run, capture=True):
    snap = backend({"command": "observe", "window_id": window_id, "cancel_file": str(marker(run))})
    snap.update({"schema_version": 1, "platform": platform.system(), "created_at": time.time(),
                 "snapshot_id": uuid.uuid4().hex})
    if capture:
        path = run / "screenshots" / f"{snap['snapshot_id']}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            snap["image"] = backend({"command": "shot", "window": snap["window"], "path": str(path),
                                     "preview_path": str(path.with_name(path.stem + "-preview.png")), "cancel_file": str(marker(run))})
            if "preview" in snap["image"]:
                snap["preview"] = snap["image"].pop("preview")
        except Cancelled:
            raise
        except Exception as exc:
            snap["image"] = {"available": False, "error": str(exc)}
    out = run / "observations" / f"{snap['snapshot_id']}.json"
    snap["snapshot"] = str(out)
    annotate(snap)
    snap["diagnostics"] = observation_diagnostics(snap)
    write_json(out, snap)
    return snap


def perform(request, run, execute=False, call_backend=backend):
    action_id = request.get("action_id", "")
    if not isinstance(action_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", action_id):
        raise Refused("A stable action_id (1-80 letters/digits/_/-) is required")
    snapshot = json.loads(Path(request["snapshot"]).read_text(encoding="utf-8"))
    if snapshot["platform"] != platform.system():
        raise Refused("Snapshot belongs to another platform")
    # One per-user OS lock serializes all actions across run directories.
    identity = str(os.getuid()) if hasattr(os, "getuid") else os.environ.get("USERNAME", "user")
    lock = Path(tempfile.gettempdir()) / f"crawshrimp-cu-{digest(identity)[:16]}.lock"
    with exclusive(lock):
        receipt_path = run / "actions" / f"{action_id}.json"
        if receipt_path.exists():
            previous = json.loads(receipt_path.read_text(encoding="utf-8"))
            if previous["request_hash"] != digest(request):
                raise Refused("action_id already used with a different request")
            return {**previous, "replayed": True, "reexecuted": False}
        check(marker(run))
        fresh = call_backend({"command": "observe", "window_id": snapshot["window"]["id"], "cancel_file": str(marker(run))})
        check(marker(run))
        payload = validate_action(resolve_ref(request, snapshot), snapshot, fresh)
        if not execute:
            return {"status": "preview", "action_id": action_id, "request": payload,
                    "execution": False, "note": "Live focus/idle/occlusion checks occur at execution time"}
        receipt = {"schema_version": 1, "action_id": action_id, "request_hash": digest(request),
                   "snapshot": request["snapshot"], "status": "unknown", "business_success": False,
                   "started_at": time.time(), "request": request}
        # Persist UNKNOWN before the only dispatch. Crash/timeout can never cause automatic resend.
        write_json(receipt_path, receipt)
        try:
            if call_backend is backend:
                from cu.feedback_session import start
                session=start(run)
                payload["feedback_dir"]=session["directory"]
                payload["feedback_pid"]=session["pid"]
                receipt["feedback_session"]={"directory":session["directory"],"pid":session["pid"]}
            check(marker(run))
            payload["cancel_file"] = str(marker(run))
            receipt["dispatch"] = call_backend(payload)
            check(marker(run))
            receipt["status"] = "executed_unverified"
            if "expect" in request:
                with activity(run, 'verifying') if call_backend is backend else nullcontext():
                    deadline = time.monotonic() + 5
                    while True:
                        check(marker(run))
                        try:
                            after = call_backend({"command": "observe", "window_id": snapshot["window"]["id"], "cancel_file": str(marker(run))})
                            check(marker(run))
                            from cu.common import same_target
                            same_target(snapshot["window"], after["window"])
                            receipt["verification"] = check_expectation(after, request["expect"])
                            if receipt["verification"]["passed"]:
                                receipt["status"] = "verified_control"
                                break
                        except Cancelled:
                            raise
                        except Exception as exc:
                            receipt["verification"] = {"passed": False, "error": str(exc)}
                        if time.monotonic() >= deadline:
                            break
                        time.sleep(.2)
        except Exception as exc:
            # Even a backend error may have followed partial input. No fallback / no repeat.
            receipt["status"] = "unknown"
            receipt["error"] = str(exc)
            receipt["cancelled"] = cancelled(marker(run))
            if hasattr(exc, "details"):
                receipt["backend_error"] = exc.details
            receipt["diagnostic"] = diagnose(exc, phase="dispatch", window=snapshot["window"])
        receipt["finished_at"] = time.time()
        write_json(receipt_path, receipt)
        return receipt


def browser_skill(explicit):
    candidates = []
    if explicit or os.environ.get("CRAWSHRIMP_BROWSER_SKILL_DIR"):
        candidates.append(Path(explicit or os.environ["CRAWSHRIMP_BROWSER_SKILL_DIR"]).expanduser())
    else:
        candidates.extend([ROOT.parent / "crawshrimp-skill", Path.home() / ".codex/skills/crawshrimp-skill",
                           Path.home() / ".agents/skills/crawshrimp-skill"])
        candidates.extend(sorted((Path.home() / ".codex/plugins/cache/personal/crawshrimp-skill").glob("*/skills/crawshrimp-skill"), reverse=True))
    for candidate in candidates:
        if (candidate / "SKILL.md").is_file() and (candidate / "scripts/web_operator.py").is_file():
            return candidate.resolve()
    raise Refused("crawshrimp-skill not found; set CRAWSHRIMP_BROWSER_SKILL_DIR to its folder")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("doctor")
    permission = sub.add_parser("automation-status", help="Read-only Apple Events authorization check; never prompts")
    permission.add_argument("--bundle-id", required=True)
    consent = sub.add_parser("automation-request", help="Request user consent via the Harness desktop host, then recheck")
    consent.add_argument("--bundle-id", required=True)
    consent.add_argument("--purpose", required=True)
    consent.add_argument("--run-dir", required=True)
    feedback=sub.add_parser("feedback")
    feedback.add_argument("op",choices=["start", "status", "stop", "cancel", "phase"])
    feedback.add_argument("--run-dir",required=True)
    feedback.add_argument("--phase", choices=PUBLIC_PHASES)
    windows = sub.add_parser("windows")
    windows.add_argument("--app", default="")
    probe = sub.add_parser("probe")
    probe.add_argument("--window", type=int, required=True)
    probe.add_argument("--out")
    probe.add_argument("--no-cdp", action="store_true", help="Skip GET checks of observed app ports")
    obs = sub.add_parser("observe")
    obs.add_argument("--window", type=int, required=True)
    obs.add_argument("--run-dir", required=True)
    obs.add_argument("--no-shot", action="store_true")
    obs.add_argument("--full", action="store_true")
    obs.add_argument("--limit", type=int, default=50)
    obs.add_argument("--query", default="")
    view = sub.add_parser("view")
    view.add_argument("--snapshot", required=True)
    view.add_argument("--query", default="")
    view.add_argument("--limit", type=int, default=50)
    flow = sub.add_parser("flow")
    flow.add_argument("--plan", required=True)
    flow.add_argument("--run-dir", required=True)
    flow.add_argument("--execute", action="store_true")
    profiles = sub.add_parser("profile")
    profiles.add_argument("op", choices=["record", "match"])
    profiles.add_argument("--probe", required=True)
    profiles.add_argument("--snapshot")
    profiles.add_argument("--profile")
    profiles.add_argument("--receipt")
    profiles.add_argument("--out")
    profiles.add_argument("--note", default="")
    act = sub.add_parser("act")
    act.add_argument("--request", required=True)
    act.add_argument("--run-dir", required=True)
    act.add_argument("--execute", action="store_true")
    verify = sub.add_parser("verify")
    verify.add_argument("--snapshot", required=True)
    verify.add_argument("--check", required=True, help="JSON file with selector/property/equals")
    browser = sub.add_parser("browser")
    browser.add_argument("--skill-dir")
    browser.add_argument("args", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.command == "feedback":
        from cu import feedback_session
        if args.op == 'phase':
            if not args.phase:parser.error('feedback phase requires --phase')
            result=feedback_session.phase(args.run_dir,args.phase)
        else:
            if args.phase:parser.error('--phase requires feedback phase')
            result=getattr(feedback_session,args.op)(args.run_dir)
    elif args.command == "automation-request":
        from cu.automation import request_permission
        result = request_permission(args.bundle_id, args.purpose, args.run_dir, backend) if platform.system() == "Darwin" else {"status": "unsupported"}
    elif args.command == "automation-status":
        result = backend({"command": "automation_permission", "bundle_id": args.bundle_id, "ask_user": False}) if platform.system() == "Darwin" else {"status": "unsupported", "platform": platform.system()}
    elif args.command == "doctor":
        result = {"platform": platform.system(), "python": sys.version.split()[0], "python_executable": sys.executable}
        try:
            result["native"] = backend({"command": "doctor"})
        except Exception as exc:
            result["native"] = {"error": str(exc)}
        try:
            result["browser_skill"] = str(browser_skill(None))
        except Refused as exc:
            result["browser_skill"] = {"error": str(exc)}
    elif args.command == "windows":
        result = backend({"command": "windows", "app": args.app})
    elif args.command == "probe":
        result = enrich(backend({"command": "probe", "window_id": args.window}), platform.system(), not args.no_cdp)
        result["platform"] = platform.system()
        result["created_at"] = time.time()
        if args.out:
            write_json(Path(args.out).resolve(), result)
    elif args.command == "observe":
        result = observe(args.window, Path(args.run_dir).resolve(), not args.no_shot)
        if not args.full:
            result = compact(result, args.limit, args.query)
    elif args.command == "view":
        result = compact(json.loads(Path(args.snapshot).read_text(encoding="utf-8")), args.limit, args.query)
    elif args.command == "flow":
        from cu.flows import run_flow
        result = run_flow(json.loads(Path(args.plan).read_text(encoding="utf-8")), Path(args.run_dir).resolve(), args.execute, observe, perform, backend)
    elif args.command == "profile":
        from cu.profiles import record, match
        p = json.loads(Path(args.probe).read_text(encoding="utf-8"))
        if args.op == "record":
            if not args.snapshot or not args.out:
                raise Refused("profile record requires --snapshot and --out")
            result = record(json.loads(Path(args.snapshot).read_text(encoding="utf-8")), p, args.out, args.note,
                            json.loads(Path(args.receipt).read_text(encoding="utf-8")) if args.receipt else None)
        else:
            if not args.profile:
                raise Refused("profile match requires --profile")
            result = match(json.loads(Path(args.profile).read_text(encoding="utf-8")), p)
    elif args.command == "act":
        result = perform(json.loads(Path(args.request).read_text(encoding="utf-8")), Path(args.run_dir).resolve(), args.execute)
    elif args.command == "verify":
        old = json.loads(Path(args.snapshot).read_text(encoding="utf-8"))
        if old["platform"] != platform.system():
            raise Refused("Snapshot belongs to another platform")
        fresh = backend({"command": "observe", "window_id": old["window"]["id"]})
        from cu.common import same_target
        same_target(old["window"], fresh["window"])
        result = check_expectation(fresh, json.loads(Path(args.check).read_text(encoding="utf-8")))
    else:
        skill = browser_skill(args.skill_dir)
        forwarded = args.args[1:] if args.args[:1] == ["--"] else args.args
        if not forwarded:
            result = {"skill": str(skill), "entry": str(skill / "SKILL.md"), "execution": False}
        else:
            # Exact argv forwarding: reuse the browser protocol, not a second browser engine.
            return subprocess.run([sys.executable, str(skill / "scripts/web_operator.py"), *forwarded]).returncode
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 2 if result.get("status") in {"unknown", "executed_unverified", "waiting", "stale", "cancelled"} or result.get("passed") is False else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        sys.exit(main())
    except Cancelled as exc:
        print(json.dumps({"status":"cancelled","error":str(exc)},ensure_ascii=False))
        sys.exit(2)
    except (Refused, subprocess.TimeoutExpired) as exc:
        print(json.dumps({"status": "refused", "error": str(exc), "diagnostic": diagnose(exc)}, ensure_ascii=False))
        sys.exit(2)
    except Exception as exc:
        print(json.dumps({"status": "error", "error": str(exc), "diagnostic": diagnose(exc)}, ensure_ascii=False))
        sys.exit(1)
