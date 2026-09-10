from __future__ import annotations

import contextlib
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
import time


class Refused(RuntimeError):
    pass


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def windows_literal_keys(text):
    """pywinauto 0.6.9 wScan is 16-bit; emit UTF-16 units, not truncated codepoints."""
    raw = text.encode("utf-16-le")
    for i in range(0, len(raw), 2):
        char = chr(int.from_bytes(raw[i:i+2], "little"))
        yield "{" + char + "}" if char in "+^%~(){}" else char


def read_json(path):
    """Bounded read through Windows atomic-rename/delete-sharing contention."""
    deadline = time.monotonic() + 1
    while True:
        try:
            return json.loads(Path(path).read_text(encoding='utf-8'))
        except PermissionError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(.025)


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".cu-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        deadline = time.monotonic() + 1
        while True:
            try:
                os.replace(temporary, path)
                break
            except OSError as exc:
                # Windows readers/antivirus may temporarily deny delete sharing.
                # Replace failed atomically: retry this file commit, never an app action.
                if getattr(exc, 'winerror', None) not in {5, 32, 33} or time.monotonic() >= deadline:
                    raise
                time.sleep(.025)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextlib.contextmanager
def exclusive(path):
    """OS-owned lock; crash releases it. Never unlink a lock inode."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    stream = path.open("a+b")
    if stream.tell() == 0:
        stream.write(b"0")
        stream.flush()
    try:
        stream.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise Refused("Another computer-use action holds the session lock") from exc
        yield
    finally:
        stream.close()


def select(elements, selector):
    allowed = {"role", "name", "automation_id"}
    if not isinstance(selector, dict) or not selector or set(selector) - allowed:
        raise Refused("selector requires exact role/name/automation_id from a fresh observation")
    matches = [e for e in elements if all(e.get(k) == v for k, v in selector.items())]
    if len(matches) != 1:
        raise Refused(f"selector matched {len(matches)} elements; require exactly one")
    if matches[0].get("protected"):
        raise Refused("Protected input is not an automation target")
    return matches[0]


def point_in_window(point, window, image=None):
    if not isinstance(point, dict) or set(point) != {"x", "y", "space"}:
        raise Refused("point requires x/y/space (normalized, window, or image)")
    x, y = point["x"], point["y"]
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (x, y)):
        raise Refused("Non-finite coordinate")
    width, height = window["width"], window["height"]
    if point["space"] == "normalized":
        if not (0 <= x < 1 and 0 <= y < 1):
            raise Refused("Normalized coordinates must be in [0,1)")
        x, y = x * width, y * height
    elif point["space"] == "image":
        if not image or not image.get("width") or not image.get("height"):
            raise Refused("Image coordinates require a screenshot receipt")
        x, y = x * width / image["width"], y * height / image["height"]
    elif point["space"] != "window":
        raise Refused("Unknown coordinate space")
    if not (0 <= x < width and 0 <= y < height):
        raise Refused("Coordinate outside target window")
    return {"x": x, "y": y}


def same_target(old, fresh):
    keys = ("id", "pid", "process_started", "executable")
    if any(old.get(k) != fresh.get(k) for k in keys):
        raise Refused("Target identity changed; observe again")


def check_expectation(snapshot, check):
    if snapshot.get("truncated") or snapshot.get("tree_errors") or snapshot.get("tree_error"):
        raise Refused("Incomplete accessibility tree; cannot verify a unique control")
    if not isinstance(check, dict) or set(check) != {"selector", "property", "equals"}:
        raise Refused("expect requires selector, property, equals")
    if check["property"] not in {"value", "name", "enabled", "focused"}:
        raise Refused("Unsupported readback property")
    element = select(snapshot["elements"], check["selector"])
    key = check["property"]
    if key not in element:
        raise Refused("Readback property is unavailable")
    return {"passed": type(element[key]) is type(check["equals"]) and element[key] == check["equals"],
            "property": key, "actual": element[key], "expected": check["equals"],
            "level": "control_readback", "business_success": False}


def validate_action(request, snapshot, fresh):
    if set(request) - {"action_id", "snapshot", "kind", "selector", "point", "text", "key", "delta", "expect", "focus"}:
        raise Refused("Unknown action fields")
    if time.time() - snapshot["created_at"] > 120 or snapshot["created_at"] > time.time() + 5:
        raise Refused("Snapshot expired; observe again (120 second TTL)")
    same_target(snapshot["window"], fresh["window"])
    kind = request.get("kind")
    if kind not in {"invoke", "set_value", "click", "type", "key", "scroll"}:
        raise Refused("Unsupported action kind")
    payload = {"command": "act", "window": fresh["window"], "kind": kind}
    focus = request.get("focus", "require")
    if focus not in {"require", "borrow"}:
        raise Refused("focus must be require or borrow")
    if focus == "borrow" and kind in {"invoke", "set_value"}:
        raise Refused("Semantic actions do not need a focus lease")
    payload["focus"] = focus
    if kind in {"invoke", "set_value"}:
        if snapshot.get("truncated") or fresh.get("truncated"):
            raise Refused("Accessibility tree truncated; selector uniqueness cannot be proven")
        select(snapshot["elements"], request.get("selector"))
        element = select(fresh["elements"], request.get("selector"))
        if not element.get("enabled", False):
            raise Refused("Control disabled")
        if kind not in element.get("actions", []):
            raise Refused("Control does not advertise the requested semantic action")
        payload["selector"] = request["selector"]
    else:
        # Window movement/resize invalidates visual anchors, even with normalized input.
        if any(snapshot["window"].get(k) != fresh["window"].get(k) for k in ("x", "y", "width", "height")):
            raise Refused("Window moved/resized; observe again")
    if kind in {"set_value", "type"}:
        if not isinstance(request.get("text"), str) or len(request["text"]) > 10000:
            raise Refused("text must be a string of at most 10000 characters")
        payload["text"] = request["text"]
        if kind == "type" and any(ord(c) < 32 or ord(c) == 127 for c in request["text"]):
            raise Refused("Physical type accepts printable text only; use set_value for multiline or explicit key actions")
        if kind == "type" and len(request["text"]) > 500:
            raise Refused("Physical input is limited to 500 characters per bounded action; prefer set_value")
    if kind in {"click", "scroll"}:
        payload["point"] = point_in_window(request.get("point"), fresh["window"], snapshot.get("image"))
    if kind == "key":
        if request.get("key") not in {"ENTER", "ESC", "TAB", "BACKSPACE", "DELETE", "LEFT", "RIGHT", "UP", "DOWN", "HOME", "END", "SELECT_ALL", "COPY", "PASTE"}:
            raise Refused("Unsupported key")
        payload["key"] = request["key"]
    if kind == "scroll":
        delta = request.get("delta")
        if type(delta) is not int or not -100 <= delta <= 100 or delta == 0:
            raise Refused("delta must be nonzero integer wheel steps in [-100,100]")
        payload["delta"] = delta
    if "expect" in request:
        # Validate schema and target before mutation; the value need not match yet.
        check_expectation(fresh, request["expect"])
    return payload
