import base64
from pathlib import Path

import pytest
from PIL import Image

from core import ai_image_service, data_sink
from core.agent import mcp_gateway


@pytest.fixture
def image_context(tmp_path, monkeypatch):
    monkeypatch.setattr("core.runtime_paths.data_root", lambda: tmp_path)
    data_sink.init_db()
    monkeypatch.setattr(mcp_gateway.ctx, "active_run", {"run_id": "image", "session_id": "session-a"})
    monkeypatch.setattr(mcp_gateway.ctx, "workspace_root", tmp_path)
    monkeypatch.setattr(mcp_gateway, "_broadcast_media_artifacts", lambda paths, kind: ["artifact"])
    monkeypatch.setattr("core.api_server._resolve_one_xm_settings", lambda: {"ai.1xm.gpt_image_4k_key": "test-key"})
    return tmp_path


@pytest.mark.parametrize("kind", ["PNG", "JPEG", "WEBP"])
def test_native_chat_reference_reaches_provider_and_next_text_call_has_no_reference(image_context, monkeypatch, kind):
    # Native chat stores images under their hash without a filename extension.
    reference = image_context / ("a" * 64)
    Image.new("RGB", (8, 8), "red").save(reference, format=kind)
    output = image_context / "out.png"
    Image.new("RGB", (8, 8), "blue").save(output)
    captured = []
    jobs = []

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        def create_task(self, payload, **kwargs):
            captured.append(payload)
            return {"id": "provider-task", "status": "queued"}

    def generate(job_uid, prompts, **kwargs):
        jobs.append(job_uid)
        submitted = ai_image_service.submit_workbench_batch(
            job_uid, prompts, settings=kwargs["settings"], client_factory=Client,
            poll_submitter=lambda *args: None,
        )
        assert submitted["accepted"]
        return {"ok": True, "assets": [{"path": str(output)}], "job_uid": job_uid}

    monkeypatch.setattr(ai_image_service, "generate_images_sync", generate)
    result = mcp_gateway.tool_image_generate("保留商品，更换背景", reference_image_paths=[str(reference)])
    assert result["ok"]
    expected_mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}[kind]
    assert captured[0]["image"] == [f"data:{expected_mime};base64,{base64.b64encode(reference.read_bytes()).decode()}"]
    assert data_sink.get_ai_image_job(jobs[0])["summary"]["runs"][0]["input_params"]["reference_image_paths"] == [str(reference)]
    assert result["data"]["delivery"]["requires_file_return"] is False
    assert mcp_gateway.tool_image_generate("画一片森林")["ok"]
    assert jobs[0] != jobs[1]
    assert "image" not in captured[1]
    assert data_sink.get_ai_image_job(jobs[0])["params"]["reference_image_paths"] == [str(reference)]


def test_product_attachment_resolves_only_in_current_session(image_context, monkeypatch):
    reference = image_context / "upload.png"
    Image.new("RGB", (8, 8)).save(reference)
    monkeypatch.setattr(mcp_gateway.db, "get_attachment", lambda aid: {"session_id": "session-a", "path": str(reference)})
    seen = []
    def generate(uid, *args, **kwargs):
        seen.append(data_sink.get_ai_image_job(uid)["params"]["reference_image_paths"])
        return {"ok": True, "assets": [{"path": str(reference)}]}
    monkeypatch.setattr(ai_image_service, "generate_images_sync", generate)
    assert mcp_gateway.tool_image_generate("改背景", reference_attachment_ids=["attachment-1"])["ok"]
    assert seen == [[str(reference)]]
    monkeypatch.setattr(mcp_gateway.ctx, "active_run", {"session_id": "session-b"})
    result = mcp_gateway.tool_image_generate("改背景", reference_attachment_ids=["attachment-1"])
    assert result["status"] == "rejected"
    assert result["error"]["code"] == "ATTACHMENT_SESSION_MISMATCH"
    assert len(seen) == 1


@pytest.mark.parametrize("mode", ["missing", "fake_png", "too_many", "not_list", "empty", "oversize"])
def test_invalid_reference_is_rejected_before_provider_or_job(image_context, monkeypatch, mode):
    path = image_context / "bad.png"
    refs = [str(path)]
    if mode == "fake_png":
        path.write_text("not an image")
    elif mode == "too_many":
        refs *= 11
    elif mode == "not_list":
        refs = str(path)
    elif mode == "empty":
        refs = [""]
    elif mode == "oversize":
        with path.open("wb") as output:
            output.truncate(20 * 1024 * 1024 + 1)
    monkeypatch.setattr(mcp_gateway, "_agent_image_job", lambda *args: pytest.fail("invalid reference created a job"))
    result = mcp_gateway.tool_image_generate("改背景", reference_image_paths=refs)
    assert not result["ok"]
    assert result["error"]["code"] == "BAD_PARAMS"
