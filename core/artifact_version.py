"""A registration-time file identity; this is not a content validation receipt."""
from __future__ import annotations

import os
from pathlib import Path
import stat as stat_module


def file_version(stat: os.stat_result) -> dict:
    # JSON numbers lose precision for nanosecond timestamps and large inodes in
    # JS clients. Keep these identifiers opaque through every event projection.
    return {
        'scheme': 'stat-v1',
        'device': str(stat.st_dev),
        'inode': str(stat.st_ino),
        'size': stat.st_size,
        'mtime_ns': str(stat.st_mtime_ns),
        'ctime_ns': str(stat.st_ctime_ns),
    }


def pin_artifact_event(event_type: str, payload, *, session_id: str = '', snapshot_root=None):
    """Pin all durable publishers, including media/Office legacy payload shapes."""
    if event_type != 'artifact.created' or not isinstance(payload, dict):
        return payload
    if 'file_version' in payload:
        pinned = payload
    else:
        pinned = _pin_source(payload)
    if session_id and snapshot_root is not None:
        from core.artifact_snapshots import snapshot
        # Only the local registration boundary can create this receipt. Ignore
        # any snapshot path asserted by a tool/worker payload.
        receipt = snapshot(pinned, session_id, Path(snapshot_root))
        if receipt['status'] == 'ready':
            return {**pinned, 'source_path': pinned['path'], 'source_file_version': pinned.get('file_version'),
                    'path': receipt['path'], 'file_version': receipt['file_version'],
                    'file_snapshot': receipt}
        # A failed snapshot is not a deliverable mutable source. Both SSE and
        # desktop resource consumers use path directly, without the chunk guard.
        return {**pinned, 'source_path': pinned.get('path'),
                'source_file_version': pinned.get('file_version'), 'path': '',
                'file_snapshot': receipt}
    return pinned


def _pin_source(payload):
    version = None
    path = payload.get('path')
    if isinstance(path, str) and path:
        try:
            stat = Path(path).stat()
            if stat_module.S_ISREG(stat.st_mode):
                version = file_version(stat)
        except (OSError, ValueError):
            pass
    # Never re-pin a supplied version to a later file, nor silently fall back
    # if a newly registered path was absent. Historical stored events without
    # this key keep their legacy download semantics.
    return {**payload, 'file_version': version}
