"""
适配包加载器
支持：本地目录安装 / zip 包安装 / 扫描 / 卸载 / 启用禁用
"""
import json
import os
import shutil
import zipfile
import logging
import re
import threading
from uuid import uuid4
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

import yaml
from pydantic import ValidationError

from core import runtime_paths
from core.atomic_file import atomic_write_json, remove_path_with_retry, replace_with_retry
from core.models import AdapterManifest

logger = logging.getLogger(__name__)

_adapters: Dict[str, AdapterManifest] = {}
_adapter_dirs: Dict[str, Path] = {}
_enabled: Dict[str, bool] = {}
_install_meta: Dict[str, dict[str, Any]] = {}
_scan_lock = threading.RLock()

SCRIPT_SUFFIXES = (".js",)
_TRANSACTION_DIR_RE = re.compile(r"^\..+\.(?:install|backup)-[0-9a-f]{32}$")


def _adapters_root() -> Path:
    return runtime_paths.child_dir("adapters")


def _metadata_root() -> Path:
    return runtime_paths.child_dir("adapter-meta")


def _metadata_path(adapter_id: str) -> Path:
    return _metadata_root() / f"{adapter_id}.json"


def _normalize_install_mode(install_mode: str | None) -> str:
    normalized = str(install_mode or "copy").strip().lower() or "copy"
    if normalized not in {"copy", "link"}:
        raise ValueError(f"不支持的安装模式: {install_mode}")
    return normalized


def _safe_realpath(path: Path) -> str:
    try:
        return str(path.expanduser().resolve())
    except Exception:
        return str(path.expanduser())


def _version_key(version: str) -> tuple:
    parts = []
    for part in re.split(r"[.\-+_]", str(version or "")):
        if part.isdigit():
            parts.append((1, int(part)))
        elif part:
            parts.append((0, part))
    return tuple(parts)


def _load_manifest_if_exists(adapter_dir: Path) -> Optional[AdapterManifest]:
    manifest_path = adapter_dir / "manifest.yaml"
    if not manifest_path.exists():
        return None
    try:
        return _read_manifest_file(manifest_path)
    except Exception as e:
        logger.warning("adapter manifest 读取失败 %s: %s", manifest_path, e)
        return None


def iter_manifest_dirs(root: Path) -> Iterator[Path]:
    try:
        entries = list(root.iterdir())
    except OSError as e:
        logger.warning("adapter 目录扫描失败 %s: %s", root, e)
        return

    for item in entries:
        try:
            if _TRANSACTION_DIR_RE.fullmatch(item.name):
                continue
            if item.is_dir() and (item / "manifest.yaml").exists():
                yield item
        except OSError as e:
            logger.warning("跳过无权限访问的 adapter 目录 %s: %s", item, e)


def _collect_manifest_dirs(root: Path) -> tuple[list[Path], bool]:
    try:
        entries = list(root.iterdir())
    except OSError as e:
        logger.warning("adapter 目录扫描失败 %s: %s", root, e)
        return [], False

    manifest_dirs: list[Path] = []
    for item in entries:
        try:
            if _TRANSACTION_DIR_RE.fullmatch(item.name):
                continue
            if item.is_dir() and (item / "manifest.yaml").exists():
                manifest_dirs.append(item)
        except OSError as e:
            logger.warning("跳过无权限访问的 adapter 目录 %s: %s", item, e)
    return manifest_dirs, True


def _should_preserve_existing_link(existing_meta: dict[str, Any], dest: Path) -> bool:
    if existing_meta.get("install_mode") != "link":
        return False
    if dest.is_symlink():
        return True
    source_path = Path(str(existing_meta.get("source_path") or "")).expanduser()
    return source_path.exists() and source_path.is_dir() and dest.exists() and dest.resolve() == source_path.resolve()


def _read_manifest_file(manifest_path: Path) -> AdapterManifest:
    with open(manifest_path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return AdapterManifest(**data)


def resolve_adapter_relative_file(
    adapter_dir: Path,
    relative_path: str,
    *,
    allowed_suffixes: tuple[str, ...] | None = None,
    require_exists: bool = True,
) -> Path:
    raw_path = str(relative_path or "").strip()
    if not raw_path or "\x00" in raw_path:
        raise ValueError("adapter file path is empty or invalid")

    normalized = Path(raw_path.replace("\\", "/"))
    if normalized.is_absolute() or any(part == ".." for part in normalized.parts):
        raise ValueError(f"adapter file path must stay inside adapter directory: {raw_path}")

    base_dir = Path(adapter_dir).resolve()
    candidate = (base_dir / normalized).resolve()
    try:
        candidate.relative_to(base_dir)
    except ValueError as exc:
        raise ValueError(f"adapter file path escapes adapter directory: {raw_path}") from exc

    if allowed_suffixes:
        allowed = tuple(item.lower() for item in allowed_suffixes)
        if candidate.suffix.lower() not in allowed:
            raise ValueError(f"adapter file path has unsupported suffix: {raw_path}")

    if require_exists and (not candidate.exists() or not candidate.is_file()):
        raise FileNotFoundError(f"adapter file not found: {raw_path}")

    return candidate


def resolve_adapter_file(
    adapter_id: str,
    relative_path: str,
    *,
    allowed_suffixes: tuple[str, ...] | None = SCRIPT_SUFFIXES,
    require_exists: bool = True,
) -> Path:
    adapter_dir = get_adapter_dir(adapter_id)
    if not adapter_dir:
        raise FileNotFoundError(f"Adapter directory not found: {adapter_id}")
    return resolve_adapter_relative_file(
        adapter_dir,
        relative_path,
        allowed_suffixes=allowed_suffixes,
        require_exists=require_exists,
    )


def _remove_installed_path(path: Path) -> None:
    remove_path_with_retry(path)


def _read_install_metadata(adapter_id: str) -> dict[str, Any]:
    path = _metadata_path(adapter_id)
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning("adapter 安装元数据读取失败 %s: %s", path, e)
        return {}
    return payload if isinstance(payload, dict) else {}


def _write_install_metadata(adapter_id: str, payload: dict[str, Any]) -> None:
    path = _metadata_path(adapter_id)
    atomic_write_json(path, payload, ensure_ascii=False, indent=2)
    _install_meta[adapter_id] = dict(payload)


def _delete_install_metadata(adapter_id: str) -> None:
    path = _metadata_path(adapter_id)
    remove_path_with_retry(path)
    _install_meta.pop(adapter_id, None)


def get_install_metadata(adapter_id: str) -> dict[str, Any]:
    cached = _install_meta.get(adapter_id)
    if cached is not None:
        return dict(cached)
    payload = _read_install_metadata(adapter_id)
    if payload:
        _install_meta[adapter_id] = dict(payload)
    return dict(payload)


def scan_all() -> List[AdapterManifest]:
    global _adapters, _adapter_dirs, _install_meta
    with _scan_lock:
        root = _adapters_root()
        manifest_dirs, scan_complete = _collect_manifest_dirs(root)
        if not scan_complete and _adapters:
            logger.warning("adapter 根目录扫描失败，保留上一份已加载清单: %s 个", len(_adapters))
            return list(_adapters.values())

        current_adapters: Dict[str, AdapterManifest] = {}
        current_adapter_dirs: Dict[str, Path] = {}
        current_install_meta: Dict[str, dict[str, Any]] = {}

        for item in manifest_dirs:
            m = _load_manifest(item)
            if not m:
                continue
            current_adapters[m.id] = m
            current_adapter_dirs[m.id] = item
            meta = _read_install_metadata(m.id)
            if not meta:
                meta = {
                    "adapter_id": m.id,
                    "install_mode": "copy",
                    "runtime_path": _safe_realpath(item),
                    "source_path": _safe_realpath(item),
                }
            else:
                meta.setdefault("adapter_id", m.id)
                meta.setdefault("install_mode", "copy")
                meta.setdefault("runtime_path", _safe_realpath(item))
                meta.setdefault("source_path", _safe_realpath(item))
            current_install_meta[m.id] = meta

        if _adapters and current_adapters and len(current_adapters) < len(_adapters):
            logger.warning(
                "adapter 扫描结果少于上一份清单，保留上一份以避免列表闪烁: previous=%s current=%s",
                len(_adapters),
                len(current_adapters),
            )
            return list(_adapters.values())

        _adapters = current_adapters
        _adapter_dirs = current_adapter_dirs
        _install_meta = current_install_meta
        for adapter_id in _adapters:
            if adapter_id not in _enabled:
                _enabled[adapter_id] = True
        for adapter_id in list(_enabled.keys()):
            if adapter_id not in _adapters:
                _enabled.pop(adapter_id, None)
        logger.info(f"已加载 {len(_adapters)} 个适配包")
        return list(_adapters.values())


def _load_manifest(adapter_dir: Path) -> Optional[AdapterManifest]:
    try:
        return _read_manifest_file(adapter_dir / "manifest.yaml")
    except (ValidationError, Exception) as e:
        logger.error(f"manifest 解析失败 {adapter_dir}: {e}")
        return None


def get_adapter(adapter_id: str) -> Optional[AdapterManifest]:
    return _adapters.get(adapter_id)


def get_adapter_dir(adapter_id: str) -> Optional[Path]:
    return _adapter_dirs.get(adapter_id)


def is_enabled(adapter_id: str) -> bool:
    return _enabled.get(adapter_id, False)


def set_enabled(adapter_id: str, enabled: bool) -> None:
    _enabled[adapter_id] = enabled


def install_from_dir(source_dir: str, install_mode: str = "copy", preserve_existing_link: bool = False) -> AdapterManifest:
    with _scan_lock:
        return _install_from_dir_locked(source_dir, install_mode, preserve_existing_link)


def _install_from_dir_locked(source_dir: str, install_mode: str, preserve_existing_link: bool) -> AdapterManifest:
    src = Path(source_dir).expanduser()
    if not (src / "manifest.yaml").exists():
        raise FileNotFoundError(f"缺少 manifest.yaml: {source_dir}")
    src = src.resolve()
    install_mode = _normalize_install_mode(install_mode)
    m = _read_manifest_file(src / "manifest.yaml")
    existing_meta = _read_install_metadata(m.id)
    dest = _adapters_root() / m.id
    if preserve_existing_link and _should_preserve_existing_link(existing_meta, dest):
        linked_manifest = _load_manifest_if_exists(dest) or m
        _adapters[linked_manifest.id] = linked_manifest
        if dest.exists() or dest.is_symlink():
            _adapter_dirs[linked_manifest.id] = dest
        _install_meta[linked_manifest.id] = existing_meta
        _enabled[linked_manifest.id] = True
        logger.info("保留 link 安装的适配包: %s", linked_manifest.id)
        return linked_manifest

    if preserve_existing_link and install_mode == "copy" and dest.exists() and not dest.is_symlink():
        existing_manifest = _load_manifest_if_exists(dest)
        if existing_manifest and _version_key(existing_manifest.version) >= _version_key(m.version):
            metadata = {
                "adapter_id": existing_manifest.id,
                "install_mode": "copy",
                "runtime_path": _safe_realpath(dest),
                "source_path": _safe_realpath(dest),
            }
            _write_install_metadata(existing_manifest.id, metadata)
            _adapters[existing_manifest.id] = existing_manifest
            _adapter_dirs[existing_manifest.id] = dest
            _enabled[existing_manifest.id] = True
            logger.info(
                "保留同版或较新的已安装适配包: %s v%s >= built-in v%s",
                existing_manifest.id,
                existing_manifest.version,
                m.version,
            )
            return existing_manifest

    root = _adapters_root()
    transaction_id = uuid4().hex
    staged = root / f".{m.id}.install-{transaction_id}"
    backup = root / f".{m.id}.backup-{transaction_id}"
    metadata = {
        "adapter_id": m.id,
        "install_mode": install_mode,
        "runtime_path": _safe_realpath(dest),
        "source_path": _safe_realpath(src),
    }
    previous_manifest = _adapters.get(m.id)
    previous_dir = _adapter_dirs.get(m.id)
    previous_enabled = _enabled.get(m.id)
    previous_meta = _install_meta.get(m.id)
    moved_previous = False
    installed_new = False
    try:
        if install_mode == "link":
            staged.symlink_to(src, target_is_directory=True)
        else:
            shutil.copytree(src, staged)
        staged_manifest = _read_manifest_file(staged / "manifest.yaml")
        if staged_manifest.id != m.id or staged_manifest.version != m.version:
            raise ValueError("适配包 staging 校验失败")

        if dest.exists() or dest.is_symlink():
            replace_with_retry(dest, backup)
            moved_previous = True
        replace_with_retry(staged, dest)
        installed_new = True
        _write_install_metadata(m.id, metadata)
    except Exception as install_exc:
        rollback_errors: list[tuple[str, Exception]] = []
        if installed_new and (dest.exists() or dest.is_symlink()):
            try:
                _remove_installed_path(dest)
            except Exception as exc:  # noqa: BLE001
                logger.exception("adapter 事务回滚删除新版本失败: %s", dest)
                rollback_errors.append(("删除新版本失败", exc))
        if moved_previous and (backup.exists() or backup.is_symlink()):
            try:
                replace_with_retry(backup, dest)
            except Exception as exc:  # noqa: BLE001
                logger.exception("adapter 事务回滚恢复旧版本失败: %s", dest)
                rollback_errors.append(("恢复旧版本失败", exc))
        elif moved_previous:
            rollback_errors.append(("恢复旧版本失败", OSError(f"备份目录丢失: {backup}")))

        if rollback_errors:
            # Disk state is no longer authoritative enough to advertise either
            # version from the in-memory registry.  Keep the backup directory
            # for operator recovery and fail closed until the next clean scan.
            _adapters.pop(m.id, None)
            _adapter_dirs.pop(m.id, None)
            _enabled.pop(m.id, None)
            _install_meta.pop(m.id, None)
            rollback_detail = "; ".join(f"{label}: {exc}" for label, exc in rollback_errors)
            raise RuntimeError(
                f"适配包 {m.id} 安装失败，且回滚未完成；"
                f"原始错误: {install_exc}; 回滚错误: {rollback_detail}"
            ) from rollback_errors[-1][1]

        if previous_manifest is None:
            _adapters.pop(m.id, None)
        else:
            _adapters[m.id] = previous_manifest
        if previous_dir is None:
            _adapter_dirs.pop(m.id, None)
        else:
            _adapter_dirs[m.id] = previous_dir
        if previous_enabled is None:
            _enabled.pop(m.id, None)
        else:
            _enabled[m.id] = previous_enabled
        if previous_meta is None:
            _install_meta.pop(m.id, None)
        else:
            _install_meta[m.id] = previous_meta
        raise
    finally:
        if staged.exists() or staged.is_symlink():
            try:
                _remove_installed_path(staged)
            except OSError:
                logger.warning("adapter staging 清理失败: %s", staged, exc_info=True)

    if moved_previous and (backup.exists() or backup.is_symlink()):
        try:
            _remove_installed_path(backup)
        except OSError:
            logger.warning("adapter 旧版本备份清理失败: %s", backup, exc_info=True)
    _adapters[m.id] = m
    _adapter_dirs[m.id] = dest
    _enabled[m.id] = True
    logger.info("适配包已安装: %s v%s (%s)", m.id, m.version, install_mode)
    return m


def install_from_zip(zip_path: str, install_mode: str = "copy") -> AdapterManifest:
    import tempfile
    install_mode = _normalize_install_mode(install_mode)
    if install_mode != "copy":
        raise ValueError("ZIP 安装暂不支持 link 模式，请改为选择适配包目录")
    with tempfile.TemporaryDirectory() as tmpdir:
        with zipfile.ZipFile(zip_path) as zf:
            root = Path(tmpdir).resolve()
            for member in zf.infolist():
                member_path = Path(member.filename.replace("\\", "/"))
                if member_path.is_absolute() or any(part == ".." for part in member_path.parts):
                    raise ValueError(f"zip 包包含不安全路径: {member.filename}")
                target = (root / member_path).resolve()
                try:
                    target.relative_to(root)
                except ValueError as exc:
                    raise ValueError(f"zip 包包含不安全路径: {member.filename}") from exc
                zf.extract(member, root)
        extracted = Path(tmpdir)
        subdirs = [d for d in extracted.iterdir() if d.is_dir()]
        if len(subdirs) == 1 and (subdirs[0] / "manifest.yaml").exists():
            source = subdirs[0]
        elif (extracted / "manifest.yaml").exists():
            source = extracted
        else:
            raise ValueError("zip 包结构不正确，未找到 manifest.yaml")
        return install_from_dir(str(source), install_mode="copy")


def uninstall(adapter_id: str) -> None:
    with _scan_lock:
        _uninstall_locked(adapter_id)


def _uninstall_locked(adapter_id: str) -> None:
    d = _adapter_dirs.get(adapter_id)
    if d and (d.exists() or d.is_symlink()):
        _remove_installed_path(d)
    _delete_install_metadata(adapter_id)
    for store in (_adapters, _adapter_dirs, _enabled, _install_meta):
        store.pop(adapter_id, None)
    logger.info(f"适配包已卸载: {adapter_id}")


def list_all() -> List[dict]:
    return [
        {
            "id": m.id,
            "name": m.name,
            "version": m.version,
            "author": m.author,
            "description": m.description,
            "entry_url": m.entry_url,
            "task_count": len(m.tasks),
            "enabled": _enabled.get(m.id, True),
            "install_mode": get_install_metadata(m.id).get("install_mode", "copy"),
            "source_path": get_install_metadata(m.id).get("source_path", str(_adapter_dirs.get(m.id) or "")),
            "runtime_path": get_install_metadata(m.id).get("runtime_path", str(_adapter_dirs.get(m.id) or "")),
        }
        for m in _adapters.values()
    ]
