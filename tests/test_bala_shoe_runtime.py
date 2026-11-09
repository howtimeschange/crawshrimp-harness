import hashlib
import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from core import bala_shoe_runtime as runtime


@pytest.fixture
def package(tmp_path, monkeypatch):
    content = b"verified-model"
    spec = {"version": "test", "bundle": {"version": "test"}, "files": {
        "model.onnx": {"sha256": hashlib.sha256(content).hexdigest(), "size": len(content), "url": "https://example.invalid/model"}}}
    monkeypatch.setattr(runtime, "manifest", lambda: spec)
    monkeypatch.setattr(runtime, "installed_root", lambda: tmp_path / "runtime")
    monkeypatch.setattr(runtime, "target", lambda: "mac-arm64")
    monkeypatch.setattr(runtime, "_worker", None)
    monkeypatch.setattr(runtime, "_verified", None)
    monkeypatch.setattr(runtime, "_progress", {})
    runtime._cancel.clear()
    yield spec, content, tmp_path / "runtime"
    runtime._cancel.clear()


def test_install_publishes_only_after_model_and_runtime_checks(package, monkeypatch):
    spec, content, root = package
    calls = []

    def download(name, entry, destination, *_):
        assert not root.exists()
        destination.write_bytes(content)

    def run(command, **kwargs):
        assert not root.exists()
        calls.append(command)
        if "--target" in command:
            libs = Path(command[command.index("--target") + 1])
            for name in ("onnxruntime", "rapidocr_onnxruntime", "cv2", "numpy"):
                path = libs / name / "__init__.py"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("")

    monkeypatch.setattr(runtime, "_download", download)
    monkeypatch.setattr(runtime, "_run", run)
    runtime._install()
    assert runtime.status()["state"] == "ready"
    assert "--require-hashes" in calls[0]
    assert "runtime_smoke" in " ".join(calls[1])
    assert runtime.require_installed() == (root / "assets", root / "libs")
    # A restart revalidates persisted files; it does not redownload.
    monkeypatch.setattr(runtime, "_verified", None)
    assert runtime.status()["state"] == "ready"
    (root / "assets/model.onnx").write_bytes(b"tampered-model")
    assert runtime.status()["state"] == "missing"


@pytest.mark.parametrize("failure", ["download", "dependencies", "smoke"])
def test_failure_never_marks_partial_install_ready(package, monkeypatch, failure):
    _, content, root = package
    count = 0

    def download(name, entry, destination, *_):
        destination.write_bytes(content if failure != "download" else b"changed")

    def run(*args, **kwargs):
        nonlocal count
        count += 1
        if count == (1 if failure == "dependencies" else 2):
            raise RuntimeError("component failed")

    monkeypatch.setattr(runtime, "_download", download)
    monkeypatch.setattr(runtime, "_run", run)
    runtime._install()
    assert runtime.status()["state"] == "error"
    assert not root.exists()
    assert not list(root.parent.glob(".install-*"))
    assert not (root.parent / "install.lock").exists()


def test_cancel_cleans_staging_and_can_retry(package, monkeypatch):
    _, content, root = package
    def download(name, entry, destination, *_):
        runtime._cancel.set()
        runtime._check_cancel()
    monkeypatch.setattr(runtime, "_download", download)
    runtime._install()
    assert runtime.status()["state"] == "cancelled"
    assert not root.exists()
    assert not list(root.parent.glob(".install-*"))


def test_other_process_install_is_not_overwritten(package):
    _, _, root = package
    lock = root.parent / "install.lock"
    lock.write_text(str(os.getpid()))
    runtime._install()
    assert runtime.status()["state"] == "error"
    assert lock.read_text() == str(os.getpid())


def test_runtime_routes_require_token_and_dispatch_without_starting_services(package):
    from core import api_server
    # No TestClient context: lifespan would start the user's schedulers.
    client = TestClient(api_server.app)
    with patch.dict(os.environ, {"CRAWSHRIMP_API_TOKEN": "runtime-unit-token"}):
        for method, url in [("GET", "/agent/runtimes/bala-shoe"), ("POST", "/agent/runtimes/bala-shoe/install"), ("POST", "/agent/runtimes/bala-shoe/cancel")]:
            assert client.request(method, url).status_code == 401
        response = client.get("/agent/runtimes/bala-shoe", headers={"x-crawshrimp-token": "runtime-unit-token"})
        assert response.status_code == 200 and response.json()["state"] == "missing"
        with patch.object(runtime, "start_install", return_value={"state": "downloading"}) as install:
            response = client.post("/agent/runtimes/bala-shoe/install", headers={"x-crawshrimp-token": "runtime-unit-token"})
        assert response.status_code == 200 and response.json()["state"] == "downloading"
        install.assert_called_once()


def test_shipping_config_excludes_weights_and_locks_every_platform():
    import yaml
    root = Path(__file__).resolve().parents[1]
    config = yaml.safe_load((root / "app/build.yml").read_text())
    entry = next(item for item in config["extraResources"] if item["to"] == "python-scripts/core")
    assert "!shoe_specialist/assets/**" in entry["filter"]
    assert "!**/*.onnx" in entry["filter"]
    assert not list((root / "core/shoe_specialist").rglob("*.onnx"))
    for target in ("mac-arm64", "mac-x64", "win-x64"):
        lock = (runtime.PACKAGE / f"runtime-{target}-py312.txt").read_text()
        assert "onnxruntime==1.20.1" in lock and "--hash=sha256:" in lock
