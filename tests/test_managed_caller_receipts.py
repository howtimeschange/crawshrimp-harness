"""Exercise the real DSH journal writer through the desktop receipt reader."""
import hashlib
import json
import os
import shutil
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from core import managed_caller_receipts, managed_models, managed_text_receipts, runtime_paths

WRITER = Path(__file__).resolve().parents[1] / 'integrations/deepseek-harness/scripts/managed-caller-trace.mjs'
UUID = '10000000-0000-4000-8000-000000000001'


@pytest.fixture
def journal(tmp_path, monkeypatch):
    calls = []
    behavior = {}
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            calls.append((self.command, self.path, self.headers.get('Authorization')))
            if behavior.get('change'):
                behavior['change']()
            if behavior.get('redirect'):
                self.send_response(307)
                self.send_header('Location', '/other')
                self.end_headers()
                return
            request_id = self.path.rsplit('/', 1)[-1]
            result = behavior.get('result', {'requestId': request_id, 'state': 'completed'})
            raw = json.dumps({'request': result}).encode()
            self.send_response(200)
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    session = {
        'version': 1, 'callerRequestIdentity': 'managed-text-preserved-v1',
        'accountId': 'newapi:synthetic', 'accountServiceOrigin': 'https://account.example',
        'baseURL': f'http://127.0.0.1:{server.server_port}',
        'brokerToken': 'synthetic-token-with-more-than-32-characters',
        'desktopRuntimeEpoch': 'desktop-fixture', 'accountSessionEpoch': 'account-fixture',
    }
    def save():
        path = tmp_path / 'managed-model-session.json'
        path.write_text(json.dumps(session))
        path.chmod(0o600)
    save()
    monkeypatch.setattr(runtime_paths, 'data_root', lambda: tmp_path)
    monkeypatch.setenv('CRAWSHRIMP_DATA', str(tmp_path))
    monkeypatch.setenv('CRAWSHRIMP_ACCOUNT_RUNTIME_EPOCH', session['desktopRuntimeEpoch'])
    yield tmp_path, session, save, calls, behavior
    server.shutdown()
    server.server_close()
    thread.join()


def write_receipt(root, session, *, request_id=UUID, created='2026-10-31T10:00:00.000Z'):
    # Fixtures below exercise corrupt/legacy inputs separately from the real writer.
    owner = hashlib.sha256((session['accountServiceOrigin'] + '\0' + session['accountId']).encode()).hexdigest()
    directory = root / 'managed-caller-receipts' / owner
    directory.mkdir(parents=True, exist_ok=True)
    operation = hashlib.sha256(request_id.encode()).hexdigest()
    row = {'version': 1, 'ownerNamespace': owner, 'operationTag': operation,
           'callerRequestId': request_id, 'managedRequestId': request_id,
           'bodySHA256': 'a' * 64, 'modelId': 'managed-test',
           'provider': 'crawshrimp-managed-openai', 'state': 'dispatch_unknown', 'createdAt': created}
    path = directory / (operation + '.json')
    path.write_text(json.dumps(row))
    path.chmod(0o600)
    return path


@pytest.mark.parametrize('provider,endpoint', [
    ('crawshrimp-managed-openai', '/v1/chat/completions'),
    ('crawshrimp-managed-openai-responses', '/v1/responses'),
])
@pytest.mark.parametrize('mode', ['disconnect', 'headers'])
def test_real_dsh_writer_lists_and_traces_original_id(journal, provider, endpoint, mode):
    root, session, _, calls, _ = journal
    node = shutil.which('node')
    assert node, 'Node is required to verify the actual DSH writer contract'
    script = """
        import fs from 'node:fs';
        import { pathToFileURL } from 'node:url';
        const {createManagedCallerFetch,listManagedCallerReceipts} = await import(pathToFileURL(process.argv[1]));
        const [provider,endpoint,mode] = process.argv.slice(2);
        const session = JSON.parse(fs.readFileSync(process.env.CRAWSHRIMP_DATA+'/managed-model-session.json'));
        let attempts=0;
        const make=()=>createManagedCallerFetch({provider,modelId:'managed-fixture',baseURL:session.baseURL+'/v1',
            apiKey:session.brokerToken,sessionId:'fixture-session',messages:[{role:'user',id:'fixture-message'}],
            fetcher:async(request)=>{attempts++;if(mode==='disconnect')throw new TypeError('synthetic lost response');
                return new Response('{}',{headers:{'X-Request-Id':request.headers.get('X-Request-Id')}})}});
        const request=()=>new Request(session.baseURL+endpoint,{method:'POST',body:'{"model":"fixture"}'});
        try{await make()(request())}catch(error){if(mode!=='disconnect')throw error}
        try{await make()(request());throw new Error('replay was accepted')}catch(error){if(error.code!=='managed_trace_no_replay')throw error}
        const rows=listManagedCallerReceipts();
        process.stdout.write(JSON.stringify({attempts,id:rows[0].callerRequestId,state:rows[0].state}));
    """
    run = subprocess.run([node, '--input-type=module', '-e', script, str(WRITER), provider, endpoint, mode],
                         check=True, capture_output=True, text=True, timeout=20)
    written = json.loads(run.stdout)
    assert written['attempts'] == 1
    assert not (root / 'managed-text-receipts.sqlite3').exists()
    rows = managed_text_receipts.list_current()
    assert len(rows) == 1 and rows[0]['request_id'] == written['id']
    assert rows[0]['model'] == 'managed-fixture'
    assert rows[0]['state'] == 'unknown'  # Even headers_received is not a completed response.
    assert calls == []
    result = managed_text_receipts.trace(written['id'])
    assert result == {'status': 'found', 'request_id': written['id'], 'state': 'completed', 'billing_request_id': None}
    assert calls == [('GET', '/account/requests/' + written['id'], 'Bearer ' + session['brokerToken'])]
    assert not (root / 'managed-text-receipts.sqlite3').exists(), 'Readback must not create another ledger'
    assert managed_text_receipts.list_current()[0]['state'] == 'unknown', 'Ledger readback does not rewrite local evidence'


def test_mixed_sources_paginate_unknown_before_completed(journal):
    root, session, _, calls, _ = journal
    sql_ids = [managed_text_receipts.create(session['accountId'], session['accountServiceOrigin'], 'python') for _ in range(105)]
    managed_text_receipts.complete(sql_ids[0])
    json_ids = [f'20000000-0000-4000-8000-{i:012d}' for i in range(6)]
    for request_id in json_ids:
        write_receipt(root, session, request_id=request_id)
    first = managed_text_receipts.list_current(limit=100)
    second = managed_text_receipts.list_current(offset=100, limit=100)
    assert len(first) == 100 and len(second) == 11
    assert {row['request_id'] for row in first + second} == set(sql_ids + json_ids)
    assert all(row['state'] == 'unknown' for row in (first + second)[:-1])
    assert second[-1]['request_id'] == sql_ids[0]
    assert calls == []


@pytest.mark.parametrize('field,value', [('accountId', 'newapi:other'), ('accountServiceOrigin', 'https://other.example')])
def test_receipts_are_not_visible_to_other_account_or_issuer(journal, field, value):
    root, session, save, calls, _ = journal
    write_receipt(root, session)
    session[field] = value
    save()
    assert managed_text_receipts.list_current() == []
    assert managed_text_receipts.trace(UUID)['status'] == 'identity_unavailable'
    assert calls == []


def test_same_account_can_trace_after_relogin(journal):
    root, session, save, calls, _ = journal
    write_receipt(root, session)
    session.update(accountSessionEpoch='new-login', brokerToken='new-synthetic-token-with-more-than-32-characters')
    save()
    assert managed_text_receipts.trace(UUID)['status'] == 'found'
    assert calls[0][2] == 'Bearer ' + session['brokerToken']


@pytest.mark.parametrize('phase', ['list', 'before_trace', 'after_trace'])
def test_account_change_discards_local_or_remote_result(journal, monkeypatch, phase):
    root, session, save, calls, behavior = journal
    write_receipt(root, session)
    def switch():
        session['accountSessionEpoch'] = 'changed'
        save()
    if phase == 'after_trace':
        behavior['change'] = switch
    else:
        original = managed_caller_receipts.list_current
        def changed(current):
            result = original(current)
            switch()
            return result
        monkeypatch.setattr(managed_caller_receipts, 'list_current', changed)
    if phase == 'list':
        assert managed_text_receipts.list_current() == []
    else:
        assert managed_text_receipts.trace(UUID)['status'] == 'account_changed'
    assert len(calls) == (1 if phase == 'after_trace' else 0)


@pytest.mark.parametrize('failure', ['redirect', 'wrong_id', 'not_found'])
def test_readback_never_follows_redirect_or_invents_outcome(journal, failure):
    root, session, _, calls, behavior = journal
    write_receipt(root, session)
    if failure == 'redirect':
        behavior['redirect'] = True
    else:
        behavior['result'] = None if failure == 'not_found' else {'requestId': 'wrong-id', 'state': 'completed'}
    result = managed_text_receipts.trace(UUID)
    assert result['status'] == ('not_found' if failure == 'not_found' else 'unavailable')
    assert [call[:2] for call in calls] == [('GET', '/account/requests/' + UUID)]


@pytest.mark.parametrize('corruption', ['owner', 'filename', 'identity', 'version', 'state', 'date', 'oversize', 'symlink_file', 'symlink_directory', 'permissions'])
def test_invalid_journal_fails_closed(journal, corruption):
    root, session, _, calls, _ = journal
    path = write_receipt(root, session)
    row = json.loads(path.read_text())
    if corruption == 'symlink_file':
        target = root / 'elsewhere.json'
        path.rename(target)
        path.symlink_to(target)
    elif corruption == 'symlink_directory':
        directory = path.parent
        target = root / 'elsewhere'
        directory.rename(target)
        directory.symlink_to(target, target_is_directory=True)
    elif corruption == 'permissions':
        if os.name == 'nt':
            pytest.skip('POSIX mode check; Windows uses ACL and reparse checks')
        path.chmod(0o644)
    else:
        field, value = {
            'owner': ('ownerNamespace', '0' * 64), 'filename': ('operationTag', '0' * 64),
            'identity': ('managedRequestId', 'wrong'), 'version': ('version', 2),
            'state': ('state', 'completed'), 'date': ('createdAt', 'invalid'),
            'oversize': ('extra', 'x' * 20000),
        }[corruption]
        row[field] = value
        path.write_text(json.dumps(row))
    with pytest.raises((OSError, ValueError)):
        managed_text_receipts.list_current()
    assert managed_text_receipts.trace(UUID)['status'] == 'unavailable'
    assert calls == []


def test_issuer_namespace_matches_javascript_origin(journal):
    root, session, save, _, _ = journal
    write_receipt(root, session)
    session['accountServiceOrigin'] = 'https://ACCOUNT.example:443/'
    save()
    assert managed_text_receipts.list_current()[0]['request_id'] == UUID
