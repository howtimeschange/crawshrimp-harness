import base64
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path

import pytest
from fastapi import HTTPException

from core import artifact_snapshots as snapshots, runtime_paths
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


def publish(path, session='one', identifier=''):
    raw = {'path': str(path), **({'artifact_id': identifier} if identifier else {})}
    item = verified_artifact(raw, source='shell')
    return db.append_session_event(session, 'artifact.created', item)[1]


def read(session, identifier):
    record = db.get_session_artifact(session, identifier)
    chunk = artifact_chunk(record, identifier, 0, 98304)
    return base64.b64decode(chunk['data'])


def test_old_bytes_survive_reused_id_source_rewrite_and_deletion(store):
    path = store / '中文报告.txt'
    path.write_bytes(b'first version')
    first = publish(path, identifier='adapter-stable-id')
    first_id = first['file_snapshot']['version_id']
    path.write_bytes(b'newest version')
    second = publish(path, identifier='adapter-stable-id')
    second_id = second['file_snapshot']['version_id']
    assert second_id != first_id
    path.unlink()
    assert read('one', first_id) == b'first version'
    assert read('one', second_id) == b'newest version'
    assert read('one', 'adapter-stable-id') == b'newest version'  # Explicit legacy alias.
    with pytest.raises(HTTPException) as error:
        read('two', first_id)
    assert error.value.status_code == 404
    resources = api.session_resources('runtime-one')['artifacts']
    assert len(resources) == 1 and resources[0]['exists']
    assert resources[0]['artifact_id'] == second_id
    assert resources[0]['source_artifact_id'] == 'adapter-stable-id'
    assert [v['artifact_id'] for v in resources[0]['versions']] == [second_id, first_id]
    assert resources[0]['source_path'] == str(path)


def test_duplicate_registration_reuses_private_readonly_bytes(store):
    path = store / 'report.txt'
    path.write_bytes(b'content')
    first, second = publish(path), publish(path)
    assert first['file_snapshot'] == second['file_snapshot']
    snapshot = Path(first['file_snapshot']['path'])
    if os.name != 'nt':
        assert snapshot.stat().st_mode & 0o777 == 0o400
        assert snapshot.parent.stat().st_mode & 0o777 == 0o700
    assert snapshot.name == path.name
    other = publish(path, session='two')
    assert other['file_snapshot']['path'] != str(snapshot)
    assert other['file_snapshot']['version_id'] != first['file_snapshot']['version_id']


@pytest.mark.parametrize('damage', ['missing', 'modified'])
def test_missing_or_damaged_snapshot_never_falls_back_to_source(store, damage):
    path = store / 'report.txt'
    path.write_bytes(b'good bytes')
    record = publish(path)
    copy = Path(record['file_snapshot']['path'])
    copy.chmod(0o600)
    if damage == 'missing':
        copy.unlink()
    else:
        copy.write_bytes(b'bad! bytes')
    with pytest.raises(HTTPException) as error:
        read('one', record['file_snapshot']['version_id'])
    assert error.value.status_code == (404 if damage == 'missing' else 409)
    repeated = publish(path)
    assert repeated['file_snapshot'] == record['file_snapshot']
    assert path.read_bytes() == b'good bytes'


def test_snapshot_receipt_hash_is_checked_independently(store):
    path = store / 'report.txt'
    path.write_bytes(b'content')
    record = publish(path)
    receipt = {**record['file_snapshot'], 'sha256': '0' * 64}
    with pytest.raises(HTTPException) as error:
        artifact_chunk({**record, 'file_snapshot': receipt}, record['artifact_id'], 0, 64)
    assert error.value.status_code == 409


def test_limits_preserve_existing_versions_without_eviction(store, monkeypatch):
    monkeypatch.setattr(snapshots, 'MAX_FILE_BYTES', 16)
    monkeypatch.setattr(snapshots, 'MAX_SESSION_BYTES', 24)
    paths = []
    for i in range(3):
        path = store / f'{i}.txt'
        path.write_bytes(b'1234567890')
        paths.append(path)
    old = publish(paths[0])
    publish(paths[1])
    blocked = publish(paths[2])
    assert blocked['file_snapshot']['status'] == 'quota_exceeded'
    assert read('one', old['file_snapshot']['version_id']) == b'1234567890'
    with pytest.raises(HTTPException) as error:
        read('one', blocked['artifact_id'])
    assert error.value.status_code == 413
    large = store / 'large.txt'
    large.write_bytes(b'x' * 17)
    assert publish(large)['file_snapshot']['status'] == 'too_large'


def test_concurrent_registration_respects_shared_quota(store, monkeypatch):
    monkeypatch.setattr(snapshots, 'MAX_SESSION_BYTES', 24)
    paths = []
    for i in range(6):
        path = store / f'{i}.txt'
        path.write_bytes(b'12345678')
        paths.append(path)
    with ThreadPoolExecutor(max_workers=6) as pool:
        events = list(pool.map(publish, paths))
    assert sum(event['file_snapshot']['status'] == 'ready' for event in events) == 3
    assert sum(event['file_snapshot']['status'] == 'quota_exceeded' for event in events) == 3


def test_source_changed_during_copy_is_not_committed(store, monkeypatch):
    path = store / 'report.txt'
    path.write_bytes(b'first')
    copy = snapshots._copy
    def mutate(original, destination):
        value = copy(original, destination)
        path.write_bytes(b'other')
        return value
    monkeypatch.setattr(snapshots, '_copy', mutate)
    event = publish(path)
    assert event['file_snapshot']['status'] == 'source_changed'
    assert not list((store / 'data/agent/artifact_versions').rglob('.copy-*'))
    with pytest.raises(HTTPException) as error:
        read('one', event['artifact_id'])
    assert error.value.status_code == 409


def test_tool_cannot_assert_an_unregistered_snapshot_path(store):
    path = store / 'real.txt'
    path.write_bytes(b'real')
    fake = store / 'fake.txt'
    fake.write_bytes(b'fake')
    event = verified_artifact(str(path), source='shell')
    event['file_snapshot'] = {'status': 'ready', 'path': str(fake)}
    _, saved = db.append_session_event('one', 'artifact.created', event)
    assert read('one', saved['file_snapshot']['version_id']) == b'real'
    assert saved['file_snapshot']['path'] != str(fake)


def test_orphaned_copy_requires_reconciliation_and_counts_against_budget(store, monkeypatch):
    path = store / 'report.txt'
    path.write_bytes(b'first')
    event = publish(path)
    index = store / 'data/agent/artifact_versions/index.sqlite'
    import sqlite3
    with sqlite3.connect(index) as connection:
        connection.execute('DELETE FROM snapshots')
    repeated = publish(path)
    assert repeated['file_snapshot']['status'] == 'unavailable'
    assert repeated['file_snapshot']['reason'] == 'snapshot_reconciliation_required'
    assert read('one', event['file_snapshot']['version_id']) == b'first'


@pytest.mark.parametrize('bad_receipt', ['"scalar"', '{"status":"ready"}'])
def test_invalid_snapshot_index_does_not_break_run_event_registration(store, bad_receipt):
    import sqlite3
    path = store / 'report.txt'
    path.write_bytes(b'first')
    first = publish(path)
    with sqlite3.connect(store / 'data/agent/artifact_versions/index.sqlite') as connection:
        connection.execute('UPDATE snapshots SET receipt=?', (bad_receipt,))
    event = publish(path)
    assert event['file_snapshot']['status'] == 'unavailable'
    assert event['file_snapshot']['reason'] == 'snapshot_index_invalid'
    assert read('one', first['file_snapshot']['version_id']) == b'first'


def test_version_count_limit_keeps_previous_receipt_readable(store, monkeypatch):
    monkeypatch.setattr(snapshots, 'MAX_SESSION_VERSIONS', 1)
    path = store / 'report.txt'
    path.write_bytes(b'first')
    first = publish(path)
    path.write_bytes(b'other')
    assert publish(path)['file_snapshot']['status'] == 'quota_exceeded'
    assert read('one', first['file_snapshot']['version_id']) == b'first'


def test_failed_reregistration_of_same_version_keeps_committed_projection(store):
    """A retry with a damaged index must not advertise the mutable source."""
    import sqlite3
    path = store / 'report.txt'
    path.write_bytes(b'committed bytes')
    first = publish(path, identifier='stable')
    with sqlite3.connect(store / 'data/agent/artifact_versions/index.sqlite') as connection:
        connection.execute('DELETE FROM snapshots')
    failed = publish(path, identifier='stable')
    assert failed['file_snapshot']['status'] == 'unavailable'
    assert failed['file_snapshot']['version_id'] == first['file_snapshot']['version_id']
    item = api.session_resources('runtime-one')['artifacts'][0]
    assert item['artifact_id'] == first['file_snapshot']['version_id']
    assert item['file_snapshot']['status'] == 'ready'
    assert item['path'] == first['path']
    assert read('one', item['artifact_id']) == b'committed bytes'


@pytest.mark.parametrize('field,value', [('size', None), ('size', '5'), ('remove_size', None), ('file_version', {}), ('sha256', 'g' * 64)])
def test_partial_ready_index_receipt_is_rejected_without_poisoning_projection(store, field, value):
    import sqlite3
    path = store / 'report.txt'
    path.write_bytes(b'first')
    first = publish(path)
    receipt = {**first['file_snapshot'], field: value}
    if field == 'remove_size':
        receipt.pop('size')
    with sqlite3.connect(store / 'data/agent/artifact_versions/index.sqlite') as connection:
        connection.execute('UPDATE snapshots SET receipt=?', (json.dumps(receipt),))
    event = publish(path)
    assert event['file_snapshot']['status'] == 'unavailable'
    assert event['file_snapshot']['reason'] == 'snapshot_index_invalid'
    assert api.session_resources('runtime-one')['artifacts'][0]['artifact_id'] == first['file_snapshot']['version_id']
    assert read('one', first['file_snapshot']['version_id']) == b'first'


def test_unavailable_snapshot_never_publishes_a_mutable_desktop_path(store, monkeypatch):
    monkeypatch.setattr(snapshots, 'MAX_FILE_BYTES', 2)
    path = store / 'rejected.txt'
    path.write_bytes(b'too large')
    saved = publish(path, identifier='rejected')
    assert saved['file_snapshot']['status'] == 'too_large'
    assert saved.get('path') in ('', None)
    assert saved['source_path'] == str(path)
    projected = api.session_resources('runtime-one')['artifacts'][0]
    assert projected.get('path') in ('', None)
    assert not projected['exists']
    assert projected['file_snapshot']['status'] == 'too_large'


def test_existing_failed_snapshot_events_cannot_advertise_mutable_path(store, monkeypatch):
    path = store / 'old-failed-event.txt'
    path.write_bytes(b'mutable source')
    monkeypatch.setattr(db, 'list_session_resource_events', lambda _: [{
        'event_type': 'artifact.created', 'created_at': '2026-10-25T00:00:00Z',
        'payload_json': json.dumps({'artifact_id': 'old-failed', 'path': str(path),
                                    'file_snapshot': {'status': 'quota_exceeded', 'version_id': 'version-failed'}}),
    }])
    item = api.session_resources('runtime-one')['artifacts'][0]
    assert item.get('path') in ('', None)
    assert item['source_path'] == str(path)
    assert not item['exists']


def test_index_commit_failure_keeps_event_failed_and_retained_bytes_in_quota(store, monkeypatch):
    import sqlite3
    original_connect = sqlite3.connect
    class FailingCommit:
        def __init__(self, connection):
            self.connection = connection
            self.commits = 0
        def __getattr__(self, name):
            return getattr(self.connection, name)
        def commit(self):
            self.commits += 1
            if self.commits == 2:
                raise sqlite3.OperationalError('injected final index commit failure')
            return self.connection.commit()
    def connect(path, *args, **kwargs):
        connection = original_connect(path, *args, **kwargs)
        return FailingCommit(connection) if Path(path).name == 'index.sqlite' else connection
    path = store / 'commit-failure.txt'
    path.write_bytes(b'first')
    with monkeypatch.context() as injected:
        injected.setattr(sqlite3, 'connect', connect)
        failed = publish(path)
    assert failed['file_snapshot']['status'] == 'unavailable'
    assert failed['path'] == ''
    assert not api.session_resources('runtime-one')['artifacts'][0]['exists']
    repeated = publish(path)
    assert repeated['file_snapshot']['reason'] == 'snapshot_reconciliation_required'
    monkeypatch.setattr(snapshots, 'MAX_SESSION_BYTES', 8)
    second = store / 'second.txt'
    second.write_bytes(b'next')
    assert publish(second)['file_snapshot']['status'] == 'quota_exceeded'
    assert not list((store / 'data/agent/artifact_versions').rglob('.copy-*'))
