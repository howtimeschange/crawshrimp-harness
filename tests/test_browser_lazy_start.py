import io
from unittest.mock import patch

import pytest
from core.cdp_bridge import CDPBridge

LAUNCH_ENV = {
    'CRAWSHRIMP_BROWSER_LAUNCH_URL': 'http://127.0.0.1:19191/ensure',
    'CRAWSHRIMP_BROWSER_LAUNCH_TOKEN': 'test-private-token',
}


def test_health_and_listing_never_launch_browser():
    bridge = CDPBridge()
    with patch.dict('os.environ', LAUNCH_ENV), patch.object(bridge, '_request_json', side_effect=ConnectionError), patch('core.cdp_bridge.cdp_urlopen') as request:
        assert bridge.is_available(timeout=.2) is False
        with pytest.raises(ConnectionError):
            bridge.get_tabs()
        request.assert_not_called()


def test_first_new_page_starts_browser_before_creating_page():
    bridge = CDPBridge()
    with patch.dict('os.environ', LAUNCH_ENV), patch.object(bridge, 'is_available', side_effect=[False, True, True]), patch('core.cdp_bridge.cdp_urlopen', return_value=io.BytesIO(b'{"ok":true}')) as launch, patch.object(bridge, '_request_json', return_value={'id': 'new-page'}) as create:
        assert bridge.new_tab('https://example.com')['id'] == 'new-page'
        assert launch.call_count == 1
        request = launch.call_args.args[0]
        assert request.method == 'POST'
        assert request.get_header('X-crawshrimp-browser-token') == 'test-private-token'
        assert create.call_count == 1


def test_existing_browser_is_reused_without_launch():
    bridge = CDPBridge()
    with patch.dict('os.environ', LAUNCH_ENV), patch.object(bridge, 'is_available', return_value=True), patch('core.cdp_bridge.cdp_urlopen') as launch:
        bridge.ensure_available()
        launch.assert_not_called()


def test_failed_start_does_not_attempt_or_repeat_page_creation():
    bridge = CDPBridge()
    with patch.dict('os.environ', LAUNCH_ENV), patch.object(bridge, 'is_available', return_value=False), patch('core.cdp_bridge.cdp_urlopen', return_value=io.BytesIO(b'{"ok":false,"message":"Chrome missing"}')), patch.object(bridge, '_request_json') as create:
        with pytest.raises(ConnectionError, match='Chrome missing'):
            bridge.new_tab('https://example.com')
        create.assert_not_called()


def test_remote_launch_channel_is_rejected():
    bridge = CDPBridge()
    with patch.dict('os.environ', {**LAUNCH_ENV, 'CRAWSHRIMP_BROWSER_LAUNCH_URL':'https://example.com/ensure'}), patch.object(bridge, 'is_available', return_value=False), patch('core.cdp_bridge.cdp_urlopen') as launch:
        with pytest.raises(ConnectionError, match='本机'):
            bridge.ensure_available()
        launch.assert_not_called()


def test_launch_waits_for_consecutive_cdp_responses():
    bridge = CDPBridge()
    with patch.dict('os.environ', LAUNCH_ENV), patch.object(bridge, 'is_available', side_effect=[False, True, False, True, True]) as probe, patch('core.cdp_bridge.cdp_urlopen', return_value=io.BytesIO(b'{"ok":true}')) as launch, patch('core.cdp_bridge.time.sleep'):
        bridge.ensure_available()
        assert launch.call_count == 1
        assert probe.call_count == 5


def test_launch_readiness_timeout_never_creates_page():
    bridge = CDPBridge()
    with patch.dict('os.environ', LAUNCH_ENV), patch.object(bridge, 'is_available', return_value=False), patch('core.cdp_bridge.cdp_urlopen', return_value=io.BytesIO(b'{"ok":true}')), patch('core.cdp_bridge.time.monotonic', side_effect=[0, 11]), patch.object(bridge, '_request_json') as create:
        with pytest.raises(ConnectionError, match='未稳定就绪'):
            bridge.new_tab('https://example.test')
        create.assert_not_called()


@pytest.mark.parametrize('mode', ['new', 'current'])
@pytest.mark.parametrize('launch_fails', [False, True])
def test_script_entry_ensures_browser_before_tab_selection(monkeypatch, tmp_path, mode, launch_fails):
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import Mock
    from core import api_server
    task = SimpleNamespace(id='review_task', name='Fixture', entry_url='https://example.test/', tab_match_prefixes=[], params=[SimpleNamespace(id='mode', default=mode)])
    adapter = SimpleNamespace(id='review_fixture', name='Fixture', entry_url=task.entry_url, tab_match_prefixes=[], tasks=[task])
    monkeypatch.setattr(api_server.adapter_loader, 'scan_all', lambda: None)
    monkeypatch.setattr(api_server.adapter_loader, 'get_adapter', lambda _: adapter)
    for name in ['begin_run', 'heartbeat_run', 'fail_run']:
        monkeypatch.setattr(api_server.data_sink, name, Mock(return_value=1))
    monkeypatch.setattr(api_server.data_sink, 'prepare_artifact_dir', lambda *a: str(tmp_path))
    calls = []
    def ensure():
        calls.append('ready')
        if launch_fails:
            raise ConnectionError('launch failed')
    def list_tabs():
        calls.append('list')
        # Stop before navigating or executing any business script.
        raise ConnectionError('tab selection reached')
    bridge = SimpleNamespace(ensure_available=ensure, get_tabs=list_tabs)
    monkeypatch.setattr(api_server, 'get_bridge', lambda: bridge)
    runner = Mock()
    monkeypatch.setattr('core.js_runner.JSRunner', runner)
    with pytest.raises(ConnectionError, match='launch failed' if launch_fails else 'tab selection reached'):
        asyncio.run(api_server._execute_task(adapter.id, task.id, {'mode': mode}))
    assert calls == (['ready'] if launch_fails else ['ready', 'list'])
    runner.assert_not_called()
