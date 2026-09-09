"""Resolve the explicit bundled runtime; never search PATH for Python or Office."""
from __future__ import annotations

import hashlib
import json
import os
import platform
from pathlib import Path

LIBRARIES = {"python-docx": "docx", "python-pptx": "pptx", "pandas": "pandas",
             "matplotlib": "matplotlib", "openpyxl": "openpyxl", "xlrd": "xlrd",
             "Pillow": "PIL", "PyMuPDF": "pymupdf"}


class OfficeError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def file_hash(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def target_id() -> str:
    if platform.system() == "Windows":
        return "win-x64"
    if platform.system() == "Darwin":
        return "mac-arm64" if platform.machine() == "arm64" else "mac-x64"
    raise OfficeError("OFFICE_PLATFORM_UNSUPPORTED", platform.system())


def python_executable() -> Path:
    raw = os.environ.get("CRAWSHRIMP_PYTHON_EXECUTABLE", "")
    if not raw or not Path(raw).is_absolute() or not Path(raw).is_file():
        raise OfficeError("OFFICE_RUNTIME_INCOMPLETE", "内置 Python 路径缺失，请修复应用运行环境。")
    # Preserve the configured venv executable path: resolving its symlink before
    # spawning bypasses pyvenv.cfg and silently selects the base interpreter.
    path = Path(raw).absolute()
    resources = os.environ.get("CRAWSHRIMP_RESOURCES_ROOT")
    if resources and not path.resolve().is_relative_to((Path(resources) / "python").resolve()):
        raise OfficeError("OFFICE_RUNTIME_MISMATCH", "发布环境的 Python 不属于当前应用。")
    return path


def office_root() -> Path:
    raw = os.environ.get("CRAWSHRIMP_OFFICE_ROOT", "")
    if not raw or not Path(raw).is_absolute():
        raise OfficeError("OFFICE_RUNTIME_INCOMPLETE", "Office 资源路径缺失，请修复应用运行环境。")
    return Path(raw).resolve()


def assets() -> dict:
    root = office_root()
    try:
        manifest = json.loads((root / "runtime.json").read_text(encoding="utf-8"))
        if manifest["target"] != target_id():
            raise OfficeError("OFFICE_RUNTIME_MISMATCH", "Office 资源平台与当前平台不匹配。")
        for entry in [manifest["executable"], *manifest["fonts"]]:
            path = (root / entry["path"]).resolve()
            if not path.is_relative_to(root) or not path.is_file():
                raise OfficeError("OFFICE_RUNTIME_INCOMPLETE", "Office 资源不完整。")
        return manifest
    except (OSError, KeyError, ValueError) as exc:
        raise OfficeError("OFFICE_RUNTIME_INCOMPLETE", "Office 清单缺失或无效。") from exc


def environment(work: Path) -> dict[str, str]:
    env = dict(os.environ)
    for name in ("PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV"):
        env.pop(name, None)
    env.update(PYTHONNOUSERSITE="1", PYTHONUTF8="1", PYTHONIOENCODING="utf-8",
               PYTHONPATH=str(Path(__file__).resolve().parents[2]),
               MPLBACKEND="Agg", MPLCONFIGDIR=str(work / "mpl-cache"),
               CRAWSHRIMP_OFFICE_OUTPUT=str(work / "editable"))
    return env


def configure_fonts() -> str:
    from matplotlib import font_manager, rcParams
    root, manifest = office_root(), assets()
    for entry in manifest["fonts"]:
        font_manager.fontManager.addfont(str(root / entry["path"]))
    family = manifest["fontFamily"]
    rcParams.update({"font.family": family, "axes.unicode_minus": False})
    return family


def inspect_runtime() -> dict:
    """Called in the selected interpreter, so module provenance is authoritative."""
    import importlib
    import importlib.metadata
    import sys
    result = {"python": sys.executable, "target": target_id(), "libraries": {}, "issues": []}
    for distribution, module in LIBRARIES.items():
        try:
            loaded = importlib.import_module(module)
            result["libraries"][distribution] = {
                "version": importlib.metadata.version(distribution), "path": loaded.__file__}
        except Exception as exc:
            result["issues"].append(f"{distribution}: {type(exc).__name__}: {exc}")
    try:
        manifest = assets()
        result["assets"] = manifest
        # Native executable bytes change during application signing. The staging
        # hash is checked before signing by afterPack; runtime checks font data.
        for entry in manifest["fonts"]:
            if file_hash(office_root() / entry["path"]) != entry["sha256"]:
                result["issues"].append(f"资源校验失败: {entry['path']}")
    except OfficeError as exc:
        result["issues"].append(str(exc))
    result["ok"] = not result["issues"]
    return result
