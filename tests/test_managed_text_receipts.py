import json
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from core import llm_gateway, managed_models, managed_text_receipts, runtime_paths


@pytest.fixture
def broker(tmp_path, monkeypatch):
    calls = []
    mode = {'redirect': False, 'drop': False, 'trace_redirect': False}
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers['Content-Length']))
            request_id = self.headers['X-Request-Id']
            # The identity is durable and unknown before the first byte is sent.
            assert managed_text_receipts.list_current()[0]['request_id'] == request_id
            calls.append((self.path, request_id, body))
            if mode.get('post_change'):
                mode['post_change']()
            if mode['drop']:
                self.connection.shutdown(2)
                return
            if mode['redirect']:
                self.send_response(307); self.send_header('Location', '/other'); self.end_headers(); return
            data = b'{"ok":true}'
            self.send_response(200); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
        def do_GET(self):
            request_id = self.path.rsplit('/', 1)[-1]
            calls.append((self.path, request_id, b''))
            if mode['trace_redirect']:
                self.send_response(307); self.send_header('Location', '/other'); self.end_headers(); return
            if mode.get('trace_change'):
                mode['trace_change']()
            data = json.dumps({'request': {'requestId': request_id, 'state': 'completed'}}).encode()
            self.send_response(200); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
        def log_message(self, *args): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    session = {'accountId': 'owner', 'accountServiceOrigin': 'https://service.example', 'desktopRuntimeEpoch': 'desktop-1', 'accountSessionEpoch': 'session-1', 'baseURL': f'http://127.0.0.1:{server.server_port}', 'brokerToken': 'test-token'}
    monkeypatch.setattr(runtime_paths, 'data_root', lambda: tmp_path)
    monkeypatch.setattr(managed_models, 'session', lambda: session.copy())
    monkeypatch.setenv('http_proxy', 'http://127.0.0.1:1')
    monkeypatch.setenv('HTTP_PROXY', 'http://127.0.0.1:1')
    monkeypatch.delenv('no_proxy', raising=False); monkeypatch.delenv('NO_PROXY', raising=False)
    yield session, mode, calls
    server.shutdown(); server.server_close(); thread.join()


@pytest.mark.parametrize('total_timeout', [None, 5])
def test_managed_direct_transport_and_durable_identity(broker, total_timeout, tmp_path):
    session, mode, calls = broker
    result = llm_gateway._post_json(session['baseURL'] + '/v1/responses', {'model': 'managed-test', 'prompt': 'secret prompt'}, {'Authorization': 'Bearer test-token'}, total_timeout=total_timeout)
    assert result == {'ok': True}
    rows = managed_text_receipts.list_current()
    assert rows[0]['request_id'] == calls[0][1]
    assert rows[0]['state'] == 'completed'
    assert managed_text_receipts.trace(calls[0][1])['state'] == 'completed'
    assert len(calls) == 2
    stored = (tmp_path / 'managed-text-receipts.sqlite3').read_bytes()
    assert b'secret prompt' not in stored and b'test-token' not in stored
    session['accountServiceOrigin'] = 'https://other.example'
    assert managed_text_receipts.list_current() == []
    assert managed_text_receipts.trace(calls[0][1])['status'] == 'account_changed'
    session['accountServiceOrigin'] = 'https://service.example'
    session['accountId'] = 'other'
    assert managed_text_receipts.list_current() == []
    assert managed_text_receipts.trace(calls[0][1])['status'] == 'account_changed'
    assert len(calls) == 2


def test_trace_rejects_redirect_without_following(broker):
    session, mode, calls = broker
    request_id = managed_text_receipts.create(session['accountId'], session['accountServiceOrigin'], 'managed-test')
    mode['trace_redirect'] = True
    assert managed_text_receipts.trace(request_id)['status'] == 'unavailable'
    assert [call[0] for call in calls] == ['/account/requests/' + request_id]


@pytest.mark.parametrize('field', ['accountId', 'accountServiceOrigin', 'desktopRuntimeEpoch', 'accountSessionEpoch', 'brokerToken', 'baseURL'])
def test_success_response_is_not_delivered_after_session_change(broker, field):
    session, mode, calls = broker
    original = session.copy()
    mode['post_change'] = lambda: session.update({field: 'changed'})
    with pytest.raises(llm_gateway.LlmUnknownSubmissionError):
        llm_gateway._post_json(original['baseURL'] + '/v1/responses', {'model': 'managed-test'}, {'Authorization': 'Bearer test-token'})
    session.update(original)
    assert managed_text_receipts.list_current()[0]['state'] == 'unknown'
    assert len(calls) == 1


def test_all_unknown_receipts_can_be_paginated(broker):
    session, _, _ = broker
    for _ in range(105):
        managed_text_receipts.create(session['accountId'], session['accountServiceOrigin'], 'managed-test')
    first = managed_text_receipts.list_current(limit=100)
    second = managed_text_receipts.list_current(offset=100, limit=100)
    assert len(first) == 100 and len(second) == 5
    assert len({row['request_id'] for row in first + second}) == 105


@pytest.mark.parametrize('field', ['accountServiceOrigin', 'desktopRuntimeEpoch', 'accountSessionEpoch'])
def test_trace_discards_response_after_session_identity_changes(broker, field):
    session, mode, _ = broker
    request_id = managed_text_receipts.create(session['accountId'], session['accountServiceOrigin'], 'managed-test')
    mode['trace_change'] = lambda: session.update({field: 'changed'})
    assert managed_text_receipts.trace(request_id)['status'] == 'account_changed'


def test_list_discards_rows_after_account_switch(broker, monkeypatch):
    session, _, _ = broker
    managed_text_receipts.create(session['accountId'], session['accountServiceOrigin'], 'managed-test')
    snapshots = iter((session.copy(), {**session, 'accountSessionEpoch': 'next'}))
    monkeypatch.setattr(managed_models, 'session', lambda: next(snapshots))
    assert managed_text_receipts.list_current() == []


@pytest.mark.parametrize('total_timeout', [None, 5])
def test_redirect_and_disconnect_preserve_unknown_and_never_resubmit(broker, total_timeout):
    session, mode, calls = broker
    for failure in ('redirect', 'drop'):
        mode[failure] = True
        with pytest.raises(llm_gateway.LlmGatewayError, match='请求编号') as exc:
            llm_gateway._post_json(session['baseURL'] + '/v1/responses', {'model': 'managed-test'}, {'Authorization': 'Bearer test-token'}, total_timeout=total_timeout)
        request_id = calls[-1][1]
        assert request_id in str(exc.value)
        assert managed_text_receipts.list_current()[0]['state'] == 'unknown'
        assert calls[-1][0] == '/v1/responses'
        mode[failure] = False
    assert len(calls) == 2


def test_receipt_failure_prevents_dispatch(broker, monkeypatch):
    session, _, calls = broker
    def fail(*args): raise OSError('disk unavailable')
    monkeypatch.setattr(managed_text_receipts, 'create', fail)
    with pytest.raises(llm_gateway.LlmGatewayError, match='请求未发送'):
        llm_gateway._post_json(session['baseURL'] + '/v1/responses', {'model': 'managed-test'}, {'Authorization': 'Bearer test-token'})
    assert calls == []


def test_missing_issuer_and_acl_failure_prevent_dispatch(broker, monkeypatch):
    session, _, calls = broker
    session.pop('accountServiceOrigin')
    with pytest.raises(llm_gateway.LlmConfigurationError):
        llm_gateway._post_json(session['baseURL'] + '/v1/responses', {'model': 'managed-test'}, {'Authorization': 'Bearer test-token'})
    session['accountServiceOrigin'] = 'https://service.example'
    def fail(*args, **kwargs): raise PermissionError('ACL unavailable')
    monkeypatch.setattr(managed_text_receipts, 'harden_windows_path', fail)
    with pytest.raises(llm_gateway.LlmGatewayError, match='请求未发送'):
        llm_gateway._post_json(session['baseURL'] + '/v1/responses', {'model': 'managed-test'}, {'Authorization': 'Bearer test-token'})
    assert calls == []


def test_legacy_receipts_without_issuer_are_preserved_but_not_exposed(broker, tmp_path):
    session, _, _ = broker
    old_id = '10000000-0000-4000-8000-000000000000'
    path = tmp_path / 'managed-text-receipts.sqlite3'
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE receipts (request_id TEXT PRIMARY KEY, owner TEXT NOT NULL, model TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
        db.execute('INSERT INTO receipts (request_id, owner, model, state) VALUES (?, ?, ?, ?)', (old_id, session['accountId'], 'old', 'unknown'))
    assert managed_text_receipts.list_current() == []
    assert managed_text_receipts.trace(old_id)['status'] == 'identity_unavailable'
    managed_text_receipts.create(session['accountId'], session['accountServiceOrigin'], 'new')
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT issuer FROM receipts WHERE request_id=?', (old_id,)).fetchone() == (None,)
    assert managed_text_receipts.trace(old_id)['status'] == 'account_changed'


def test_missing_managed_default_never_switches_to_byok(monkeypatch):
    monkeypatch.setattr(managed_models, 'session', lambda: None)
    config = {'ai': {'llm': {'default_model': 'managed-test', 'default_provider': 'crawshrimp-managed-openai', 'custom_providers': [{'id': 'byok', 'name': 'BYOK', 'base_url': 'https://example.invalid', 'api_key': 'test', 'models': ['other']}]}}}
    with pytest.raises(llm_gateway.LlmConfigurationError, match='官方默认模型当前不可用'):
        llm_gateway.route_for_model('', config)
