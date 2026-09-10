"""Live UIA regression on an exclusively owned Notepad process and test document."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'scripts'))
from computer_use import backend, observe, perform
from cu.common import write_json
from cu.feedback_session import stop

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out', required=True)
args = parser.parse_args()
if sys.platform != 'win32':
    parser.error('Windows only')
import psutil
import win32gui

sys.stdout.reconfigure(encoding='utf-8')
run = Path(args.out).resolve()
run.mkdir(parents=True, exist_ok=False)
name = 'crawshrimp-uia-' + uuid.uuid4().hex
path = run / (name + '.txt')
path.write_text('Owned local UIA test', encoding='utf-8')
existing = [p.pid for p in psutil.process_iter(['name']) if (p.info['name'] or '').lower() == 'notepad.exe']
if existing:
    raise RuntimeError('Notepad already running; this test requires an isolated process')
report = {'application': 'Notepad', 'checks': [], 'owned_document': str(path)}
anchor = None
owned = None
try:
    subprocess.Popen([str(Path(os.environ['WINDIR']) / 'System32/notepad.exe'), str(path)])
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        found = [w for w in backend({'command': 'windows', 'app': name})['windows'] if name in w['title']]
        if len(found) == 1:
            window = found[0]
            owned = psutil.Process(window['pid'])
            assert owned.name().lower() == 'notepad.exe', window
            break
        time.sleep(.3)
    else:
        raise RuntimeError('Owned Notepad document did not appear')
    anchor = subprocess.Popen([sys.executable, str(root / 'tests/windows_fixture.py'), '--anchor'])
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        anchors = [w for w in backend({'command': 'windows', 'app': 'Crawshrimp CU Focus Anchor'})['windows'] if w['pid'] == anchor.pid]
        if len(anchors) == 1:
            anchor_window = anchors[0]
            break
        time.sleep(.2)
    else:
        raise RuntimeError('Focus anchor not found')
    from cu.focus_windows import activate
    assert activate(anchor_window['id']), 'Windows refused owned focus anchor activation'
    time.sleep(.3)
    assert backend({'command': 'observe', 'window_id': anchor_window['id']})['foreground']
    snap = observe(window['id'], run)
    edits = [e for e in snap['elements'] if e['role'] in {'text_field', 'text_area'} and 'set_value' in e['actions']]
    assert len(edits) == 1, edits
    value = 'Notepad UIA 中文 🦐\r\nBackground readback.'
    # RichEdit's UIA Value exposes paragraph separators as CR, even when the
    # input uses CRLF. Keep the protocol's exact comparison; specify the native
    # expected representation for this observed control only.
    expected = value.replace('\r\n', '\r') if edits[0].get('class_name') == 'RichEditD2DPT' else value
    selector = {'role': edits[0]['role']}
    if edits[0].get('automation_id'):
        selector['automation_id'] = edits[0]['automation_id']
    # A text area's accessible name may be its current text, and changes on write.
    from cu.common import select
    select(snap['elements'], selector)
    request = {'action_id': 'notepad-background-value', 'snapshot': snap['snapshot'], 'kind': 'set_value',
               'ref': edits[0]['ref'], 'text': value,
               'expect': {'selector': selector, 'property': 'value', 'equals': expected}}
    result = perform(request, run, True)
    report['receipt'] = result
    assert result['status'] == 'verified_control', result
    assert backend({'command': 'observe', 'window_id': anchor_window['id']})['foreground']
    assert perform(request, run, True)['replayed']
    final = observe(window['id'], run)
    assert select(final['elements'], selector)['value'].splitlines() == value.splitlines()
    assert final['image']['available'] and not final['image'].get('possibly_blank')
    report.update(status='passed', image=final['image']['path'], checks=[
        'real_notepad_UIA_unicode_multiline_readback', 'other_process_foreground_preserved',
        'resident_feedback', 'duplicate_not_dispatched', 'window_screenshot_nonblank'])
except Exception as exc:
    report.update(status='failed', error=str(exc))
    raise
finally:
    try:
        report['feedback_shutdown'] = stop(run)
        assert report['feedback_shutdown'].get('status') in {'stopped', 'not_started'}
    except Exception as exc:
        report.update(status='failed', cleanup_error=str(exc))
    if anchor is not None:
        anchor.terminate()
        anchor.wait(timeout=5)
    if owned is not None and owned.is_running():
        # No Notepad existed before this test; only this identified process is owned.
        owned.terminate()
        owned.wait(timeout=5)
    write_json(run / 'notepad-report.json', report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
if report['status'] != 'passed':
    raise SystemExit(1)
