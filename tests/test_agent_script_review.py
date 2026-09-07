"""Dialog-confirmed agent adapter installation and runtime-discovery regression."""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
import yaml
from fastapi import HTTPException

from core import adapter_loader, runtime_paths
from core.agent import api, mcp_gateway
from core.agent.script_contract import validate_page_script


VALID_JS = """;(async () => {
  return { success: true, data: [], meta: { has_more: false } }
})()
"""


def _package(tmp_path: Path, script: str = VALID_JS) -> tuple[dict, list[dict]]:
    manifest = tmp_path / "manifest.yaml"
    task = tmp_path / "collect.js"
    manifest.write_text(yaml.safe_dump({
        "id": "eifini-franchise-entry",
        "name": "伊芙丽加盟入口探查",
        "version": "1.0.0",
        "description": "探查官方加盟入口、识别表单字段并提取联系方式。",
        "entry_url": "https://example.com/franchise",
        "tasks": [{"id": "find-franchise-entry", "name": "查找加盟入口", "script": "collect.js"}],
    }, allow_unicode=True), encoding="utf-8")
    task.write_text(script, encoding="utf-8")
    revision = {
        "rev_id": "rev-eifini",
        "draft_path": str(manifest),
        "created_run_id": "run-eifini",
        "status": "draft",
        "adapter_id": None,
        "target_adapter_id": None,
        "test_adapter_id": None,
    }
    return revision, [{"path": str(manifest)}, {"path": str(task)}]


@pytest.mark.parametrize("source, message", [
    ("async function run() { return { success: true, data: [], meta: {} } }", "async IIFE"),
    (";(async () => { return { success: true, data: [] } })()", "success、data、meta"),
])
def test_page_script_contract_rejects_non_compliant_source(source, message):
    with pytest.raises(ValueError, match=message):
        validate_page_script(source, "collect.js")


def test_revision_must_be_manifest_entry(tmp_path, monkeypatch):
    script = tmp_path / "loose.js"
    script.write_text(VALID_JS, encoding="utf-8")
    revision = {"draft_path": str(script), "created_run_id": "run"}
    monkeypatch.setattr(api.db, "list_workspace_files", lambda _run: [{"path": str(script)}])
    with pytest.raises(HTTPException, match="manifest.yaml"):
        api._load_revision_package(revision)


def test_revision_files_are_scoped_to_its_adapter_package_directory(tmp_path, monkeypatch):
    package = tmp_path / "eifini-franchise-entry"
    package.mkdir()
    revision, files = _package(package)
    unrelated = tmp_path / "other-package" / "collect.js"
    unrelated.parent.mkdir()
    unrelated.write_text(VALID_JS, encoding="utf-8")
    monkeypatch.setattr(api.db, "list_workspace_files", lambda _run: files + [{"path": str(unrelated)}])

    collected = dict(api._collect_revision_files(revision))

    assert set(collected) == {"manifest.yaml", "collect.js"}
    assert collected["collect.js"].parent == package


def test_direct_install_rejects_path_shaped_adapter_id(tmp_path, monkeypatch):
    revision, files = _package(tmp_path)
    manifest = Path(revision["draft_path"])
    document = yaml.safe_load(manifest.read_text(encoding="utf-8"))
    document["id"] = "../../escape"
    manifest.write_text(yaml.safe_dump(document, allow_unicode=True), encoding="utf-8")
    monkeypatch.setattr(api.db, "list_workspace_files", lambda _run: files)
    with pytest.raises(HTTPException, match="schema"):
        api._load_revision_package(revision)


def test_dialog_confirmed_install_writes_formal_runtime_and_my_scripts_catalog(tmp_path, monkeypatch):
    """One confirmed adapter is installed under its formal id and discoverable by My Scripts."""
    revision, files = _package(tmp_path)
    updates = []
    data_root = tmp_path / "runtime"
    previous = {
        "adapters": dict(adapter_loader._adapters),
        "dirs": dict(adapter_loader._adapter_dirs),
        "enabled": dict(adapter_loader._enabled),
        "meta": dict(adapter_loader._install_meta),
    }
    monkeypatch.setenv("CRAWSHRIMP_DATA", str(data_root))
    monkeypatch.setattr("core.agent.service._data_root", lambda: data_root)
    monkeypatch.setattr(api.db, "get_script_revision", lambda _rid: dict(revision))
    monkeypatch.setattr(api.db, "list_workspace_files", lambda _run: files)

    def update_revision(_rid, **fields):
        updates.append(fields)
        revision.update(fields)

    monkeypatch.setattr(api.db, "update_script_revision", update_revision)
    runtime_paths.reset_runtime_data_root_cache()
    adapter_loader._adapters.clear()
    adapter_loader._adapter_dirs.clear()
    adapter_loader._enabled.clear()
    adapter_loader._install_meta.clear()
    try:
        expected_sha = api._revision_package_sha256(revision)
        result = api.install_approved_script_revision(
            revision["rev_id"], expected_source_sha256=expected_sha,
        )
        assert result["status"] == "published"
        assert result["adapter_id"] == "eifini-franchise-entry"
        assert (data_root / "adapters" / "eifini-franchise-entry" / "manifest.yaml").is_file()
        adapter_loader.scan_all()
        installed = {item["id"]: item for item in adapter_loader.list_all()}
        assert installed["eifini-franchise-entry"]["name"] == "伊芙丽加盟入口探查"
        assert installed["eifini-franchise-entry"]["task_count"] == 1
        assert updates[-1]["status"] == "published"
        assert updates[-1]["source_sha256"] == expected_sha
    finally:
        adapter_loader._adapters.clear()
        adapter_loader._adapters.update(previous["adapters"])
        adapter_loader._adapter_dirs.clear()
        adapter_loader._adapter_dirs.update(previous["dirs"])
        adapter_loader._enabled.clear()
        adapter_loader._enabled.update(previous["enabled"])
        adapter_loader._install_meta.clear()
        adapter_loader._install_meta.update(previous["meta"])
        runtime_paths.reset_runtime_data_root_cache()


def test_confirmed_install_rejects_content_changed_after_dialog_confirmation(tmp_path, monkeypatch):
    revision, files = _package(tmp_path)
    monkeypatch.setattr(api.db, "get_script_revision", lambda _rid: dict(revision))
    monkeypatch.setattr(api.db, "list_workspace_files", lambda _run: files)
    with pytest.raises(HTTPException, match="确认期间已变化"):
        api.install_approved_script_revision(revision["rev_id"], expected_source_sha256="old-content")


@pytest.mark.parametrize("had_snapshot, rollback_name", [(True, "restore"), (False, "remove")])
def test_confirmed_install_failure_rolls_back_target(tmp_path, monkeypatch, had_snapshot, rollback_name):
    revision, files = _package(tmp_path)
    revision["status"] = "tested"
    calls = []
    monkeypatch.setattr(api.db, "get_script_revision", lambda _rid: dict(revision))
    monkeypatch.setattr(api.db, "list_workspace_files", lambda _run: files)
    monkeypatch.setattr(api, "_capture_published_adapter_baseline", lambda _adapter: False)
    monkeypatch.setattr(api, "_snapshot_existing_adapter", lambda _adapter: had_snapshot)
    monkeypatch.setattr(
        api,
        "_install_revision_to_adapters",
        lambda *_args: (_ for _ in ()).throw(HTTPException(409, "install failed")),
    )
    monkeypatch.setattr(api, "_restore_snapshotted_adapter", lambda _adapter: calls.append("restore"))
    monkeypatch.setattr(api, "_remove_failed_adapter", lambda _adapter: calls.append("remove"))
    with pytest.raises(HTTPException, match="install failed"):
        api.install_approved_script_revision(revision["rev_id"])
    assert calls == [rollback_name]


def test_publish_tool_uses_one_native_confirmation_then_direct_install(tmp_path, monkeypatch):
    revision, files = _package(tmp_path)
    approvals = []
    previous_run = mcp_gateway.ctx.active_run
    previous_approval = mcp_gateway.ctx.request_approval
    monkeypatch.setattr(mcp_gateway.db, "get_script_revision", lambda _rid: dict(revision))
    monkeypatch.setattr(mcp_gateway.db, "list_workspace_files", lambda _run: files)

    async def approve(_tool_call, _plan, summary, _risk):
        approvals.append(summary)
        return "approved"

    mcp_gateway.ctx.request_approval = approve
    installed = []

    def direct_install(rev_id, *, expected_source_sha256):
        installed.append((rev_id, expected_source_sha256))
        return {"ok": True, "status": "published", "adapter_id": "eifini-franchise-entry"}

    monkeypatch.setattr(api, "install_approved_script_revision", direct_install)
    mcp_gateway.ctx.active_run = {"run_id": "run-eifini", "session_id": "session-eifini"}
    try:
        result = asyncio.run(mcp_gateway.tool_script_publish(revision["rev_id"]))
    finally:
        mcp_gateway.ctx.active_run = previous_run
        mcp_gateway.ctx.request_approval = previous_approval

    assert result["status"] == "published"
    assert approvals[0]["kind"] == "script_publish"
    assert approvals[0]["adapter_id"] == "eifini-franchise-entry"
    assert installed == [(revision["rev_id"], approvals[0]["source_sha256"])]


def test_publish_tool_rejection_never_installs(tmp_path, monkeypatch):
    revision, files = _package(tmp_path)
    previous_run = mcp_gateway.ctx.active_run
    previous_approval = mcp_gateway.ctx.request_approval
    monkeypatch.setattr(mcp_gateway.db, "get_script_revision", lambda _rid: dict(revision))
    monkeypatch.setattr(mcp_gateway.db, "list_workspace_files", lambda _run: files)
    monkeypatch.setattr(mcp_gateway.db, "update_script_revision", lambda *_args, **_kwargs: None)

    async def reject(*_args):
        return "rejected"

    mcp_gateway.ctx.request_approval = reject
    monkeypatch.setattr(api, "install_approved_script_revision", lambda *_args, **_kwargs: pytest.fail("拒绝后不得安装"))
    mcp_gateway.ctx.active_run = {"run_id": "run-eifini", "session_id": "session-eifini"}
    try:
        result = asyncio.run(mcp_gateway.tool_script_publish(revision["rev_id"]))
    finally:
        mcp_gateway.ctx.active_run = previous_run
        mcp_gateway.ctx.request_approval = previous_approval
    assert result["status"] == "rejected"


def test_legacy_script_review_http_routes_are_not_exposed():
    paths = {route.path for route in api.router.routes}
    assert "/agent/script-revisions/{rev_id}/test-install" not in paths
    assert "/agent/script-revisions/{rev_id}/review" not in paths


def test_published_baseline_preserves_original_adapter(tmp_path, monkeypatch):
    from core.agent import service

    adapter_id = "eifini-franchise-entry"
    data_root = tmp_path / "data"
    dest = data_root / "adapters" / adapter_id
    dest.mkdir(parents=True)
    (dest / "manifest.yaml").write_text(
        "id: eifini-franchise-entry\nname: 原包\nentry_url: https://example.com\ntasks: []\n",
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
    (dest / "version.txt").write_text("agent-version", encoding="utf-8")
    assert api._restore_published_adapter_baseline(adapter_id) is True
    assert (dest / "version.txt").read_text(encoding="utf-8") == "original"
    assert '"link"' in meta_path.read_text(encoding="utf-8")


def test_publish_rollback_failure_reports_original_and_rollback_errors(monkeypatch):
    original = HTTPException(409, "install failed")
    monkeypatch.setattr(
        api,
        "_restore_snapshotted_adapter",
        lambda _adapter: (_ for _ in ()).throw(HTTPException(500, "restore failed")),
    )
    with pytest.raises(HTTPException) as raised:
        api._rollback_failed_adapter_install(
            "eifini-franchise-entry", had_snapshot=True, original_exc=original,
        )
    assert raised.value.status_code == 500
    assert "install failed" in raised.value.detail
    assert "restore failed" in raised.value.detail
