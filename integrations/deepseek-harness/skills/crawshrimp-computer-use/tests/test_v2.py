import copy
import importlib.util
import json
from pathlib import Path
import platform
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch, Mock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from cu.common import Refused, write_json
from cu.observation import annotate, compact, resolve_ref
from cu.discovery import cdp, enrich
from cu.diagnostics import diagnose
from cu.flows import run_flow
from cu.profiles import record, match
from test_protocol import snapshot


class V2Tests(unittest.TestCase):
    def test_json_reader_waits_for_transient_replace_lock(self):
        from cu.common import read_json
        with patch.object(Path,'read_text',side_effect=[PermissionError('sharing'),'{"seq":"ready"}']):
            self.assertEqual(read_json('command.json'),{'seq':'ready'})

    def test_atomic_json_commit_survives_windows_reader_contention(self):
        import os
        actual_replace=os.replace
        error=PermissionError('reader holds destination')
        error.winerror=5
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'reply.json'
            write_json(path,{'seq':'old'})
            attempts=[]
            def contended(source,target):
                attempts.append(1)
                self.assertEqual(json.loads(path.read_text()),{'seq':'old'})
                if len(attempts)==1:raise error
                actual_replace(source,target)
            with patch('cu.common.os.replace',side_effect=contended):
                write_json(path,{'seq':'new'})
            self.assertEqual(json.loads(path.read_text()),{'seq':'new'})
            self.assertEqual(list(Path(folder).glob('.cu-*')),[])

    def test_feedback_start_timeout_reaps_its_child(self):
        from cu.feedback_session import start
        child=Mock(pid=12345)
        child.poll.return_value=None
        with tempfile.TemporaryDirectory() as folder:
            with patch('cu.feedback_session.platform.system',return_value='Darwin'), \
                 patch('cu.feedback_session.subprocess.Popen',return_value=child), \
                 patch('cu.feedback_session.time',types.SimpleNamespace(
                     monotonic=Mock(side_effect=[0,60]),time=lambda:0,sleep=lambda _:None)):
                with self.assertRaisesRegex(Refused,'startup timeout'):start(folder)
            child.terminate.assert_called_once()
            child.wait.assert_called_once_with(timeout=3)
            state=json.loads((Path(folder)/'feedback/state.json').read_text())
            self.assertEqual(state['status'],'stopped')
            self.assertEqual(state['reason'],'startup_failed')

    def observation(self):
        s = snapshot()
        s.update(snapshot="fixture.json", snapshot_id="fixture")
        return annotate(s)

    def test_refs_bind_to_snapshot_and_unique_selector(self):
        s = self.observation()
        self.assertEqual(resolve_ref({"kind": "set_value", "ref": "e1"}, s)["selector"], {"role": "text_field", "automation_id": "input"})
        with self.assertRaises(Refused):
            resolve_ref({"kind": "set_value", "ref": "e99"}, s)

    def test_ambiguous_ref_cannot_dispatch(self):
        s = snapshot()
        s["elements"] *= 2
        annotate(s)
        with self.assertRaises(Refused):
            resolve_ref({"kind": "invoke", "ref": "e1"}, s)

    def test_compact_is_bounded_searchable_and_keeps_full_evidence(self):
        s = self.observation()
        for i in range(100):
            s["elements"].append({**s["elements"][0], "automation_id": f"input-{i}", "value": "a"*200})
        annotate(s)
        view = compact(s, limit=10)
        self.assertEqual((view["shown"], view["omitted"]), (10,91))
        self.assertEqual(view["full_evidence"], "fixture.json")
        self.assertEqual(compact(s, query="input-99")["shown"], 1)
        self.assertTrue(view["elements"][1]["value_truncated"])
        self.assertEqual(len(s["elements"][1]["value"]),200)

    def test_diagnostic_never_retries_a_dispatch(self):
        for text in ("timeout", "Window closed", "User takeover", "Screen recording permission unavailable", "screenshot failed"):
            d = diagnose(text, phase="dispatch")
            self.assertEqual(d["effect"], "unknown")
            self.assertFalse(d["auto_retry"])
            self.assertTrue(d["next_action"])

    def test_offscreen_capture_has_specific_advice(self):
        self.assertEqual(diagnose("screenshot unavailable", window={"visible":False})["code"], "window_not_visible")

    def test_cdp_readonly_endpoint_and_redirect_rejection(self):
        calls=[]
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args): pass
            def do_GET(self):
                calls.append(self.path)
                data = {"Browser":"fixture", "webSocketDebuggerUrl":"ws://127.0.0.1/devtools/browser/fixture"} if self.path=="/json/version" else [{"id":"1","type":"page","title":"fixture","url":"https://example.test"}]
                self.send_response(200); self.end_headers(); self.wfile.write(json.dumps(data).encode())
        server=ThreadingHTTPServer(("127.0.0.1",0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            self.assertEqual(cdp(server.server_port)["status"],"verified")
            self.assertEqual(calls,["/json/version","/json/list"])
            def redirect(handler):
                handler.send_response(302);handler.send_header("Location",f"http://127.0.0.1:{server.server_port}/should-not-follow");handler.end_headers()
            Handler.do_GET=redirect
            self.assertEqual(cdp(server.server_port)["status"],"unknown")
        finally:
            server.shutdown();server.server_close();thread.join()

    def test_probe_queries_only_observed_ports(self):
        with patch("cu.discovery.cdp",return_value={"status":"verified"}) as called:
            p=enrich({"listening_ports":[{"port":9333},{"port":9333}],"semantic_controls":1},"Windows")
            called.assert_called_once_with(9333)
            self.assertEqual(p["recommended_surface"],"cdp")
            self.assertFalse(p["mutations_performed"])

    def test_incomplete_probe_does_not_recommend_semantic_writes(self):
        result=enrich({"semantic_controls":3,"tree_complete":False},"Windows",False)
        self.assertNotIn("semantic",[route["surface"] for route in result["routes"]])

    def test_profile_versions_and_no_volatile_coordinates(self):
        s=self.observation()
        probe={"window":s["window"],"platform":s["platform"],"version":"1.0"}
        with tempfile.TemporaryDirectory() as d:
            p=record(s,probe,Path(d)/"profile.json")
            self.assertEqual(match(p,probe)["status"],"compatible_hint")
            self.assertEqual(match(p,{**probe,"version":"2.0"})["status"],"stale")
            self.assertNotIn("pid",p["app"])
            self.assertNotIn("rect",p["controls"][0])
            with self.assertRaises(Refused):record(s,probe,Path(d)/"profile.json")

    def flow_fixture(self, fail=False):
        s=self.observation()
        calls=[]
        ready={"value":False}
        def observe(wid,directory):
            return s
        def backend(payload):
            current=copy.deepcopy(s)
            current["elements"][0]["value"]="ready" if ready["value"] else ""
            return current
        def act(req,directory,execute):
            calls.append(req["action_id"])
            return {"status":"unknown" if fail else "verified_control"}
        expect={"selector":{"automation_id":"input"},"property":"value","equals":"ready"}
        plan={"flow_id":"flow","window_id":1,"steps":[{"id":"write","op":"act","action":{"kind":"set_value","selector":{"automation_id":"input"},"text":"ready"},"expect":expect},{"id":"wait","op":"wait","expect":expect,"timeout":.01},{"id":"after","op":"observe"}]}
        return plan,calls,ready,observe,act,backend

    def test_flow_resume_skips_verified_mutations(self):
        plan,calls,ready,observe,act,backend=self.flow_fixture()
        with tempfile.TemporaryDirectory() as d:
            result=run_flow(plan,Path(d),True,observe,act,backend)
            self.assertEqual(result["status"],"waiting")
            ready["value"]=True
            result=run_flow(plan,Path(d),True,observe,act,backend)
            self.assertEqual(result["status"],"verified_flow")
            self.assertEqual(len(calls),1)
            self.assertTrue(run_flow(plan,Path(d),True,observe,act,backend)["replayed"])

    def test_flow_unknown_never_reexecutes_mutation(self):
        plan,calls,ready,observe,act,backend=self.flow_fixture(True)
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(run_flow(plan,Path(d),True,observe,act,backend)["status"],"unknown")
            self.assertTrue(run_flow(plan,Path(d),True,observe,act,backend)["replayed"])
            self.assertEqual(len(calls),1)

    def test_flow_preview_does_not_observe_or_create_files(self):
        plan,*_=self.flow_fixture()
        def deny(*args):raise AssertionError("No calls during preview")
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(run_flow(plan,Path(d),False,deny,deny,deny)["status"],"preview")
            self.assertEqual(list(Path(d).iterdir()),[])

    def test_flow_changed_plan_cannot_resume(self):
        plan,calls,ready,observe,act,backend=self.flow_fixture()
        with tempfile.TemporaryDirectory() as d:
            run_flow(plan,Path(d),True,observe,act,backend)
            plan["steps"][0]["action"]["text"]="another"
            with self.assertRaises(Refused):run_flow(plan,Path(d),True,observe,act,backend)


class WindowsFocusContractTests(unittest.TestCase):
    """Policy contracts with a fake Win32 surface; not Windows hardware acceptance."""
    def test_activation_waits_for_asynchronous_readback_without_repeating(self):
        gui=types.SimpleNamespace(GetForegroundWindow=Mock(side_effect=[100,100,200]),SetForegroundWindow=Mock())
        import cu.common as common
        with patch.dict(sys.modules,{'win32api':types.SimpleNamespace(),'win32con':types.SimpleNamespace(),'win32gui':gui,'common':common}):
            spec=importlib.util.spec_from_file_location('focus_test',Path(__file__).resolve().parents[1]/'scripts/cu/focus_windows.py')
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            with patch.object(module.time,'sleep'):
                self.assertTrue(module.activate(200))
        gui.SetForegroundWindow.assert_called_once_with(200)

    def test_activation_detaches_input_queue_when_activation_fails(self):
        gui=types.SimpleNamespace(GetForegroundWindow=lambda:100,SetForegroundWindow=Mock(side_effect=OSError('denied')))
        api=types.SimpleNamespace(GetCurrentThreadId=lambda:1)
        user=Mock()
        user.GetWindowThreadProcessId.return_value=2
        user.AttachThreadInput.return_value=True
        import cu.common as common
        with patch.dict(sys.modules,{'win32api':api,'win32con':types.SimpleNamespace(),'win32gui':gui,'common':common}):
            spec=importlib.util.spec_from_file_location('focus_test',Path(__file__).resolve().parents[1]/'scripts/cu/focus_windows.py')
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            with patch.object(module.ctypes,'WinDLL',return_value=user,create=True):
                self.assertFalse(module.activate(200))
            self.assertEqual(user.AttachThreadInput.call_args_list, [((1,2,True),), ((1,2,False),)])

    def test_takeover_never_restores_focus_or_cursor(self):
        current=[100]
        moves=[]
        gui=types.SimpleNamespace(GetForegroundWindow=lambda:current[0],GetCursorPos=lambda:(1,2),
                                  SetForegroundWindow=lambda h:moves.append(h),IsWindow=lambda h:True)
        import cu.common as common
        with patch.dict(sys.modules,{"win32api":types.SimpleNamespace(),"win32con":types.SimpleNamespace(),"win32gui":gui,"common":common}):
            spec=importlib.util.spec_from_file_location("focus_test",Path(__file__).resolve().parents[1]/"scripts/cu/focus_windows.py")
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            lease=module.FocusLease({"id":100},True,lambda:3,lambda:None)
            lease.armed=True;lease.borrowed=True;lease.takeover.set()
            with self.assertRaises(Refused):lease.check()
            lease.__exit__(None,None,None)
            self.assertEqual(moves,[])
            self.assertTrue(lease.report["user_takeover"])

    def test_external_focus_change_is_takeover(self):
        gui=types.SimpleNamespace(GetForegroundWindow=lambda:200,GetCursorPos=lambda:(1,2))
        import cu.common as common
        with patch.dict(sys.modules,{"win32api":types.SimpleNamespace(),"win32con":types.SimpleNamespace(),"win32gui":gui,"common":common}):
            spec=importlib.util.spec_from_file_location("focus_test",Path(__file__).resolve().parents[1]/"scripts/cu/focus_windows.py")
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            lease=module.FocusLease({"id":100},True,lambda:3,lambda:None)
            with self.assertRaises(Refused):lease.check()
            self.assertTrue(lease.takeover.is_set())
