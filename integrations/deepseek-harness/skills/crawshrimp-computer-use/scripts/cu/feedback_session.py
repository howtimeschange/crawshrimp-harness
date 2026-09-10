"""A task-owned resident visual cursor. File IPC carries visual commands only."""
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time
import uuid
from contextlib import contextmanager
try:
    from .common import Refused, exclusive, write_json, read_json
except ImportError:
    from common import Refused, exclusive, write_json, read_json

try:
    from .cancellation import cancel, check, marker, cancelled
except ImportError:
    from cancellation import cancel, check, marker, cancelled

ROOT=Path(__file__).resolve().parents[2]


def command(folder, op, **values):
    folder=Path(folder)
    if op != "stop": check(marker(folder.parent))
    with exclusive(folder/'ipc.lock'):
        seq=uuid.uuid4().hex
        write_json(folder/'command.json',{'seq':seq,'op':op,**values})
        until=time.monotonic()+4
        while time.monotonic()<until:
            if op != "stop": check(marker(folder.parent))
            try:
                reply=read_json(folder/'reply.json')
                if reply.get('seq')==seq:
                    if reply.get('error'):raise Refused(reply['error'])
                    return reply
            except (FileNotFoundError,json.JSONDecodeError):pass
            time.sleep(.02)
    raise Refused('Resident visual feedback did not acknowledge command')


def start(run):
    check(marker(run))
    folder=Path(run).resolve()/'feedback'
    folder.mkdir(parents=True,exist_ok=True)
    if os.name!='nt':folder.chmod(0o700)
    with exclusive(folder/'start.lock'):
        check(marker(run))
        try:
            state=read_json(folder/'state.json')
            if time.time()-state.get('heartbeat',0)<3 and state.get('status')=='running':
                return {**command(folder,'status'),'directory':str(folder)}
        except (FileNotFoundError,json.JSONDecodeError):pass
        # A fresh file namespace prevents a stale command from being replayed on restart.
        generation=uuid.uuid4().hex
        write_json(folder/'command.json',{'seq':generation,'op':'status'})
        env=os.environ.copy();env.pop('CRAWSHRIMP_CU_FEEDBACK_DIR',None)
        if platform.system()=='Darwin':cmd=[str(ROOT/'scripts/native/mac'),'--feedback-server',str(folder)]
        elif platform.system()=='Windows':cmd=[sys.executable,str(ROOT/'scripts/cu/feedback_windows.py'),'--server',str(folder)]
        else:raise Refused('Desktop feedback requires macOS or Windows')
        log=(folder/'worker.log').open('ab')
        try:
            options={'creationflags':subprocess.CREATE_NO_WINDOW} if os.name=='nt' else {'start_new_session':True}
            child=subprocess.Popen(cmd,stdin=subprocess.DEVNULL,stdout=log,stderr=log,env=env,**options)
        finally:log.close()
        # First Windows font/DLL loads can be slow under ARM x64 emulation.
        deadline=time.monotonic()+(30 if platform.system()=='Windows' else 5)
        try:
            while time.monotonic()<deadline:
                check(marker(run))
                if child.poll() is not None:raise Refused('Feedback worker exited; inspect feedback/worker.log')
                try:
                    state=read_json(folder/'state.json')
                    if state.get('pid')==child.pid and state.get('status')=='running':
                        return {**command(folder,'status'),'directory':str(folder)}
                except (FileNotFoundError,json.JSONDecodeError):pass
                time.sleep(.03)
            raise Refused('Feedback worker startup timeout')
        except BaseException:
            # Only this Popen child: a timeout must not leave a late-starting HUD.
            if child.poll() is None:
                child.terminate()
                try:child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    child.kill();child.wait(timeout=3)
            write_json(folder/'state.json',{'pid':child.pid,'status':'stopped',
                       'heartbeat':time.time(),'reason':'startup_failed'})
            raise


def stop(run):
    folder=Path(run).resolve()/'feedback'
    if not (folder/'state.json').exists():return {'status':'not_started'}
    state=read_json(folder/'state.json')
    if state.get('status')!='running' or time.time()-state.get('heartbeat',0)>3:return state
    result=command(folder,'stop')
    until=time.monotonic()+3
    while time.monotonic()<until:
        state=read_json(folder/'state.json')
        if state.get('status')=='stopped':return {**result,**state}
        time.sleep(.03)
    raise Refused('Feedback stop was sent but not yet verified')


def status(run):
    if cancelled(marker(run)): return {"status":"cancelled","cancel_file":str(marker(run))}
    folder=Path(run).resolve()/'feedback'
    try:
        state=read_json(folder/'state.json')
    except FileNotFoundError:return {'status':'not_started'}
    if state.get('status')=='running' and time.time()-state.get('heartbeat',0)>3:
        state['status']='unresponsive'
    return state


def phase(run, name, start_if_needed=True):
    try:
        from .feedback_copy import PUBLIC_PHASES
    except ImportError:
        from feedback_copy import PUBLIC_PHASES
    if name not in PUBLIC_PHASES:
        raise Refused('Unknown feedback phase')
    if start_if_needed:
        start(run)
    elif status(run).get('status') != 'running':
        return None
    return command(Path(run).resolve()/'feedback', 'phase', phase=name)


@contextmanager
def activity(run, name):
    """Best-effort display for actual read work; never changes action outcomes.

    Read-only tasks do not start a HUD. A scope may only clear its own token,
    so a late read completion cannot overwrite a newer agent-reported phase.
    """
    result = None
    try:
        result = phase(run, name, start_if_needed=False)
    except Exception:
        pass
    try:
        yield
    finally:
        if result:
            try:
                command(Path(run).resolve()/'feedback', 'idle', if_phase=result['seq'])
            except Exception:
                pass
