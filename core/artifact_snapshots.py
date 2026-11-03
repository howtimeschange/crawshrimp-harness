"""Private, session-scoped byte snapshots; no claim about document correctness."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile

from core.artifact_version import file_version
from core import artifact_storage as storage
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
        storage.schema(connection)
        connection.commit()
        connection.execute('BEGIN IMMEDIATE')
        old = connection.execute('SELECT receipt FROM snapshots WHERE session_key=? AND version_key=?', (session_key, key)).fetchone()
        if old:
            # A missing/modified committed snapshot is not silently rebuilt from
            # a possibly changed original. The download reports its own error.
            receipt = json.loads(old[0])
            if not isinstance(receipt, dict):
                return {**result, 'reason': 'snapshot_index_invalid'}
            if receipt.get('status') == 'deleted':
                # A later explicit final delivery can freeze the still-matching
                # source again; ordinary polling cannot resurrect old drafts.
                if ((record.get('office') or {}).get('delivery') or {}).get('status') != 'final':
                    return receipt
            else:
                destination = Path(receipt.get('path') or '')
                storage_key = receipt.get('storage_key', key)
                if (not isinstance(storage_key, str) or len(storage_key) != 64
                        or destination.parent != session / storage_key or destination.name != receipt.get('name')
                        or any(c not in '0123456789abcdef' for c in storage_key)
                        or not _valid_receipt(receipt, version_id, destination, expected)):
                    return {**result, 'reason': 'snapshot_index_invalid'}
                storage.remember(connection, session_key, key, record)
                connection.commit()
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
            # Content identity is independent of source inode, timestamps and
            # Office job copy paths. Hash before checking quota so unchanged
            # documents still register when the store is full.
            digest = hashlib.file_digest(original, 'sha256').hexdigest()
            if file_version(os.fstat(original.fileno())) != expected:
                return {**result, 'status': 'source_changed'}
            document, protected = storage.policy(record)
            candidates = connection.execute('SELECT s.version_key,s.receipt,p.document_key FROM snapshots s LEFT JOIN snapshot_policy p USING(session_key,version_key) WHERE s.session_key=?', (session_key,)).fetchall()
            shared = None
            for other_key, raw, other_doc in candidates:
                candidate = json.loads(raw)
                if not isinstance(candidate, dict):
                    continue
                if candidate.get('status') != 'ready' or candidate.get('sha256') != digest or candidate.get('size') != before.st_size:
                    continue
                target = Path(candidate.get('path') or '')
                valid = (target.parent.parent == session and not target.is_symlink() and not target.parent.is_symlink()
                         and target.is_file() and file_version(target.stat()) == candidate.get('file_version'))
                if valid:
                    with target.open('rb') as handle:
                        valid = hashlib.file_digest(handle, 'sha256').hexdigest() == digest
                if not valid:
                    if other_doc == document:
                        return {**result, 'reason': 'snapshot_integrity_failed'}
                    continue
                if other_doc == document:
                    storage.remember(connection, session_key, other_key, record)
                    connection.commit()
                    return candidate
                shared = (other_key, candidate)
            if shared:
                other_key, candidate = shared
                result = {**candidate, 'version_id': version_id, 'storage_key': candidate.get('storage_key', other_key)}
                connection.execute('INSERT OR REPLACE INTO snapshots VALUES(?,?,?)', (session_key, key, json.dumps(result)))
                storage.remember(connection, session_key, key, record)
                storage.prune(connection, session_key)
                connection.commit()
                connection.execute('BEGIN IMMEDIATE')
                storage.reclaim(connection, root, session_key)
                connection.commit()
                return result
            original.seek(0)
            folders = [p for p in session.iterdir() if p.is_dir()]
            if any(folder.is_symlink() for folder in folders):
                return result
            # Include orphan temporary/final copies from interrupted writes.
            used = sum(p.stat().st_size for folder in folders for p in folder.iterdir() if p.is_file())
            retiring = storage.retiring_copies(connection, session_key, document) if not protected else set()
            retiring_paths = [Path(p) for p in retiring if Path(p).parent.parent == session and Path(p).is_file() and not Path(p).is_symlink()]
            released_bytes = sum(p.stat().st_size for p in retiring_paths)
            released_folders = sum(all(child in retiring_paths for child in folder.iterdir()) for folder in {p.parent for p in retiring_paths})
            if used + before.st_size - released_bytes > MAX_SESSION_BYTES or len(folders) + 1 - released_folders > MAX_SESSION_VERSIONS:
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
        connection.execute('INSERT OR REPLACE INTO snapshots VALUES(?,?,?)', (session_key, key, json.dumps(result)))
        storage.remember(connection, session_key, key, record)
        storage.prune(connection, session_key)
        connection.commit()
        connection.execute('BEGIN IMMEDIATE')
        storage.reclaim(connection, root, session_key)
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
