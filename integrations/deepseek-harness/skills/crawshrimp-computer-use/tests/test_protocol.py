from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from cu.common import Refused, check_expectation, exclusive, point_in_window, select, validate_action, windows_literal_keys, write_json
from computer_use import perform


def snapshot():
    return {"platform": platform.system(), "created_at": time.time(),
            "window": {"id": 1, "pid": 2, "process_started": 3, "executable": "fixture",
                       "x": -100, "y": 50, "width": 600, "height": 400},
            "elements": [{"role": "text_field", "automation_id": "input", "name": "",
                          "value": "", "enabled": True, "actions": ["set_value"]}]}


class ProtocolTests(unittest.TestCase):
    def test_windows_non_bmp_text_is_not_truncated(self):
        units = list(windows_literal_keys("中🦐"))
        self.assertEqual([ord(c) for c in units], [0x4e2d, 0xd83e, 0xdd90])

    def test_windows_text_cannot_be_interpreted_as_shortcuts(self):
        self.assertEqual(list(windows_literal_keys("+^{}")), ["{+}", "{^}", "{{}", "{}}"])

    def test_retina_coordinates(self):
        self.assertEqual(point_in_window({"x": 600, "y": 400, "space": "image"}, snapshot()["window"],
                                         {"width": 1200, "height": 800}), {"x": 300, "y": 200})

    def test_invalid_coordinates(self):
        for x in [-1, 1, float("inf"), float("nan"), True]:
            with self.assertRaises(Refused):
                point_in_window({"x": x, "y": .5, "space": "normalized"}, snapshot()["window"])

    def test_ambiguous_selector(self):
        element = snapshot()["elements"][0]
        with self.assertRaises(Refused):
            select([element, element], {"role": "text_field"})

    def test_protected_selector(self):
        with self.assertRaises(Refused):
            select([{**snapshot()["elements"][0], "protected": True}], {"automation_id": "input"})

    def test_incomplete_tree_cannot_verify(self):
        for key, value in [("truncated", True), ("tree_error", "permission unavailable"), ("tree_errors", ["COMError"])]:
            a = snapshot()
            a[key] = value
            with self.assertRaises(Refused):
                check_expectation(a, {"selector": {"automation_id": "input"}, "property": "value", "equals": ""})

    def request(self):
        return {"kind": "set_value", "selector": {"automation_id": "input"}, "text": "中文 🦐"}

    def test_pid_reuse(self):
        a, b = snapshot(), snapshot()
        b["window"]["process_started"] = 4
        with self.assertRaises(Refused):
            validate_action(self.request(), a, b)

    def test_stale_observation(self):
        a = snapshot()
        a["created_at"] -= 121
        with self.assertRaises(Refused):
            validate_action(self.request(), a, snapshot())

    def test_window_movement_invalidates_coordinates(self):
        a, b = snapshot(), snapshot()
        b["window"]["x"] += 5
        with self.assertRaises(Refused):
            validate_action({"kind": "click", "point": {"x": .5, "y": .5, "space": "normalized"}}, a, b)

    def test_truncated_tree(self):
        a = snapshot()
        a["truncated"] = True
        with self.assertRaises(Refused):
            validate_action(self.request(), a, snapshot())

    def test_type_cannot_implicitly_enter(self):
        with self.assertRaises(Refused):
            validate_action({"kind": "type", "text": "hello\n"}, snapshot(), snapshot())

    def test_disabled_control(self):
        a = snapshot()
        a["elements"][0]["enabled"] = False
        with self.assertRaises(Refused):
            validate_action(self.request(), snapshot(), a)

    def exercise(self, mode):
        with tempfile.TemporaryDirectory() as d:
            run = Path(d)
            snap = snapshot()
            path = run / "snapshot.json"
            write_json(path, snap)
            req = {**self.request(), "snapshot": str(path), "action_id": "test-1"}
            writes = []
            def backend(payload):
                if payload["command"] == "observe":
                    return snap
                writes.append(payload)
                if mode == "timeout":
                    raise subprocess.TimeoutExpired("fixture", 25)
                return {"dispatched": True}
            first = perform(req, run, execute=mode != "dry", call_backend=backend)
            second = perform(req, run, execute=mode != "dry", call_backend=backend)
            if mode == "dry":
                self.assertEqual(writes, [])
                self.assertEqual(first["status"], "preview")
                self.assertFalse((run / "actions").exists())
            else:
                self.assertEqual(len(writes), 1)
                self.assertTrue(second["replayed"])
                self.assertEqual(first["status"], "unknown" if mode == "timeout" else "executed_unverified")
                with self.assertRaises(Refused):
                    perform({**req, "text": "changed"}, run, execute=True, call_backend=backend)

    def test_dry_run_never_dispatches(self):
        self.exercise("dry")

    def test_timeout_never_retries(self):
        self.exercise("timeout")

    def test_unverified_never_claims_success_or_retries(self):
        self.exercise("unverified")

    def test_readback_success_is_not_business_success(self):
        with tempfile.TemporaryDirectory() as d:
            run = Path(d)
            snap = snapshot()
            write_json(run / "s.json", snap)
            req = {**self.request(), "snapshot": str(run / "s.json"), "action_id": "verified",
                   "expect": {"selector": {"automation_id": "input"}, "property": "value", "equals": "中文 🦐"}}
            def backend(payload):
                if payload["command"] == "observe":
                    return snap
                snap["elements"][0]["value"] = req["text"]
                return {"dispatched": True}
            result = perform(req, run, True, backend)
            self.assertEqual(result["status"], "verified_control")
            self.assertFalse(result["business_success"])

    def test_lock_excludes_other_process(self):
        with tempfile.TemporaryDirectory() as d:
            lock = str(Path(d) / "lock")
            script = "from cu.common import exclusive; import sys\nwith exclusive(sys.argv[1]): print('acquired')"
            with exclusive(lock):
                child = subprocess.run([sys.executable, "-c", script, lock], cwd=Path(__file__).resolve().parents[1] / "scripts", capture_output=True)
                self.assertNotEqual(child.returncode, 0)
            child = subprocess.run([sys.executable, "-c", script, lock], cwd=Path(__file__).resolve().parents[1] / "scripts", capture_output=True)
            self.assertEqual(child.returncode, 0)


if __name__ == "__main__":
    unittest.main()
