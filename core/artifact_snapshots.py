"""Private, session-scoped byte snapshots; no claim about document correctness."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile

from core.artifact_version import file_version
from core.atomic_file import replace_with_retry
from core.windows_acl import assert_no_reparse_components_windows, harden_windows_path

MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_SESSION_BYTES = 512 * 1024 * 1024
MAX_SESSION_VERSIONS = 500


def _sync_directory(path: Path):
    if os.name == 'nt':
        return
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _private_directory(path: Path):
    assert_no_reparse_components_windows(path, allow_missing=True)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink():
        raise OSError('Snapshot directory cannot be a symbolic link')
    path.chmod(0o700)
    harden_windows_path(path)


def _copy(source, output):
    digest = hashlib.sha256()
    total = 0
    while chunk := source.read(1024 * 1024):
        total += len(chunk)
        if total > MAX_FILE_BYTES:
            raise ValueError('snapshot_too_large')
        output.write(chunk)
        digest.update(chunk)
    output.flush()
    os.fsync(output.fileno())
    return digest.hexdigest(), total


def _valid_receipt(receipt, version_id: str, destination: Path, expected: dict) -> bool:
    if not isinstance(receipt, dict):
        return False
    version = receipt.get('file_version')
    digest = receipt.get('sha256')
    size = receipt.get('size')
    return (receipt.get('status') == 'ready' and receipt.get('version_id') == version_id
            and receipt.get('path') == str(destination) and receipt.get('name') == destination.name
            and type(size) is int and 0 <= size <= MAX_FILE_BYTES and size == expected.get('size')
            and isinstance(digest, str) and len(digest) == 64
            and all(character in '0123456789abcdef' for character in digest)
            and isinstance(version, dict) and version.get('scheme') == 'stat-v1'
            and version.get('size') == size
            and all(isinstance(version.get(field), str)
                    and version[field].removeprefix('-').isascii()
                    and version[field].removeprefix('-').isdigit()
                    for field in ('device', 'inode', 'mtime_ns', 'ctime_ns')))


def snapshot(record: dict, session_id: str, root: Path) -> dict:
    """Freeze at registration. Index transactions serialize copies and quotas.

    Existing bytes are never replaced after a committed receipt. Incomplete
    own files count against the quota, so a crash cannot bypass storage limits.
    """
    source = Path(str(record.get('path') or ''))
    expected = record.get('file_version')
    session_key = hashlib.sha256(session_id.encode()).hexdigest()
    identity = json.dumps([str(source.absolute()), expected], sort_keys=True, ensure_ascii=False)
    key = hashlib.sha256(identity.encode()).hexdigest()
    version_id = 'artifact-version-' + session_key[:16] + '-' + key
    result = {'version_id': version_id, 'status': 'unavailable'}
    if not isinstance(expected, dict) or expected.get('scheme') != 'stat-v1':
        return {**result, 'status': 'source_changed'}
    temporary = None
    connection = None
    try:
        _private_directory(root)
        _sync_directory(root.parent)
        session = root / session_key
        _private_directory(session)
        _sync_directory(root)
        index = root / 'index.sqlite'
        if index.is_symlink():
            raise OSError('Snapshot index cannot be a symbolic link')
        connection = sqlite3.connect(index, timeout=5)
        index.chmod(0o600)
        harden_windows_path(index)
        connection.execute('CREATE TABLE IF NOT EXISTS snapshots (session_key TEXT, version_key TEXT, receipt TEXT NOT NULL, PRIMARY KEY(session_key,version_key))')
        connection.commit()
        connection.execute('BEGIN IMMEDIATE')
        old = connection.execute('SELECT receipt FROM snapshots WHERE session_key=? AND version_key=?', (session_key, key)).fetchone()
        if old:
            # A missing/modified committed snapshot is not silently rebuilt from
            # a possibly changed original. The download reports its own error.
            receipt = json.loads(old[0])
            if not _valid_receipt(receipt, version_id, session / key / source.name, expected):
                return {**result, 'reason': 'snapshot_index_invalid'}
            return receipt
        # Nonblocking open avoids hanging registration if a path was replaced
        # by a FIFO between stat and open. Regular-file reads are unaffected.
        source_descriptor = os.open(source, os.O_RDONLY | getattr(os, 'O_NONBLOCK', 0))
        with os.fdopen(source_descriptor, 'rb') as original:
            before = os.fstat(original.fileno())
            import stat
            if not stat.S_ISREG(before.st_mode) or expected != file_version(before):
                return {**result, 'status': 'source_changed'}
            if before.st_size > MAX_FILE_BYTES:
                return {**result, 'status': 'too_large'}
            folders = [p for p in session.iterdir() if p.is_dir()]
            if any(folder.is_symlink() for folder in folders):
                return result
            # Include orphan temporary/final copies from interrupted writes.
            used = sum(p.stat().st_size for folder in folders for p in folder.iterdir() if p.is_file())
            if used + before.st_size > MAX_SESSION_BYTES or len(folders) >= MAX_SESSION_VERSIONS:
                return {**result, 'status': 'quota_exceeded'}
            folder = session / key
            _private_directory(folder)
            destination = folder / source.name
            if destination.exists() or destination.is_symlink():
                return {**result, 'status': 'unavailable', 'reason': 'snapshot_reconciliation_required'}
            descriptor, name = tempfile.mkstemp(prefix='.copy-', dir=folder)
            temporary = Path(name)
            with os.fdopen(descriptor, 'wb') as output:
                digest, total = _copy(original, output)
            after = os.fstat(original.fileno())
            if file_version(before) != file_version(after) or total != before.st_size:
                return {**result, 'status': 'source_changed'}
        replace_with_retry(temporary, destination)
        temporary = None
        destination.chmod(0o400)
        harden_windows_path(destination)
        _sync_directory(folder)
        _sync_directory(session)
        result.update(status='ready', path=str(destination), name=source.name, size=total,
                      sha256=digest, file_version=file_version(destination.stat()),
                      verification_scope='byte_copy_sha256')
        connection.execute('INSERT INTO snapshots VALUES(?,?,?)', (session_key, key, json.dumps(result)))
        connection.commit()
        return result
    except ValueError as error:
        return {**result, 'status': 'too_large' if str(error) == 'snapshot_too_large' else 'unavailable'}
    except (OSError, sqlite3.Error):
        return {**result, 'status': 'unavailable'}
    finally:
        if connection is not None:
            connection.close()
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass  # Retained own partial files count against the next quota check.
