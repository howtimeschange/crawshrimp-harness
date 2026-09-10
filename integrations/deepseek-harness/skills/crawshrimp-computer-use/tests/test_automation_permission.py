import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from cu.automation import request_permission


def test_authorized_task_does_not_request(tmp_path):
    result = request_permission('com.apple.TextEdit', 'read draft', tmp_path,
                                lambda _: {'status': 'authorized'},
                                lambda _: (_ for _ in ()).throw(AssertionError('must not request')))
    assert result['request_attempted'] is False


def test_host_authorized_but_task_restricted_is_not_another_tcc_request(tmp_path):
    calls = []
    backend = lambda _: {'status': 'denied_or_restricted'}
    def send(payload):
        calls.append(payload)
        return {'status': 'authorized'}
    result = request_permission('com.apple.TextEdit', 'read draft', tmp_path, backend, send)
    assert result['status'] == 'execution_context_restricted'
    assert request_permission('com.apple.TextEdit', 'read draft', tmp_path, backend, send)['replayed']
    assert len(calls) == 1


def test_unknown_request_cannot_be_repeated(tmp_path):
    import pytest
    def timeout(_): raise TimeoutError('unknown consent result')
    backend = lambda _: {'status': 'not_determined'}
    with pytest.raises(TimeoutError):
        request_permission('com.apple.TextEdit', 'read draft', tmp_path, backend, timeout)
    result = request_permission('com.apple.TextEdit', 'read draft', tmp_path, backend, timeout)
    assert result['status'] == 'unknown' and result['replayed']
