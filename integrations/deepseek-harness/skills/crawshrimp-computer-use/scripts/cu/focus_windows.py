"""Windows focus lease with real-input hooks and a non-activating native HUD."""
import ctypes
from ctypes import wintypes
import threading
import time
import win32api
import win32con
import win32gui
try:
    from .common import Refused
except ImportError:
    from common import Refused


def activate(hwnd, cancelled=lambda: False):
    """Activate within the current desktop, with temporary input-queue attachment."""
    def settled():
        # Cross-input-queue SetForegroundWindow can complete asynchronously.
        # Wait for readback only; do not inject input or repeat the activation.
        deadline = time.monotonic() + .4
        while not cancelled():
            if win32gui.GetForegroundWindow() == hwnd:
                return True
            if time.monotonic() >= deadline:
                break
            time.sleep(.01)
        return False
    if cancelled():
        return False
    if win32gui.GetForegroundWindow() == hwnd:
        return True
    try:
        win32gui.SetForegroundWindow(hwnd)
    except Exception:
        pass
    if settled():
        return True
    user = ctypes.WinDLL('user32', use_last_error=True)
    user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user.GetWindowThreadProcessId.restype = wintypes.DWORD
    user.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
    user.AttachThreadInput.restype = wintypes.BOOL
    current = win32api.GetCurrentThreadId()
    foreground = user.GetWindowThreadProcessId(win32gui.GetForegroundWindow(), None)
    if not foreground or foreground == current or cancelled():
        return False
    if not user.AttachThreadInput(current, foreground, True):
        return False
    requested = False
    try:
        if not cancelled():
            win32gui.SetForegroundWindow(hwnd)
            requested = True
    except Exception:
        return False
    finally:
        user.AttachThreadInput(current, foreground, False)
    return requested and settled()


try:
    from cu.cancellation import check, cancelled
except ImportError:
    from cancellation import check, cancelled

class FocusLease:
    def __init__(self, window, borrow, idle, desktop_ready):
        self.window, self.borrow, self.idle, self.desktop_ready = window, borrow, idle, desktop_ready
        self.previous = win32gui.GetForegroundWindow()
        self.cursor = win32gui.GetCursorPos()
        self.started = time.monotonic()
        self.takeover = threading.Event()
        self.stop = threading.Event()
        self.ready = threading.Event()
        self.hook_error = None
        self.hud = None
        self.borrowed = False
        self.armed = False
        self.report = None

    def hooks(self):
        user = ctypes.WinDLL("user32", use_last_error=True)
        callback_type = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)
        user.SetWindowsHookExW.argtypes = [ctypes.c_int, callback_type, wintypes.HINSTANCE, wintypes.DWORD]
        user.SetWindowsHookExW.restype = wintypes.HANDLE
        user.CallNextHookEx.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM]
        user.CallNextHookEx.restype = ctypes.c_ssize_t
        user.UnhookWindowsHookEx.argtypes = [wintypes.HANDLE]
        class Keyboard(ctypes.Structure):
            _fields_ = [("vk", wintypes.DWORD), ("scan", wintypes.DWORD), ("flags", wintypes.DWORD), ("time", wintypes.DWORD), ("extra", ctypes.c_size_t)]
        class Mouse(ctypes.Structure):
            _fields_ = [("point", wintypes.POINT), ("data", wintypes.DWORD), ("flags", wintypes.DWORD), ("time", wintypes.DWORD), ("extra", ctypes.c_size_t)]
        def make_callback(struct, injected):
            def callback(code, wparam, lparam):
                if code >= 0 and not ctypes.cast(lparam, ctypes.POINTER(struct)).contents.flags & injected:
                    self.takeover.set()
                return user.CallNextHookEx(None, code, wparam, lparam)
            return callback_type(callback)
        key_cb, mouse_cb = make_callback(Keyboard, 0x10), make_callback(Mouse, 0x1)
        kh = user.SetWindowsHookExW(13, key_cb, None, 0)
        mh = user.SetWindowsHookExW(14, mouse_cb, None, 0)
        if not kh or not mh:
            self.hook_error = "User input hooks unavailable"
        self.ready.set()
        try:
            while not self.stop.is_set():
                win32gui.PumpWaitingMessages()
                time.sleep(.005)
        finally:
            if kh:
                user.UnhookWindowsHookEx(kh)
            if mh:
                user.UnhookWindowsHookEx(mh)

    def show_hud(self):
        from feedback_windows import DesktopFeedback
        self.feedback=DesktopFeedback()
        self.feedback.show(self.borrowed,background=False)
        self.hud=True

    def __enter__(self):
        try:
            check()
            self.desktop_ready()
            if self.idle() < 2:
                raise Refused("User active in last 2 seconds")
            if not self.window["visible"] or self.window["minimized"]:
                raise Refused("Window not visible; lease cannot restore or switch virtual desktops")
            self.thread = threading.Thread(target=self.hooks, daemon=True)
            self.thread.start()
            if not self.ready.wait(1) or self.hook_error:
                raise Refused(self.hook_error or "User input monitor timeout")
            self.armed = True
            if self.previous != self.window["id"]:
                if not self.borrow:
                    raise Refused("Target must be foreground, or use focus=borrow")
                self.borrowed = True
                if not activate(self.window["id"], lambda: self.takeover.is_set() or cancelled()):
                    raise Refused("Focus activation not verified; inspect current foreground")
                until = time.monotonic() + 1
                while win32gui.GetForegroundWindow() != self.window["id"] and time.monotonic() < until:
                    if self.takeover.wait(.01):
                        break
            self.check()
            self.show_hud()
            return self
        except Exception:
            self.__exit__(None, None, None)
            raise

    def check(self):
        check()
        if self.takeover.is_set():
            raise Refused("User takeover; partial input possible")
        if time.monotonic() - self.started > 8:
            raise Refused("Focus lease timeout; partial input possible")
        if win32gui.GetForegroundWindow() != self.window["id"]:
            self.takeover.set()
            raise Refused("Focus changed; user retains control")

    def __exit__(self, *args):
        if self.report is not None:
            return
        restored = False
        time.sleep(.04)
        if self.armed and not cancelled() and not self.takeover.is_set() and win32gui.GetForegroundWindow() == self.window["id"]:
            # Injected movement is ignored by the physical-user hook.
            from pywinauto import mouse
            mouse.move(coords=self.cursor)
            if self.borrowed and win32gui.IsWindow(self.previous):
                try:
                    restored = activate(self.previous, lambda: self.takeover.is_set() or cancelled())
                except Exception:
                    restored = False
        if self.hud:
            self.feedback_report=self.feedback.report
            self.feedback.close()
        self.stop.set()
        if hasattr(self, "thread"):
            self.thread.join(timeout=1)
        self.report = {"requested": self.borrow, "borrowed": self.borrowed, "restored": restored,
                       "user_takeover": self.takeover.is_set(), "duration_seconds": time.monotonic()-self.started,
                       "hud_shown": bool(self.hud), "capture_exclusion": "requested_not_guaranteed"}
