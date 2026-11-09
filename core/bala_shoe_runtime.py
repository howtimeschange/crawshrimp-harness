"""Download verified Bala weights and an isolated inference environment on demand."""
from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

from core import runtime_paths
from core.atomic_file import atomic_write_json

PACKAGE = Path(__file__).resolve().parent / "shoe_specialist"
_lock = threading.RLock()
_worker: threading.Thread | None = None
_cancel = threading.Event()
_progress: dict = {}
_verified: tuple | None = None


def manifest() -> dict:
    return json.loads((PACKAGE / "model-package.json").read_text(encoding="utf-8"))


def target() -> str:
    machine = platform.machine().lower()
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError("巴拉鞋品组件需要应用内置的 Python 3.12")
    if sys.platform == "darwin" and machine in {"arm64", "aarch64", "x86_64"}:
        return "mac-arm64" if machine in {"arm64", "aarch64"} else "mac-x64"
    if sys.platform == "win32" and machine in {"amd64", "x86_64"}:
        return "win-x64"
    raise RuntimeError("巴拉鞋品组件暂不支持当前系统")


def installed_root() -> Path:
    fingerprint = hashlib.sha256((PACKAGE / "model-package.json").read_bytes()).hexdigest()[:16]
    return runtime_paths.data_root() / "runtimes" / "bala-shoe" / f"{target()}-{fingerprint}"


def _hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_bundle(root: Path) -> None:
    spec = manifest()
    if json.loads((root / "bundle.json").read_text(encoding="utf-8")) != spec["bundle"]:
        raise ValueError("模型包清单不匹配")
    for name, entry in spec["files"].items():
        path = root / name
        if Path(name).name != name or path.is_symlink() or path.stat().st_size != entry["size"] or _hash(path) != entry["sha256"]:
            raise ValueError(f"模型文件校验失败：{name}")


def status() -> dict:
    global _verified
    with _lock:
        if _worker is not None and _worker.is_alive():
            return dict(_progress)
        spec = manifest()
        total = sum(item["size"] for item in spec["files"].values())
        common = {"version": spec["version"], "model_bytes": total}
        try:
            root = installed_root()
            paths = [root / "installed.json", root / "assets" / "bundle.json"]
            paths += [root / "assets" / name for name in spec["files"]]
            paths += [root / "libs" / name for name in ("onnxruntime/__init__.py", "rapidocr_onnxruntime/__init__.py", "cv2/__init__.py", "numpy/__init__.py")]
            signature = (str(root), *[(p.stat().st_mtime_ns, p.stat().st_size) for p in paths])
            if signature != _verified:
                receipt = json.loads(paths[0].read_text(encoding="utf-8"))
                if receipt.get("version") != spec["version"] or receipt.get("target") != target():
                    raise ValueError("组件安装版本不匹配")
                validate_bundle(root / "assets")
                _verified = signature
            return {**common, "state": "ready", "message": "巴拉鞋品组件已安装"}
        except (OSError, ValueError, KeyError):
            return {**common, **(_progress if _progress.get("state") in {"error", "cancelled"} else {}), "state": _progress.get("state") if _progress.get("state") in {"error", "cancelled"} else "missing"}
        except RuntimeError as exc:
            return {**common, "state": "unsupported", "message": str(exc)}


def require_installed() -> tuple[Path, Path]:
    if status()["state"] != "ready":
        raise RuntimeError("请先在鞋品任务中下载并安装巴拉鞋品组件")
    root = installed_root()
    return root / "assets", root / "libs"


def _update(state: str, message: str, **extra) -> None:
    with _lock:
        _progress.update(state=state, message=message, **extra)


def _check_cancel() -> None:
    if _cancel.is_set():
        raise InterruptedError("组件安装已取消")


def _download(name: str, entry: dict, destination: Path, completed: int, total: int) -> None:
    # Only the embedded, commit-pinned release manifest supplies URLs.
    request = urllib.request.Request(entry["url"], headers={"User-Agent": "Harness-Bala-Models/1"})
    with urllib.request.urlopen(request, timeout=30) as response, destination.open("wb") as output:
        received = 0
        deadline = time.monotonic() + 1800
        while True:
            _check_cancel()
            if time.monotonic() > deadline:
                raise TimeoutError("模型文件下载超时")
            chunk = response.read(256 * 1024)
            if not chunk:
                break
            received += len(chunk)
            if received > entry["size"]:
                raise ValueError(f"模型文件大小不匹配：{name}")
            output.write(chunk)
            _update("downloading", "正在下载模型文件", filename=name,
                    downloaded_bytes=completed + received, total_bytes=total)
    if received != entry["size"] or _hash(destination) != entry["sha256"]:
        raise ValueError(f"模型文件校验失败：{name}")


def _run(command: list[str], *, env: dict | None = None, timeout: float = 1200) -> None:
    # Never log credentials or arbitrary pip/provider output through the UI.
    with tempfile.TemporaryFile() as output:
        process = subprocess.Popen(command, stdout=output, stderr=output, env=env,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        deadline = time.monotonic() + timeout
        try:
            while process.poll() is None:
                _check_cancel()
                if time.monotonic() > deadline:
                    raise TimeoutError("组件安装或验证超时，请重试")
                time.sleep(.2)
            if process.returncode:
                raise RuntimeError("组件依赖安装或验证失败，请检查网络后重试")
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


def _install() -> None:
    global _verified
    staging = None
    lock_path = None
    owns_lock = False
    try:
        spec = manifest()
        destination = installed_root()
        destination.parent.mkdir(parents=True, exist_ok=True)
        lock_path = destination.parent / "install.lock"
        try:
            descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            # An interrupted app leaves a PID receipt. Only reclaim a dead owner.
            try:
                owner = int(lock_path.read_text())
                os.kill(owner, 0)
            except ProcessLookupError:
                lock_path.unlink()
                descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            else:
                raise RuntimeError("另一个应用进程正在安装组件，请稍后重试")
        owns_lock = True
        with os.fdopen(descriptor, "w") as handle:
            handle.write(str(os.getpid()))
        staging = Path(tempfile.mkdtemp(prefix=".install-", dir=destination.parent))
        assets = staging / "assets"
        assets.mkdir()
        total = sum(item["size"] for item in spec["files"].values())
        completed = 0
        for name, entry in spec["files"].items():
            for attempt in range(3):
                try:
                    _download(name, entry, assets / name, completed, total)
                    break
                except (OSError, TimeoutError):
                    _check_cancel()
                    if attempt == 2:
                        raise
                    _cancel.wait(attempt + 1)
            completed += entry["size"]
        atomic_write_json(assets / "bundle.json", spec["bundle"], ensure_ascii=False, indent=2)
        validate_bundle(assets)
        _check_cancel()
        _update("installing", "正在安装独立的识别与 OCR 组件")
        libraries = staging / "libs"
        lock = PACKAGE / f"runtime-{target()}-py312.txt"
        _run([sys.executable, "-m", "pip", "--isolated", "install", "--disable-pip-version-check",
              "--only-binary=:all:", "--require-hashes", "--ignore-installed",
              "--target", str(libraries), "-r", str(lock)])
        _update("verifying", "正在验证模型和 OCR")
        env = {**os.environ, "PYTHONPATH": os.pathsep.join([str(libraries), str(PACKAGE.parents[1])]),
               "PYTHONNOUSERSITE": "1", "PYTHONUTF8": "1"}
        _run([sys.executable, "-m", "core.shoe_specialist.runtime_smoke", str(assets)], env=env, timeout=180)
        _check_cancel()
        atomic_write_json(staging / "installed.json", {"version": spec["version"], "target": target()}, indent=2)
        if destination.exists():
            shutil.rmtree(destination)
        os.replace(staging, destination)
        staging = None
        _verified = None
        _update("ready", "巴拉鞋品组件已安装")
    except InterruptedError:
        _update("cancelled", "组件安装已取消，可重新下载")
    except Exception as exc:
        # urllib errors can include proxy credentials; return a stable error.
        message = str(exc) if isinstance(exc, (ValueError, RuntimeError)) else "组件下载失败，请检查网络后重试"
        _update("error", message)
    finally:
        if staging is not None:
            shutil.rmtree(staging, ignore_errors=True)
        if owns_lock and lock_path is not None:
            lock_path.unlink(missing_ok=True)


def start_install() -> dict:
    global _worker
    with _lock:
        current = status()
        if current["state"] == "ready" or (_worker is not None and _worker.is_alive()):
            return current
        target()  # Reject unsupported systems before starting a download.
        _cancel.clear()
        _progress.clear()
        _progress.update(state="downloading", message="正在准备下载", downloaded_bytes=0,
                         total_bytes=current["model_bytes"], model_bytes=current["model_bytes"])
        _worker = threading.Thread(target=_install, name="bala-shoe-install", daemon=True)
        _worker.start()
        return dict(_progress)


def cancel_install() -> dict:
    _cancel.set()
    return status()
