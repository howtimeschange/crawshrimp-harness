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
    with patch.dict('os.environ', LAUNCH_ENV), patch.object(bridge, 'is_available', side_effect=[False, True]), patch('core.cdp_bridge.cdp_urlopen', return_value=io.BytesIO(b'{"ok":true}')) as launch, patch.object(bridge, '_request_json', return_value={'id': 'new-page'}) as create:
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
