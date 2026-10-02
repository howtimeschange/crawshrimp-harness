"""Explicit tool-output manifests -> verified file deliveries, never guesses from prose."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path


def verified_artifact(raw, *, source: str, run_id: str = '', tool_call_id: str = '', workspace=None):
    item = raw if isinstance(raw, dict) else {'path': raw}
    path = item.get('path') or item.get('document')
    if not isinstance(path, str) or not path.strip():
        return None
    target = Path(path).expanduser()
    if not target.is_absolute():
        if not workspace:
            return None
        target = Path(workspace) / target
    try:
        target = target.resolve()
        if not target.is_file():
            return None
        stat = target.stat()
    except OSError:
        return None
    from core.agent.service import _classify_artifact_media
    media, images = _classify_artifact_media(target.name, str(target))
    return {'task_instance_uid': item.get('task_instance_uid') or '', 'artifact_id': item.get('artifact_id') or item.get('id') or
            'file-' + hashlib.sha256(f'{target}\0{stat.st_mtime_ns}\0{stat.st_size}'.encode()).hexdigest()[:24],
            'filename': target.name, 'path': str(target), 'kind': 'file', 'size': stat.st_size,
            'media_kind': media, 'zip_images': images, 'source': source,
            'run_id': run_id, 'tool_call_id': tool_call_id, 'verified': True,
            'verification': {'status': 'exists', 'mtime_ns': stat.st_mtime_ns}}


def _successful_manifest(data):
    return (isinstance(data, dict) and data.get('ok') is not False
            and data.get('status') not in ('failed', 'rejected', 'canceled')
            and data.get('exit_code') in (None, 0) and data.get('exitCode') in (None, 0))


def collect_tool_deliveries(call: dict, result_text: str, workspace=None):
    try:
        envelope = json.loads(result_text)
    except (ValueError, TypeError):
        return []
    if not _successful_manifest(envelope):
        return []
    name = str(call.get('tool_name') or '').split('__')[-1]
    data = envelope.get('data') if isinstance(envelope.get('data'), dict) else envelope
    if name in ('fs_exec', 'bash', 'shell'):
        # Commands can explicitly print a JSON manifest. Ordinary output is not a delivery claim.
        if not _successful_manifest(data):
            return []
        if 'stdout' in data or 'output' in data:
            try:
                data = json.loads(data.get('stdout') or data.get('output') or '{}')
            except (ValueError, TypeError):
                return []
        elif name != 'bash':
            return []
        # Native bash renders stdout directly; it is already decoded above.
    if not _successful_manifest(data):
        return []
    source = 'shell' if name in ('fs_exec', 'bash', 'shell', 'fs_write', 'write', 'artifact_present') else 'adapter'
    candidates = data.get('artifacts') or data.get('output_files') or data.get('files') or []
    if name in ('fs_write', 'write') and data.get('path'):
        candidates = [data]
    if not isinstance(candidates, list):
        return []
    result, seen = [], set()
    for raw in candidates[:100]:
        item = verified_artifact(raw, source=source, run_id=call.get('run_id', ''),
                                 tool_call_id=call.get('tool_call_id', ''), workspace=workspace)
        if item and item['path'] not in seen:
            seen.add(item['path']); result.append(item)
    return result
