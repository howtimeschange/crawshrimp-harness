"""Windows worker, isolated so a blocked UIA provider has a process timeout."""
from __future__ import annotations

import ctypes
from ctypes import wintypes
import json
import os
import sys

# DPI awareness precedes all UIA/Win32 imports and all rectangle reads.
if sys.platform != "win32":
    raise SystemExit("Windows only")
u32 = ctypes.WinDLL("user32", use_last_error=True)
try:
    u32.SetProcessDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    u32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
except AttributeError:
    u32.SetProcessDPIAware()

import psutil
import win32gui
import win32api
import win32process
from pywinauto import Desktop, keyboard, mouse
from common import Refused, same_target, select, windows_literal_keys

ROLES = {"Button": "button", "Edit": "text_field", "Document": "text_area", "CheckBox": "checkbox",
         "ComboBox": "combobox", "MenuItem": "menu_item", "Text": "text", "Window": "window"}


def desktop_ready():
    u32.OpenInputDesktop.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    u32.OpenInputDesktop.restype = wintypes.HANDLE
    u32.CloseDesktop.argtypes = [wintypes.HANDLE]
    handle = u32.OpenInputDesktop(0, False, 1)  # DESKTOP_READOBJECTS
    if not handle:
        raise Refused("Interactive desktop unavailable (locked, UAC, or disconnected session)")
    try:
        buf = ctypes.create_unicode_buffer(256)
        needed = wintypes.DWORD()
        u32.GetUserObjectInformationW.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
        if not u32.GetUserObjectInformationW(handle, 2, buf, ctypes.sizeof(buf), ctypes.byref(needed)) or buf.value.lower() != "default":
            raise Refused("Secure/non-default input desktop")
    finally:
        u32.CloseDesktop(handle)


def idle():
    class LastInput(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]
    info = LastInput(ctypes.sizeof(LastInput), 0)
    if not u32.GetLastInputInfo(ctypes.byref(info)):
        raise Refused("Cannot determine user input activity")
    kernel = ctypes.WinDLL("kernel32")
    kernel.GetTickCount.restype = wintypes.DWORD
    return ((kernel.GetTickCount() - info.dwTime) & 0xFFFFFFFF) / 1000


def window(hwnd):
    if not win32gui.IsWindow(hwnd):
        raise Refused("Window closed")
    _, pid = win32process.GetWindowThreadProcessId(hwnd)
    proc = psutil.Process(pid)
    x, y, right, bottom = win32gui.GetWindowRect(hwnd)
    return {"id": hwnd, "pid": pid, "process_started": proc.create_time(), "executable": proc.exe(),
            "app": proc.name(), "title": win32gui.GetWindowText(hwnd), "x": x, "y": y,
            "width": right-x, "height": bottom-y, "visible": bool(win32gui.IsWindowVisible(hwnd)),
            "minimized": bool(win32gui.IsIconic(hwnd)), "coordinate_unit": "physical_pixel"}


def windows(app):
    found = []
    def visit(hwnd, _):
        try:
            w = window(hwnd)
            if w["visible"] and w["width"] > 0 and w["height"] > 0 and app.lower() in (w["app"] + " " + w["title"]).lower():
                found.append(w)
        except (OSError, psutil.Error):
            pass
    win32gui.EnumWindows(visit, None)
    return {"windows": found}


def tree(hwnd):
    errors = []
    for backend_name in ("uia", "win32"):
        try:
            root = Desktop(backend=backend_name).window(handle=hwnd).wrapper_object()
            pending = [(root, 0)]
            result, wrappers = [], []
            depth_truncated = False
            while pending and len(result) < 500:
                ctrl, depth = pending.pop(0)
                try:
                    info = ctrl.element_info
                    protected = bool(getattr(info, "is_password", False))
                    if backend_name == "uia":
                        protected = protected or bool(info.element.CurrentIsPassword)
                    role = ROLES.get(getattr(info, "control_type", ""), getattr(info, "control_type", "") or ctrl.friendly_class_name())
                    actions = []
                    value = None
                    if not protected:
                        if backend_name == "uia":
                            try:
                                value = ctrl.iface_value.CurrentValue
                                if not ctrl.iface_value.CurrentIsReadOnly:
                                    actions.append("set_value")
                            except Exception:
                                pass
                            try:
                                ctrl.iface_invoke
                                actions.append("invoke")
                            except Exception:
                                pass
                        elif ctrl.class_name() == "Edit":
                            role = "text_field"
                            # ES_PASSWORD and ES_READONLY must not be exposed as normal edits.
                            style = win32gui.GetWindowLong(ctrl.handle, -16)
                            protected = bool(style & 0x20)
                            if not protected:
                                value = ctrl.window_text()
                                if not style & 0x800:
                                    actions.append("set_value")
                    r = ctrl.rectangle()
                    item = {"role": role, "name": "" if protected else ctrl.window_text(),
                            "class_name": getattr(info, "class_name", "") or "",
                            "automation_id": getattr(info, "automation_id", "") or "",
                            "enabled": bool(ctrl.is_enabled()), "protected": protected,
                            "focused": bool(info.element.CurrentHasKeyboardFocus) if backend_name == "uia" else bool(ctrl.has_focus()),
                            "actions": [] if protected else actions,
                            "rect": {"x": r.left, "y": r.top, "width": r.width(), "height": r.height()}}
                    if value is not None and not protected:
                        item["value"] = value
                    result.append(item)
                    wrappers.append(ctrl)
                    if depth < 12:
                        pending.extend((child, depth+1) for child in ctrl.children())
                    elif ctrl.children():
                        depth_truncated = True
                except Exception as exc:
                    errors.append(type(exc).__name__)
            if len(result) > 1 or backend_name == "win32":
                return result, wrappers, backend_name, bool(pending) or depth_truncated, errors
        except Exception as exc:
            errors.append(f"{backend_name}: {type(exc).__name__}")
    return [], [], "unavailable", False, errors


def physical_guard(w, point=None):
    desktop_ready()
    if not w["visible"] or w["minimized"] or win32gui.GetForegroundWindow() != w["id"]:
        raise Refused("Target must already be the foreground window; no implicit focus stealing")
    if point:
        x, y = round(w["x"] + point["x"]), round(w["y"] + point["y"])
        hit = win32gui.WindowFromPoint((x, y))
        if win32gui.GetAncestor(hit, 2) != w["id"]:
            raise Refused("Point is occluded or belongs to another window")
        return (x, y)


def screenshot(w, path):
    import win32ui
    from PIL import Image, ImageStat
    desktop_ready()
    if w["minimized"]:
        raise Refused("Minimized window may not render; use CDP or restore it explicitly")
    width, height = w["width"], w["height"]
    hwnd_dc = win32gui.GetWindowDC(w["id"])
    source = win32ui.CreateDCFromHandle(hwnd_dc)
    memory = source.CreateCompatibleDC()
    bitmap = win32ui.CreateBitmap()
    try:
        bitmap.CreateCompatibleBitmap(source, width, height)
        memory.SelectObject(bitmap)
        u32.PrintWindow.argtypes = [wintypes.HWND, wintypes.HDC, wintypes.UINT]
        if not u32.PrintWindow(w["id"], memory.GetSafeHdc(), 2):
            raise Refused("PrintWindow failed; no foreground/crop fallback")
        image = Image.frombuffer("RGB", (width, height), bitmap.GetBitmapBits(True), "raw", "BGRX", 0, 1)
        image.save(path)
        blank = max(ImageStat.Stat(image.resize((64,64))).stddev) < 1
        return {"path": path, "width": width, "height": height, "available": True, "possibly_blank": blank,
                "mode": "PrintWindow", "content_verified": False}
    finally:
        win32gui.DeleteObject(bitmap.GetHandle())
        memory.DeleteDC()
        source.DeleteDC()
        win32gui.ReleaseDC(w["id"], hwnd_dc)


from cancellation import check

def run(req):
    if req.get("cancel_file"): os.environ["CRAWSHRIMP_CU_CANCEL_FILE"] = req["cancel_file"]
    check()
    if req.get('feedback_dir'):os.environ['CRAWSHRIMP_CU_FEEDBACK_DIR']=req['feedback_dir']
    command = req["command"]
    if command == "doctor":
        try:
            desktop_ready()
            available = True
        except Refused:
            available = False
        return {"backend": "pywinauto UIA + Win32", "interactive_desktop": available,
                "physical_input": "foreground_or_explicit_borrow", "python_bits": ctypes.sizeof(ctypes.c_void_p)*8}
    if command == "windows":
        return windows(req.get("app", ""))
    w = window(req.get("window_id", req.get("window", {}).get("id")))
    if "window" in req:
        same_target(req["window"], w)
    if command == "shot":
        result = screenshot(w, req["path"])
        if req.get("preview_path"):
            from PIL import Image
            image = Image.open(req["path"])
            image.thumbnail((1400, 1400))
            image.save(req["preview_path"])
            result["preview"] = {"path": req["preview_path"], "width": image.width, "height": image.height,
                                 "coordinate_hint": "Use normalized coordinates; image-space refers to original screenshot."}
        return result
    elements, wrappers, used_backend, truncated, errors = tree(w["id"])
    if command == "observe":
        fg = win32gui.GetForegroundWindow()
        return {"window": w, "elements": elements, "backend": used_backend, "truncated": truncated,
                "tree_errors": errors[:10], "foreground": fg == w["id"], "foreground_hwnd": fg,
                "foreground_pid": win32process.GetWindowThreadProcessId(fg)[1] if fg else None}
    if command == "probe":
        proc = psutil.Process(w["pid"])
        ports = []
        for p in [proc, *proc.children(recursive=True)]:
            try:
                ports.extend({"pid": p.pid, "port": c.laddr.port} for c in p.net_connections("tcp") if c.status == "LISTEN")
            except (psutil.Error, OSError):
                pass
        try:
            v = win32api.GetFileVersionInfo(w["executable"], "\\")
            version = ".".join(str(n) for n in (v["FileVersionMS"] >> 16, v["FileVersionMS"] & 0xffff, v["FileVersionLS"] >> 16, v["FileVersionLS"] & 0xffff))
        except Exception:
            version = "unknown"
        return {"window": w, "version": version, "backend": used_backend, "semantic_controls": sum(bool(e["actions"]) for e in elements),
                "tree_complete": not truncated and not errors,
                "listening_ports": ports, "note": "Ports are clues; verify CDP /json/version before use. No port writes or restarts performed."}
    if command != "act":
        raise Refused("Unknown command")
    desktop_ready()
    kind = req["kind"]
    if kind in {"invoke", "set_value"}:
        if truncated or errors:
            raise Refused("Incomplete tree; cannot prove selector uniqueness")
        item = select(elements, req["selector"])
        if kind not in item["actions"] or not item["enabled"]:
            raise Refused("Control no longer supports this action")
        ctrl = wrappers[elements.index(item)]
        from feedback_windows import DesktopFeedback
        visual=DesktopFeedback()
        previous=win32gui.GetForegroundWindow()
        try:
            visual.show()
            if w["visible"] and not w["minimized"]:
                r=item["rect"];visual.locate((r["x"]+r["width"]/2,r["y"]+r["height"]/2))
            check()
            before_operation=win32gui.GetForegroundWindow()
            method = 'uia_invoke' if kind == 'invoke' else 'uia_value'
            if kind == "invoke":
                if ctrl.handle and win32gui.GetClassName(ctrl.handle) == 'Button' and item['role'] == 'button':
                    if win32gui.GetAncestor(ctrl.handle, 2) != w['id']:
                        raise Refused('Native Button no longer belongs to the observed window')
                    style = win32gui.GetWindowLong(ctrl.handle, -16) & 0xF
                    control_id = win32gui.GetDlgCtrlID(ctrl.handle)
                    if style in {0, 1} and 0 < control_id <= 0xFFFF:
                        # BM_CLICK synthesizes button-down and can focus the window.
                        # A standard push button's semantic action is BN_CLICKED.
                        parent = win32gui.GetParent(ctrl.handle)
                        win32gui.SendMessage(parent, 0x0111, control_id, ctrl.handle)  # WM_COMMAND / BN_CLICKED=0
                        method = 'win32_button_command'
                    else:
                        ctrl.iface_invoke.Invoke()
                else:
                    ctrl.iface_invoke.Invoke()
            elif ctrl.handle and win32gui.GetClassName(ctrl.handle) in {'Edit', 'RichEditD2DPT', 'RICHEDIT50W', 'RichEdit20W'} and item['role'] in {'text_field', 'text_area'}:
                # The Windows UIA proxy for standard Edit can activate its window
                # during Value.SetValue. Native WM_SETTEXT preserves background use.
                if win32gui.GetAncestor(ctrl.handle, 2) != w['id']:
                    raise Refused('Native edit no longer belongs to the observed window')
                style = win32gui.GetWindowLong(ctrl.handle, -16)
                if style & (0x20 | 0x800):
                    raise Refused('Native edit is protected or read-only')
                win32gui.SendMessage(ctrl.handle, 0x000C, 0, req['text'])
                method = 'win32_edit_message'
            elif used_backend == "uia":
                ctrl.iface_value.SetValue(req["text"])
            else:
                # Native standard Edit only. pywin32 marshals full Unicode including surrogate pairs.
                win32gui.SendMessage(ctrl.handle, 0x000C, 0, req["text"])  # WM_SETTEXT
            after_operation=win32gui.GetForegroundWindow()
            visual.pulse()
            feedback=visual.report
        finally:
            visual.close()
        return {"dispatched":True,"business_success":False,"backend":used_backend,"feedback":feedback,
                "control_method":method,
                "foreground_unchanged":win32gui.GetForegroundWindow()==previous,
                "foreground_trace":{"before_feedback":previous,"before_operation":before_operation,
                                    "after_operation":after_operation,"after_feedback":win32gui.GetForegroundWindow()}}
    else:
        if any(req["window"][k] != w[k] for k in ("x", "y", "width", "height")):
            raise Refused("Window geometry changed before dispatch")
        from focus_windows import FocusLease
        lease = FocusLease(w, req.get("focus") == "borrow", idle, desktop_ready)
        try:
            with lease:
                point = physical_guard(w, req.get("point"))
                def checked():
                    lease.check()
                    return True
                if point: lease.feedback.locate(point,checked)
                lease.check()
                physical_guard(w, req.get('point'))  # Recheck after the pointer animation.
                if kind == "click":
                    mouse.click(coords=point)
                    lease.feedback.pulse(checked)
                elif kind == "scroll":
                    mouse.scroll(coords=point, wheel_dist=req["delta"])
                elif kind == "type":
                    # Escape all pywinauto metacharacters; text is literal Unicode, never a key program.
                    for key_text in windows_literal_keys(req["text"]):
                        lease.check()
                        keyboard.send_keys(key_text, with_spaces=True, vk_packet=True, turn_off_numlock=False, pause=.005)
                elif kind == "key":
                    keys = {"SELECT_ALL": "^a", "COPY": "^c", "PASTE": "^v", "ESC": "{ESC}", "ENTER": "{ENTER}"}
                    keyboard.send_keys(keys.get(req["key"], "{" + req["key"] + "}"), turn_off_numlock=False, pause=.005)
                else:
                    raise Refused("Unsupported physical input")
                lease.check()
        except Exception as exc:
            exc.focus_report = lease.report
            raise
        return {"dispatched": True, "business_success": False, "backend": used_backend, "focus_report": lease.report,"feedback":lease.feedback_report}
    return {"dispatched": True, "business_success": False, "backend": used_backend}


if __name__ == "__main__":
    try:
        print(json.dumps(run(json.load(sys.stdin)), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"status": "refused" if isinstance(exc, Refused) else "error", "error": str(exc), "focus_report": getattr(exc, "focus_report", None)}, ensure_ascii=False))
        sys.exit(2)
