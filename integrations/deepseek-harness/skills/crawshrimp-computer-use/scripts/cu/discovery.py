"""Read-only capability enrichment. Only app-owned observed ports are queried."""
import json
from pathlib import Path
import plistlib
import re
import subprocess
import time
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET


def cdp(port, opener=None):
    if type(port) is not int or not 1 <= port <= 65535:
        return {"port": port, "status": "invalid"}
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    def get(path):
        # Loopback only, no inherited proxy. Reject redirects outside the observed endpoint.
        url = f"http://127.0.0.1:{port}{path}"
        with opener.open(url, timeout=.75) as response:
            if response.geturl() != url:
                raise ValueError("CDP endpoint redirected")
            data = response.read(262145)
            if len(data) > 262144:
                raise ValueError("Probe response too large")
            return json.loads(data)
    try:
        version = get("/json/version")
        if not isinstance(version, dict) or not isinstance(version.get("webSocketDebuggerUrl"), str) or not version["webSocketDebuggerUrl"].startswith("ws"):
            return {"port": port, "status": "not_cdp"}
        targets = get("/json/list")
        if not isinstance(targets, list):
            raise ValueError("Invalid CDP target list")
        return {"port": port, "status": "verified", "browser": version.get("Browser"),
                "pages": [{k: t[k] for k in ("id", "title", "url", "type") if k in t} for t in targets[:30] if isinstance(t, dict) and t.get("type") == "page"],
                "note": "Choose the task's exact page; hidden pages are not auto-selected."}
    except Exception as exc:
        return {"port": port, "status": "unknown", "error": str(exc)}


def shell(args, timeout=3):
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return p.stdout if p.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


def mac_details(probe):
    app_path = probe.get("app_path", "")
    if not app_path:
        return probe
    contents = Path(app_path) / "Contents"
    frameworks = []
    # Recursive but bounded; nested CEF/Electron is common under Helpers.
    import os
    visited = 0
    for folder, dirs, _ in os.walk(contents, followlinks=False):
        visited += 1
        if visited > 1200:
            break
        depth = len(Path(folder).relative_to(contents).parts)
        if depth >= 7 or visited > 1200:
            dirs[:] = []
            continue
        for name in dirs:
            if any(x in name.casefold() for x in ("electron framework", "chromium embedded", "browser framework")):
                frameworks.append(str(Path(folder) / name))
    probe["chromium_frameworks"] = frameworks[:12]
    try:
        info = plistlib.loads((contents / "Info.plist").read_bytes())
        probe["version"] = info.get("CFBundleShortVersionString", "")
    except (OSError, ValueError):
        probe["version"] = "unknown"
    dictionary = shell(["/usr/bin/sdef", app_path])
    try:
        suites = ET.fromstring(dictionary).findall(".//suite") if dictionary else []
        commands = [el.get("name") for suite in suites if suite.get("name") != "Standard Suite" for el in suite.findall("command")]
        probe["applescript"] = {"status": "verified_dictionary" if commands else ("no_app_commands" if dictionary else "unavailable"), "commands": commands[:40]}
    except ET.ParseError:
        probe["applescript"] = {"status": "unavailable"}
    processes = shell(["/bin/ps", "-axo", "pid=,ppid=,comm="])
    rows = []
    for line in processes.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
            rows.append((int(parts[0]), int(parts[1]), parts[2]))
    pids = {probe["window"]["pid"]}
    for _ in range(8):
        new = {pid for pid, parent, _ in rows if parent in pids}
        if new <= pids:
            break
        pids |= new
    probe["process_family"] = [{"pid": pid, "executable": cmd} for pid, _, cmd in rows if pid in pids]
    listeners = shell(["/usr/sbin/lsof", "-nP", "-a", "-p", ",".join(map(str, sorted(pids))), "-iTCP", "-sTCP:LISTEN", "-Fn"])
    probe["listening_ports"] = [{"port": int(match.group(1))} for line in listeners.splitlines() if line.startswith("n") and (match := re.search(r":(\d+)$", line))]
    # Bundle identity only. Do not interpolate a display name into Spotlight predicates.
    bundle_id = probe.get("bundle_id", "")
    if re.fullmatch(r"[A-Za-z0-9_.-]+", bundle_id):
        duplicates = shell(["/usr/bin/mdfind", f"kMDItemContentType == 'com.apple.application-bundle' && kMDItemCFBundleIdentifier == '{bundle_id}'"])
        probe["installed_copies"] = [p for p in duplicates.splitlines() if "/Caches/" not in p and "/.Trash/" not in p][:20]
    return probe


def enrich(probe, platform, inspect_cdp=True):
    if platform == "Darwin":
        probe = mac_details(probe)
    endpoints = []
    if inspect_cdp:
        deadline = time.monotonic() + 6
        for port in sorted({p["port"] for p in probe.get("listening_ports", [])})[:8]:
            if time.monotonic() >= deadline:
                break
            endpoints.append(cdp(port))
    probe["cdp"] = endpoints
    routes = []
    if probe.get("applescript", {}).get("status") == "verified_dictionary":
        routes.append({"surface": "applescript", "confidence": "dictionary_verified", "next": "Read command semantics and choose an application readback."})
    if any(e["status"] == "verified" for e in endpoints):
        routes.append({"surface": "cdp", "confidence": "endpoint_verified", "next": "Match exact task page and reuse crawshrimp-skill; no auto target selection."})
    if probe.get("semantic_controls", 0) and probe.get("tree_complete", True):
        routes.append({"surface": "semantic", "confidence": "controls_observed", "next": "Observe and resolve a unique supported AX/UIA action."})
    routes.append({"surface": "window_input", "confidence": "requires_live_guards", "next": "Use fresh image coordinates, foreground checks or explicit focus=borrow."})
    probe["routes"] = routes
    probe["recommended_surface"] = routes[0]["surface"]
    probe["mutations_performed"] = False
    return probe
