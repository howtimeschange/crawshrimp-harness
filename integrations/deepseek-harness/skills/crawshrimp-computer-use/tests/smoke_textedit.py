"""macOS live AX smoke on a unique task-owned TextEdit file, with background readback."""
import argparse,json,subprocess,sys,time,uuid
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'scripts'))
from computer_use import backend,observe,perform
from cu.common import write_json
from cu.feedback_session import stop
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--out',required=True);a=p.parse_args();run=Path(a.out).resolve();run.mkdir(parents=True,exist_ok=True)
name='crawshrimp-ax-'+uuid.uuid4().hex+'.txt';draft=run/name;draft.write_text('Task-owned local AX test',encoding='utf-8')
fixture=run/'textedit-focus-anchor';subprocess.run(['swiftc',str(root/'tests/mac_fixture.swift'),'-o',str(fixture)],check=True)
anchor=None;report={'application':'TextEdit','checks':[]}
try:
    subprocess.run(['open','-a','TextEdit',str(draft)],check=True)
    deadline=time.monotonic()+15
    while True:
        windows=[w for w in backend({'command':'windows','app':name})['windows'] if w['title']==name]
        if len(windows)==1:window=windows[0];break
        if time.monotonic()>deadline:raise RuntimeError('Owned TextEdit document did not appear')
        time.sleep(.2)
    anchor=subprocess.Popen([str(fixture),'--anchor']);time.sleep(1)
    anchor_window=next(w for w in backend({'command':'windows','app':'Crawshrimp CU Focus Anchor'})['windows'] if w['pid']==anchor.pid)
    subprocess.run(['osascript','-e','tell application "System Events" to set frontmost of (first application process whose unix id is %d) to true'%anchor.pid],check=True,timeout=5)
    time.sleep(.3)
    assert backend({'command':'observe','window_id':anchor_window['id']})['foreground']
    snap=observe(window['id'],run);editable=[e for e in snap['elements'] if 'set_value' in e['actions'] and e['role']=='text_area']
    assert len(editable)==1,editable
    value='TextEdit 后台 AX 验收 🦐\n保留用户当前窗口焦点。'
    selector=editable[0]['selector'];request={'action_id':'textedit-background-value','snapshot':snap['snapshot'],'kind':'set_value','ref':editable[0]['ref'],'text':value,'expect':{'selector':selector,'property':'value','equals':value}}
    result=perform(request,run,True);report['receipt']=result;assert result['status']=='verified_control',result
    assert backend({'command':'observe','window_id':anchor_window['id']})['foreground'],'TextEdit action changed foreground'
    assert perform(request,run,True)['replayed']
    final=observe(window['id'],run);report.update(status='passed',image=final['image']['path'],checks=['real_textedit_AX_unicode_multiline_readback','other_process_foreground_preserved','resident_visual_feedback','duplicate_not_dispatched'])
except Exception as e:report.update(status='failed',error=str(e));raise
finally:
    try:report['feedback_shutdown']=stop(run)
    finally:
        if anchor is not None:anchor.terminate();anchor.wait(timeout=5)
        # Only this unique task-owned document; no global close/quit or save.
        report['owned_document']=str(draft)
        report['cleanup']='Close only this uniquely named test document after reviewing its evidence.'
        write_json(run/'textedit-report.json',report);print(json.dumps(report,ensure_ascii=False,indent=2))
