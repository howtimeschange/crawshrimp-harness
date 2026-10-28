"""Read bounded chunks from server-registered artifacts, never caller paths."""
import base64
import hashlib
import mimetypes
import os
from collections import OrderedDict
from pathlib import Path
from fastapi import HTTPException

from core.artifact_version import file_version

_hashes = OrderedDict()


def artifact_chunk(record, artifact_id, offset, length, expected=''):
    if not record: raise HTTPException(404, 'Artifact not registered in this session')
    if offset < 0 or not 1 <= length <= 96*1024: raise HTTPException(400, 'Invalid chunk range')
    snapshot = record.get('file_snapshot')
    if 'file_snapshot' in record:
        if not isinstance(snapshot, dict): raise HTTPException(409, 'Snapshot receipt is invalid')
        if snapshot.get('status') in ('too_large', 'quota_exceeded'):
            raise HTTPException(413, 'Artifact snapshot exceeds storage limit')
        if snapshot.get('status') != 'ready': raise HTTPException(409, 'Artifact snapshot is unavailable; inspect its delivery')
        if (not isinstance(snapshot.get('path'), str) or not snapshot.get('file_version')
                or not isinstance(snapshot.get('sha256'), str) or len(snapshot['sha256']) != 64):
            raise HTTPException(409, 'Snapshot receipt is invalid')
        # No fallback to the original even if the copy was removed or damaged.
        record = {**record, 'path': snapshot['path'], 'file_version': snapshot['file_version']}
    path = Path(str(record.get('path', '')))
    try:
        # Validate the opened handle without waiting for a replaced FIFO writer.
        descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NONBLOCK', 0))
        with os.fdopen(descriptor, 'rb') as f:
            stat = os.fstat(f.fileno())
            import stat as stat_module
            if not stat_module.S_ISREG(stat.st_mode): raise HTTPException(400, 'Not a regular file')
            # Also pin the FIRST chunk to the registered source version. The
            # client hash only protects chunks after its first successful read.
            # Legacy events have no version and retain their existing protocol;
            # a present but unknown/corrupt version must never disable this guard.
            if 'file_version' in record and record['file_version'] != file_version(stat):
                raise HTTPException(409, 'Registered artifact changed; refresh its delivery')
            total = stat.st_size
            if total > 64*1024*1024: raise HTTPException(413, 'Artifact exceeds size limit')
            if offset > total: raise HTTPException(416, 'Offset exceeds artifact size')
            key = (str(path), stat.st_dev, stat.st_ino, total, stat.st_mtime_ns, stat.st_ctime_ns)
            digest = _hashes.get(key)
            if digest is None:
                digest = hashlib.file_digest(f, 'sha256').hexdigest()
                _hashes[key] = digest
                while len(_hashes) > 32: _hashes.popitem(last=False)
            if snapshot and digest != snapshot['sha256']:
                raise HTTPException(409, 'Artifact snapshot integrity check failed')
            if (offset and not expected) or (expected and expected != digest): raise HTTPException(409, 'Artifact changed; restart download')
            f.seek(offset);raw = f.read(length)
            after = os.fstat(f.fileno())
            if (stat.st_size,stat.st_mtime_ns,stat.st_ctime_ns) != (after.st_size,after.st_mtime_ns,after.st_ctime_ns):
                _hashes.pop(key, None)
                raise HTTPException(409, 'Artifact changed; restart download')
    except (OSError, ValueError): raise HTTPException(404, 'Artifact unavailable')
    return {'artifactId':artifact_id,'name':path.name,'mime':mimetypes.guess_type(path.name)[0] or 'application/octet-stream',
            'total':total,'offset':offset,'data':base64.b64encode(raw).decode(),'sha256':digest,
            'chunkSha256':hashlib.sha256(raw).hexdigest(),'nextOffset':offset+len(raw),'eof':offset+len(raw)==total}
