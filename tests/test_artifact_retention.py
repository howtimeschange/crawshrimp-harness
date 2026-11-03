import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time

import pytest
from fastapi import HTTPException
from core import artifact_snapshots, artifact_storage, artifact_maintenance, runtime_paths
from core.agent import api, db
from core.agent.artifact_delivery import verified_artifact
from core.artifact_chunks import artifact_chunk


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv('CRAWSHRIMP_DATA', str(tmp_path / 'data'))
    runtime_paths.reset_runtime_data_root_cache()
    db.init_agent_db()
    db.create_session('one', 'runtime-one')
    db.create_session('two', 'runtime-two')
    yield tmp_path
    runtime_paths.reset_runtime_data_root_cache()


def publish(root, content, job, *, final=False, session='one', name='deck.pptx', source='office'):
    path = root / 'office' / session / job / 'editable' / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    item = verified_artifact({'path': str(path)}, source=source)
    item['office'] = {'job_id': job, 'pages': [], 'delivery': {'status': 'final'} if final else None}
    return db.append_session_event(session, 'artifact.created', item)[1]


def read(event):
    record = db.get_session_artifact('one', event['file_snapshot']['version_id'])
    return base64.b64decode(artifact_chunk(record, record['artifact_id'], 0, 98304)['data'])


def test_unchanged_copies_reuse_one_version_even_when_store_full(store, monkeypatch):
    first = publish(store, b'same', 'run')
    monkeypatch.setattr(artifact_snapshots, 'MAX_SESSION_VERSIONS', 1)
    for i in range(3):
        repeated = publish(store, b'same', f'render{i}', final=i == 1)
        assert repeated['file_snapshot'] == first['file_snapshot']
    items = api.session_resources('runtime-one')['artifacts']
    assert len(items) == 1 and len(items[0]['versions']) == 1
    assert items[0]['office']['delivery']['status'] == 'final'
    assert artifact_storage.usage(db.artifact_snapshot_root(), 'one')['versions'] == 1


def test_equal_content_different_documents_share_bytes_but_not_identity(store):
    first = publish(store, b'same', 'run', name='first.pptx')
    second = publish(store, b'same', 'run', name='second.pptx')
    assert first['file_snapshot']['path'] == second['file_snapshot']['path']
    assert first['file_snapshot']['version_id'] != second['file_snapshot']['version_id']
    assert read(second) == b'same'
    assert len(api.session_resources('runtime-one')['artifacts']) == 2
    third = publish(store, b'same', 'run', session='two')
    assert third['file_snapshot']['path'] != first['file_snapshot']['path']


def test_keep_ten_drafts_preserve_final_and_original_upload(store):
    final = publish(store, b'final', 'final', final=True)
    upload = publish(store, b'original', 'original', source='upload')
    drafts = [publish(store, str(i).encode(), f'run{i}') for i in range(13)]
    assert read(final) == b'final'
    assert read(upload) == b'original'
    for event in drafts[:3]:
        assert Path(event['source_path']).is_file()
        assert not Path(event['path']).exists()
        with pytest.raises(HTTPException) as error:
            read(event)
        assert error.value.status_code == 410
    assert read(drafts[-1]) == b'12'
    item = api.session_resources('runtime-one')['artifacts'][0]
    assert len(item['versions']) == 15
    assert sum(v['status'] == 'deleted' for v in item['versions']) == 3
    with pytest.raises(HTTPException) as error:
        api.artifact_history_version('runtime-one', drafts[0]['file_snapshot']['version_id'])
    assert error.value.status_code == 410
    with pytest.raises(HTTPException) as error:
        api.artifact_history_version('runtime-two', final['file_snapshot']['version_id'])
    assert error.value.status_code == 404


def test_removing_draft_reference_keeps_shared_final_bytes(store):
    shared = publish(store, b'shared', 'first')
    protected = publish(store, b'shared', 'final-other', name='final.pptx', final=True)
    for i in range(10):
        publish(store, str(i).encode(), f'run{i}')
    with pytest.raises(HTTPException):
        read(shared)
    assert read(protected) == b'shared'


def test_concurrent_new_versions_keep_ten_without_losing_final(store):
    final = publish(store, b'final', 'final', final=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        events = list(pool.map(lambda i: publish(store, str(i).encode(), f'run{i}'), range(14)))
    assert all(e['file_snapshot']['status'] == 'ready' for e in events)
    assert read(final) == b'final'
    current = artifact_storage.receipts(db.artifact_snapshot_root(), 'one')
    assert sum(r['status'] == 'ready' for r in current.values()) == 11


def test_retry_after_disposable_legacy_snapshot_cleanup(store, monkeypatch):
    # Legacy process image already occupies the one-slot store.
    path = store / 'icon.png'
    path.write_bytes(b'icon')
    old = db.append_session_event('one', 'artifact.created', verified_artifact({'path': str(path)}, source='shell'))[1]
    connection = db._conn()
    try:
        payload = {**old, 'source': 'office', 'office': {'job_id': 'legacy'}}
        connection.execute("UPDATE agent_events SET payload_json=? WHERE session_id='one'", (json.dumps(payload),))
        connection.commit()
    finally:
        connection.close()
    monkeypatch.setattr(artifact_snapshots, 'MAX_SESSION_VERSIONS', 1)
    failed = publish(store, b'deck', 'new')
    assert failed['file_snapshot']['status'] == 'quota_exceeded'
    assert api.session_resources('runtime-one')['storage']['full']
    result = api.retry_artifact_snapshot(api.ArtifactRetryRequest(runtime_session_id='runtime-one', version_id=failed['file_snapshot']['version_id']))
    assert result['status'] == 'ready'
    assert path.read_bytes() == b'icon'
    assert artifact_storage.receipts(db.artifact_snapshot_root(), 'one')[old['file_snapshot']['version_id']]['status'] == 'deleted'
    assert api.session_resources('runtime-one')['artifacts'][0]['exists']


def test_retry_rejects_changed_source_before_cleanup(store, monkeypatch):
    monkeypatch.setattr(artifact_snapshots, 'MAX_FILE_BYTES', 2)
    failed = publish(store, b'large', 'run')
    Path(failed['source_path']).write_bytes(b'replaced')
    with pytest.raises(HTTPException) as error:
        api.retry_artifact_snapshot(api.ArtifactRetryRequest(runtime_session_id='runtime-one', version_id=failed['file_snapshot']['version_id']))
    assert error.value.status_code == 409


def test_process_events_never_create_snapshots(store):
    path = store / 'preview.png'
    path.write_bytes(b'preview')
    item = verified_artifact({'path': str(path)}, source='office')
    item['office'] = {'job_id': 'run'}
    event = db.append_session_event('one', 'artifact.created', item)[1]
    assert event['file_snapshot']['status'] == 'working_file'
    assert not artifact_storage.receipts(db.artifact_snapshot_root(), 'one')
    # Explicit image presentation is still a real artifact.
    item = verified_artifact({'path': str(path)}, source='shell')
    assert db.append_session_event('one', 'artifact.created', item)[1]['file_snapshot']['status'] == 'ready'


def test_completed_cache_ttl_preserves_documents_explicit_images_live_jobs_and_links(store):
    root = store / 'cache'
    now = time.time()
    old = now - 8 * 86400
    for session, job, state in [('session', 'done', 'completed'), ('active', 'done', 'completed'), ('session', 'busy', 'running')]:
        work = root / session / job
        (work / 'editable/_fit').mkdir(parents=True)
        (work / 'preview').mkdir()
        (work / 'manifest.json').write_text(json.dumps({'state': state, 'finished_at': old}))
        for name in ['editable/_fit/icon.png', 'editable/explicit.png', 'editable/deck.pptx', 'preview/page.png', 'preview/deck.pdf']:
            path = work / name
            path.write_bytes(b'keep' if name.endswith('.pptx') else b'cache')
            os.utime(path, (old, old))
    outside = store / 'outside.png'
    outside.write_bytes(b'outside')
    (root / 'session/done/editable/link.png').symlink_to(outside)
    protected = root / 'session/done/editable/explicit.png'
    assert artifact_maintenance.clean_office_cache(root, protected_paths=[str(protected)], active_sessions={'active'}, now=now) == 3
    assert protected.exists() and outside.exists()
    assert (root / 'session/done/editable/deck.pptx').exists()
    assert (root / 'active/done/preview/page.png').exists()
    assert (root / 'session/busy/preview/page.png').exists()
    assert artifact_maintenance.clean_office_cache(root, now=now) == 5  # Explicit image no longer protected here; active session now eligible.


def test_late_final_delivery_restores_pruned_exact_draft(store):
    first = publish(store, b'original draft', 'first')
    for i in range(10):
        publish(store, str(i).encode(), f'run{i}')
    with pytest.raises(HTTPException):
        read(first)
    # A validated explicit delivery may restore the unchanged original copy.
    item = verified_artifact({'path': first['source_path']}, source='office')
    item['office'] = {'job_id': 'first', 'delivery': {'status': 'final'}}
    final = db.append_session_event('one', 'artifact.created', item)[1]
    assert read(final) == b'original draft'
    for i in range(10, 13):
        publish(store, str(i).encode(), f'run{i}')
    assert read(final) == b'original draft'


def test_periodic_maintenance_uses_same_retention_and_preserves_sources(store):
    protected = publish(store, b'final', 'final', final=True)
    result = artifact_maintenance.maintain()
    assert result == {'removed': 0, 'cache_files_removed': 0}
    assert read(protected) == b'final'


def test_standalone_preview_jobs_are_cleaned_after_ttl(store):
    root = store / 'previews'
    work = root / 'job'
    (work / 'preview').mkdir(parents=True)
    old = time.time() - 8 * 86400
    (work / 'manifest.json').write_text(json.dumps({'state': 'completed', 'finished_at': old}))
    page = work / 'preview/page.png'
    page.write_bytes(b'cache')
    os.utime(page, (old, old))
    assert artifact_maintenance.clean_office_cache(root, direct_jobs=True) == 1


def test_failed_copy_does_not_evict_tenth_previous_draft(store, monkeypatch):
    drafts = [publish(store, str(i).encode(), f'run{i}') for i in range(10)]
    def fail_copy(*args):
        raise OSError('disk full')
    monkeypatch.setattr(artifact_snapshots, '_copy', fail_copy)
    failed = publish(store, b'new', 'new')
    assert failed['file_snapshot']['status'] == 'unavailable'
    assert read(drafts[0]) == b'0'
    assert all(read(d) for d in drafts)


def test_full_store_can_replace_oldest_draft_after_success(store, monkeypatch):
    monkeypatch.setattr(artifact_snapshots, 'MAX_SESSION_VERSIONS', 10)
    drafts = [publish(store, str(i).encode(), f'run{i}') for i in range(11)]
    assert drafts[-1]['file_snapshot']['status'] == 'ready'
    assert artifact_storage.usage(db.artifact_snapshot_root(), 'one')['versions'] == 10
    assert read(drafts[-1]) == b'10'
    with pytest.raises(HTTPException) as error:
        read(drafts[0])
    assert error.value.status_code == 410
