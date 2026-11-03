"""Bounded periodic cleanup of completed Office caches and draft snapshots."""
import hashlib
import json
from pathlib import Path
import time

from core import artifact_storage, runtime_paths
from core.office.artifacts import IMAGE_SUFFIXES, is_office_working_image

PROCESS_TTL_SECONDS = 7 * 86400


def clean_office_cache(root, *, protected_paths=(), active_sessions=(), now=None, direct_jobs=False):
    from core.office import jobs
    now = time.time() if now is None else now
    root = Path(root)
    protected = {str(Path(p).absolute()) for p in protected_paths}
    removed = 0
    if not root.is_dir() or root.is_symlink():
        return removed
    for manifest in root.glob('*/manifest.json' if direct_jobs else '*/*/manifest.json'):
        work = manifest.parent
        if any(p.is_symlink() for p in (manifest, work, work.parent)) or work.parent.name in active_sessions:
            continue
        with jobs._lock:
            if str(work.resolve()) in jobs._live:
                continue
            try:
                data = json.loads(manifest.read_text())
                finished = data.get('finished_at', manifest.stat().st_mtime)
                if data.get('state') not in {'completed', 'failed', 'canceled', 'interrupted'} or now - finished < PROCESS_TTL_SECONDS:
                    continue
                for folder_name in ('editable', 'preview'):
                    folder = work / folder_name
                    if folder.is_symlink():
                        continue
                    for path in folder.rglob('*'):
                        if (not path.is_file() or path.is_symlink() or any((folder / p).is_symlink() for p in path.relative_to(folder).parents)):
                            continue
                        if not path.resolve().is_relative_to(work.resolve()) or str(path.absolute()) in protected:
                            continue
                        if path.suffix.lower() not in IMAGE_SUFFIXES and not (folder_name == 'preview' and path.suffix.lower() == '.pdf'):
                            continue
                        if now - path.stat().st_mtime < PROCESS_TTL_SECONDS:
                            continue
                        path.unlink()
                        removed += 1
            except (OSError, ValueError, TypeError):
                continue
    return removed


def session_events(session_id):
    from core.agent import db
    connection = db._conn()
    try:
        return [{'payload': json.loads(raw), 'created_at': created} for raw, created in connection.execute("SELECT payload_json,created_at FROM agent_events WHERE session_id=? AND event_type='artifact.created' ORDER BY seq", (session_id,))]
    finally:
        connection.close()


def maintain(*, session_id=None, clear_process=False):
    from core.agent import db
    connection = db._conn()
    try:
        session_ids = [session_id] if session_id else [row[0] for row in connection.execute('SELECT session_id FROM agent_sessions')]
        active = {hashlib.sha256(row[0].encode()).hexdigest()[:24] for row in connection.execute("SELECT DISTINCT session_id FROM agent_runs WHERE status NOT IN ('completed','failed','canceled','interrupted','stopped','succeeded')")}
        protected = [row[0] for row in connection.execute('SELECT path FROM agent_attachments')]
    finally:
        connection.close()
    removed = 0
    for sid in session_ids:
        events = session_events(sid)
        for event in events:
            record = event['payload']
            if not is_office_working_image(record):
                protected.append(record.get('source_path') or record.get('path') or '')
        result = artifact_storage.maintain_session(db.artifact_snapshot_root(), sid, events, clear_process=clear_process)
        removed += result['removed']
    # Cross-session cache cleanup must protect explicitly delivered images from
    # every session, so scoped user actions only reclaim snapshot copies.
    cache_removed = 0
    if not session_id:
        from core.agent import mcp_gateway
        workspace = Path(mcp_gateway.ctx.workspace_root or runtime_paths.data_root() / 'agent/workspace')
        cache_removed = clean_office_cache(workspace / 'outputs/office', protected_paths=protected, active_sessions=active)
        cache_removed += clean_office_cache(runtime_paths.data_root() / 'agent/previews/office', protected_paths=protected, direct_jobs=True)
    return {'removed': removed, 'cache_files_removed': cache_removed}
