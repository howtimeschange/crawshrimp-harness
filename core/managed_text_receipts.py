"""Durable request identities for official text calls; no prompts or credentials.

A record is committed before dispatch.  Unfinished records remain ambiguous
across crashes and can only be checked with the broker's read-only trace API.
"""
import json
import os
import re
import sqlite3
import uuid
from contextlib import contextmanager
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler

from core import managed_models, runtime_paths
from core.windows_acl import assert_no_reparse_components_windows, harden_windows_path


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _same_session(current, after):
    return bool(after) and all(after.get(k) == current.get(k) for k in (
        'accountId', 'accountServiceOrigin', 'brokerToken', 'baseURL',
        'desktopRuntimeEpoch', 'accountSessionEpoch',
    ))


@contextmanager
def _connect(*, read_only=False):
    root = runtime_paths.data_root()
    path = root / 'managed-text-receipts.sqlite3'
    assert_no_reparse_components_windows(root)
    harden_windows_path(root)
    assert_no_reparse_components_windows(path, allow_missing=True)
    if path.is_symlink():
        raise OSError('invalid receipt storage')
    if not read_only and not path.exists():
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(fd)
        except FileExistsError:
            pass
    assert_no_reparse_components_windows(path)
    harden_windows_path(path)
    db = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=10) if read_only else sqlite3.connect(str(path), timeout=10)
    if not read_only and os.name != 'nt':
        os.chmod(path, 0o600)
    try:
        if not read_only:
            db.execute('PRAGMA synchronous=FULL')
            db.execute('BEGIN IMMEDIATE')
            db.execute('CREATE TABLE IF NOT EXISTS receipts (request_id TEXT PRIMARY KEY, owner TEXT NOT NULL, issuer TEXT, model TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
            if 'issuer' not in {column[1] for column in db.execute('PRAGMA table_info(receipts)')}:
                db.execute('ALTER TABLE receipts ADD COLUMN issuer TEXT')
            db.commit()
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def create(owner, issuer, model):
    if not isinstance(issuer, str) or not issuer.strip():
        raise ValueError('account service identity unavailable')
    request_id = str(uuid.uuid4())
    with _connect() as db:
        db.execute('INSERT INTO receipts (request_id, owner, issuer, model, state) VALUES (?, ?, ?, ?, ?)', (request_id, owner, issuer, model, 'unknown'))
    return request_id


def complete(request_id):
    with _connect() as db:
        db.execute("UPDATE receipts SET state='completed' WHERE request_id=?", (request_id,))


def list_current(*, offset=0, limit=101):
    offset = max(0, int(offset))
    limit = min(101, max(1, int(limit)))
    current = managed_models.session()
    if not current or not current.get('accountId') or not current.get('accountServiceOrigin'):
        return []
    if not (runtime_paths.data_root() / 'managed-text-receipts.sqlite3').exists():
        return []
    with _connect(read_only=True) as db:
        if 'issuer' not in {column[1] for column in db.execute('PRAGMA table_info(receipts)')}:
            return []
        rows = db.execute("SELECT request_id, model, state, created_at FROM receipts WHERE owner=? AND issuer=? ORDER BY CASE WHEN state='unknown' THEN 0 ELSE 1 END, rowid DESC LIMIT ? OFFSET ?", (current['accountId'], current['accountServiceOrigin'], limit, offset)).fetchall()
    if not _same_session(current, managed_models.session()):
        return []
    return [dict(zip(('request_id', 'model', 'state', 'created_at'), row)) for row in rows]


def trace(request_id):
    if not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', str(request_id)):
        return {'status': 'identity_unavailable'}
    current = managed_models.session()
    if not current or not current.get('accountId') or not current.get('accountServiceOrigin'):
        return {'status': 'account_changed'}
    if not (runtime_paths.data_root() / 'managed-text-receipts.sqlite3').exists():
        return {'status': 'identity_unavailable'}
    with _connect(read_only=True) as db:
        if 'issuer' not in {column[1] for column in db.execute('PRAGMA table_info(receipts)')}:
            return {'status': 'identity_unavailable'}
        row = db.execute('SELECT owner, issuer FROM receipts WHERE request_id=?', (request_id,)).fetchone()
    if not row or row != (current['accountId'], current['accountServiceOrigin']):
        return {'status': 'account_changed'}
    request = Request(current['baseURL'] + '/account/requests/' + request_id, headers={'Authorization': 'Bearer ' + current['brokerToken']}, method='GET')
    try:
        with build_opener(ProxyHandler({}), _NoRedirect()).open(request, timeout=35) as response:
            raw = response.read(8193)
        if len(raw) > 8192:
            raise ValueError('response too large')
        data = json.loads(raw)
        after = managed_models.session()
        if not _same_session(current, after):
            return {'status': 'account_changed'}
        if not isinstance(data, dict) or 'request' not in data:
            raise ValueError('invalid trace')
        result = data['request']
        if result is None:
            return {'status': 'not_found', 'request_id': request_id}
        if not isinstance(result, dict) or result.get('requestId') != request_id or result.get('state') not in ('in_progress', 'completed', 'unknown', 'upstream_rejected', 'not_dispatched', 'failed', 'canceled'):
            raise ValueError('invalid trace')
        return {'status': 'found', 'request_id': request_id, 'state': result['state'], 'billing_request_id': result.get('billingRequestId')}
    except (OSError, ValueError, TypeError):
        if not _same_session(current, managed_models.session()):
            return {'status': 'account_changed'}
        return {'status': 'unavailable', 'request_id': request_id}
