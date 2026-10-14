import hashlib
import json
import sys
import threading
import time
from pathlib import Path

import pytest

from core.office import install
from core.office.runtime import OfficeError


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class FakeResponse:
    def __init__(self, data: bytes, url: str = "https://download.documentfoundation.org/asset"):
        self.data = data
        self.offset = 0
        self.headers = {"Content-Length": str(len(data))}
        self.url = url

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, size=-1):
        if self.offset >= len(self.data):
            return b""
        if size < 0:
            size = len(self.data) - self.offset
        chunk = self.data[self.offset:self.offset + size]
        self.offset += len(chunk)
        return chunk

    def geturl(self):
        return self.url


def write_lock(tmp_path, *, target="mac-arm64", archive=b"archive", font=b"font", url_host="download.documentfoundation.org"):
    lock_dir = tmp_path / "locks"
    (lock_dir / "licenses").mkdir(parents=True)
    (lock_dir / "licenses" / "source-han-sans.txt").write_text("license", encoding="utf-8")
    lock = {
        "schemaVersion": 1,
        "libreofficeVersion": "26.2.6",
        "fontFamily": "Source Han Sans SC",
        "targets": {
            target: {
                "url": f"https://{url_host}/libreoffice/stable/26.2.6/{target}/LibreOffice.bin",
                "fallbackUrls": [f"https://tdf.mirror.garr.it/libreoffice/stable/26.2.6/{target}/LibreOffice.bin"],
                "sha256": sha(archive),
                "executable": "libreoffice/LibreOffice.app/Contents/MacOS/soffice" if target.startswith("mac-") else "libreoffice/program/soffice.exe",
                "fontDirectory": "libreoffice/LibreOffice.app/Contents/Resources/fonts/truetype" if target.startswith("mac-") else "libreoffice/share/fonts/truetype",
            }
        },
        "fonts": [{
            "url": "https://raw.githubusercontent.com/adobe-fonts/source-han-sans/2.005R/OTF/SimplifiedChinese/SourceHanSansSC-Regular.otf",
            "sha256": sha(font),
            "filename": "SourceHanSansSC-Regular.otf",
            "version": "2.005R",
        }],
    }
    path = lock_dir / "office-assets.json"
    path.write_text(json.dumps(lock), encoding="utf-8")
    return path, lock, {"LibreOffice.bin": archive, "SourceHanSansSC-Regular.otf": font}


@pytest.fixture
def office_env(tmp_path, monkeypatch):
    cache = tmp_path / "cache"
    monkeypatch.setenv("CRAWSHRIMP_OFFICE_CACHE", str(cache))
    monkeypatch.setattr(install, "LOCK_TIMEOUT_SECONDS", 2.0)
    return cache


def install_with_fakes(monkeypatch, lock_path, payloads, *, target="mac-arm64", extract=None):
    monkeypatch.setenv("CRAWSHRIMP_OFFICE_ASSETS_LOCK", str(lock_path))
    monkeypatch.setattr(install, "target_id", lambda: target)

    def fake_urlopen(url, timeout):
        name = Path(url.split("?", 1)[0]).name
        if name not in payloads:
            raise OSError(f"offline: {name}")
        return FakeResponse(payloads[name], url)

    monkeypatch.setattr(install.urllib.request, "urlopen", fake_urlopen)
    if extract is None:
        extract = fake_mac_extract if target.startswith("mac-") else fake_win_extract
    monkeypatch.setattr(install, "_extract_libreoffice", extract)
    if target.startswith("mac-"):
        monkeypatch.setattr(install, "_verify_mac_signature", lambda app: None)


def fake_mac_extract(_archive, destination, _target, cancel=None):
    app = destination / "libreoffice" / "LibreOffice.app" / "Contents"
    (app / "MacOS").mkdir(parents=True)
    (app / "Resources" / "fonts" / "truetype").mkdir(parents=True)
    (app / "Resources" / "presets").mkdir(parents=True)
    (app / "Frameworks").mkdir()
    (app / "MacOS" / "soffice").write_bytes(b"soffice")
    (app / "Resources" / "fonts" / "truetype" / "Original.ttf").write_bytes(b"original")
    (app / "Resources" / "presets" / "registry.ini").write_text("preset", encoding="utf-8")
    (app / "Resources" / "config.txt").write_text("config", encoding="utf-8")


def fake_win_extract(_archive, destination, _target, cancel=None):
    root = destination / "libreoffice"
    (root / "program").mkdir(parents=True)
    (root / "program" / "soffice.exe").write_bytes(b"soffice-win")


def test_mac_install_creates_relocatable_brand_and_manifest(tmp_path, monkeypatch, office_env):
    lock_path, lock, payloads = write_lock(tmp_path, archive=b"mac-archive", font=b"font-data")
    install_with_fakes(monkeypatch, lock_path, payloads)

    root = install.ensure_runtime()
    manifest = json.loads((root / "runtime.json").read_text(encoding="utf-8"))

    assert root == install.installed_root()
    assert manifest["stagingVersion"] == 3
    assert manifest["target"] == "mac-arm64"
    assert manifest["brandDirectory"] == "brand"
    assert manifest["fingerprint"] == sha(lock_path.read_bytes())
    assert manifest["source"] == {"url": lock["targets"]["mac-arm64"]["url"], "sha256": lock["targets"]["mac-arm64"]["sha256"]}
    assert (root / "licenses" / "source-han-sans.txt").read_text(encoding="utf-8") == "license"

    macos_link = root / "brand" / "MacOS"
    frameworks_link = root / "brand" / "Frameworks"
    assert macos_link.is_symlink() and not Path(macos_link.readlink()).is_absolute()
    assert frameworks_link.is_symlink() and not Path(frameworks_link.readlink()).is_absolute()
    assert (root / "brand" / "Resources" / "config.txt").is_symlink()
    presets = root / "brand" / "Resources" / "presets"
    assert presets.is_dir() and not presets.is_symlink()
    assert (presets / "registry.ini").read_text(encoding="utf-8") == "preset"
    brand_fonts = root / "brand" / "Resources" / "fonts" / "truetype"
    assert (brand_fonts / "Original.ttf").is_symlink()
    assert (brand_fonts / "SourceHanSansSC-Regular.otf").is_symlink()
    assert (root / manifest["fonts"][0]["path"]).read_bytes() == b"font-data"

    relocated = tmp_path / "relocated"
    root.rename(relocated)
    assert (relocated / "brand" / "MacOS" / "soffice").read_bytes() == b"soffice"
    assert (relocated / "brand" / "Resources" / "presets" / "registry.ini").read_text(encoding="utf-8") == "preset"
    assert (relocated / "brand" / "Resources" / "fonts" / "truetype" / "SourceHanSansSC-Regular.otf").read_bytes() == b"font-data"


def test_windows_install_uses_single_font_copy_in_libreoffice_tree(tmp_path, monkeypatch, office_env):
    lock_path, _lock, payloads = write_lock(tmp_path, target="win-x64", archive=b"win-archive", font=b"font-win")
    install_with_fakes(monkeypatch, lock_path, payloads, target="win-x64")

    root = install.ensure_runtime()
    manifest = json.loads((root / "runtime.json").read_text(encoding="utf-8"))

    assert manifest["target"] == "win-x64"
    assert manifest["executable"]["path"] == "libreoffice/program/soffice.exe"
    assert manifest["fonts"] == [{"path": "libreoffice/share/fonts/truetype/SourceHanSansSC-Regular.otf", "sha256": sha(b"font-win")}]
    assert not (root / "fonts").exists()


def test_verified_download_cache_allows_reinstall_without_network(tmp_path, monkeypatch, office_env):
    lock_path, _lock, payloads = write_lock(tmp_path, archive=b"cached-archive", font=b"cached-font")
    install_with_fakes(monkeypatch, lock_path, payloads)
    first = install.ensure_runtime()
    assert first.is_dir()
    import shutil
    shutil.rmtree(first)

    install_with_fakes(monkeypatch, lock_path, {}, extract=fake_mac_extract)
    second = install.ensure_runtime()
    assert second == first
    assert (second / "runtime.json").is_file()


def test_checksum_failure_does_not_publish_half_package(tmp_path, monkeypatch, office_env):
    lock_path, _lock, payloads = write_lock(tmp_path, archive=b"expected", font=b"font")
    payloads["LibreOffice.bin"] = b"tampered"
    install_with_fakes(monkeypatch, lock_path, payloads)

    with pytest.raises(OfficeError) as error:
        install.ensure_runtime()

    assert error.value.code == "OFFICE_CHECKSUM_MISMATCH"
    assert not install.installed_root().exists()
    assert not list(office_env.glob(".*.tmp"))


def test_rejects_untrusted_urls_before_download(tmp_path, monkeypatch, office_env):
    lock_path, _lock, payloads = write_lock(tmp_path, url_host="evil.example")
    install_with_fakes(monkeypatch, lock_path, payloads)

    with pytest.raises(OfficeError) as error:
        install.ensure_runtime()

    assert error.value.code == "OFFICE_LOCK_INVALID"
    assert not install.installed_root().exists()


def test_cancel_before_install_does_not_publish(tmp_path, monkeypatch, office_env):
    lock_path, _lock, payloads = write_lock(tmp_path)
    install_with_fakes(monkeypatch, lock_path, payloads)
    cancel = threading.Event()
    cancel.set()

    with pytest.raises(OfficeError) as error:
        install.ensure_runtime(cancel=cancel)

    assert error.value.code == "OFFICE_CANCELED"
    assert not install.installed_root().exists()


def test_concurrent_installs_share_one_native_extraction(tmp_path, monkeypatch, office_env):
    lock_path, _lock, payloads = write_lock(tmp_path, archive=b"once", font=b"font-once")
    calls = []
    gate = threading.Barrier(2)

    def slow_extract(archive, destination, target, cancel=None):
        calls.append(archive)
        gate.wait(timeout=5)
        time.sleep(0.1)
        fake_mac_extract(archive, destination, target)

    install_with_fakes(monkeypatch, lock_path, payloads, extract=slow_extract)
    results = []
    errors = []

    def worker():
        try:
            results.append(install.ensure_runtime())
        except Exception as exc:
            errors.append(exc)

    first = threading.Thread(target=worker)
    second = threading.Thread(target=worker)
    first.start()
    while not calls:
        time.sleep(0.01)
    second.start()
    gate.wait(timeout=5)
    first.join(timeout=5)
    second.join(timeout=5)

    assert not errors
    assert len(results) == 2
    assert results[0] == results[1]
    assert len(calls) == 1


def test_status_progress_is_persisted_without_urls(tmp_path, monkeypatch, office_env):
    lock_path, _lock, payloads = write_lock(tmp_path, archive=b"status-archive", font=b"status-font")
    install_with_fakes(monkeypatch, lock_path, payloads)
    progress = []

    root = install.ensure_runtime(progress=progress.append)
    status = json.loads((office_env / "status.json").read_text(encoding="utf-8"))

    assert status["state"] == "ready"
    assert status["root"] == str(root)
    assert progress[-1]["state"] == "ready"
    encoded = json.dumps(status)
    assert "https://" not in encoded
    assert "download.documentfoundation.org" not in encoded


@pytest.mark.parametrize("stale_state", ["ready", "failed"])
def test_lock_wait_status_overrides_stale_terminal_status(tmp_path, office_env, stale_state):
    office_env.mkdir(parents=True, exist_ok=True)
    (office_env / "status.json").write_text(
        json.dumps({"state": stale_state, "message": "stale", "error": "OLD"}),
        encoding="utf-8",
    )

    status = install._lock_wait_status()

    assert status["state"] == "waiting"
    assert status["message"] == "正在等待 Office 资源安装。"
    assert status.get("error") is None


def test_lock_wait_status_preserves_active_download_metadata(tmp_path, office_env):
    office_env.mkdir(parents=True, exist_ok=True)
    (office_env / "status.json").write_text(
        json.dumps({
            "state": "downloading",
            "message": "正在下载 Office 资源",
            "downloaded_bytes": 10,
            "total_bytes": 20,
            "filename": "LibreOffice.dmg",
        }),
        encoding="utf-8",
    )

    status = install._lock_wait_status()

    assert status["state"] == "waiting"
    assert status["message"] == "正在下载 Office 资源"
    assert status["downloaded_bytes"] == 10
    assert status["total_bytes"] == 20


def test_runtime_status_rejects_manifest_path_traversal(tmp_path, monkeypatch, office_env):
    lock_path, _lock, _payloads = write_lock(tmp_path)
    monkeypatch.setenv("CRAWSHRIMP_OFFICE_ASSETS_LOCK", str(lock_path))
    monkeypatch.setattr(install, "target_id", lambda: "mac-arm64")
    root = install.installed_root()
    root.mkdir(parents=True)
    (root / "runtime.json").write_text(json.dumps({
        "schemaVersion": 1,
        "stagingVersion": 3,
        "target": "mac-arm64",
        "executable": {"path": "../escape", "sha256": "0" * 64},
        "fonts": [],
        "brandDirectory": "brand",
    }), encoding="utf-8")

    assert install.runtime_status()["state"] == "missing"


def test_lock_timeout_reports_retryable_error(tmp_path, monkeypatch, office_env):
    lock_path, _lock, payloads = write_lock(tmp_path, archive=b"timeout-archive", font=b"timeout-font")
    install_with_fakes(monkeypatch, lock_path, payloads)
    monkeypatch.setattr(install, "TOTAL_DOWNLOAD_TIMEOUT_SECONDS", 0.05)

    with install._FileLock(office_env / "install.lock"):
        with pytest.raises(OfficeError) as error:
            install.ensure_runtime()

    assert error.value.code == "OFFICE_INSTALL_LOCK_TIMEOUT"


def test_damaged_existing_root_is_replaced_after_successful_install(tmp_path, monkeypatch, office_env):
    lock_path, _lock, payloads = write_lock(tmp_path, archive=b"repair-archive", font=b"repair-font")
    install_with_fakes(monkeypatch, lock_path, payloads)
    root = install.installed_root()
    root.mkdir(parents=True)
    (root / "runtime.json").write_text("{}", encoding="utf-8")
    (root / "old-marker").write_text("old", encoding="utf-8")

    assert install.ensure_runtime() == root

    assert not (root / "old-marker").exists()
    assert json.loads((root / "runtime.json").read_text(encoding="utf-8"))["stagingVersion"] == 3
    assert not list(office_env.glob(".*.invalid-owned-*"))


def test_damaged_existing_root_is_restored_when_repair_fails(tmp_path, monkeypatch, office_env):
    lock_path, _lock, payloads = write_lock(tmp_path, archive=b"restore-archive", font=b"restore-font")
    def failing_extract(*_, **__):
        raise OfficeError("OFFICE_EXTRACT_FAILED", "boom")
    install_with_fakes(monkeypatch, lock_path, payloads, extract=failing_extract)
    root = install.installed_root()
    root.mkdir(parents=True)
    (root / "runtime.json").write_text("{}", encoding="utf-8")
    (root / "old-marker").write_text("old", encoding="utf-8")

    with pytest.raises(OfficeError):
        install.ensure_runtime()

    assert (root / "old-marker").read_text(encoding="utf-8") == "old"


def test_waiting_for_install_lock_reports_existing_download_status(tmp_path, monkeypatch, office_env):
    lock_path, _lock, payloads = write_lock(tmp_path, archive=b"wait-archive", font=b"wait-font")
    install_with_fakes(monkeypatch, lock_path, payloads)
    office_env.mkdir(parents=True, exist_ok=True)
    (office_env / "status.json").write_text(json.dumps({
        "state": "downloading",
        "message": "已有下载",
        "downloaded_bytes": 5,
        "total_bytes": 10,
        "filename": "LibreOffice.bin",
    }), encoding="utf-8")
    progress = []

    with install._FileLock(office_env / "install.lock"):
        thread = threading.Thread(target=lambda: install.ensure_runtime(progress=progress.append))
        thread.start()
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline and not progress:
            time.sleep(0.01)
        assert progress and progress[0]["state"] == "waiting"
        assert progress[0]["downloaded_bytes"] == 5
    thread.join(timeout=5)

    assert install.installed_root().is_dir()


def test_download_rejects_http_redirect(tmp_path, monkeypatch, office_env):
    lock_path, _lock, payloads = write_lock(tmp_path, archive=b"redirect-archive", font=b"redirect-font")
    monkeypatch.setenv("CRAWSHRIMP_OFFICE_ASSETS_LOCK", str(lock_path))
    monkeypatch.setattr(install, "target_id", lambda: "mac-arm64")

    def fake_urlopen(url, timeout):
        name = Path(url).name
        return FakeResponse(payloads[name], "http://download.documentfoundation.org/insecure")

    monkeypatch.setattr(install.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(install, "_extract_libreoffice", fake_mac_extract)

    with pytest.raises(OfficeError) as error:
        install.ensure_runtime()

    assert error.value.code == "OFFICE_LOCK_INVALID"


def test_cache_hit_requires_current_lock_manifest_values(tmp_path, monkeypatch, office_env):
    lock_path, lock, payloads = write_lock(tmp_path, archive=b"drift-archive", font=b"drift-font")
    install_with_fakes(monkeypatch, lock_path, payloads)
    root = install.ensure_runtime()
    manifest_path = root / "runtime.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["source"]["sha256"] = "0" * 64
    manifest["fonts"] = [{"path": "fonts/Other.otf", "sha256": "1" * 64}]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    repaired = install.ensure_runtime()
    repaired_manifest = json.loads((repaired / "runtime.json").read_text(encoding="utf-8"))

    assert repaired == root
    assert repaired_manifest["source"]["sha256"] == lock["targets"]["mac-arm64"]["sha256"]
    assert repaired_manifest["fonts"] == [{"path": "fonts/SourceHanSansSC-Regular.otf", "sha256": sha(b"drift-font")}]


def test_mac_cache_hit_verifies_signature_once_per_process_metadata(tmp_path, monkeypatch, office_env):
    lock_path, _lock, payloads = write_lock(tmp_path, archive=b"sig-archive", font=b"sig-font")
    install_with_fakes(monkeypatch, lock_path, payloads)
    root = install.ensure_runtime()
    install._MAC_SIGNATURE_CACHE.clear()
    calls = []
    monkeypatch.setattr(install, "_verify_mac_signature", lambda app: calls.append(app))

    assert install.ensure_runtime() == root
    assert install.ensure_runtime() == root

    assert len(calls) == 1


def test_waiting_for_file_lock_can_be_canceled_and_releases_handle(tmp_path, monkeypatch, office_env):
    lock_path, _lock, payloads = write_lock(tmp_path, archive=b"cancel-lock-archive", font=b"cancel-lock-font")
    install_with_fakes(monkeypatch, lock_path, payloads)
    cancel = threading.Event()
    errors = []

    with install._FileLock(office_env / "install.lock"):
        cancel.set()
        thread = threading.Thread(target=lambda: errors.append(pytest.raises(OfficeError, install.ensure_runtime, cancel=cancel).value))
        thread.start()
        thread.join(timeout=5)

    assert errors and errors[0].code == "OFFICE_CANCELED"
    with install._FileLock(office_env / "install.lock", timeout=0.1):
        pass


def test_native_command_runner_is_cancel_aware():
    cancel = threading.Event()
    cancel.set()

    with pytest.raises(OfficeError) as error:
        install._run_checked([sys.executable, "-c", "import time; time.sleep(5)"], cancel=cancel, timeout=5)

    assert error.value.code == "OFFICE_CANCELED"


def test_windows_extract_uses_kernel32_system_directory_not_systemroot(tmp_path, monkeypatch):
    trusted = tmp_path / "trusted-system32"
    trusted.mkdir()
    captured = []
    monkeypatch.setenv("SystemRoot", str(tmp_path / "evil"))
    monkeypatch.setattr(install, "_windows_system32", lambda: trusted)

    def fake_run(argv, *, timeout=600, cancel=None, input=None):
        captured.append(argv)
        target_arg = next(arg for arg in argv if str(arg).startswith("TARGETDIR="))
        extracted = Path(str(target_arg).split("=", 1)[1]) / "LibreOffice"
        (extracted / "program").mkdir(parents=True)
        (extracted / "program" / "soffice.exe").write_bytes(b"win")
        return ""

    monkeypatch.setattr(install, "_run_checked", fake_run)

    install._extract_libreoffice(tmp_path / "lo.msi", tmp_path / "dest", "win-x64")

    assert captured[0][0] == str(trusted / "msiexec.exe")
    assert (tmp_path / "dest" / "libreoffice" / "program" / "soffice.exe").read_bytes() == b"win"


def test_windows_root_search_does_not_follow_symlink(tmp_path):
    outside = tmp_path / "outside"
    (outside / "program").mkdir(parents=True)
    (outside / "program" / "soffice.exe").write_bytes(b"outside")
    root = tmp_path / "root"
    root.mkdir()
    try:
        (root / "linked").symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("directory symlink unavailable")

    assert install._find_windows_office_root(root) is None


def test_lock_schema_version_is_required(tmp_path, monkeypatch, office_env):
    lock_path, _lock, _payloads = write_lock(tmp_path)
    data = json.loads(lock_path.read_text(encoding="utf-8"))
    del data["schemaVersion"]
    lock_path.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setenv("CRAWSHRIMP_OFFICE_ASSETS_LOCK", str(lock_path))

    with pytest.raises(OfficeError) as error:
        install.installed_root()

    assert error.value.code == "OFFICE_LOCK_INVALID"
