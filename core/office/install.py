"""Install hash-pinned LibreOffice assets into the user data cache on demand."""
from __future__ import annotations

import json
import os
import signal
import shutil
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Callable

from core import runtime_paths
from core.atomic_file import atomic_write_json
from core.office.runtime import OfficeError, file_hash, target_id

SCHEMA_VERSION = 1
STAGING_VERSION = 3
MAC_TEAM_IDENTIFIER = "7P5S3ZLCN7"
DOWNLOAD_TIMEOUT_SECONDS = 30.0
TOTAL_DOWNLOAD_TIMEOUT_SECONDS = 1800.0
LOCK_TIMEOUT_SECONDS = TOTAL_DOWNLOAD_TIMEOUT_SECONDS
MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024
_ALLOWED_URL_HOSTS = {
    "download.documentfoundation.org",
    "tdf.mirror.garr.it",
    "ftp.halifax.rwth-aachen.de",
    "raw.githubusercontent.com",
}
_MAC_SIGNATURE_CACHE: dict[tuple, bool] = {}


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _lock_file() -> Path:
    raw = os.environ.get("CRAWSHRIMP_OFFICE_ASSETS_LOCK")
    if raw:
        return Path(raw).expanduser().resolve()
    return _repo_root() / "runtime-locks" / "office-assets.json"


def _cache_root() -> Path:
    raw = os.environ.get("CRAWSHRIMP_OFFICE_CACHE")
    root = Path(raw).expanduser() if raw else runtime_paths.data_root() / "agent" / "runtimes" / "office"
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def _read_lock() -> tuple[dict, Path, str]:
    path = _lock_file()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise OfficeError("OFFICE_LOCK_INVALID", "Office 资源锁文件缺失或无效。") from exc
    if data.get("schemaVersion") != 1:
        raise OfficeError("OFFICE_LOCK_INVALID", "Office 资源锁文件 schemaVersion 必须为 1。")
    fingerprint = file_hash(path)
    return data, path, fingerprint


def _target_entry(lock: dict, target: str) -> dict:
    try:
        entry = lock["targets"][target]
    except KeyError as exc:
        raise OfficeError("OFFICE_PLATFORM_UNSUPPORTED", f"Office 资源不支持当前平台: {target}") from exc
    return entry


def _safe_name(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in ".-_" else "-" for ch in value).strip(".-") or "office"


def _install_dir(lock: dict, target: str, fingerprint: str) -> Path:
    version = _safe_name(str(lock.get("libreofficeVersion") or "unknown"))
    return _cache_root() / f"{version}-{target}-{fingerprint[:16]}"


def installed_root() -> Path:
    lock, _path, fingerprint = _read_lock()
    return _install_dir(lock, target_id(), fingerprint)


def _status_path() -> Path:
    return _cache_root() / "status.json"


def _public_status(payload: dict) -> dict:
    allowed = {"state", "message", "downloaded_bytes", "total_bytes", "filename", "target", "root", "error"}
    return {key: value for key, value in payload.items() if key in allowed and value is not None}


def _write_progress_sidecar(status: dict) -> None:
    sidecar = os.environ.get("CRAWSHRIMP_OFFICE_PROGRESS_FILE", "")
    if sidecar:
        try:
            sidecar_path = Path(sidecar).expanduser().resolve()
            sidecar_path.parent.mkdir(parents=True, exist_ok=True)
            atomic_write_json(sidecar_path, status, ensure_ascii=False)
        except OSError:
            pass


def _write_status(payload: dict, progress: Callable[[dict], None] | None = None) -> None:
    status = _public_status(payload)
    status["updated_at"] = time.time()
    atomic_write_json(_status_path(), status, ensure_ascii=False)
    _write_progress_sidecar(status)
    if progress:
        progress(dict(status))


def _read_status_payload() -> dict | None:
    try:
        status = json.loads(_status_path().read_text(encoding="utf-8"))
        return _public_status(status)
    except (OSError, json.JSONDecodeError):
        return None


def _lock_wait_status() -> dict:
    current = _read_status_payload() or {}
    status = {"state": "waiting", "message": "正在等待 Office 资源安装。"}
    if current.get("state") in {"downloading", "verifying", "extracting"}:
        for key in ("message", "downloaded_bytes", "total_bytes", "filename", "target", "root"):
            if current.get(key) is not None:
                status[key] = current[key]
    status["updated_at"] = time.time()
    return status


def runtime_status() -> dict:
    try:
        lock, _path, fingerprint = _read_lock()
        target = target_id()
        source = _target_entry(lock, target)
        root = installed_root()
        manifest = _read_runtime_manifest(root, lock=lock, fingerprint=fingerprint, source=source, target=target)
        return {"state": "ready", "root": str(root), "target": manifest["target"], "manifest": manifest}
    except OfficeError:
        pass
    try:
        return json.loads(_status_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"state": "missing"}


def _cancelled(cancel) -> bool:
    if cancel is None:
        return False
    if callable(cancel):
        return bool(cancel())
    return bool(getattr(cancel, "is_set", lambda: False)())


def _check_cancel(cancel) -> None:
    if _cancelled(cancel):
        raise OfficeError("OFFICE_CANCELED", "Office 安装已取消。")


def _validate_sha(value: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(ch not in "0123456789abcdef" for ch in value.lower()):
        raise OfficeError("OFFICE_LOCK_INVALID", "Office 资源锁包含无效哈希。")
    return value.lower()


def _filename_from_url(url: str, fallback: str) -> str:
    name = Path(urllib.parse.urlparse(url).path).name
    return _safe_name(name or fallback)


def _validate_pinned_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise OfficeError("OFFICE_LOCK_INVALID", "Office 资源锁包含非官方下载地址。")
    host = parsed.hostname.lower()
    if host not in _ALLOWED_URL_HOSTS:
        raise OfficeError("OFFICE_LOCK_INVALID", "Office 资源锁包含非官方下载地址。")
    if host == "raw.githubusercontent.com" and not parsed.path.startswith("/adobe-fonts/"):
        raise OfficeError("OFFICE_LOCK_INVALID", "Office 字体资源锁包含非官方下载地址。")
    return url


def _entry_urls(entry: dict) -> list[str]:
    urls = [entry.get("url"), *(entry.get("fallbackUrls") or [])]
    result = []
    for url in urls:
        if url and url not in result:
            result.append(_validate_pinned_url(str(url)))
    if not result:
        raise OfficeError("OFFICE_LOCK_INVALID", "Office 资源锁缺少下载地址。")
    return result


def _asset_cache_path(downloads: Path, entry: dict, filename: str | None = None) -> Path:
    sha256 = _validate_sha(entry.get("sha256", ""))
    name = _safe_name(filename or _filename_from_url(str(entry.get("url", "")), sha256))
    return downloads / f"{sha256[:16]}-{name}"


def _download_asset(
    entry: dict,
    downloads: Path,
    *,
    filename: str | None = None,
    cancel=None,
    progress: Callable[[dict], None] | None = None,
    deadline: float | None = None,
) -> Path:
    downloads.mkdir(parents=True, exist_ok=True)
    expected = _validate_sha(entry.get("sha256", ""))
    target = _asset_cache_path(downloads, entry, filename)
    display_name = target.name.split("-", 1)[-1]
    if target.is_file() and file_hash(target) == expected:
        return target
    if target.exists():
        target.unlink()

    failures = []
    last_office_error: OfficeError | None = None
    deadline = deadline or (time.monotonic() + TOTAL_DOWNLOAD_TIMEOUT_SECONDS)
    for url in _entry_urls(entry):
        _check_cancel(cancel)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise OfficeError("OFFICE_DOWNLOAD_TIMEOUT", "Office 资源下载超时。")
        partial = downloads / f".{target.name}.{os.getpid()}.{time.time_ns()}.partial"
        downloaded = 0
        try:
            _write_status({
                "state": "downloading",
                "message": "正在下载 Office 资源",
                "downloaded_bytes": 0,
                "total_bytes": None,
                "filename": display_name,
            }, progress)
            with urllib.request.urlopen(url, timeout=min(DOWNLOAD_TIMEOUT_SECONDS, remaining)) as response, partial.open("wb") as out:
                final_url = getattr(response, "geturl", lambda: url)()
                if urllib.parse.urlparse(final_url).scheme != "https":
                    raise OfficeError("OFFICE_LOCK_INVALID", "Office 下载被重定向到非 HTTPS 地址。")
                total = response.headers.get("Content-Length")
                total_bytes = int(total) if total and total.isdigit() else None
                if total_bytes and total_bytes > MAX_DOWNLOAD_BYTES:
                    raise OfficeError("OFFICE_DOWNLOAD_TOO_LARGE", "Office 资源超过大小上限。")
                while True:
                    _check_cancel(cancel)
                    if time.monotonic() > deadline:
                        raise OfficeError("OFFICE_DOWNLOAD_TIMEOUT", "Office 资源下载超时。")
                    chunk = response.read(1024 * 1024)
                    if time.monotonic() > deadline:
                        raise OfficeError("OFFICE_DOWNLOAD_TIMEOUT", "Office 资源下载超时。")
                    if not chunk:
                        break
                    downloaded += len(chunk)
                    if downloaded > MAX_DOWNLOAD_BYTES:
                        raise OfficeError("OFFICE_DOWNLOAD_TOO_LARGE", "Office 资源超过大小上限。")
                    out.write(chunk)
                    _write_status({
                        "state": "downloading",
                        "message": "正在下载 Office 资源",
                        "downloaded_bytes": downloaded,
                        "total_bytes": total_bytes,
                        "filename": display_name,
                    }, progress)
            _write_status({"state": "verifying", "message": "正在校验 Office 资源", "filename": display_name}, progress)
            if file_hash(partial) != expected:
                raise OfficeError("OFFICE_CHECKSUM_MISMATCH", "Office 资源校验失败。")
            os.replace(partial, target)
            return target
        except OfficeError as exc:
            partial.unlink(missing_ok=True)
            if exc.code in {"OFFICE_CHECKSUM_MISMATCH", "OFFICE_DOWNLOAD_TIMEOUT"}:
                last_office_error = exc
                failures.append(f"{urllib.parse.urlparse(url).hostname}: {exc.code}: {exc}")
                continue
            raise
        except Exception as exc:
            partial.unlink(missing_ok=True)
            failures.append(f"{urllib.parse.urlparse(url).hostname}: {type(exc).__name__}: {exc}")
    if last_office_error and all(("OFFICE_CHECKSUM_MISMATCH" in failure or "OFFICE_DOWNLOAD_TIMEOUT" in failure) for failure in failures):
        raise last_office_error
    raise OfficeError("OFFICE_DOWNLOAD_FAILED", "无法下载已校验的 Office 资源。" + (" " + "; ".join(failures) if failures else ""))


class _FileLock:
    def __init__(
        self,
        path: Path,
        timeout: float | None = None,
        *,
        cancel=None,
        progress: Callable[[dict], None] | None = None,
        deadline: float | None = None,
    ):
        self.path = path
        self.timeout = timeout
        self.cancel = cancel
        self.progress = progress
        self.deadline = deadline
        self.handle = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("a+b")
        deadline = self.deadline or (time.monotonic() + (LOCK_TIMEOUT_SECONDS if self.timeout is None else self.timeout))
        next_progress = 0.0
        while True:
            try:
                if os.name == "nt":
                    import msvcrt
                    self.handle.seek(0)
                    msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except OSError as exc:
                try:
                    _check_cancel(self.cancel)
                except OfficeError:
                    self.handle.close()
                    self.handle = None
                    raise
                if time.monotonic() >= deadline:
                    self.handle.close()
                    self.handle = None
                    raise OfficeError("OFFICE_INSTALL_LOCK_TIMEOUT", "Office 安装正在由另一个进程执行。") from exc
                if self.progress and time.monotonic() >= next_progress:
                    status = _lock_wait_status()
                    _write_progress_sidecar(status)
                    self.progress(status)
                    next_progress = time.monotonic() + 0.5
                elif time.monotonic() >= next_progress:
                    status = _lock_wait_status()
                    _write_progress_sidecar(status)
                    next_progress = time.monotonic() + 0.5
                time.sleep(0.05)

    def __exit__(self, exc_type, exc, tb):
        if not self.handle:
            return
        try:
            if os.name == "nt":
                import msvcrt
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        finally:
            self.handle.close()


def _expected_font_entries(lock: dict, source: dict, target: str) -> list[dict]:
    entries = []
    for font in lock.get("fonts", []):
        filename = _safe_name(font["filename"])
        relative = f"fonts/{filename}" if target.startswith("mac-") else f"{source['fontDirectory'].rstrip('/')}/{filename}"
        entries.append({"path": relative, "sha256": _validate_sha(font["sha256"])})
    return entries


def _read_runtime_manifest(
    root: Path,
    *,
    lock: dict | None = None,
    fingerprint: str | None = None,
    source: dict | None = None,
    target: str | None = None,
) -> dict:
    expected_target = target or target_id()
    try:
        manifest = json.loads((root / "runtime.json").read_text(encoding="utf-8"))
        if manifest["schemaVersion"] != SCHEMA_VERSION or manifest["stagingVersion"] != STAGING_VERSION:
            raise OfficeError("OFFICE_RUNTIME_INCOMPLETE", "Office 安装清单版本不匹配。")
        if manifest["target"] != expected_target:
            raise OfficeError("OFFICE_RUNTIME_MISMATCH", "Office 安装平台与当前平台不匹配。")
        if fingerprint and manifest.get("fingerprint") != fingerprint:
            raise OfficeError("OFFICE_RUNTIME_MISMATCH", "Office 安装锁版本与当前锁不匹配。")
        if source and manifest.get("source", {}).get("sha256") != _validate_sha(source.get("sha256", "")):
            raise OfficeError("OFFICE_RUNTIME_MISMATCH", "Office 安装来源与当前锁不匹配。")
        executable_path = _safe_manifest_path(root, manifest["executable"]["path"])
        if not executable_path.is_file():
            raise OfficeError("OFFICE_RUNTIME_INCOMPLETE", "Office 可执行文件缺失。")
        if "sha256" in manifest["executable"] and file_hash(executable_path) != manifest["executable"]["sha256"]:
            raise OfficeError("OFFICE_RUNTIME_INCOMPLETE", "Office 可执行文件已损坏。")
        expected_fonts = _expected_font_entries(lock, source, expected_target) if lock and source else manifest.get("fonts", [])
        if manifest.get("fonts") != expected_fonts:
            raise OfficeError("OFFICE_RUNTIME_MISMATCH", "Office 字体清单与当前锁不匹配。")
        for entry in expected_fonts:
            path = _safe_manifest_path(root, entry["path"])
            if not path.is_file() or file_hash(path) != entry["sha256"]:
                raise OfficeError("OFFICE_RUNTIME_INCOMPLETE", "Office 安装资源不完整。")
        brand = manifest.get("brandDirectory")
        if manifest["target"].startswith("mac-") and (brand != "brand" or not (root / brand).is_dir()):
            raise OfficeError("OFFICE_RUNTIME_INCOMPLETE", "Office brand 目录缺失。")
        if manifest["target"].startswith("mac-"):
            _verify_mac_signature_cached(root, executable_path)
        return manifest
    except (OSError, KeyError, json.JSONDecodeError) as exc:
        raise OfficeError("OFFICE_RUNTIME_INCOMPLETE", "Office 安装清单缺失或无效。") from exc


def _safe_manifest_path(root: Path, relative: str) -> Path:
    if not isinstance(relative, str) or Path(relative).is_absolute():
        raise OfficeError("OFFICE_RUNTIME_INCOMPLETE", "Office 安装清单包含不安全路径。")
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise OfficeError("OFFICE_RUNTIME_INCOMPLETE", "Office 安装清单包含不安全路径。")
    return path


def _copy_licenses(lock_path: Path, destination: Path) -> None:
    for candidate in (lock_path.parent / "licenses", _repo_root() / "runtime-locks" / "licenses"):
        if candidate.is_dir():
            shutil.copytree(candidate, destination / "licenses", dirs_exist_ok=True)
            return


def _remove_owned_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink(missing_ok=True)
    elif path.exists():
        shutil.rmtree(path, ignore_errors=True)


def _relative_symlink(target: Path, link: Path) -> None:
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to(os.path.relpath(target, link.parent), target_is_directory=target.is_dir())


def _prepare_mac_brand(root: Path, source: dict, font_entries: list[dict]) -> None:
    app = root / "libreoffice" / "LibreOffice.app"
    contents = app / "Contents"
    if not contents.is_dir():
        raise OfficeError("OFFICE_EXTRACT_FAILED", "LibreOffice.app 结构不完整。")
    brand = root / "brand"
    brand.mkdir(parents=True, exist_ok=True)
    for child in contents.iterdir():
        if child.name == "Resources":
            continue
        _relative_symlink(child, brand / child.name)

    resources = contents / "Resources"
    brand_resources = brand / "Resources"
    brand_resources.mkdir(parents=True, exist_ok=True)
    if resources.is_dir():
        for child in resources.iterdir():
            if child.name == "fonts":
                continue
            if child.name == "presets" and child.is_dir():
                shutil.copytree(child, brand_resources / child.name, symlinks=True)
                continue
            _relative_symlink(child, brand_resources / child.name)

    original_font_dir = root / source["fontDirectory"]
    brand_font_dir = brand_resources / "fonts" / "truetype"
    brand_font_dir.mkdir(parents=True, exist_ok=True)
    if original_font_dir.is_dir():
        for child in original_font_dir.iterdir():
            _relative_symlink(child, brand_font_dir / child.name)
    for entry in font_entries:
        _relative_symlink(root / entry["path"], brand_font_dir / Path(entry["path"]).name)


def _verify_mac_signature(app: Path) -> None:
    try:
        verify = subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], text=True, capture_output=True, timeout=60)
        if verify.returncode != 0:
            raise OfficeError("OFFICE_SIGNATURE_INVALID", "LibreOffice 签名校验失败。")
        detail = subprocess.run(["codesign", "-dv", str(app)], text=True, capture_output=True, timeout=30)
        if detail.returncode != 0 or f"TeamIdentifier={MAC_TEAM_IDENTIFIER}" not in (detail.stderr + detail.stdout):
            raise OfficeError("OFFICE_SIGNATURE_INVALID", "LibreOffice 签名团队不匹配。")
    except subprocess.TimeoutExpired as exc:
        raise OfficeError("OFFICE_SIGNATURE_INVALID", "LibreOffice 签名校验超时。") from exc


def _verify_mac_signature_cached(root: Path, executable: Path) -> None:
    app = root / "libreoffice" / "LibreOffice.app"
    try:
        stat = executable.stat()
    except OSError as exc:
        raise OfficeError("OFFICE_RUNTIME_INCOMPLETE", "Office 可执行文件缺失。") from exc
    key = (str(app.resolve(strict=False)), stat.st_size, stat.st_mtime_ns)
    if _MAC_SIGNATURE_CACHE.get(key):
        return
    _verify_mac_signature(app)
    _MAC_SIGNATURE_CACHE[key] = True


def _terminate_process(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True, timeout=15)
    else:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        if os.name == "nt":
            proc.kill()
        else:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        proc.wait(timeout=5)


def _run_checked(argv: list[str], *, timeout: float = 600, cancel=None, input: str | None = None) -> str:
    proc = subprocess.Popen(
        argv,
        text=True,
        stdin=subprocess.PIPE if input is not None else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=(os.name != "nt"),
    )
    if input is not None and proc.stdin is not None:
        try:
            proc.stdin.write(input)
            proc.stdin.close()
        except BrokenPipeError:
            pass
    deadline = time.monotonic() + timeout
    while proc.poll() is None:
        if _cancelled(cancel):
            _terminate_process(proc)
            raise OfficeError("OFFICE_CANCELED", "Office 安装已取消。")
        if time.monotonic() >= deadline:
            _terminate_process(proc)
            raise OfficeError("OFFICE_EXTRACT_TIMEOUT", "Office 原生安装命令超时。")
        time.sleep(0.05)
    stdout = proc.stdout.read() if proc.stdout else ""
    stderr = proc.stderr.read() if proc.stderr else ""
    if proc.returncode != 0:
        raise OfficeError("OFFICE_EXTRACT_FAILED", stderr or stdout or argv[0])
    return stdout


def _extract_libreoffice(archive: Path, destination: Path, target: str, cancel=None) -> None:
    if target.startswith("mac-"):
        plist = _run_checked(["hdiutil", "attach", "-readonly", "-nobrowse", "-plist", str(archive)], cancel=cancel, timeout=120)
        converted = _run_checked(["plutil", "-convert", "json", "-o", "-", "-"], input=plist, cancel=cancel, timeout=30)
        mounts = json.loads(converted).get("system-entities", [])
        mount = next((item.get("mount-point") for item in mounts if item.get("mount-point")), None)
        if not mount:
            raise OfficeError("OFFICE_EXTRACT_FAILED", "LibreOffice DMG 没有挂载点。")
        try:
            _check_cancel(cancel)
            shutil.copytree(Path(mount) / "LibreOffice.app", destination / "libreoffice" / "LibreOffice.app", symlinks=True)
        finally:
            try:
                _run_checked(["hdiutil", "detach", mount], timeout=60)
            except OfficeError:
                pass
        _verify_mac_signature(destination / "libreoffice" / "LibreOffice.app")
        return

    if target == "win-x64":
        system32 = _windows_system32()
        scratch = destination / "msi"
        scratch.mkdir(parents=True, exist_ok=True)
        _run_checked([str(system32 / "msiexec.exe"), "/a", str(archive), "/qn", f"TARGETDIR={scratch}"], cancel=cancel, timeout=900)
        extracted = _find_windows_office_root(scratch)
        if not extracted:
            raise OfficeError("OFFICE_EXTRACT_FAILED", "LibreOffice MSI 未解出 soffice.exe。")
        shutil.copytree(extracted, destination / "libreoffice", symlinks=True)
        shutil.rmtree(scratch, ignore_errors=True)
        return

    raise OfficeError("OFFICE_PLATFORM_UNSUPPORTED", target)


def _windows_system32() -> Path:
    if os.name != "nt":
        return Path(r"C:\Windows\System32")
    import ctypes
    buffer = ctypes.create_unicode_buffer(32768)
    length = ctypes.windll.kernel32.GetSystemDirectoryW(buffer, len(buffer))
    if not length:
        raise OfficeError("OFFICE_EXTRACT_FAILED", "无法定位 Windows 系统目录。")
    return Path(buffer.value)


def _find_windows_office_root(root: Path) -> Path | None:
    if (root / "program" / "soffice.exe").is_file():
        return root
    with os.scandir(root) as entries:
        for entry in entries:
            if entry.is_dir(follow_symlinks=False):
                found = _find_windows_office_root(Path(entry.path))
                if found:
                    return found
    return None


def _executable_manifest(root: Path, relative: str) -> dict:
    path = _safe_manifest_path(root, relative)
    if not path.is_file():
        raise OfficeError("OFFICE_RUNTIME_INCOMPLETE", "Office 可执行文件缺失。")
    return {"path": relative, "sha256": file_hash(path)}


def _install_to_temp(
    temporary: Path,
    *,
    lock: dict,
    lock_path: Path,
    fingerprint: str,
    target: str,
    source: dict,
    downloads: Path,
    cancel=None,
    progress: Callable[[dict], None] | None = None,
    deadline: float | None = None,
) -> None:
    archive = _download_asset(source, downloads, cancel=cancel, progress=progress, deadline=deadline)
    _check_cancel(cancel)
    _write_status({"state": "extracting", "message": "正在解压 Office 资源", "filename": archive.name}, progress)
    _extract_libreoffice(archive, temporary, target, cancel=cancel)

    font_entries = []
    if target.startswith("mac-"):
        (temporary / "fonts").mkdir(parents=True, exist_ok=True)
    else:
        (temporary / source["fontDirectory"]).mkdir(parents=True, exist_ok=True)
    for font in lock.get("fonts", []):
        font_path = _download_asset(font, downloads, filename=font.get("filename"), cancel=cancel, progress=progress, deadline=deadline)
        if target.startswith("mac-"):
            relative = f"fonts/{_safe_name(font['filename'])}"
        else:
            relative = f"{source['fontDirectory'].rstrip('/')}/{_safe_name(font['filename'])}"
        destination = temporary / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(font_path, destination)
        font_entries.append({"path": relative, "sha256": _validate_sha(font["sha256"])})

    _copy_licenses(lock_path, temporary)
    if target.startswith("mac-"):
        _prepare_mac_brand(temporary, source, font_entries)
    executable = _executable_manifest(temporary, source["executable"])
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "stagingVersion": STAGING_VERSION,
        "target": target,
        "fingerprint": fingerprint,
        "libreofficeVersion": lock["libreofficeVersion"],
        "fontFamily": lock["fontFamily"],
        "executable": executable,
        "fonts": font_entries,
        "source": {"url": source["url"], "sha256": _validate_sha(source["sha256"])},
    }
    if target.startswith("mac-"):
        manifest["brandDirectory"] = "brand"
    atomic_write_json(temporary / "runtime.json", manifest, ensure_ascii=False)
    _read_runtime_manifest(temporary, lock=lock, fingerprint=fingerprint, source=source, target=target)


def ensure_runtime(cancel=None, progress: Callable[[dict], None] | None = None) -> Path:
    lock, lock_path, fingerprint = _read_lock()
    target = target_id()
    source = _target_entry(lock, target)
    _entry_urls(source)
    for font in lock.get("fonts", []):
        _entry_urls(font)
    root = _install_dir(lock, target, fingerprint)
    deadline = time.monotonic() + TOTAL_DOWNLOAD_TIMEOUT_SECONDS
    try:
        _read_runtime_manifest(root, lock=lock, fingerprint=fingerprint, source=source, target=target)
        _write_status({"state": "ready", "message": "Office 资源已就绪", "target": target, "root": str(root)}, progress)
        return root
    except OfficeError:
        pass

    with _FileLock(_cache_root() / "install.lock", cancel=cancel, progress=progress, deadline=deadline):
        backup = None
        try:
            _read_runtime_manifest(root, lock=lock, fingerprint=fingerprint, source=source, target=target)
            _write_status({"state": "ready", "message": "Office 资源已就绪", "target": target, "root": str(root)}, progress)
            return root
        except OfficeError:
            if root.exists() or root.is_symlink():
                backup = root.parent / f".{root.name}.invalid-owned-{uuid.uuid4().hex}"
                root.rename(backup)
        _check_cancel(cancel)
        downloads = _cache_root() / "downloads"
        parent = root.parent
        temporary = Path(tempfile.mkdtemp(prefix=f".{root.name}.", suffix=".tmp", dir=parent))
        try:
            _install_to_temp(
                temporary,
                lock=lock,
                lock_path=lock_path,
                fingerprint=fingerprint,
                target=target,
                source=source,
                downloads=downloads,
                cancel=cancel,
                progress=progress,
                deadline=deadline,
            )
            _check_cancel(cancel)
            try:
                os.rename(temporary, root)
            except FileExistsError:
                shutil.rmtree(temporary, ignore_errors=True)
            _read_runtime_manifest(root, lock=lock, fingerprint=fingerprint, source=source, target=target)
            if backup:
                _remove_owned_path(backup)
            _write_status({"state": "ready", "message": "Office 资源已就绪", "target": target, "root": str(root)}, progress)
            return root
        except Exception as exc:
            shutil.rmtree(temporary, ignore_errors=True)
            if backup and not root.exists() and not root.is_symlink():
                try:
                    backup.rename(root)
                except OSError:
                    pass
            if isinstance(exc, OfficeError):
                _write_status({"state": "failed", "message": str(exc), "error": exc.code, "target": target}, progress)
                raise
            _write_status({"state": "failed", "message": str(exc), "error": "OFFICE_INSTALL_FAILED", "target": target}, progress)
            raise OfficeError("OFFICE_INSTALL_FAILED", "Office 安装失败。") from exc
