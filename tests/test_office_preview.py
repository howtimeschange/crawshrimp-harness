import json
from pathlib import Path

from core.agent import api
from core.office import jobs, preview
from core.office.runtime import file_hash


def _use_data_root(monkeypatch, tmp_path: Path) -> Path:
    data = tmp_path / "data"
    monkeypatch.setattr(preview.runtime_paths, "data_root", lambda: data)
    return data


def _write_completed_manifest(work: Path, document: Path, *, job_id: str = "a" * 32) -> dict:
    page = work / "preview" / "pages" / "page-0001.png"
    page.parent.mkdir(parents=True, exist_ok=True)
    page.write_bytes(b"page")
    pdf = work / "preview" / "deck.pdf"
    pdf.write_bytes(b"%PDF-")
    result = {
        "document": str(document),
        "revision": file_hash(document),
        "pdf": str(pdf),
        "pages": [{
            "page": 1,
            "path": str(page),
            "sha256": file_hash(page),
            "width": 640,
            "height": 360,
            "text_length": 12,
        }],
        "visual": {"status": "passed", "reviewed": [1], "total": 1},
        "validation": {"status": "passed"},
        "delivery": {"status": "final", "path": str(document), "sha256": file_hash(document)},
    }
    jobs.save(work, {"job_id": job_id, "state": "completed", "operation": "render", "result": result, "error": None})
    return result


def _fake_start(monkeypatch, started: list[Path], *, state: str = "queued", job_id: str = "b" * 32):
    def start(root, operation, *, document=None, recalculate=False, **_kwargs):
        assert operation == "render"
        assert recalculate is False
        started.append(Path(document))
        work = root / job_id
        work.mkdir(parents=True)
        jobs.save(work, {"job_id": job_id, "state": state, "operation": "render", "result": None, "error": None})
        return {"job_id": job_id, "state": state}

    monkeypatch.setattr(preview.jobs, "start", start)
    monkeypatch.setattr(preview.jobs, "read", lambda root, job_id, **_kwargs: json.loads((root / job_id / "manifest.json").read_text(encoding="utf-8")))


def test_recovers_exact_sibling_managed_manifest_across_sessions(monkeypatch, tmp_path):
    _use_data_root(monkeypatch, tmp_path)
    job_id = "a" * 32
    work = tmp_path / "old-session" / "outputs" / "office" / "session" / job_id
    editable = work / "editable"
    editable.mkdir(parents=True)
    document = editable / "deck.pptx"
    document.write_bytes(b"pptx")
    _write_completed_manifest(work, document, job_id=job_id)

    result = preview.resolve(document)

    assert result["state"] == "completed"
    assert result["office"]["job_id"] == job_id
    assert result["office"]["revision"] == file_hash(document)
    assert result["office"]["pages"][0]["path"].endswith("page-0001.png")
    assert result["office"]["visual"]["status"] == "passed"
    assert result["office"]["delivery"]["status"] == "final"


def test_stale_sibling_manifest_starts_fresh_preview_job(monkeypatch, tmp_path):
    _use_data_root(monkeypatch, tmp_path)
    work = tmp_path / "managed" / ("a" * 32)
    editable = work / "editable"
    editable.mkdir(parents=True)
    document = editable / "report.docx"
    document.write_bytes(b"v1")
    _write_completed_manifest(work, document)
    document.write_bytes(b"v2")
    started = []
    _fake_start(monkeypatch, started)

    result = preview.resolve(document)

    assert result == {"state": "queued", "job_id": "b" * 32}
    assert started == [document.resolve()]


def test_corrupt_optional_manifest_shape_does_not_block_render(monkeypatch, tmp_path):
    _use_data_root(monkeypatch, tmp_path)
    work = tmp_path / "managed" / ("a" * 32)
    editable = work / "editable"
    editable.mkdir(parents=True)
    document = editable / "report.pptx"
    document.write_bytes(b"pptx")
    result = _write_completed_manifest(work, document)
    result["pages"] = 123
    jobs.save(work, {"state": "completed", "result": result})
    started = []
    _fake_start(monkeypatch, started)
    assert preview.resolve(document)["state"] == "queued"
    assert started == [document.resolve()]


def test_preview_storage_failure_returns_actionable_error(monkeypatch, tmp_path):
    _use_data_root(monkeypatch, tmp_path)
    document = tmp_path / "report.docx"
    document.write_bytes(b"docx")

    def fail(*args, **kwargs):
        raise OSError("preview storage is full")

    monkeypatch.setattr(preview.jobs, "start", fail)
    result = preview.resolve(document)
    assert result["state"] == "failed"
    assert result["error"]["message"] == "preview storage is full"


def test_plain_office_file_starts_once_and_reuses_queued_job(monkeypatch, tmp_path):
    _use_data_root(monkeypatch, tmp_path)
    document = tmp_path / "plain.pptx"
    original = b"plain-pptx"
    document.write_bytes(original)
    started = []
    _fake_start(monkeypatch, started)

    def read(root, job_id, *, cancel=False):
        return json.loads((root / job_id / "manifest.json").read_text(encoding="utf-8"))

    monkeypatch.setattr(preview.jobs, "read", read)

    first = preview.resolve(document)
    second = preview.resolve(document)

    assert first == second == {"state": "queued", "job_id": "b" * 32}
    assert started == [document.resolve()]
    assert document.read_bytes() == original


def test_preview_poll_exposes_first_use_install_progress(monkeypatch, tmp_path):
    _use_data_root(monkeypatch, tmp_path)
    document = tmp_path / "first.docx"
    document.write_bytes(b"docx")
    started = []
    _fake_start(monkeypatch, started)
    monkeypatch.setattr(preview.jobs, "read", lambda root, job_id, **kwargs: {
        "state": "running", "runtime_progress": {"state": "downloading", "downloaded_bytes": 50, "total_bytes": 100}})
    first = preview.resolve(document)
    result = preview.resolve(document, first["job_id"])
    assert result["state"] == "running"
    assert result["runtime_progress"]["downloaded_bytes"] == 50
    assert started == [document.resolve()]


def test_start_terminal_response_is_normalized_through_poll(monkeypatch, tmp_path):
    _use_data_root(monkeypatch, tmp_path)
    document = tmp_path / "fast.docx"
    document.write_bytes(b"docx")
    started = []
    _fake_start(monkeypatch, started, state="completed")

    result = preview.resolve(document)

    assert result["state"] == "failed"
    assert result["job_id"] == "b" * 32
    assert result["error"]["code"] == "OFFICE_PREVIEW_INVALID"


def test_unsupported_office_format_is_terminal_failure(monkeypatch, tmp_path):
    _use_data_root(monkeypatch, tmp_path)
    document = tmp_path / "legacy.ppt"
    document.write_bytes(b"legacy")

    result = preview.resolve(document)

    assert result["state"] == "failed"
    assert result["error"]["code"] == "OFFICE_FORMAT_UNSUPPORTED"


def test_polling_completed_job_returns_sanitized_office(monkeypatch, tmp_path):
    data = _use_data_root(monkeypatch, tmp_path)
    source = tmp_path / "source.xlsx"
    source.write_bytes(b"xlsx")
    root = data / "agent" / "previews" / "office"
    job_id = "c" * 32
    work = root / job_id
    editable = work / "editable"
    editable.mkdir(parents=True)
    rendered = editable / "source.xlsx"
    rendered.write_bytes(source.read_bytes())
    _write_completed_manifest(work, rendered, job_id=job_id)
    (work / preview.REQUEST_FILE).write_text(json.dumps({
        "source_path": str(source.resolve()),
        "source_revision": file_hash(source),
    }), encoding="utf-8")

    result = preview.resolve(source, job_id)

    assert result["state"] == "completed"
    assert result["office"]["job_id"] == job_id
    assert result["office"]["pages"][0]["sha256"]
    assert "data_url" not in result["office"]["pages"][0]


def test_polling_failure_and_path_mismatch_do_not_rerender(monkeypatch, tmp_path):
    data = _use_data_root(monkeypatch, tmp_path)
    first = tmp_path / "first.docx"
    second = tmp_path / "second.docx"
    first.write_bytes(b"first")
    second.write_bytes(b"second")
    root = data / "agent" / "previews" / "office"
    job_id = "d" * 32
    work = root / job_id
    work.mkdir(parents=True)
    jobs.save(work, {"job_id": job_id, "state": "failed", "operation": "render", "result": None,
                     "error": {"code": "OFFICE_RENDER_FAILED", "message": "boom"}})
    (work / preview.REQUEST_FILE).write_text(json.dumps({
        "source_path": str(first.resolve()),
        "source_revision": file_hash(first),
    }), encoding="utf-8")
    started = []
    _fake_start(monkeypatch, started, job_id="e" * 32)

    failed = preview.resolve(first, job_id)
    mismatch = preview.resolve(second, job_id)

    assert failed["state"] == "failed"
    assert failed["job_id"] == job_id
    assert failed["error"] == {"code": "OFFICE_RENDER_FAILED", "message": "boom"}
    assert mismatch["error"]["code"] == "OFFICE_PREVIEW_PATH_MISMATCH"
    assert started == []


def test_api_office_preview_uses_token_guarded_local_file_path(monkeypatch, tmp_path):
    document = tmp_path / "deck.pptx"
    document.write_bytes(b"pptx")
    captured = {}

    def resolve(path, job_id=None):
        captured["path"] = path
        captured["job_id"] = job_id
        return {"state": "queued", "job_id": "f" * 32}

    monkeypatch.setattr("core.office.preview.resolve", resolve)

    result = api.office_preview(api.OfficePreviewRequest(path=str(document), job_id=""))

    assert result == {"state": "queued", "job_id": "f" * 32}
    assert captured == {"path": document.resolve(), "job_id": None}
