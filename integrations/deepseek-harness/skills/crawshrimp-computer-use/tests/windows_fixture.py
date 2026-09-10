"""Local Win32 fixture; no app or user data is accessed."""
import win32api
import win32con
import win32gui
import sys

edit = None
status = None
last_input_focus = None
takeover_posted = False
stop_signalled = False


def wndproc(hwnd, message, wparam, lparam):
    global last_input_focus, takeover_posted, stop_signalled
    if message == win32con.WM_COMMAND and win32api.LOWORD(wparam) == 1001 and win32api.HIWORD(wparam) == win32con.EN_CHANGE:
        if '--stop-signal' in sys.argv and not stop_signalled and win32gui.GetWindowText(edit).startswith('stop:'):
            from pathlib import Path
            Path(sys.argv[sys.argv.index('--stop-signal')+1]).write_text('started')
            stop_signalled=True
        if not takeover_posted and win32gui.GetWindowText(edit).startswith('takeover:'):
            takeover_posted = True
            target = win32gui.FindWindow('CrawshrimpCUFixture', 'Crawshrimp CU Focus Anchor')
            if target:
                win32gui.SetForegroundWindow(target)
    if message == win32con.WM_COMMAND and win32api.LOWORD(wparam) == 1001 and win32api.HIWORD(wparam) == win32con.EN_SETFOCUS:
        last_input_focus = edit
        if status:
            win32gui.SetWindowText(status, "input-focused")
    if message == win32con.WM_SETFOCUS and last_input_focus:
        # Normal top-level Win32 apps restore their last focused child on
        # activation. Preserve this only after a real child focus event.
        win32gui.SetFocus(last_input_focus)
        return 0
    if message == win32con.WM_COMMAND and win32api.LOWORD(wparam) == 1002:
        win32gui.SetWindowText(edit, "button-invoked")
        return 0
    if message == win32con.WM_DESTROY:
        win32gui.PostQuitMessage(0)
        return 0
    return win32gui.DefWindowProc(hwnd, message, wparam, lparam)


wc = win32gui.WNDCLASS()
wc.hInstance = win32api.GetModuleHandle(None)
wc.lpszClassName = "CrawshrimpCUFixture"
wc.lpfnWndProc = wndproc
win32gui.RegisterClass(wc)
anchor = "--anchor" in sys.argv
hwnd = win32gui.CreateWindow(wc.lpszClassName, "Crawshrimp CU Focus Anchor" if anchor else "Crawshrimp CU Test Fixture", win32con.WS_OVERLAPPEDWINDOW,
                            820 if anchor else 160, 180, 560, 240, 0, 0, wc.hInstance, None)
edit = win32gui.CreateWindowEx(win32con.WS_EX_CLIENTEDGE, "Edit", "", win32con.WS_CHILD | win32con.WS_VISIBLE | win32con.ES_AUTOHSCROLL,
                               24, 35, 480, 32, hwnd, 1001, wc.hInstance, None)
win32gui.CreateWindow("Button", "Local test button", win32con.WS_CHILD | win32con.WS_VISIBLE | win32con.BS_PUSHBUTTON,
                     24, 100, 175, 40, hwnd, 1002, wc.hInstance, None)
status = win32gui.CreateWindow("Static", "input-idle", win32con.WS_CHILD | win32con.WS_VISIBLE,
                              230, 108, 250, 28, hwnd, 1003, wc.hInstance, None)
win32gui.ShowWindow(hwnd, win32con.SW_SHOWNOACTIVATE)
win32gui.PumpMessages()
