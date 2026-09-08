import threading
import urllib.request
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from core.cloud_approval_client import CloudApprovalClient, CloudApprovalError, _CloudRedirectHandler


@contextmanager
def server():
    seen, redirects = [], {}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            seen.append((self.path, self.headers.get("Authorization")))
            target = redirects.get(self.path)
            self.send_response(302 if target else 200)
            if target:
                self.send_header("Location", target)
            self.end_headers()
            self.wfile.write(b'{}')

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_port}", seen, redirects
    finally:
        httpd.shutdown()
        thread.join(timeout=2)
        httpd.server_close()


@pytest.mark.parametrize("token_type", ["machine", "user"])
def test_cloud_api_rejects_cross_origin_redirect_before_target_receives_token(token_type):
    with server() as (base, source, redirects), server() as (other, destination, _):
        redirects['/api/example'] = other + '/target'
        client = CloudApprovalClient(base, machine_token='fake-machine', user_token='fake-user')
        with pytest.raises(CloudApprovalError, match='Unsafe cloud redirect'):
            client.request_json('GET', '/api/example', token_type=token_type)
        assert source == [('/api/example', 'Bearer fake-' + token_type)]
        assert destination == []


def test_same_origin_api_redirect_preserves_auth():
    with server() as (base, seen, redirects):
        redirects['/api/source'] = base + '/api/target'
        assert CloudApprovalClient(base, machine_token='fake').request_json('GET', '/api/source') == {}
        assert seen == [('/api/source', 'Bearer fake'), ('/api/target', 'Bearer fake')]


def test_download_strips_token_on_cross_origin_and_never_restores_it_on_later_hop(tmp_path):
    with server() as (base, source, redirects), server() as (other, destination, redirects2):
        redirects['/api/assets/example/download'] = other + '/cdn'
        redirects2['/cdn'] = base + '/return'
        target = tmp_path / 'asset.json'
        CloudApprovalClient(base, machine_token='fake').download_asset('example', target)
        assert target.read_bytes() == b'{}'
        assert destination == [('/cdn', None)]
        assert source[-1] == ('/return', None)


@pytest.mark.parametrize('target', ['http://secure.test/file', 'ftp://secure.test/file'])
def test_download_redirect_cannot_downgrade_https_or_change_protocol(target):
    request = urllib.request.Request('https://secure.test/source', headers={'Authorization': 'Bearer fake'})
    request._cloud_asset_download = True
    with pytest.raises(CloudApprovalError, match='Unsafe cloud redirect'):
        _CloudRedirectHandler().redirect_request(request, None, 302, 'Found', {}, target)
