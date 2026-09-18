"""Lossless cold-log compression; active buffers and user records are preserved."""
import gzip
import os
import shutil
import time
from pathlib import Path
from uuid import uuid4


def restore_log(path: Path):
    archived = path.with_suffix(path.suffix + '.gz')
    if path.exists() or not archived.exists():
        return
    temp = path.with_name(path.name + '.restore-' + uuid4().hex)
    try:
        with gzip.open(archived, 'rb') as source, temp.open('wb') as dest:
            shutil.copyfileobj(source, dest, length=256 * 1024)
        os.replace(temp, path)
        archived.unlink()
    finally:
        temp.unlink(missing_ok=True)


def archive_cold_logs(root: Path, *, older_days=30, max_files=4, cancel=None):
    from core.run_logs import _registry_lock, _live_buffers
    from core.log_writer import flush_logs
    if not root.exists():
        return {'archived': 0, 'saved_bytes': 0}
    cutoff = time.time() - max(1, older_days) * 86400
    count = saved = 0
    # Avoid materializing all directory entries for large histories.
    with os.scandir(root) as entries:
        for visited, entry in enumerate(entries):
            if visited >= 5000 or count >= max_files or (cancel and cancel.is_set()):
                break
            if not entry.name.endswith('.jsonl') or not entry.is_file(follow_symlinks=False):
                continue
            path = Path(entry.path); stat = path.stat()
            if stat.st_mtime >= cutoff or stat.st_size > 64 * 1024 * 1024:
                continue
            with _registry_lock:
                if any(b.path == path for b in list(_live_buffers.values())):
                    continue
            temp = path.with_name(path.name + '.compress-' + uuid4().hex)
            try:
                with path.open('rb') as source, gzip.open(temp, 'wb', compresslevel=3) as dest:
                    while chunk := source.read(256 * 1024):
                        if cancel and cancel.is_set():
                            return {'archived': count, 'saved_bytes': saved}
                        dest.write(chunk)
                # Recheck after compression; a resumed task must never lose writes.
                with _registry_lock:
                    if any(b.path == path for b in list(_live_buffers.values())):
                        continue
                    flush_logs(path)
                    current = path.stat()
                    if (current.st_ino, current.st_size, current.st_mtime_ns) != (stat.st_ino, stat.st_size, stat.st_mtime_ns):
                        continue
                    compressed_size = temp.stat().st_size
                    if compressed_size >= stat.st_size:
                        continue
                    os.replace(temp, path.with_suffix('.jsonl.gz'))
                    path.unlink()
                    count += 1; saved += stat.st_size - compressed_size
            except OSError:
                continue
            finally:
                temp.unlink(missing_ok=True)
    return {'archived': count, 'saved_bytes': saved}
