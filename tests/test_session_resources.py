import asyncio
import json
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


@pytest.mark.parametrize('extension', ['pptx', 'docx', 'xlsx'])
def test_office_job_copies_collapse_without_losing_preview_or_other_files(resource_db, extension):
    filename = f'report.{extension}'

    def publish(job, pages, filename=filename, delivery=None):
        db.append_event('a', None, 'artifact.created', {
            'path': f'/outputs/office/session/{job}/editable/{filename}',
            'filename': filename, 'office': {'job_id': job, 'pages': pages, 'delivery': delivery},
        })
    publish('run1', [])
    publish('render1', [{'path': '/page1.png'}])
    publish('run2', [])
    publish('other', [], f'other.{extension}')
    items = api.session_resources('runtime-a')['artifacts']
    assert len(items) == 2
    assert next(i for i in items if i['filename'] == filename)['office']['job_id'] == 'render1'
    publish('render2', [{'path': '/page2.png'}], delivery={'status': 'final'})
    publish('late-poll', [])
    items = api.session_resources('runtime-a')['artifacts']
    assert len(items) == 2
    assert next(i for i in items if i['filename'] == filename)['office']['job_id'] == 'render2'


def test_image_delivery_restores_only_owned_completed_image_calls_without_arguments(resource_db):
    db.append_event('a', None, 'tool.requested', {
        'tool_call_id': 'run:img', 'tool_name': 'mcp__crawshrimp__image_generate',
        'dsh_call_id': 'img', 'turn': 3, 'arguments': {'private': 'not-public'},
    })
    db.append_event('a', None, 'tool.requested', {
        'tool_call_id': 'run:failed', 'tool_name': 'image_generate', 'turn': 4,
    })
    db.append_event('b', None, 'tool.requested', {
        'tool_call_id': 'other', 'tool_name': 'image_generate', 'turn': 3,
    })
    db.append_event('a', None, 'artifact.created', {
        'path': '/image.png', 'media_kind': 'image', 'tool_call_id': 'run:img',
    })
    result = api.session_resources('runtime-a')
    assert result['imageGenerations'] == [{
        'tool_call_id': 'run:img', 'dsh_call_id': 'img', 'turn': 3, 'state': 'finished',
    }]
    assert api.session_resources('runtime-b')['imageGenerations'] == []
    assert api.session_resources('missing')['imageGenerations'] == []


def test_resource_query_projects_image_ownership_without_loading_tool_arguments(resource_db):
    names = ['browser_evaluate', 'image_generate_extra', 'IMAGE_GENERATE', None,
             'image_generate', 'mcp__crawshrimp__image_generate']
    for index, name in enumerate(names):
        db.append_event('a', None, 'tool.requested', {
            'tool_name': name, 'tool_call_id': f'call-{index}', 'dsh_call_id': str(index),
            'turn': index, 'arguments': {'script': 'x' * 131072},
        })
    db.append_event('b', None, 'tool.requested', {'tool_name': 'image_generate', 'tool_call_id': 'private'})
    db.append_event('a', None, 'browser.activity', {'tabs': [{'id': 'one'}]})
    db.append_event('a', None, 'browser.page.closed', {'tab_id': 'one'})
    rows = db.list_session_resource_events('runtime-a')
    assert [r['seq'] for r in rows] == sorted(r['seq'] for r in rows)
    assert [r['event_type'] for r in rows] == ['tool.requested', 'tool.requested', 'browser.activity', 'browser.page.closed']
    assert [json.loads(r['payload_json']) for r in rows[:2]] == [
        {'tool_name': names[i], 'tool_call_id': f'call-{i}', 'dsh_call_id': str(i), 'turn': i}
        for i in (4, 5)
    ]
    assert sum(len(r['payload_json']) for r in rows) < 1024
    # This is a read projection: the durable audit and replay data are unchanged.
    durable = db.list_events_after('a', 0)
    assert len(durable) == 8
    assert len(json.loads(durable[0]['payload_json'])['arguments']['script']) == 131072


@pytest.mark.parametrize('status', [None, 'ready', 'quota_exceeded'])
def test_old_office_working_images_are_hidden_without_hiding_image_deliveries(monkeypatch, status):
    items = [
        {'filename': 'icon.png', 'path': '/_fit/icon.png', 'source': 'office', 'office': {'job_id': 'old'}},
        {'filename': 'deck.pptx', 'path': '/editable/deck.pptx', 'source': 'office', 'office': {'job_id': 'old'}},
        {'filename': 'requested-image.png', 'path': '/images/requested.png', 'source': 'adapter'},
    ]
    if status:
        items[0].update(source_path=items[0]['path'], path='/snapshots/icon.png' if status == 'ready' else '',
                        file_snapshot={'status': status, 'version_id': 'old-image', 'size': 1, 'sha256': 'a' * 64})
    monkeypatch.setattr(db, 'list_session_resource_events', lambda _: [
        {'event_type': 'artifact.created', 'created_at': '2026-11-03T10:00:00Z', 'payload_json': json.dumps(item)}
        for item in items
    ])
    assert {item['filename'] for item in api.session_resources('a')['artifacts']} == {'deck.pptx', 'requested-image.png'}
