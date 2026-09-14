"""Submission failures must not silently wait or duplicate paid requests."""
import importlib.util
from pathlib import Path
import urllib.error
import pytest


def helper():
    path = Path(__file__).resolve().parents[1] / 'integrations/deepseek-harness/skills/image-generation/scripts/generate.py'
    spec = importlib.util.spec_from_file_location('image_skill_test', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_definitive_rejection_exits_without_polling(monkeypatch):
    module = helper()
    calls = []
    def request(method, route, payload=None):
        calls.append((method, route))
        if route == '/ai-image/jobs':
            return {'job_uid': 'rejected-job'}
        raise urllib.error.HTTPError('http://localhost', 400, 'missing key', {}, None)
    monkeypatch.setattr(module, 'request', request)
    with pytest.raises(RuntimeError, match='HTTP 400.*rejected-job'):
        module.generate('test', 'gpt-image-2')
    assert len(calls) == 2


def test_lost_submission_response_reads_same_job_without_resubmitting(monkeypatch, tmp_path):
    module = helper()
    image = tmp_path / 'image.png'
    image.write_bytes(b'completed artifact')
    calls = []
    def request(method, route, payload=None):
        calls.append((method, route))
        if route == '/ai-image/jobs':
            return {'job_uid': 'accepted-job'}
        if route.endswith('/batch-run'):
            raise TimeoutError('response lost after acceptance')
        if route.endswith('/materialize'):
            return {'path': str(image)}
        return {'summary': {'runs': [{'status': 'completed'}], 'image_urls': ['data:image/png;base64,AA==']}}
    monkeypatch.setattr(module, 'request', request)
    assert module.generate('test', 'woka/gpt-image-2')['job_uid'] == 'accepted-job'
    assert sum(route.endswith('/batch-run') for _, route in calls) == 1
