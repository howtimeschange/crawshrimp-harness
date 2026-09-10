"""Explicit, version-scoped app knowledge; never automatic global memory writes."""
from pathlib import Path
import time
from .common import Refused, same_target, write_json


def record(snapshot, probe, out, note="", receipt=None):
    same_target(snapshot["window"], probe["window"])
    if probe.get("platform") != snapshot["platform"]:
        raise Refused("Probe and observation must come from the same platform")
    app = {"platform": snapshot["platform"], "executable": Path(snapshot["window"]["executable"]).name,
           "bundle_id": probe.get("bundle_id", ""), "version": probe.get("version", "unknown")}
    controls = [{k: e[k] for k in ("role", "name", "automation_id", "selector", "actions") if k in e}
                for e in snapshot["elements"] if e.get("selector") and e.get("actions") and not e.get("protected")]
    verified = []
    if receipt:
        if receipt.get("status") != "verified_control" or receipt.get("snapshot") != snapshot["snapshot"]:
            raise Refused("Receipt must verify an action bound to this observation")
        verified.append({"action_id": receipt["action_id"], "kind": receipt["request"]["kind"], "evidence": "control_readback", "business_success": False})
    profile = {"schema_version": 1, "app": app, "recorded_at": time.time(), "controls": controls,
               "surfaces": probe.get("routes", []), "note": note, "verified_actions": verified,
               "source_observation": snapshot["snapshot"], "validity": "requires_current_version_match_and_fresh_observation"}
    if Path(out).exists():
        raise Refused("Profile path exists; use a new versioned filename to preserve evidence")
    write_json(out, profile)
    return profile


def match(profile, probe):
    old = profile["app"]
    current = {"platform": probe.get("platform"), "executable": Path(probe["window"]["executable"]).name,
               "bundle_id": probe.get("bundle_id", ""), "version": probe.get("version", "unknown")}
    differences = [k for k in current if current[k] != old.get(k)]
    if old.get("version") in ("", "unknown", None):
        differences.append("unverified_version")
    return {"status": "stale" if differences else "compatible_hint", "differences": differences,
            "auto_apply": False, "next_action": "Re-observe controls; never reuse window IDs, ports or coordinates from a profile."}
