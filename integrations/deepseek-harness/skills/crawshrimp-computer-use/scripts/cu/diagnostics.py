"""Error codes are recovery advice, never authority to retry a dispatched mutation."""


def diagnose(error, *, phase="observe", window=None):
    text = str(error)
    lower = text.lower()
    rules = [
        (("permission", "accessibility", "screen recording", "privilege"), "permission_unavailable", "user_action", "Check doctor and the specific OS permission; do not change TCC/UAC."),
        (("locked", "secure/non-default", "interactive desktop"), "session_unavailable", "user_action", "Unlock/reconnect the interactive desktop, then observe again."),
        (("closed", "identity changed", "target identity"), "target_changed", "observe", "Discover the intended window and take a new observation."),
        (("expired", "moved", "resized"), "observation_stale", "observe", "Refresh the observation and coordinates."),
        (("user active", "user takeover", "focus changed"), "user_takeover", "wait_observe", "Let the user finish; inspect current state before another action."),
        (("occluded",), "point_occluded", "select_surface", "Prefer a semantic action or explicitly borrow focus if authorized."),
        (("foreground",), "focus_required", "select_surface", "Use AX/UIA or request focus=borrow within the existing task scope."),
        (("not unique", "matched", "selector", "ref is"), "target_ambiguous", "observe", "Filter the full observation and use a unique control selector."),
        (("truncated", "incomplete", "mapping", "tree"), "semantic_tree_unavailable", "select_surface", "Inspect capability probe and screenshot; prefer app API/CDP when available."),
        (("screenshot", "printwindow", "render", "blank"), "capture_unavailable", "select_surface", "Keep the failed receipt; probe an existing app-owned CDP endpoint or rendering state."),
        (("timed out", "timeout"), "backend_timeout", "readback", "Inspect the target state; a timeout may follow a partial operation."),
        (("holds", "lock",), "session_busy", "wait_observe", "Wait for the current desktop action to release the OS lock."),
    ]
    for words, code, recovery, message in rules:
        if any(word in lower for word in words):
            break
    else:
        code, recovery, message = "backend_error", "inspect", "Inspect the recorded error and current application state."
    if window and window.get("visible") is False and code == "capture_unavailable":
        code, message = "window_not_visible", "Window is offscreen/another desktop or not rendered. Prefer a verified background interface."
    return {"code": code, "phase": phase, "message": text, "recovery": recovery, "next_action": message,
            "auto_retry": False, "effect": "unknown" if phase == "dispatch" else "not_dispatched"}


def observation_diagnostics(snapshot):
    errors = []
    if snapshot.get("tree_error"):
        errors.append(diagnose(snapshot["tree_error"], window=snapshot["window"]))
    if snapshot.get("tree_errors"):
        errors.append(diagnose("Incomplete tree: " + "; ".join(snapshot["tree_errors"][:3])))
    image = snapshot.get("image", {})
    if image.get("error"):
        errors.append(diagnose(image["error"], window=snapshot["window"]))
    elif image.get("possibly_blank"):
        errors.append(diagnose("Screenshot may be blank; content not verified", window=snapshot["window"]))
    return errors
