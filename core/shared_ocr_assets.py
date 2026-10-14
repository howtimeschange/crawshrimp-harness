"""Shared OCR asset resolution for bundled adapter compatibility."""

from __future__ import annotations

from pathlib import Path, PurePosixPath
from urllib.parse import unquote


TESSERACT_ASSET_PREFIX = "vendor/tesseract/"
SHARED_TESSERACT_DIR = Path("shared-assets") / "tesseract"


def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def shared_tesseract_dir(root: Path | None = None) -> Path:
    return (root or project_root()) / SHARED_TESSERACT_DIR


def normalize_adapter_asset_path(asset_path: str) -> str:
    normalized = unquote(str(asset_path or "")).replace("\\", "/").lstrip("/")
    pure = PurePosixPath(normalized)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise ValueError("adapter asset path is not safe")
    return pure.as_posix()


def resolve_shared_tesseract_asset(
    asset_path: str,
    *,
    root: Path | None = None,
    require_exists: bool = True,
) -> Path | None:
    normalized = normalize_adapter_asset_path(asset_path)
    if not normalized.startswith(TESSERACT_ASSET_PREFIX):
        return None

    relative = normalized.removeprefix(TESSERACT_ASSET_PREFIX)
    if not relative:
        raise ValueError("shared tesseract asset path must include a file")

    shared_root = shared_tesseract_dir(root).resolve(strict=False)
    candidate = (shared_root / relative).resolve(strict=False)
    if candidate != shared_root and shared_root not in candidate.parents:
        raise ValueError("shared tesseract asset path escapes shared asset root")
    if require_exists and not candidate.is_file():
        raise FileNotFoundError(f"Adapter asset not found: {normalized}")
    return candidate


def default_tesseract_lang_path(root: Path | None = None) -> str:
    base = root or project_root()
    shared = shared_tesseract_dir(base) / "lang"
    if shared.is_dir():
        return str(shared)
    bundled = base / "adapters" / "tmall-ops-assistant" / "vendor" / "tesseract" / "lang"
    return str(bundled) if bundled.is_dir() else ""
