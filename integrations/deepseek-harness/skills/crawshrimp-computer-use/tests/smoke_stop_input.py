"""Stop an actual partial physical input in an owned fixture via real HUD click."""
import argparse,json,os,platform,subprocess,sys,threading,time
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'scripts'))
from computer_use import backend,observe,perform
from cu.common import write_json
from cu.feedback_session import start,stop
from cu.cancellation import marker,cancel
p=argparse.ArgumentParser();p.add_argument('--out',required=True);args=p.parse_args()
run=Path(args.out).resolve();run.mkdir(parents=True,exist_ok=False)
system=platform.system();signal=run/'input-started';report={'platform':system}
if system=='Darwin':
    fixture=run/'fixture';inspector=run/'stop-click'
    for source,target in [('mac_fixture.swift',fixture),('stop_click.swift',inspector)]:subprocess.run(['swiftc',str(root/'tests'/source),'-o',str(target)],check=True)
    cmd=[str(fixture)]
else:
    import ctypes;ctypes.windll.user32.SetProcessDPIAware()
    import win32gui,win32con,win32api,win32process
    cmd=[sys.executable,str(root/'tests/windows_fixture.py')]
child=subprocess.Popen(cmd+['--stop-signal',str(signal)]);thread=None
try:
    until=time.monotonic()+12
    while True:
        windows=[w for w in backend({'command':'windows','app':'Crawshrimp CU Test Fixture'})['windows'] if w['pid']==child.pid]
        if len(windows)==1:break
        assert time.monotonic()<until,'Fixture did not appear';time.sleep(.1)
    w=windows[0];snap=observe(w['id'],run,False)
    field=next(e for e in snap['elements'] if e['role']=='text_field' and 'set_value' in e['actions'])
    selector={'role':'text_field','automation_id':field['automation_id']};r=field['rect']
    if system=='Windows':
        # Test setup only: normal pointer click on the verified, task-owned editor.
        win32gui.SetWindowPos(w['id'],win32con.HWND_TOP,0,0,0,0,win32con.SWP_NOMOVE|win32con.SWP_NOSIZE|win32con.SWP_NOACTIVATE)
        point=(round(r['x']+r['width']/2),round(r['y']+r['height']/2))
        assert win32gui.GetAncestor(win32gui.WindowFromPoint(point),2)==w['id'],'Owned editor occluded'
        win32api.SetCursorPos(point);win32api.mouse_event(2,0,0);time.sleep(.05);win32api.mouse_event(4,0,0)
        time.sleep(2.1)
    else:
        time.sleep(2.1)
        receipt=perform({'action_id':'focus-editor','snapshot':snap['snapshot'],'kind':'click','focus':'borrow','point':{'x':r['x']+r['width']/2-w['x'],'y':r['y']+r['height']/2-w['y'],'space':'window'}},run,True)
        assert receipt['status']=='executed_unverified',receipt
    snap=observe(w['id'],run,False);session=start(run)
    request={'action_id':'typing-to-stop','snapshot':snap['snapshot'],'kind':'type','focus':'borrow','text':'stop:'+'x'*495}
    results=[]
    def typing():
        try:results.append(perform(request,run,True))
        except Exception as exc:results.append({'error':str(exc)})
    thread=threading.Thread(target=typing);thread.start();until=time.monotonic()+12
    while not signal.exists() and thread.is_alive() and time.monotonic()<until:time.sleep(.005)
    assert signal.exists(),{'message':'No actual input began','result':results}
    if system=='Darwin':
        clicked=json.loads(subprocess.check_output([str(inspector),str(session['pid']),'click'],text=True));report['click']=clicked
    else:
        buttons=[]
        def visit(h,_):
            if win32gui.IsWindowVisible(h) and win32process.GetWindowThreadProcessId(h)[1]==session['pid']:
                x,y,r,b=win32gui.GetWindowRect(h)
                if r-x==64:buttons.append((h,x,y))
        win32gui.EnumWindows(visit,None);assert len(buttons)==1,buttons
        h,x,y=buttons[0];before=win32gui.GetForegroundWindow()
        win32api.SetCursorPos((x+32,y+16));win32api.mouse_event(2,0,0);time.sleep(.03);win32api.mouse_event(4,0,0)
        time.sleep(.15);assert win32gui.GetForegroundWindow()==before
    thread.join(6);assert not thread.is_alive()
    assert marker(run).exists(),'Button did not persist cancellation'
    assert results[0]['status']=='unknown' and results[0]['cancelled'],results
    def value():
        s=backend({'command':'observe','window_id':w['id']})
        return next(e.get('value','') for e in s['elements'] if e.get('automation_id')==selector['automation_id'] and e['role']=='text_field')
    actual=value();assert 0<len(actual)<500,{'length':len(actual),'receipt':results}
    time.sleep(.4);assert value()==actual,'Input continued after cancellation'
    again=perform(request,run,True);assert again['replayed'] and not again['reexecuted']
    report.update(status='passed',characters_before_stop=len(actual),requested_characters=500,no_further_input=True,no_replay=True,receipt=results[0])
except Exception as exc:
    report.update(status='failed',error=str(exc));raise
finally:
    if thread and thread.is_alive():cancel(run);thread.join(6)
    stop(run)
    child.terminate();child.wait(5)
    write_json(run/'stop-input-report.json',report)
