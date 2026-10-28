"""Registered file records must not start serving overwritten source bytes."""
import base64
import json
import os
from pathlib import Path

import pytest
from fastapi import HTTPException

from core.agent.artifact_delivery import verified_artifact
from core.artifact_chunks import artifact_chunk


@pytest.mark.parametrize('mutation', ['rewrite', 'restore_mtime', 'replace_inode'])
def test_registered_version_rejects_changes_before_the_first_chunk(tmp_path, mutation):
    path = tmp_path / '成果.txt'
    path.write_bytes(b'original')
    record = verified_artifact(str(path), source='shell', run_id='run-one')
    before = path.stat()
    if mutation == 'replace_inode':
        replacement = tmp_path / 'new.txt'
        replacement.write_bytes(b'changed!')
        replacement.replace(path)
    else:
        path.write_bytes(b'changed!')
    if mutation != 'rewrite':
        os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
    # No prior download hash: the registered delivery itself pins the version.
    with pytest.raises(HTTPException) as error:
        artifact_chunk(record, record['artifact_id'], 0, 4)
    assert error.value.status_code == 409


def test_unchanged_registered_version_survives_json_and_downloads(tmp_path):
    path = tmp_path / '成果.txt'
    path.write_bytes(b'unchanged bytes')
    record = json.loads(json.dumps(verified_artifact(str(path), source='shell')))
    chunk = artifact_chunk(record, record['artifact_id'], 0, 64)
    assert base64.b64decode(chunk['data']) == path.read_bytes()
    assert record['verification']['status'] == 'exists'
    assert record['verification']['scope'] == 'file_exists'
    # Nanosecond timestamps and inode identifiers must survive JS JSON parsing.
    version = record['file_version']
    assert version['scheme'] == 'stat-v1'
    assert all(isinstance(version[key], str) for key in ['device', 'inode', 'mtime_ns', 'ctime_ns'])


def test_automatic_artifact_id_changes_for_same_size_and_mtime_replacement(tmp_path):
    path = tmp_path / 'report.txt'
    path.write_bytes(b'first')
    first = verified_artifact(str(path), source='shell')
    before = path.stat()
    assert verified_artifact(str(path), source='shell')['artifact_id'] == first['artifact_id']
    replacement = tmp_path / 'replacement.txt'
    replacement.write_bytes(b'later')
    replacement.replace(path)
    os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
    second = verified_artifact(str(path), source='shell')
    assert second['artifact_id'] != first['artifact_id']
    assert second['file_version'] != first['file_version']


def test_unknown_registered_version_cannot_fall_back_to_mutable_path(tmp_path):
    path = tmp_path / 'report.txt'
    path.write_bytes(b'bytes')
    for version in [None, {}, {'scheme': 'future'}]:
        with pytest.raises(HTTPException) as error:
            artifact_chunk({'path': str(path), 'file_version': version}, 'artifact-one', 0, 4)
        assert error.value.status_code == 409


@pytest.mark.parametrize('publisher', ['direct', 'session'])
def test_durable_media_and_office_events_pin_without_a_shell_manifest(tmp_path, monkeypatch, publisher):
    from core import runtime_paths
    from core.agent import db
    monkeypatch.setenv('CRAWSHRIMP_DATA', str(tmp_path / 'state'))
    runtime_paths.reset_runtime_data_root_cache()
    try:
        db.init_agent_db()
        db.create_session('owner-session', 'runtime-one')
        path = tmp_path / 'report.xlsx'
        path.write_bytes(b'original bytes')
        payload = {'artifact_id': 'office-one', 'path': str(path), 'media_kind': 'office'}
        if publisher == 'session':
            _, event = db.append_session_event('owner-session', 'artifact.created', payload)
            assert event['file_version']['scheme'] == 'stat-v1'
        else:
            db.append_event('owner-session', None, 'artifact.created', payload)
        assert 'file_version' not in payload, 'Publishing must not mutate the caller payload'
        record = db.get_session_artifact('owner-session', 'office-one')
        assert record['file_version']['scheme'] == 'stat-v1'
        assert db.get_session_artifact('another-session', 'office-one') is None
        path.write_bytes(b'replacement!!!')
        chunk = artifact_chunk(record, 'office-one', 0, 64)
        assert base64.b64decode(chunk['data']) == b'original bytes'
        assert record['file_snapshot']['status'] == 'ready'
    finally:
        runtime_paths.reset_runtime_data_root_cache()


def test_publisher_preserves_existing_version_and_absence_evidence(tmp_path):
    from core.artifact_version import pin_artifact_event
    path = tmp_path / 'report.txt'
    missing = pin_artifact_event('artifact.created', {'path': str(path)})
    assert missing['file_version'] is None
    path.write_bytes(b'first')
    with pytest.raises(HTTPException):
        artifact_chunk(missing, 'never-existed-at-registration', 0, 4)
    registered = verified_artifact(str(path), source='shell')
    path.write_bytes(b'second')
    event = pin_artifact_event('artifact.created', registered)
    assert event is registered
    with pytest.raises(HTTPException) as error:
        artifact_chunk(event, event['artifact_id'], 0, 4)
    assert error.value.status_code == 409


def test_http_chunk_route_conflicts_then_accepts_a_new_registration(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from core import runtime_paths
    from core.agent import api, db
    monkeypatch.setenv('CRAWSHRIMP_DATA', str(tmp_path / 'state'))
    runtime_paths.reset_runtime_data_root_cache()
    try:
        db.init_agent_db()
        db.create_session('owner-session', 'runtime-one')
        db.create_session('other-session', 'runtime-two')
        path = tmp_path / 'report.txt'
        path.write_bytes(b'original')
        registered = verified_artifact(str(path), source='shell')
        db.append_session_event('owner-session', 'artifact.created', registered)
        app = FastAPI()
        app.include_router(api.router)
        # Test the real route and persistence boundary in isolation. Production
        # gateway authentication remains covered by its separate existing suite.
        route = next(r.path for r in api.router.routes if r.endpoint is api.artifact_chunk_endpoint)
        params = {'session_id': 'owner-session', 'artifact_id': registered['artifact_id']}
        with TestClient(app) as client:
            response = client.get(route, params=params)
            assert response.status_code == 200
            assert base64.b64decode(response.json()['data']) == b'original'
            assert client.get(route, params={**params, 'session_id': 'other-session'}).status_code == 404
            assert client.get(route, params={**params, 'path': str(path)}).status_code == 400
            path.write_bytes(b'changed!')
            response = client.get(route, params=params)
            assert response.status_code == 200
            assert base64.b64decode(response.json()['data']) == b'original'
            current = verified_artifact(str(path), source='shell')
            assert current['artifact_id'] != registered['artifact_id']
            db.append_session_event('owner-session', 'artifact.created', current)
            response = client.get(route, params={**params, 'artifact_id': current['artifact_id']})
            assert response.status_code == 200
            assert base64.b64decode(response.json()['data']) == b'changed!'
            response = client.get(route, params=params)
            assert response.status_code == 200
            assert base64.b64decode(response.json()['data']) == b'original'
    finally:
        runtime_paths.reset_runtime_data_root_cache()


@pytest.mark.skipif(os.name == 'nt', reason='POSIX FIFO replacement')
@pytest.mark.parametrize('kind', ['source', 'snapshot'])
def test_download_rejects_fifo_replacement_without_waiting_for_a_writer(tmp_path, kind):
    import subprocess
    import sys
    path = tmp_path / 'replaced-with-fifo.txt'
    path.write_bytes(b'original')
    record = verified_artifact(str(path), source='shell')
    if kind == 'snapshot':
        from core.artifact_snapshots import snapshot
        receipt = snapshot(record, 'fifo-session', tmp_path / 'snapshots')
        assert receipt['status'] == 'ready'
        record = {**record, 'file_snapshot': receipt}
        path = Path(receipt['path'])
    path.unlink()
    os.mkfifo(path)
    code = '''import json,sys
from fastapi import HTTPException
from core.artifact_chunks import artifact_chunk
try:
    artifact_chunk(json.loads(sys.argv[1]), 'fifo', 0, 64)
except HTTPException as error:
    print(error.status_code)
else:
    raise AssertionError('A FIFO is not a registered regular file')
'''
    # A timeout kills only this test-owned subprocess; never block pytest itself.
    result = subprocess.run([sys.executable, '-c', code, json.dumps(record)], capture_output=True, text=True, timeout=3)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() in {'400', '404', '409'}
