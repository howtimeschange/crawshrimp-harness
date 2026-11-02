import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import pytest

from core import ai_image_service, data_sink
from core.image_providers import CompatibleImageClient, managed_image_request_id


def test_managed_loopback_ignores_proxy_and_reuses_persisted_request_id(monkeypatch):
    calls = []
    class Broker(BaseHTTPRequestHandler):
        def do_POST(self):
            calls.append((self.path, self.headers['X-Request-Id']))
            self.rfile.read(int(self.headers['Content-Length']))
            body = json.dumps({'data': [{'b64_json': 'aW1hZ2U='}]}).encode()
            self.send_response(200); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
        def log_message(self, *args): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Broker)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    monkeypatch.setenv('http_proxy', 'http://127.0.0.1:1')
    monkeypatch.setenv('HTTP_PROXY', 'http://127.0.0.1:1')
    monkeypatch.delenv('no_proxy', raising=False); monkeypatch.delenv('NO_PROXY', raising=False)
    try:
        client = CompatibleImageClient('fixture-token', provider='custom-managed-openai', model='gpt-image-2', base_url=f'http://127.0.0.1:{server.server_port}/v1')
        result = client.create_task({'prompt': 'fixture'}, idempotency_key='persistent-run', timeout=1)
        assert result['status'] == 'completed'
        assert calls == [('/v1/images/generations', managed_image_request_id('persistent-run'))]
    finally:
        server.shutdown(); server.server_close(); thread.join()


def test_managed_redirect_does_not_resubmit_or_forward_credentials():
    calls = []
    class Broker(BaseHTTPRequestHandler):
        def do_POST(self):
            calls.append(self.path)
            self.send_response(307); self.send_header('Location', '/other'); self.end_headers()
        def log_message(self, *args): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Broker)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    try:
        client = CompatibleImageClient('fixture-token', provider='custom-managed-openai', model='gpt-image-2', base_url=f'http://127.0.0.1:{server.server_port}/v1')
        with pytest.raises(Exception, match='无法确认'):
            client.create_task({'prompt': 'fixture'}, idempotency_key='fixture')
        assert calls == ['/v1/images/generations']
    finally:
        server.shutdown(); server.server_close(); thread.join()


@pytest.mark.parametrize('reply', [(200, {}), (200, {'error': 'failed'}), (409, {'error': 'request_already_submitted'}), (503, {'error': 'image_admission_outcome_unknown'}), (503, {'error': 'image_request_not_dispatched'})])
def test_ambiguous_managed_responses_do_not_become_retryable_rejections(reply):
    from core.one_xm_image import OneXMImageError, RejectedOneXMImageError
    client = CompatibleImageClient('fixture-token', provider='custom-managed-openai', model='gpt-image-2', base_url='http://127.0.0.1:12345/v1', transport=lambda *a, **k: reply)
    with pytest.raises(OneXMImageError) as raised:
        client.create_task({'prompt': 'fixture'}, idempotency_key='fixture')
    assert not isinstance(raised.value, RejectedOneXMImageError)


@pytest.mark.parametrize('batch', [False, True])
def test_managed_receipt_is_saved_before_post_and_unknown_is_not_retried(tmp_path, batch):
    session = {'accountId': 'fixture-owner', 'baseURL': 'http://127.0.0.1:12345', 'brokerToken': 'fixture-token'}
    provider = {'id': 'custom-managed-openai', 'name': 'fixture', 'protocol': 'openai', 'base_url': session['baseURL'] + '/v1', 'models': ['gpt-image-2']}
    settings = {'ai.image.custom_providers': [provider], 'ai.image.custom.custom-managed-openai.api_key': session['brokerToken']}
    calls = []
    with patch('core.runtime_paths.data_root', return_value=tmp_path), patch('core.managed_models.session', return_value=session), patch('core.managed_models.image_providers', return_value=[provider]):
        data_sink.init_db()
        job = data_sink.create_ai_image_job({'model_key': 'custom-managed-openai/gpt-image-2', 'prompt': 'fixture', 'params': {'size': '1024x1024'}})
        def transport(*args, **kwargs):
            saved = data_sink.get_ai_image_job(job['job_uid'])['summary']['runs'][-1]
            assert saved['managed_owner_id'] == 'fixture-owner'
            assert saved['managed_request_id'] == kwargs['headers']['X-Request-Id']
            assert kwargs['direct'] is True
            calls.append(saved['managed_request_id'])
            err = TimeoutError('fixture timeout'); err.failure_phase = 'before_headers'; raise err
        with patch('core.image_providers._compatible_transport', side_effect=transport):
            if batch:
                result = ai_image_service.submit_workbench_batch(job['job_uid'], [{'prompt': 'fixture'}], settings=settings)
            else:
                result = ai_image_service.run_job_with_one_xm(job['job_uid'], settings=settings)
        saved = data_sink.get_ai_image_job(job['job_uid'])['summary']['runs'][-1]
        assert len(calls) == 1 and saved['managed_request_id'] == calls[0]
        assert saved['error_code'] == 'UNKNOWN_SUBMIT_RESULT'
        assert saved['failure_phase'] == 'before_headers'
        with pytest.raises(ValueError, match='回执未知'):
            ai_image_service.retry_workbench_run(job['job_uid'], saved['run_uid'], settings=settings)


def test_readback_is_get_only_owner_bound_and_never_treats_absence_as_success(tmp_path, monkeypatch):
    calls = []
    class Broker(BaseHTTPRequestHandler):
        def do_GET(self):
            calls.append(self.path)
            request_id = self.path.rsplit('/', 1)[-1]
            body = json.dumps({'request': {'requestId': request_id, 'state': 'unknown', 'billingRequestId': None}}).encode()
            self.send_response(200); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
        def log_message(self, *args): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Broker)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    session = {'accountId': 'owner', 'baseURL': f'http://127.0.0.1:{server.server_port}', 'brokerToken': 'fixture-token'}
    monkeypatch.setenv('http_proxy', 'http://127.0.0.1:1'); monkeypatch.delenv('no_proxy', raising=False); monkeypatch.delenv('NO_PROXY', raising=False)
    try:
        with patch('core.runtime_paths.data_root', return_value=tmp_path), patch('core.managed_models.session', return_value=session):
            data_sink.init_db()
            job = data_sink.create_ai_image_job({'model_key': 'custom-managed-openai/gpt-image-2'})
            request_id = managed_image_request_id('fixture')
            data_sink.update_ai_image_job(job['job_uid'], {'summary': {'runs': [{'run_uid': 'run', 'managed_owner_id': 'owner', 'managed_request_id': request_id}]}})
            assert ai_image_service.trace_managed_image_request(job['job_uid'], 'run') == {'status': 'found', 'request_id': request_id, 'state': 'unknown', 'billing_request_id': None}
            assert calls == ['/account/requests/' + request_id]
            session['accountId'] = 'another-owner'
            assert ai_image_service.trace_managed_image_request(job['job_uid'], 'run') == {'status': 'account_changed'}
            assert len(calls) == 1
    finally:
        server.shutdown(); server.server_close(); thread.join()


def test_readback_http_route_is_authenticated_and_read_only(monkeypatch):
    from fastapi.testclient import TestClient
    from core import api_server
    monkeypatch.setattr(api_server, '_get_api_token', lambda: 'fixture-local-token')
    with patch.object(ai_image_service, 'trace_managed_image_request', return_value={'status': 'identity_unavailable'}) as trace:
        client = TestClient(api_server.app)  # No lifespan: do not start background workers.
        url = '/ai-image/jobs/job/runs/run/managed-request'
        assert client.get(url).status_code == 401
        response = client.get(url, headers={'x-crawshrimp-token': 'fixture-local-token'})
        assert response.status_code == 200 and response.json() == {'status': 'identity_unavailable'}
        assert client.post(url, headers={'x-crawshrimp-token': 'fixture-local-token'}).status_code == 405
        client.close()
        trace.assert_called_once_with('job', 'run')
