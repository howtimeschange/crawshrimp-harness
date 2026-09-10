import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from cu.cancellation import cancel, cancelled, marker, Cancelled, run_process
from cu.feedback_session import start, command
from cu.common import write_json, exclusive
from cu.flows import run_flow
from computer_use import perform
from test_protocol import snapshot

class CancellationTests(unittest.TestCase):
    def request(self,run):
        path=run/'snapshot.json';write_json(path,snapshot())
        return {'action_id':'stop-test','snapshot':str(path),'kind':'set_value','selector':{'automation_id':'input'},'text':'test'}

    def test_stop_persists_and_does_not_cancel_other_runs(self):
        with tempfile.TemporaryDirectory() as d:
            run=Path(d)/'one';first=cancel(run)
            self.assertEqual(first,cancel(run))
            self.assertTrue(cancelled(marker(run)))
            self.assertFalse(cancelled(marker(Path(d)/'two')))
            with patch('cu.feedback_session.subprocess.Popen') as launch:
                with self.assertRaises(Cancelled): start(run)
                launch.assert_not_called()

    def test_cancel_does_not_wait_for_visual_lock(self):
        with tempfile.TemporaryDirectory() as d:
            run=Path(d)
            with exclusive(run/'feedback/ipc.lock'):
                cancel(run)
            self.assertTrue(marker(run).exists())
            with self.assertRaises(Cancelled): command(run/'feedback','show')

    def test_cancelled_run_never_dispatches_new_action(self):
        with tempfile.TemporaryDirectory() as d:
            run=Path(d);req=self.request(run);cancel(run);backend=Mock()
            with self.assertRaises(Cancelled):perform(req,run,True,backend)
            backend.assert_not_called()

    def test_cancel_during_fresh_observation_never_dispatches(self):
        with tempfile.TemporaryDirectory() as d:
            run=Path(d);req=self.request(run)
            def observe(_):cancel(run);return snapshot()
            backend=Mock(side_effect=observe)
            with self.assertRaises(Cancelled):perform(req,run,True,backend)
            self.assertEqual(backend.call_count,1)
            self.assertFalse((run/'actions/stop-test.json').exists())

    def test_partial_dispatch_is_unknown_and_never_replayed(self):
        with tempfile.TemporaryDirectory() as d:
            run=Path(d);req=self.request(run);calls=[]
            def backend(payload):
                calls.append(payload)
                if payload.get('command')=='observe':return snapshot()
                cancel(run);return {'dispatched':True}
            first=perform(req,run,True,backend)
            self.assertEqual(first['status'],'unknown');self.assertTrue(first['cancelled'])
            second=perform(req,run,True,backend)
            self.assertTrue(second['replayed']);self.assertFalse(second['reexecuted'])
            self.assertEqual(len(calls),2)

    def test_stop_verification_does_not_retry(self):
        with tempfile.TemporaryDirectory() as d:
            run=Path(d);req=self.request(run);req['expect']={'selector':{'automation_id':'input'},'property':'value','equals':'test'};n=[0]
            def backend(payload):
                n[0]+=1
                if n[0]==3:cancel(run)
                return snapshot() if payload.get('command')=='observe' else {'dispatched':True}
            result=perform(req,run,True,backend)
            self.assertTrue(result['cancelled']);self.assertEqual(n[0],3)

    def test_flow_stops_after_current_step(self):
        with tempfile.TemporaryDirectory() as d:
            run=Path(d);observe=Mock(side_effect=lambda *_:(cancel(run) and {**snapshot(),'snapshot':'test'}))
            plan={'flow_id':'stop-flow','window_id':1,'steps':[{'id':'first','op':'observe'},{'id':'never','op':'observe'}]}
            result=run_flow(plan,run,True,observe,Mock(),lambda _:snapshot())
            self.assertEqual(result['status'],'cancelled');self.assertEqual(observe.call_count,1)
            self.assertNotIn('never',result['steps'])

    def test_stuck_worker_is_reaped_and_unrelated_worker_survives(self):
        with tempfile.TemporaryDirectory() as d:
            run=Path(d);pidfile=run/'pid';owned=[];real=subprocess.Popen
            def launch(*args,**kwargs):
                child=real(*args,**kwargs);owned.append(child);return child
            other=real([sys.executable,'-c','import time;time.sleep(30)'])
            def stop_after_start():
                end=time.monotonic()+5
                while not pidfile.exists() and time.monotonic()<end:time.sleep(.01)
                cancel(run)
            thread=threading.Thread(target=stop_after_start);thread.start()
            try:
                with patch('cu.cancellation.subprocess.Popen',side_effect=launch):
                    with self.assertRaises(Cancelled):run_process([sys.executable,'-c',f'import os,time;open({str(pidfile)!r},"w").write(str(os.getpid()));time.sleep(30)'],'{}',marker(run),text=True)
                self.assertIsNotNone(owned[0].poll());self.assertIsNone(other.poll())
            finally:
                thread.join(6);other.terminate();other.wait(3)
