"""Serialize short approval read/modify/write transactions across local callers."""
from contextlib import contextmanager
from pathlib import Path
import os
if os.name == "nt":
    import msvcrt
else:
    import fcntl
import threading

_locks = {}
_guard = threading.Lock()


@contextmanager
def approval_batch_lock(json_path):
    if not str(json_path or '').strip():
        yield
        return
    path = Path(json_path).expanduser().resolve()
    with _guard:
        lock = _locks.setdefault(str(path), threading.RLock())
    with lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.with_suffix(path.suffix + '.lock').open('a') as handle:
            if os.name == "nt":
                handle.write(" "); handle.flush(); handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_EX)
            try:
                yield
            finally:
                if os.name == "nt":
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(handle, fcntl.LOCK_UN)
