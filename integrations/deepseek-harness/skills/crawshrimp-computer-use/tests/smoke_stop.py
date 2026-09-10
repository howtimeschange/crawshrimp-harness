"""Real pointer clicks on task-owned stop buttons; no application input or backdrop."""
import argparse,json,os,platform,subprocess,sys,threading,time
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'scripts'))
from cu.feedback_session import start,stop,phase,status,command
from cu.cancellation import marker,Cancelled,run_process,cancel
from cu.common import read_json,write_json
p=argparse.ArgumentParser();p.add_argument('--out',required=True);args=p.parse_args()
out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=False)
os.environ['CRAWSHRIMP_CU_FEEDBACK_CAPTURE']='1'
system=platform.system()
if system=='Darwin':
    inspector=out/'stop-click';subprocess.run(['swiftc',str(root/'tests/stop_click.swift'),'-o',str(inspector)],check=True)
    def inspect(pid,click=False):return json.loads(subprocess.check_output([str(inspector),str(pid)]+(['click'] if click else []),text=True))
    def capture(box,path):
        b=box['bounds'];subprocess.run(['/usr/sbin/screencapture','-x','-R'+','.join(str(round(b[k])) for k in ('X','Y','Width','Height')),str(path)],check=True)
else:
    import ctypes;ctypes.windll.user32.SetProcessDPIAware()
    import win32api,win32gui,win32process,win32con
    from PIL import ImageGrab
    def inspect(pid,click=False):
        found=[]
        def visit(h,_):
            if win32gui.IsWindowVisible(h) and win32process.GetWindowThreadProcessId(h)[1]==pid:
                x,y,r,b=win32gui.GetWindowRect(h);found.append({'id':h,'bounds':{'X':x,'Y':y,'Width':r-x,'Height':b-y}})
        win32gui.EnumWindows(visit,None);before=win32gui.GetForegroundWindow();samples=[before]
        if click:
            button=next(w for w in found if w['bounds']['Width']==64);b=button['bounds']
            win32api.SetCursorPos((b['X']+32,b['Y']+16));win32api.mouse_event(2,0,0);time.sleep(.05);win32api.mouse_event(4,0,0)
            for _ in range(30):samples.append(win32gui.GetForegroundWindow());time.sleep(.02)
        return {'windows':found,'foreground':before,'foreground_samples':samples,'cursor':list(win32gui.GetCursorPos())}
    def capture(box,path):
        b=box['bounds'];ImageGrab.grab(include_layered_windows=True).crop((b['X'],b['Y'],b['X']+b['Width'],b['Y']+b['Height'])).save(path)
report={'platform':system,'themes':{}}
try:
    for theme in (('glass',) if system=='Darwin' else ('glass','navy')):
        os.environ['CRAWSHRIMP_CU_FEEDBACK_THEME']=theme
        run=out/theme;session=start(run);pid=session['pid'];worker=[]
        try:
            phase(run,'planning');command(run/'feedback','locate',x=420,y=420);state=inspect(pid);assert len(state['windows'])==3,state
            banner=next(w for w in state['windows'] if w['bounds']['Width']>300)
            capture(banner,out/(theme+'.png'))
            # Exercise real cancellation while the parent is waiting on its own hung child.
            ready=run/'worker-ready'
            def pending():
                try:run_process([sys.executable,'-c',f'import time;open({str(ready)!r},"w").write("ready");time.sleep(30)'],'{}',marker(run),text=True)
                except Cancelled:worker.append('cancelled')
                except Exception as exc:worker.append(str(exc))
            thread=threading.Thread(target=pending);thread.start()
            until=time.monotonic()+8
            while not ready.exists() and time.monotonic()<until:time.sleep(.02)
            assert ready.exists(),'Waiting worker did not start'
            started=time.monotonic();clicked=inspect(pid,True)
            until=time.monotonic()+4
            while not marker(run).exists() and time.monotonic()<until:time.sleep(.02)
            assert marker(run).exists(),'Real stop click did not cancel'
            thread.join(5);assert worker==['cancelled'],worker
            until=time.monotonic()+4
            while inspect(pid)['windows'] and time.monotonic()<until:time.sleep(.03)
            assert not inspect(pid)['windows'],'HUD remains visible'
            assert len(set(clicked['foreground_samples']))==1,clicked
            assert clicked['foreground']==state['foreground'],clicked
            assert status(run)['status']=='cancelled'
            try:start(run);raise AssertionError('Cancelled run restarted')
            except Cancelled:pass
            report['themes'][theme]={'status':'passed','real_mouse_click':True,'foreground_preserved':True,'worker_cancelled':True,'hud_closed':True,'restart_refused':True,'elapsed_seconds':time.monotonic()-started,'native_state':clicked}
        finally:
            if not marker(run).exists():stop(run)
    report['status']='passed'
except Exception as exc:
    report.update(status='failed',error=str(exc));raise
finally:write_json(out/'stop-report.json',report)
