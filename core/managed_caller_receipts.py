"""Read-only desktop view of the DSH managed-caller JSON journal.

The writer and replay fence remain in managed-caller-trace.mjs. A receipt proves
the original request identity, never response completion or billing finality.
"""
import hashlib
import json
import os
import re
import stat
from datetime import datetime, timezone
from urllib.parse import urlsplit

from core import runtime_paths
from core.windows_acl import assert_no_reparse_components_windows

_FILE = re.compile(r'[a-f0-9]{64}\.json')
_HASH = re.compile(r'[a-f0-9]{64}')
_UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')
_MAX_BYTES = 16384


def _owner(current):
    # Match URL.origin in the JS writer, including default ports/trailing slash.
    issuer = urlsplit(current['accountServiceOrigin'])
    host = issuer.hostname
    if (not host or issuer.username is not None or issuer.password is not None
            or issuer.path not in ('', '/') or issuer.query or issuer.fragment
            or not (issuer.scheme == 'https' or issuer.scheme == 'http' and host == '127.0.0.1')):
        raise ValueError('invalid receipt authority')
    host = '[' + host + ']' if ':' in host else host.encode('idna').decode('ascii')
    port = issuer.port
    suffix = ':' + str(port) if port is not None and port != (443 if issuer.scheme == 'https' else 80) else ''
    origin = issuer.scheme + '://' + host + suffix
    return hashlib.sha256((origin + '\0' + current['accountId']).encode()).hexdigest()


def _read_private(path):
    assert_no_reparse_components_windows(path)
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or os.name != 'nt' and before.st_mode & 0o077:
        raise OSError('invalid caller receipt file')
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
    with os.fdopen(os.open(path, flags), 'rb') as stream:
        opened = os.fstat(stream.fileno())
        if (not stat.S_ISREG(opened.st_mode) or opened.st_size > _MAX_BYTES
                or (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino)
                or os.name != 'nt' and opened.st_mode & 0o077):
            raise OSError('invalid caller receipt file')
        raw = stream.read(_MAX_BYTES + 1)
    if len(raw) > _MAX_BYTES:
        raise ValueError('caller receipt too large')
    return json.loads(raw)


def list_current(current):
    """Return only UI fields, scoped by both issuer and account, without writes."""
    owner = _owner(current)
    root = runtime_paths.data_root()
    parent = root / 'managed-caller-receipts'
    directory = parent / owner
    for path in (root, parent, directory):
        try:
            info = path.lstat()
        except FileNotFoundError:
            return []
        assert_no_reparse_components_windows(path)
        if not stat.S_ISDIR(info.st_mode):
            raise OSError('invalid caller receipt directory')
    result = []
    for path in sorted(directory.iterdir()):
        if not _FILE.fullmatch(path.name):
            continue  # Temporary writes are not committed receipts.
        row = _read_private(path)
        if (not isinstance(row, dict) or type(row.get('version')) is not int or row['version'] != 1
                or row.get('operationTag') != path.stem or row.get('ownerNamespace') != owner
                or not isinstance(row.get('callerRequestId'), str) or not _UUID.fullmatch(row['callerRequestId'])
                or row.get('managedRequestId') != row['callerRequestId']
                or not isinstance(row.get('bodySHA256'), str) or not _HASH.fullmatch(row['bodySHA256'])
                or row.get('provider') not in ('crawshrimp-managed-openai', 'crawshrimp-managed-openai-responses')
                or row.get('state') not in ('dispatch_unknown', 'headers_received')
                or not isinstance(row.get('modelId'), str) or not 0 < len(row['modelId']) <= 1024
                or not isinstance(row.get('createdAt'), str)):
            raise ValueError('invalid caller receipt')
        created = datetime.fromisoformat(row['createdAt'].replace('Z', '+00:00'))
        if created.tzinfo is None:
            raise ValueError('invalid caller receipt date')
        result.append({
            'request_id': row['callerRequestId'], 'model': row['modelId'],
            # Receiving HTTP headers is not proof that the body completed.
            'state': 'unknown',
            'created_at': created.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
        })
    return result
