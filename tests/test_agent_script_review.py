"""智能体脚本三闸门与隔离测试安装回归。"""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
import yaml
from fastapi import HTTPException

from core.agent import api
from core.agent.script_contract import validate_page_script


VALID_JS = """;(async () => {
  return { success: true, data: [], meta: { has_more: false } }
})()
"""


def _package(tmp_path: Path, script: str = VALID_JS) -> tuple[dict, list[dict]]:
    manifest = tmp_path / "manifest.yaml"
    task = tmp_path / "collect.js"
    manifest.write_text(yaml.safe_dump({
        "id": "production-adapter",
        "name": "正式适配器",
        "entry_url": "https://example.com",
        "tasks": [{"id": "collect", "name": "采集", "script": "collect.js"}],
    }, allow_unicode=True), encoding="utf-8")
    task.write_text(script, encoding="utf-8")
    revision = {
        "rev_id": "rev-contract",
        "draft_path": str(manifest),
        "created_run_id": "run-contract",
        "status": "pending_review",
        "adapter_id": "production-adapter",
        "target_adapter_id": None,
        "test_adapter_id": None,
    }
    files = [{"path": str(manifest)}, {"path": str(task)}]
    return revision, files


@pytest.mark.parametrize("source, message", [
    ("async function run() { return { success: true, data: [], meta: {} } }", "async IIFE"),
    (";(async () => { return { success: true, data: [] } })()", "success、data、meta"),
    (";(async () => { function fake() { return { success: true, data: [], meta: {} } } })()",
     "success、data、meta"),
])
def test_page_script_contract_rejects_non_compliant_source(source, message):
    with pytest.raises(ValueError, match=message):
        validate_page_script(source, "collect.js")


@pytest.mark.parametrize("source", [
    """;(async () => {
      const success = true; const data = { items: [{ id: 1 }] }; const meta = { has_more: false };
      return { success, data, meta }
    })()""",
    """;(async () => {
      return { success: true, data: { items: [{ nested: true }] }, meta: { has_more: false } }
    })()""",
])
def test_page_script_contract_accepts_nested_values_and_shorthand(source):
    validate_page_script(source, "collect.js")


def test_revision_rejects_path_shaped_adapter_id_before_install(tmp_path, monkeypatch):
    revision, files = _package(tmp_path)
    manifest = Path(revision["draft_path"])
    doc = yaml.safe_load(manifest.read_text(encoding="utf-8"))
    doc["id"] = "../../escape"
    manifest.write_text(yaml.safe_dump(doc, allow_unicode=True), encoding="utf-8")
    monkeypatch.setattr(api.db, "list_workspace_files", lambda _run: files)
    with pytest.raises(HTTPException, match="schema"):
        api._load_revision_package(revision)


def test_revision_must_be_manifest_entry(tmp_path, monkeypatch):
    script = tmp_path / "loose.js"
    script.write_text(VALID_JS, encoding="utf-8")
    revision = {"draft_path": str(script), "created_run_id": "run"}
    monkeypatch.setattr(api.db, "list_workspace_files", lambda _run: [{"path": str(script)}])
    with pytest.raises(HTTPException, match="manifest.yaml"):
        api._load_revision_package(revision)


def test_revision_rejects_missing_or_invalid_task_script(tmp_path, monkeypatch):
    revision, files = _package(tmp_path, "console.log('not an iife')")
    monkeypatch.setattr(api.db, "list_workspace_files", lambda _run: files)
    with pytest.raises(HTTPException, match="async IIFE"):
        api._load_revision_package(revision)


def test_test_install_uses_unique_adapter_without_overwriting_target(tmp_path, monkeypatch):
    revision, files = _package(tmp_path)
    installed = []
    updates = []

    def install_from_dir(source_dir, install_mode="copy"):
        manifest = yaml.safe_load((Path(source_dir) / "manifest.yaml").read_text(encoding="utf-8"))
        installed.append(manifest)

    monkeypatch.setattr(api.db, "get_script_revision", lambda _rid: dict(revision))
    monkeypatch.setattr(api.db, "list_workspace_files", lambda _run: files)
    monkeypatch.setattr(api.db, "update_script_revision", lambda _rid, **fields: updates.append(fields))
    monkeypatch.setattr("core.adapter_loader.install_from_dir", install_from_dir)
    result = asyncio.run(api.test_install_script_revision("rev-contract"))
    assert result["adapter_id"].startswith("review-")
    assert result["adapter_id"] != "production-adapter"
    assert installed[0]["id"] == result["adapter_id"]
    assert updates[-1]["target_adapter_id"] == "production-adapter"
    assert updates[-1]["test_adapter_id"] == result["adapter_id"]


def test_publish_cannot_skip_isolated_test(monkeypatch):
    revision = {
        "rev_id": "rev-skip",
        "draft_path": "/tmp/manifest.yaml",
        "status": "pending_review",
        "test_adapter_id": None,
    }
    monkeypatch.setattr(api.db, "get_script_revision", lambda _rid: revision)
    with pytest.raises(HTTPException, match="必须先安装"):
        asyncio.run(api.review_script_revision("rev-skip", api.ScriptReviewRequest(decision="publish")))


def test_reject_stops_test_instances_before_uninstall(monkeypatch):
    revision = {
        "rev_id": "rev-reject",
        "draft_path": "/tmp/manifest.yaml",
        "status": "testing",
        "test_adapter_id": "review-deadbeef",
    }
    calls = []
    monkeypatch.setattr(api.db, "get_script_revision", lambda _rid: revision)
    monkeypatch.setattr(api.db, "update_script_revision", lambda *_args, **_kwargs: calls.append("update"))

    async def stop(_adapter_id):
        calls.append("stop")

    monkeypatch.setattr(api, "_stop_test_adapter_instances", stop)
    monkeypatch.setattr("core.adapter_loader.uninstall", lambda _adapter_id: calls.append("uninstall"))
    result = asyncio.run(api.review_script_revision("rev-reject", api.ScriptReviewRequest(decision="reject")))
    assert result["status"] == "rejected"
    assert calls == ["stop", "uninstall", "update"]


def test_repeated_test_install_of_same_package_is_idempotent(tmp_path, monkeypatch):
    revision, files = _package(tmp_path)
    monkeypatch.setattr(api.db, "list_workspace_files", lambda _run: files)
    revision.update({
        "status": "testing",
        "test_adapter_id": "review-existing",
        "tested_sha256": api._revision_package_sha256(revision),
    })
    monkeypatch.setattr(api.db, "get_script_revision", lambda _rid: dict(revision))
    monkeypatch.setattr(
        api, "_install_revision_to_adapters",
        lambda *_args, **_kwargs: pytest.fail("相同内容不应重复覆盖测试适配器"),
    )
    result = asyncio.run(api.test_install_script_revision("rev-contract"))
    assert result["idempotent"] is True
    assert result["test_adapter_id"] == "review-existing"


def test_failed_test_reinstall_clears_testing_state(tmp_path, monkeypatch):
    revision, files = _package(tmp_path)
    revision.update({
        "status": "testing",
        "test_adapter_id": "review-existing",
        "tested_sha256": "old-sha",
    })
    updates = []
    removed = []
    monkeypatch.setattr(api.db, "get_script_revision", lambda _rid: dict(revision))
    monkeypatch.setattr(api.db, "list_workspace_files", lambda _run: files)
    monkeypatch.setattr(api.db, "update_script_revision", lambda _rid, **fields: updates.append(fields))
    monkeypatch.setattr(api, "_stop_test_adapter_instances", lambda _adapter: _async_record([], "stop"))
    monkeypatch.setattr(
        api, "_install_revision_to_adapters",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(HTTPException(409, "install failed")),
    )
    monkeypatch.setattr(api, "_remove_failed_adapter", lambda adapter_id: removed.append(adapter_id))
    with pytest.raises(HTTPException, match="install failed"):
        asyncio.run(api.test_install_script_revision("rev-contract"))
    assert removed == ["review-existing"]
    assert updates[-1] == {
        "status": "pending_review", "test_adapter_id": None, "tested_sha256": None,
    }


def test_publish_rejects_package_changed_after_test(tmp_path, monkeypatch):
    revision, files = _package(tmp_path)
    revision.update({
        "status": "testing",
        "test_adapter_id": "review-existing",
        "tested_sha256": "tested-old-content",
    })
    monkeypatch.setattr(api.db, "get_script_revision", lambda _rid: dict(revision))
    monkeypatch.setattr(api.db, "list_workspace_files", lambda _run: files)
    with pytest.raises(HTTPException, match="测试后已变化"):
        asyncio.run(api.review_script_revision("rev-contract", api.ScriptReviewRequest(decision="publish")))


def test_snapshot_restore_recovers_adapter_and_metadata(tmp_path, monkeypatch):
    from core import adapter_loader
    from core.agent import service

    adapter_id = "production-adapter"
    data_root = tmp_path / "data"
    dest = data_root / "adapters" / adapter_id
    dest.mkdir(parents=True)
    (dest / "manifest.yaml").write_text("id: production-adapter\nname: 旧包\nentry_url: https://example.com\ntasks: []\n", encoding="utf-8")
    (dest / "old.txt").write_text("old", encoding="utf-8")
    meta_path = data_root / "adapter-meta" / f"{adapter_id}.json"
    meta_path.parent.mkdir(parents=True)
    meta_path.write_text('{"install_mode":"link","source_path":"/old/source"}', encoding="utf-8")
    scans = []
    monkeypatch.setattr(service, "_data_root", lambda: data_root)
    monkeypatch.setattr(adapter_loader, "_metadata_path", lambda _adapter_id: meta_path)
    monkeypatch.setattr(adapter_loader, "scan_all", lambda: scans.append(True) or [])

    assert api._snapshot_existing_adapter(adapter_id) is True
    (dest / "old.txt").write_text("new", encoding="utf-8")
    meta_path.write_text('{"install_mode":"copy"}', encoding="utf-8")
    api._restore_snapshotted_adapter(adapter_id)

    assert (dest / "old.txt").read_text(encoding="utf-8") == "old"
    assert '"link"' in meta_path.read_text(encoding="utf-8")
    assert scans == [True]
    assert not api._adapter_snapshot_dir(adapter_id).exists()


def test_published_baseline_preserves_original_across_multiple_agent_publishes(tmp_path, monkeypatch):
    from core import adapter_loader
    from core.agent import service

    adapter_id = "production-adapter"
    data_root = tmp_path / "data"
    dest = data_root / "adapters" / adapter_id
    dest.mkdir(parents=True)
    (dest / "manifest.yaml").write_text(
        "id: production-adapter\nname: 原包\nentry_url: https://example.com\ntasks: []\n",
        encoding="utf-8",
    )
    (dest / "version.txt").write_text("original", encoding="utf-8")
    meta_path = data_root / "adapter-meta" / f"{adapter_id}.json"
    meta_path.parent.mkdir(parents=True)
    meta_path.write_text('{"install_mode":"link"}', encoding="utf-8")
    monkeypatch.setattr(service, "_data_root", lambda: data_root)
    monkeypatch.setattr(adapter_loader, "_metadata_path", lambda _adapter_id: meta_path)
    monkeypatch.setattr(adapter_loader, "scan_all", lambda: [])

    assert api._capture_published_adapter_baseline(adapter_id) is True
    (dest / "version.txt").write_text("agent-v1", encoding="utf-8")
    assert api._capture_published_adapter_baseline(adapter_id) is False
    (dest / "version.txt").write_text("agent-v2", encoding="utf-8")

    assert api._restore_published_adapter_baseline(adapter_id) is True
    assert (dest / "version.txt").read_text(encoding="utf-8") == "original"
    assert '"link"' in meta_path.read_text(encoding="utf-8")
    assert api._published_adapter_baseline_dir(adapter_id).exists()


@pytest.mark.parametrize("had_snapshot, cleanup_name", [(True, "restore"), (False, "remove")])
def test_publish_install_failure_rolls_back_target(tmp_path, monkeypatch, had_snapshot, cleanup_name):
    revision, files = _package(tmp_path)
    monkeypatch.setattr(api.db, "list_workspace_files", lambda _run: files)
    revision.update({
        "status": "testing",
        "test_adapter_id": "review-existing",
        "tested_sha256": api._revision_package_sha256(revision),
    })
    calls = []
    monkeypatch.setattr(api.db, "get_script_revision", lambda _rid: dict(revision))
    monkeypatch.setattr(api, "_stop_test_adapter_instances", lambda _adapter: _async_record(calls, "stop"))
    monkeypatch.setattr(api, "_snapshot_existing_adapter", lambda _adapter: had_snapshot)
    monkeypatch.setattr(
        api, "_install_revision_to_adapters",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(HTTPException(409, "install failed")),
    )
    monkeypatch.setattr(api, "_restore_snapshotted_adapter", lambda _adapter: calls.append("restore"))
    monkeypatch.setattr(api, "_remove_failed_adapter", lambda _adapter: calls.append("remove"))
    with pytest.raises(HTTPException, match="install failed"):
        asyncio.run(api.review_script_revision("rev-contract", api.ScriptReviewRequest(decision="publish")))
    assert calls == ["stop", cleanup_name]


async def _async_record(calls, value):
    calls.append(value)
