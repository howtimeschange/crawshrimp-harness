"""Windows DACL hardening for user-owned Crawshrimp runtime state."""

from __future__ import annotations

import os
import stat
import threading
from pathlib import Path
from typing import Any


class WindowsAclError(PermissionError):
    """Raised when a Windows runtime path cannot be restricted safely."""


_hardened_paths: dict[str, tuple[int, int, int, int, int]] = {}
_hardened_paths_lock = threading.RLock()


def _is_windows() -> bool:
    return os.name == "nt"


def assert_safe_windows_data_root(path: Path | str) -> Path:
    """Reject broad Windows directories before applying a protected DACL."""
    target = Path(path).expanduser().absolute()
    if not _is_windows():
        return target

    target_identity = os.path.normcase(os.path.abspath(str(target)))
    home_dir = Path.home()
    broad_roots = {target.anchor, str(home_dir), str(home_dir.parent)}
    broad_roots.update(
        str(os.environ.get(name) or "").strip()
        for name in (
            "USERPROFILE",
            "LOCALAPPDATA",
            "APPDATA",
            "SystemRoot",
            "WINDIR",
            "ProgramFiles",
            "ProgramFiles(x86)",
            "ProgramData",
            "ALLUSERSPROFILE",
            "PUBLIC",
        )
    )
    user_profile = str(os.environ.get("USERPROFILE") or "").strip()
    if user_profile:
        broad_roots.add(str(Path(user_profile).parent))
    broad_identities = {
        os.path.normcase(os.path.abspath(value))
        for value in broad_roots
        if value
    }
    if target_identity in broad_identities:
        raise WindowsAclError(
            f"CRAWSHRIMP_DATA must be a dedicated child directory, not a broad system or user directory: {target}"
        )
    return target


def _load_pywin32() -> tuple[Any, Any, Any, Any]:
    try:
        import ntsecuritycon
        import win32api
        import win32con
        import win32security
    except ImportError as exc:
        raise WindowsAclError("pywin32 is required to secure Crawshrimp data on Windows") from exc
    return win32security, win32api, win32con, ntsecuritycon


def _is_reparse_point(target: Path) -> bool:
    metadata = target.lstat()
    attributes = int(getattr(metadata, "st_file_attributes", 0) or 0)
    return target.is_symlink() or bool(attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0))


def assert_no_reparse_components_windows(
    path: Path | str,
    *,
    allow_missing: bool = False,
) -> Path:
    """Reject a Windows path whose existing components traverse a reparse point."""
    target = Path(path).expanduser().absolute()
    if not _is_windows():
        return target

    current = Path(target.anchor)
    for part in target.parts[1:]:
        current = current / part
        try:
            if _is_reparse_point(current):
                raise WindowsAclError(
                    f"Refusing a Windows runtime path through a reparse point: {current}"
                )
        except FileNotFoundError as exc:
            if allow_missing:
                return target
            raise WindowsAclError(f"Windows runtime path does not exist: {current}") from exc

    try:
        resolved = target.resolve(strict=True)
    except OSError as exc:
        if allow_missing:
            return target
        raise WindowsAclError(f"Unable to resolve Windows runtime path: {target}") from exc
    if os.path.normcase(os.path.abspath(str(resolved))) != os.path.normcase(os.path.abspath(str(target))):
        raise WindowsAclError(f"Refusing a Windows runtime path through a reparse point: {target}")
    return resolved


def harden_windows_path(path: Path | str) -> bool:
    """Replace a Windows path DACL with current-user, SYSTEM, and admin access."""
    if not _is_windows():
        return False

    target = Path(path)
    identity = os.path.normcase(os.path.abspath(str(target)))
    with _hardened_paths_lock:
        current_file_identity = _file_identity(target)
        if _hardened_paths.get(identity) == current_file_identity:
            return True
        _apply_windows_dacl(target)
        # Atomic replacement creates a new filesystem object at the same path.
        # Cache the object identity, not only the path string, so the replacement
        # receives a fresh DACL on the next hardening pass.
        _hardened_paths[identity] = _file_identity(target)
    return True


def _file_identity(target: Path) -> tuple[int, int, int, int, int]:
    metadata = target.stat(follow_symlinks=False)
    return (
        int(metadata.st_dev),
        int(metadata.st_ino),
        int(getattr(metadata, "st_ctime_ns", 0) or 0),
        int(getattr(metadata, "st_mtime_ns", 0) or 0),
        int(metadata.st_size),
    )


def _apply_windows_dacl(target: Path) -> None:
    try:
        if _is_reparse_point(target):
            raise WindowsAclError(f"Refusing to apply a Windows ACL through a reparse point: {target}")
        if not target.is_dir() and not target.is_file():
            raise WindowsAclError(f"Windows ACL target must be a regular file or directory: {target}")

        win32security, win32api, win32con, ntsecuritycon = _load_pywin32()
        token = win32security.OpenProcessToken(win32api.GetCurrentProcess(), win32con.TOKEN_QUERY)
        try:
            current_user_sid = win32security.GetTokenInformation(token, win32security.TokenUser)[0]
        finally:
            close = getattr(token, "Close", None)
            if callable(close):
                close()

        allowed_sids = (
            current_user_sid,
            win32security.CreateWellKnownSid(win32security.WinLocalSystemSid, None),
            win32security.CreateWellKnownSid(win32security.WinBuiltinAdministratorsSid, None),
        )
        inheritance = 0
        if target.is_dir():
            inheritance = win32con.OBJECT_INHERIT_ACE | win32con.CONTAINER_INHERIT_ACE

        dacl = win32security.ACL()
        for sid in allowed_sids:
            dacl.AddAccessAllowedAceEx(
                win32security.ACL_REVISION_DS,
                inheritance,
                ntsecuritycon.FILE_ALL_ACCESS,
                sid,
            )
        descriptor = win32security.SECURITY_DESCRIPTOR()
        descriptor.SetSecurityDescriptorDacl(True, dacl, False)
        security_information = (
            win32security.DACL_SECURITY_INFORMATION
            | win32security.PROTECTED_DACL_SECURITY_INFORMATION
        )
        win32security.SetFileSecurity(str(target), security_information, descriptor)
    except WindowsAclError:
        raise
    except Exception as exc:
        raise WindowsAclError(f"Unable to secure Windows runtime path: {target}") from exc
