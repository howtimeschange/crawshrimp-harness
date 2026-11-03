"""Retention metadata for immutable artifact receipts (never original files)."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time

DRAFT_VERSIONS = 10


def document_key(record):
    path = Path(record.get('source_path') or record.get('path') or '')
    office = record.get('office') or {}
    # Office run/render jobs copy the same document between job directories.
    if isinstance(office, dict) and office.get('job_id') and path.parent.name == 'editable' and path.parent.parent.name == office['job_id']:
        return str(path.parent.parent.parent / path.name)
    return str(path.absolute())


def policy(record):
    office = record.get('office') or {}
    final = isinstance(office, dict) and (office.get('delivery') or {}).get('status') == 'final'
    # Unknown publishers and uploads are protected by default. Only managed
    # Office drafts participate in automatic version trimming.
    draft = isinstance(office, dict) and office.get('job_id') and Path(record.get('filename') or record.get('path') or '').suffix.lower() in {'.pptx', '.docx', '.xlsx', '.pdf'}
    protected = final or record.get('source') in {'upload', 'attachment', 'user'} or record.get('user_uploaded') or not draft
    return document_key(record), bool(protected)


def schema(connection):
    connection.execute('CREATE TABLE IF NOT EXISTS snapshot_policy (session_key TEXT, version_key TEXT, document_key TEXT NOT NULL, protected INTEGER NOT NULL, created REAL NOT NULL, PRIMARY KEY(session_key,version_key))')


def remember(connection, session, key, record):
    document, protected = policy(record)
    connection.execute('INSERT INTO snapshot_policy VALUES(?,?,?,?,?) ON CONFLICT(session_key,version_key) DO UPDATE SET protected=MAX(protected,excluded.protected),created=excluded.created', (session, key, document, int(protected), time.time()))


def prune(connection, session, *, document=None, keep=DRAFT_VERSIONS):
    rows = connection.execute('SELECT s.version_key,s.receipt,p.document_key FROM snapshots s JOIN snapshot_policy p USING(session_key,version_key) WHERE s.session_key=? AND p.protected=0 ORDER BY p.created DESC,s.rowid DESC', (session,)).fetchall()
    counts, removed = {}, 0
    for key, raw, doc in rows:
        receipt = json.loads(raw)
        if not isinstance(receipt, dict):
            continue
        if receipt.get('status') != 'ready' or document is not None and document != doc:
            continue
        counts[doc] = counts.get(doc, 0) + 1
        if counts[doc] <= keep:
            continue
        receipt.update(status='deleted', deleted_at=time.time(), reason='draft_retention')
        connection.execute('UPDATE snapshots SET receipt=? WHERE session_key=? AND version_key=?', (json.dumps(receipt), session, key))
        removed += 1
    return removed


def retiring_copies(connection, session, document):
    """Plan quota after a successful new draft; do not delete before it exists."""
    rows = connection.execute('SELECT s.version_key,s.receipt FROM snapshots s JOIN snapshot_policy p USING(session_key,version_key) WHERE s.session_key=? AND p.document_key=? AND p.protected=0 ORDER BY p.created DESC,s.rowid DESC', (session, document)).fetchall()
    ready = [(key, r) for key, raw in rows if isinstance((r := json.loads(raw)), dict) and r.get('status') == 'ready']
    retired = {key for key, _ in ready[DRAFT_VERSIONS - 1:]}
    all_ready = [(key, r) for key, raw in connection.execute('SELECT version_key,receipt FROM snapshots WHERE session_key=?', (session,)) if isinstance((r := json.loads(raw)), dict) and r.get('status') == 'ready']
    candidates = {r['path'] for key, r in all_ready if key in retired}
    retained = {r['path'] for key, r in all_ready if key not in retired}
    return candidates - retained


def reclaim(connection, root, session):
    """Delete only tombstoned private copies with no surviving references.

    Caller holds BEGIN IMMEDIATE, after committing tombstones. A crash can
    leave extra bytes, but cannot leave a ready receipt for a deleted copy.
    """
    receipts = [r for row in connection.execute('SELECT receipt FROM snapshots WHERE session_key=?', (session,)) if isinstance((r := json.loads(row[0])), dict)]
    live = {r.get('path') for r in receipts if r.get('status') == 'ready'}
    deleted = {r.get('path') for r in receipts if r.get('status') == 'deleted'} - live
    folder = root / session
    if root.is_symlink() or folder.is_symlink():
        return
    for raw in deleted:
        if not raw:
            continue
        path = Path(raw)
        # Never follow a symlink or remove directories outside this store.
        if path.parent.parent != folder or path.parent.is_symlink() or path.is_symlink():
            continue
        try:
            if os.name == 'nt' and path.exists():
                path.chmod(0o600)
            path.unlink(missing_ok=True)
            path.parent.rmdir()
        except OSError:
            pass


def receipts(root, session_id):
    index = Path(root) / 'index.sqlite'
    if not index.is_file() or index.is_symlink():
        return {}
    session = hashlib.sha256(session_id.encode()).hexdigest()
    with sqlite3.connect(f'file:{index}?mode=ro', uri=True) as connection:
        return {r['version_id']: r for (raw,) in connection.execute('SELECT receipt FROM snapshots WHERE session_key=?', (session,)) if isinstance((r := json.loads(raw)), dict) and r.get('version_id')}


def overlay(record, current):
    receipt = current.get((record.get('file_snapshot') or {}).get('version_id'))
    if receipt and receipt.get('status') == 'deleted':
        return {**record, 'path': '', 'file_snapshot': receipt, 'exists': False}
    return record


def usage(root, session_id):
    folder = Path(root) / hashlib.sha256(session_id.encode()).hexdigest()
    from core.artifact_snapshots import MAX_SESSION_BYTES, MAX_SESSION_VERSIONS
    folders = [p for p in folder.iterdir() if p.is_dir() and not p.is_symlink()] if folder.is_dir() else []
    used = sum(p.stat().st_size for d in folders for p in d.iterdir() if p.is_file() and not p.is_symlink())
    count = len(folders)
    return {'bytes': used, 'versions': count, 'max_bytes': MAX_SESSION_BYTES, 'max_versions': MAX_SESSION_VERSIONS,
            'near_limit': used >= MAX_SESSION_BYTES * .8 or count >= MAX_SESSION_VERSIONS * .8,
            'full': used >= MAX_SESSION_BYTES or count >= MAX_SESSION_VERSIONS}


def maintain_session(root, session_id, events, *, clear_process=False, now=None):
    """Backfill legacy policy and reclaim only disposable snapshots."""
    from datetime import datetime
    from core.office.artifacts import is_office_working_image
    now = time.time() if now is None else now
    root = Path(root)
    index = root / 'index.sqlite'
    if not index.is_file() or index.is_symlink() or root.is_symlink() or (root / hashlib.sha256(session_id.encode()).hexdigest()).is_symlink():
        return {'removed': 0}
    session = hashlib.sha256(session_id.encode()).hexdigest()
    protected, working = set(), {}
    with sqlite3.connect(index, timeout=5) as connection:
        schema(connection)
        connection.commit()
        connection.execute('BEGIN IMMEDIATE')
        by_id = {r.get('version_id'): (key, r) for key, raw in connection.execute('SELECT version_key,receipt FROM snapshots WHERE session_key=?', (session,)) if isinstance((r := json.loads(raw)), dict)}
        for event in events:
            record = event['payload']
            found = by_id.get((record.get('file_snapshot') or {}).get('version_id'))
            if not found:
                continue
            key, receipt = found
            if is_office_working_image(record):
                try:
                    created = datetime.fromisoformat(event['created_at'].replace('Z', '+00:00')).timestamp()
                except (KeyError, ValueError):
                    created = now
                working[key] = max(working.get(key, 0), created)
            else:
                remember(connection, session, key, record)
                if policy(record)[1]:
                    protected.add(key)
        removed = 0
        for key, created in working.items():
            receipt = next(r for k, r in by_id.values() if k == key)
            if key not in protected and receipt.get('status') == 'ready' and (clear_process or now - created >= 7 * 86400):
                receipt.update(status='deleted', deleted_at=now, reason='process_cache_retention')
                connection.execute('UPDATE snapshots SET receipt=? WHERE session_key=? AND version_key=?', (json.dumps(receipt), session, key))
                removed += 1
        removed += prune(connection, session)
        connection.commit()
        connection.execute('BEGIN IMMEDIATE')
        reclaim(connection, root, session)
        connection.commit()
    return {'removed': removed, 'storage': usage(root, session_id)}
