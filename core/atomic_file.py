"""Crash-safe local file replacement with bounded sharing-violation retries."""

from __future__ import annotations

import errno
import json
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any, Callable, Iterable


DEFAULT_RETRY_DELAYS = (0.025, 0.075, 0.15, 0.3)
_RETRYABLE_ERRNOS = {errno.EACCES, errno.EBUSY, errno.ENOTEMPTY, errno.EPERM}
_RETRYABLE_WINERRORS = {5, 32, 33, 145}


def _retryable_file_error(exc: OSError) -> bool:
    if getattr(exc, "errno", None) in _RETRYABLE_ERRNOS:
        return True
    if getattr(exc, "winerror", None) in _RETRYABLE_WINERRORS:
        return True
    message = str(exc)
    return any(f"WinError {code}" in message for code in _RETRYABLE_WINERRORS)


def retry_file_operation(
    operation: Callable[[], Any],
    *,
    delays: Iterable[float] = DEFAULT_RETRY_DELAYS,
    sleep: Callable[[float], None] = time.sleep,
) -> Any:
    retry_delays = tuple(max(0.0, float(delay)) for delay in delays)
    for attempt in range(len(retry_delays) + 1):
        try:
            return operation()
        except OSError as exc:
            if attempt >= len(retry_delays) or not _retryable_file_error(exc):
                raise
            sleep(retry_delays[attempt])
    raise RuntimeError("unreachable")


def replace_with_retry(source: Path | str, target: Path | str) -> None:
    retry_file_operation(lambda: os.replace(source, target))


def remove_path_with_retry(path: Path | str) -> None:
    target = Path(path)

    def remove() -> None:
        try:
            if target.is_symlink():
                target.unlink()
            elif target.exists():
                if target.is_dir():
                    shutil.rmtree(target)
                else:
                    target.unlink()
        except FileNotFoundError:
            # Another cleanup path won the race; removal is already complete.
            return

    retry_file_operation(remove)


def _set_descriptor_mode(descriptor: int, mode: int) -> None:
    """Apply a private POSIX mode when the runtime exposes descriptor chmod."""
    fchmod = getattr(os, "fchmod", None)
    if not callable(fchmod):
        return
    try:
        fchmod(descriptor, mode)
    except OSError:
        pass


def atomic_write_json(
    path: Path | str,
    payload: Any,
    *,
    ensure_ascii: bool = False,
    indent: int | None = 2,
    mode: int = 0o600,
) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{target.name}.",
        suffix=".tmp",
        dir=str(target.parent),
    )
    temporary = Path(temporary_name)
    try:
        _set_descriptor_mode(descriptor, mode)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            descriptor = -1
            json.dump(payload, handle, ensure_ascii=ensure_ascii, indent=indent)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        replace_with_retry(temporary, target)
        try:
            os.chmod(target, mode)
        except OSError:
            pass
        _fsync_parent(target.parent)
    finally:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        try:
            remove_path_with_retry(temporary)
        except OSError:
            pass


def atomic_write_text(path: Path | str, text: str, *, mode: int = 0o600) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{target.name}.", suffix=".tmp", dir=str(target.parent)
    )
    temporary = Path(temporary_name)
    try:
        _set_descriptor_mode(descriptor, mode)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            descriptor = -1
            handle.write(str(text))
            handle.flush()
            os.fsync(handle.fileno())
        replace_with_retry(temporary, target)
        try:
            os.chmod(target, mode)
        except OSError:
            pass
        _fsync_parent(target.parent)
    finally:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        try:
            remove_path_with_retry(temporary)
        except OSError:
            pass


def _fsync_parent(parent: Path) -> None:
    if os.name != "posix":
        return
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    descriptor = None
    try:
        descriptor = os.open(parent, flags)
        os.fsync(descriptor)
    except OSError:
        pass
    finally:
        if descriptor is not None:
            try:
                os.close(descriptor)
            except OSError:
                pass
