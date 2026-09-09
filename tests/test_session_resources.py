import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from core import runtime_paths
from core.agent import api, db

@pytest.fixture
def resource_db(monkeypatch, tmp_path):
    monkeypatch.setenv('CRAWSHRIMP_DATA', str(tmp_path))
    runtime_paths.reset_runtime_data_root_cache()
    db.init_agent_db()
    db.create_session('a', 'runtime-a')
    db.create_session('b', 'runtime-b')
    yield
    runtime_paths.reset_runtime_data_root_cache()


def test_resources_restore_all_files_and_isolate_sessions(resource_db):
    for i in range(55):
        db.append_event('a', None, 'artifact.created', {'path': f'/file-{i}.txt', 'filename': f'file-{i}.txt'})
    db.append_event('a', None, 'artifact.created', {'path': '/file-0.txt', 'filename': 'file-0.txt', 'size': 120})
    db.append_event('b', None, 'artifact.created', {'path': '/secret.txt'})
    result = api.session_resources('runtime-a')
    assert len(result['artifacts']) == 55
    assert result['artifacts'][0]['size'] == 120
    assert not any(a['path'] == '/secret.txt' for a in result['artifacts'])
    assert api.session_resources('missing')['artifacts'] == []


def test_browser_history_accumulates_pages_and_applies_close(resource_db):
    for tid in ['one', 'two']:
        db.append_event('a', None, 'browser.activity', {'tabs': [{'id': tid}], 'active_tab_id': tid})
    assert [t['id'] for t in api.session_resources('runtime-a')['tabs']] == ['one', 'two']
    db.append_event('a', None, 'browser.page.closed', {'tab_id': 'one'})
    assert api.session_resources('runtime-a')['tabs'] == [{'id': 'two'}]


def test_cannot_close_other_session_page(resource_db):
    db.append_event('b', None, 'browser.activity', {'tabs': [{'id': 'private'}]})
    with pytest.raises(HTTPException) as exc:
        asyncio.run(api.close_session_page('private', 'runtime-a'))
    assert exc.value.status_code == 404


def test_artifact_creation_time_survives_later_preview_updates(monkeypatch):
    import json
    payload = {'path': '/report.docx', 'filename': 'report.docx'}
    monkeypatch.setattr(db, 'list_session_resource_events', lambda _: [
        {'event_type': 'artifact.created', 'created_at': '2026-09-01T01:00:00Z', 'payload_json': json.dumps(payload)},
        {'event_type': 'artifact.created', 'created_at': '2026-09-09T01:00:00Z', 'payload_json': json.dumps({**payload, 'office': {'visual': 'passed'}})},
    ])
    item = api.session_resources('a')['artifacts'][0]
    assert item['created_at'] == '2026-09-01T01:00:00Z'
    assert item['updated_at'] == '2026-09-09T01:00:00Z'
    assert item['office'] == {'visual': 'passed'}
