"""Owned live banner regression: actual stages, idle rotation, stale phase timeout, OS focus and capture."""
import argparse
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time

root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'scripts'))
from cu.feedback_copy import CATALOG, PUBLIC_PHASES
from cu.feedback_session import start, phase, command, stop, activity
from cu.common import write_json
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out',required=True)
args=parser.parse_args()
run=Path(args.out).resolve();run.mkdir(parents=True,exist_ok=False)
os.environ['CRAWSHRIMP_CU_FEEDBACK_CAPTURE']='1'
system=platform.system();backdrop=None
if system=='Darwin':
    inspector=run/'feedback-inspect'
    subprocess.run(['swiftc',str(root/'tests/feedback_inspect.swift'),'-o',str(inspector)],check=True)
    def inspect(pid):return json.loads(subprocess.check_output([str(inspector),str(pid)],text=True))
    before=inspect(0)
    def capture(box,path):
        b=box['bounds'];region=','.join(str(round(b[k])) for k in ('X','Y','Width','Height'))
        subprocess.run(['/usr/sbin/screencapture','-x','-R'+region,str(path)],check=True)
else:
    assert system=='Windows'
    import ctypes
    ctypes.windll.user32.SetProcessDPIAware()
    import win32api,win32gui,win32process,win32con
    from PIL import ImageGrab
    def inspect(pid):
        found=[]
        def visit(h,_):
            if win32gui.IsWindowVisible(h) and win32process.GetWindowThreadProcessId(h)[1]==pid:
                x,y,r,b=win32gui.GetWindowRect(h);found.append({'id':h,'bounds':{'X':x,'Y':y,'Width':r-x,'Height':b-y}})
        win32gui.EnumWindows(visit,None)
        return {'windows':found,'foreground':win32gui.GetForegroundWindow(),'cursor':list(win32gui.GetCursorPos())}
    before=inspect(0)
    def capture(box,path):
        b=box['bounds'];screen=ImageGrab.grab(include_layered_windows=True)
        screen.crop((b['X'],b['Y'],b['X']+b['Width'],b['Y']+b['Height'])).save(path)
report={'platform':system,'checks':[],'frames':{},'initial_os_state':before}
try:
    session=start(run);pid=session['pid'];folder=run/'feedback'
    command(folder,'locate',x=420,y=420)
    first=command(folder,'status');position=first['position']
    native=inspect(pid);ids=sorted(w['id'] for w in native['windows'])
    assert len(ids)==3,native
    banner=next(w for w in native['windows'] if w['bounds']['Width']>300)
    for name in CATALOG:
        # Compare the OS around this change, not with a mouse position sampled
        # before startup. User activity between cases is not renderer activity.
        before_change=inspect(pid)
        if name in PUBLIC_PHASES:reply=phase(run,name)
        else:reply=command(folder,'show',borrowed=name=='borrowed',background=name=='background')
        frame=reply['feedback']
        assert frame['phase']==name and frame['title']==CATALOG[name]['title'],reply
        assert frame['subtitle']==CATALOG[name]['subtitles'][0],reply
        time.sleep(.2)
        state=inspect(pid)
        assert state['foreground']==before_change['foreground'],{'before':before_change,'after':state}
        assert state['cursor']==before_change['cursor'],{'before':before_change,'after':state}
        assert sorted(w['id'] for w in state['windows'])==ids,state
        assert reply['position']==position,reply
        path=run/(name+'.png');capture(banner,path)
        report['frames'][name]={**frame,'image':str(path)}
    report['checks'] += ['nine_real_native_states_match_catalog','same_renderer_windows_and_pointer_position','foreground_and_system_cursor_preserved']
    initial=phase(run,'idle');time.sleep(6.3);rotated=command(folder,'status')
    motion=initial['feedback']['reduced_motion']
    assert (rotated['feedback']['subtitle']==initial['feedback']['subtitle'])==motion,rotated
    assert rotated['feedback']['phase']=='idle' and rotated['position']==position
    report['checks'].append('idle_copy_rotation_or_reduced_motion_static')
    # Nested work finishes after a newer stage report: its cleanup must not erase it.
    with activity(run,'observing'):phase(run,'planning')
    assert command(folder,'status')['feedback']['phase']=='planning'
    report['checks'].append('late_cleanup_preserves_newer_stage')
    phase(run,'thinking')
    # Status reads do not renew work claims. Real native timer expires the phase.
    time.sleep(30)
    assert command(folder,'status')['feedback']['phase']=='thinking'
    time.sleep(30.5)
    expired=command(folder,'status')
    assert expired['feedback']['phase']=='idle',expired
    report['checks'].append('stale_phase_returns_to_neutral_idle')
    report['status']='passed'
except Exception as exc:
    report.update(status='failed',error=str(exc));raise
finally:
    try:
        report['shutdown']=stop(run)
        assert report['shutdown']['status']=='stopped',report['shutdown']
        if 'pid' in locals():assert inspect(pid)['windows']==[]
    except Exception as exc:
        report.update(status='failed',cleanup_error=str(exc))
    if system=='Darwin' and backdrop:backdrop.terminate();backdrop.wait(5)
    elif backdrop:
        win32gui.DestroyWindow(backdrop);win32gui.UnregisterClass(wc.lpszClassName,wc.hInstance)
    write_json(run/'feedback-report.json',report)
    print(json.dumps(report,ensure_ascii=False,indent=2))
if report['status']!='passed':raise SystemExit(1)
