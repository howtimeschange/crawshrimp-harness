"""Compact model-facing views; full evidence stays in the immutable observation."""
from .common import Refused, select


def annotate(snapshot):
    for i, element in enumerate(snapshot.get("elements", []), 1):
        element["ref"] = f"e{i}"
        if element.get("protected"):
            continue
        selector = {"role": element.get("role", "")}
        if element.get("automation_id"):
            selector["automation_id"] = element["automation_id"]
        elif element.get("name"):
            selector["name"] = element["name"]
        try:
            select(snapshot["elements"], selector)
            element["selector"] = selector
        except Refused:
            pass
    return snapshot


def resolve_ref(request, snapshot):
    if "ref" not in request:
        return request
    if "selector" in request:
        raise Refused("Use either ref or selector, not both")
    matches = [e for e in snapshot["elements"] if e.get("ref") == request["ref"]]
    if len(matches) != 1 or "selector" not in matches[0]:
        raise Refused("Ref is absent or not uniquely addressable; use a fresh observation")
    if request.get("kind") not in {"invoke", "set_value"}:
        raise Refused("Short refs support semantic invoke/set_value only")
    return {k: v for k, v in {**request, "selector": matches[0]["selector"]}.items() if k != "ref"}


def compact(snapshot, limit=50, query=""):
    if not 1 <= limit <= 150:
        raise Refused("Compact limit must be in [1,150]")
    rows = [e for e in snapshot.get("elements", []) if not e.get("protected") and
            (e.get("actions") or "value" in e) and
            (not query or query.casefold() in (e.get("name", "") + " " + e.get("automation_id", "") + " " + str(e.get("value", ""))).casefold())]
    shown = []
    for e in rows[:limit]:
        item = {k: e[k] for k in ("ref", "role", "enabled", "actions", "selector") if k in e}
        for key in ("name", "value"):
            if key in e:
                item[key] = str(e[key])[:160]
                if len(str(e[key])) > 160:
                    item[key + "_truncated"] = True
        shown.append(item)
    return {k: snapshot[k] for k in ("schema_version", "platform", "created_at", "snapshot_id", "snapshot", "window", "image", "preview", "diagnostics", "foreground") if k in snapshot} | {
        "elements": shown, "shown": len(shown), "matched": len(rows),
        "total": len(snapshot.get("elements", [])), "tree_truncated": snapshot.get("truncated", False),
        "omitted": max(0, len(rows)-len(shown)), "view": "compact", "full_evidence": snapshot.get("snapshot")}
