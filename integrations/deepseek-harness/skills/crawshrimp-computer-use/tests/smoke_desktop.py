"""Explicit live smoke on an owned fixture only. Usage: python tests/smoke_desktop.py --out PATH"""
import argparse
import json
from pathlib import Path
import platform
import subprocess
import sys
import time
import shutil
sys.stdout.reconfigure(encoding="utf-8")

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "scripts"))
from computer_use import backend, observe, perform
from cu.common import write_json
from cu.observation import compact
from cu.discovery import enrich
from cu.flows import run_flow
from cu.profiles import record, match

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--out", required=True)
parser.add_argument("--focus", action="store_true", help="Also exercise real focus borrowing, clicking and physical Unicode input on the owned fixture")
parser.add_argument("--prepare-focus-click", action="store_true", help="Windows owned-fixture setup only: click its observed title bar if activation is denied")
args = parser.parse_args()
run = Path(args.out).resolve()
run.mkdir(parents=True, exist_ok=True)
system = platform.system()
if system == "Darwin":
    fixture = run / "cu-fixture"
    subprocess.run(["swiftc", str(root / "tests/mac_fixture.swift"), "-o", str(fixture)], check=True)
    command = [str(fixture)]
elif system == "Windows":
    command = [sys.executable, str(root / "tests/windows_fixture.py")]
else:
    parser.error("macOS/Windows only")
child = subprocess.Popen(command)
anchor = None
report = {"platform": system, "checks": []}
def focus_anchor():
    if system == "Darwin":
        subprocess.run(["osascript", "-e", 'tell application "System Events" to set frontmost of (first application process whose unix id is %d) to true' % anchor.pid], check=True, timeout=5)
    else:
        from cu.focus_windows import activate
        activated=activate(anchor_window["id"])
        if not activated and args.prepare_focus_click:
            import win32gui,win32api,win32con
            h=anchor_window['id']
            win32gui.SetWindowPos(h,win32con.HWND_TOP,0,0,0,0,win32con.SWP_NOMOVE|win32con.SWP_NOSIZE|win32con.SWP_NOACTIVATE)
            x,y,right,bottom=win32gui.GetWindowRect(h);point=(x+60,y+15)
            assert win32gui.GetAncestor(win32gui.WindowFromPoint(point),2)==h, 'Owned anchor titlebar occluded'
            win32api.SetCursorPos(point);win32api.mouse_event(2,0,0);time.sleep(.05);win32api.mouse_event(4,0,0);time.sleep(.15)
            activated=win32gui.GetForegroundWindow()==h
            report.setdefault('setup',[]).append('normal_pointer_click_on_owned_anchor_titlebar')
        assert activated, "Windows refused owned focus anchor activation"
    time.sleep(.15)
    anchor_state=backend({"command":"observe","window_id":anchor_window["id"]})
    assert anchor_state["foreground"], {"message":"Anchor must actually be foreground","state":anchor_state}

try:
    deadline = time.monotonic() + 12
    while True:
        matches = [w for w in backend({"command": "windows", "app": "Crawshrimp CU Test Fixture"})["windows"]
                   if w["pid"] == child.pid]
        if len(matches) == 1:
            break
        if time.monotonic() > deadline:
            raise RuntimeError("Owned fixture did not appear")
        time.sleep(.2)
    window = matches[0]
    anchor_command = command
    if system == "Darwin":
        anchor_exe=run / "cu-focus-anchor"
        shutil.copy2(fixture,anchor_exe)
        anchor_command=[str(anchor_exe)]
    anchor = subprocess.Popen(anchor_command + ["--anchor"])
    deadline = time.monotonic() + 12
    while True:
        anchors = [w for w in backend({"command":"windows","app":"Crawshrimp CU Focus Anchor"})["windows"] if w["pid"] == anchor.pid]
        if len(anchors) == 1:
            anchor_window = anchors[0]
            break
        if time.monotonic() > deadline:
            raise RuntimeError("Focus anchor did not appear")
        time.sleep(.2)
    time.sleep(.5)
    focus_anchor()
    snap = observe(window["id"], run)
    report["before"] = snap["snapshot"]
    input_id = "cu-input" if system == "Darwin" else "1001"
    inputs = [e for e in snap["elements"] if "set_value" in e["actions"]
              and e["role"] == "text_field" and e.get("automation_id") == input_id]
    if len(inputs) != 1:
        raise RuntimeError(f"Expected one editable fixture control, got {len(inputs)}; inspect observation")
    selector = {"role": inputs[0]["role"]}
    if inputs[0]["automation_id"]:
        selector["automation_id"] = inputs[0]["automation_id"]
    text = "抓虾 Unicode 🦐 +^%~{}()"
    request = {"action_id": "unicode-input", "snapshot": snap["snapshot"], "kind": "set_value", "ref": inputs[0]["ref"],
               "text": text, "expect": {"selector": selector, "property": "value", "equals": text}}
    preview = perform(request, run, False)
    assert preview["status"] == "preview"
    report["checks"].append("preview")
    result = perform(request, run, True)
    assert result["status"] == "verified_control", result
    feedback_pid=result["feedback_session"]["pid"]
    report["checks"].append("unicode_set_value_readback")
    kept=backend({"command":"observe","window_id":anchor_window["id"]})
    assert kept["foreground"], {"message":"AX/UIA set_value changed focus","anchor":anchor.pid,"target":child.pid,"actual":kept.get("foreground_pid")}
    repeated = perform(request, run, True)
    assert repeated["replayed"] and not repeated["reexecuted"]
    report["checks"].append("duplicate_not_dispatched")
    snap = observe(window["id"], run)
    report["after_input"] = snap["snapshot"]
    button = next(e for e in snap["elements"] if e["role"] == "button" and e["name"] in {"本地测试按钮", "Local test button"})
    if system == "Darwin":
        check = {"selector": {"automation_id": "cu-status"}, "property": "value", "equals": "invoked-once"}
    else:
        check = {"selector": selector, "property": "value", "equals": "button-invoked"}
    request = {"action_id": "button-invoke", "snapshot": snap["snapshot"], "kind": "invoke",
               "selector": {"role": "button", "name": button["name"]}, "expect": check}
    result = perform(request, run, True)
    assert result["status"] == "verified_control", result
    report["checks"].append("semantic_button_invoke_readback")
    assert result["feedback_session"]["pid"]==feedback_pid, "Pointer renderer must survive across actions"
    from cu.feedback_session import command as visual_command
    resident=visual_command(run / "feedback","status")
    time.sleep(.2)
    resting=visual_command(run / "feedback","status")
    assert resident["pid"]==resting["pid"] and resident["position"]==resting["position"]
    report["checks"].append("resident_pointer_persists_between_actions")
    assert backend({"command":"observe","window_id":anchor_window["id"]})["foreground"], "AX/UIA invoke stole focus"
    report["checks"].append("background_semantics_preserve_other_process_focus")
    view = compact(snap, query=inputs[0]["automation_id"])
    assert view["shown"] >= 1 and view["full_evidence"] == snap["snapshot"]
    assert snap.get("preview", {}).get("width", 99999) <= 1400
    report["checks"].append("compact_refs_and_preview")
    probe = enrich(backend({"command": "probe", "window_id": window["id"]}), system)
    probe["platform"] = system
    write_json(run / "probe.json", probe)
    assert any(r["surface"] == "semantic" for r in probe["routes"])
    profile = record(snap, probe, run / "app-profile.json", "Owned fixture capability observation")
    assert not match(profile, probe)["auto_apply"]
    report["checks"].append("capability_probe_and_versioned_profile")
    if args.focus:
        snap = observe(window["id"], run)
        cleared = perform({"action_id":"clear-for-focus", "snapshot":snap["snapshot"],"kind":"set_value", "selector":selector,"text":"",
                           "expect":{"selector":selector,"property":"value","equals":""}},run,True)
        assert cleared["status"] == "verified_control",cleared
        snap = observe(window["id"],run)
        field = next(e for e in snap["elements"] if e["role"]==selector["role"] and e.get("automation_id")==inputs[0]["automation_id"])
        r=field["rect"]
        focus_anchor()
        time.sleep(2.1)
        click_expect = {"selector":selector,"property":"focused","equals":True}
        if system == "Windows":
            # UIA HasKeyboardFocus is correctly false after restoring the anchor.
            # The owned fixture persists EN_SETFOCUS so the click's actual target
            # can be proven after restoration, independently of input dispatch.
            status = next(e for e in snap['elements'] if e.get('automation_id') == '1003')
            assert status['name'] == 'input-idle', status
            click_expect = {"selector":{"automation_id":"1003"},"property":"name","equals":"input-focused"}
        clicked=perform({"action_id":"borrow-click","snapshot":snap["snapshot"],"kind":"click","focus":"borrow",
                         "point":{"x":r["x"]+r["width"]/2-window["x"],"y":r["y"]+r["height"]/2-window["y"],"space":"window"},
                         "expect":click_expect},run,True)
        assert clicked["status"]=="verified_control",clicked
        report["focus_click"] = clicked["dispatch"]["focus_report"]
        assert report["focus_click"]["borrowed"] and report["focus_click"]["restored"],report["focus_click"]
        anchor_after = backend({"command":"observe","window_id":anchor_window["id"]})
        assert anchor_after["foreground"], anchor_after
        snap=observe(window["id"],run)
        focus_anchor()
        time.sleep(2.1)
        typed=perform({"action_id":"borrow-type","snapshot":snap["snapshot"],"kind":"type","focus":"borrow","text":"焦点借用 🦐",
                       "expect":{"selector":selector,"property":"value","equals":"焦点借用 🦐"}},run,True)
        assert typed["status"]=="verified_control",typed
        report["focus_type"]=typed["dispatch"]["focus_report"]
        assert report["focus_type"]["borrowed"] and report["focus_type"]["restored"],report["focus_type"]
        anchor_after = backend({"command":"observe","window_id":anchor_window["id"]})
        assert anchor_after["foreground"], anchor_after
        report["checks"].append("physical_click_unicode_and_focus_restoration")
        if system in {"Darwin", "Windows"}:
            snap=observe(window["id"],run)
            cleared=perform({"action_id":"clear-for-takeover","snapshot":snap["snapshot"],"kind":"set_value","selector":selector,"text":"",
                             "expect":{"selector":selector,"property":"value","equals":""}},run,True)
            assert cleared["status"]=="verified_control",cleared
            snap=observe(window["id"],run)
            focus_anchor()
            time.sleep(2.1)
            content="takeover:" + "x" * 470
            request={"action_id":"takeover-type","snapshot":snap["snapshot"],"kind":"type","focus":"borrow","text":content,
                     "expect":{"selector":selector,"property":"value","equals":content}}
            interrupted=perform(request,run,True)
            assert interrupted["status"]=="unknown",interrupted
            takeover_report=interrupted["backend_error"]["focus_report"]
            assert takeover_report["user_takeover"] and not takeover_report["restored"],interrupted
            assert perform(request,run,True)["replayed"]
            report["takeover"]=interrupted
            report["checks"].append("os_event_simulated_takeover_and_no_replay" if system == "Darwin" else "simulated_external_focus_takeover_and_no_replay")
    plan={"flow_id":"smoke-flow","window_id":window["id"],"steps":[
        {"id":"draft","op":"act","action":{"kind":"set_value","selector":selector,"text":"flow-verified 🦐"},
         "expect":{"selector":selector,"property":"value","equals":"flow-verified 🦐"}},
        {"id":"wait","op":"wait","expect":{"selector":selector,"property":"value","equals":"flow-verified 🦐"},"timeout":1},
        {"id":"evidence","op":"observe"}]}
    flow=run_flow(plan,run,True,observe,perform,backend)
    assert flow["status"]=="verified_flow",flow
    assert run_flow(plan,run,True,observe,perform,backend)["replayed"]
    report["checks"].append("durable_multistep_flow_and_resume")
    final = observe(window["id"], run)
    assert final.get("image", {}).get("available"), final.get("image")
    assert not final["image"].get("possibly_blank"), final["image"]
    report["checks"].append("window_screenshot_nonblank")
    report["final"] = final["snapshot"]
    report["image"] = final["image"]["path"]
    report["status"] = "passed"
except Exception as exc:
    report["status"] = "failed"
    report["error"] = str(exc)
    raise
finally:
    from cu.feedback_session import stop
    cleanup_error = None
    try:
        report["feedback_shutdown"]=stop(run)
        if report["feedback_shutdown"].get("status") not in {"stopped", "not_started"}:
            raise RuntimeError("Resident feedback shutdown was not verified")
    except Exception as exc:
        report["feedback_shutdown"]={"error":str(exc)}
        cleanup_error = exc
        report["status"] = "failed"
    if anchor is not None:
        anchor.terminate()
        try:
            anchor.wait(timeout=5)
        except subprocess.TimeoutExpired:
            anchor.kill()
            anchor.wait()
    child.terminate()
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait()
    write_json(run / "smoke-report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if cleanup_error is not None:
        raise RuntimeError("Feedback cleanup failed") from cleanup_error
