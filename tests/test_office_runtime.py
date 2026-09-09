import json
import os
import sys
import threading
import time
from pathlib import Path

import pytest

from core.office import jobs
from core.office.executor import execute
from core.office.runtime import OfficeError, environment, file_hash, python_executable
from core.office.templates import word_template, ppt_template, excel_template
from core.office.validate import validate


def test_explicit_python_never_falls_back(monkeypatch, tmp_path):
    monkeypatch.delenv("CRAWSHRIMP_PYTHON_EXECUTABLE", raising=False)
    monkeypatch.setenv("PATH", str(tmp_path))
    with pytest.raises(OfficeError, match="Python"):
        python_executable()
    monkeypatch.setenv("CRAWSHRIMP_PYTHON_EXECUTABLE", sys.executable)
    assert python_executable() == Path(sys.executable).resolve()
    monkeypatch.setenv("CRAWSHRIMP_RESOURCES_ROOT", str(tmp_path))
    with pytest.raises(OfficeError, match="不属于"):
        python_executable()


def test_child_environment_and_unicode_paths(monkeypatch, tmp_path):
    work = tmp_path / "中文 工作区"
    monkeypatch.setenv("PYTHONPATH", "/untrusted")
    monkeypatch.setenv("PYTHONHOME", "/broken")
    monkeypatch.setenv("VIRTUAL_ENV", "/other")
    env = environment(work)
    assert "PYTHONHOME" not in env and "VIRTUAL_ENV" not in env
    assert env["PYTHONPATH"] != "/untrusted"
    result = execute([sys.executable, "-c", "import sys; print('中文'); print(sys.executable)"], work)
    assert "中文" in result["stdout"] and sys.executable in result["stdout"]


def test_timeout_kills_only_own_process(tmp_path):
    with pytest.raises(OfficeError) as error:
        execute([sys.executable, "-c", "import time; time.sleep(20)"], tmp_path, timeout=1)
    assert error.value.code == "OFFICE_TIMEOUT"
    assert execute([sys.executable, "-c", "print('alive')"], tmp_path)["stdout"].strip() == "alive"


def test_cancel_is_distinct_from_failure(tmp_path):
    event = threading.Event()
    event.set()
    with pytest.raises(OfficeError) as error:
        execute([sys.executable, "-c", "raise Exception('must not run')"], tmp_path, cancel=event)
    assert error.value.code == "OFFICE_CANCELED"


def test_documents_reopen_and_wrong_expectations_fail(tmp_path):
    word, ppt, excel = [tmp_path / f"sample.{ext}" for ext in ("docx", "pptx", "xlsx")]
    word_template(word)
    ppt_template(ppt)
    excel_template(excel)
    assert validate(word, {"contains": ["业务报告"]})["status"] == "passed"
    assert validate(ppt, {"slides": 5})["status"] == "passed"
    assert validate(ppt, {"slides": 6})["status"] == "issues"
    report = validate(excel)
    assert report["formula_count"] == 4
    assert all(i["code"] == "FORMULA_CACHE_MISSING" for i in report["issues"])
    import openpyxl
    book = openpyxl.load_workbook(excel)
    assert book["数据"]["A2"].value == "00123"
    book.close()


def wait(root, job_id):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        result = jobs.read(root, job_id)
        if result["state"] not in ("queued", "running"):
            return result
        time.sleep(.05)
    raise AssertionError("job did not complete")


def test_same_name_jobs_are_isolated_and_use_explicit_python(tmp_path, monkeypatch):
    monkeypatch.setenv("CRAWSHRIMP_PYTHON_EXECUTABLE", sys.executable)
    code = 'import os\nfrom pathlib import Path\nfrom core.office.templates import word_template\nword_template(Path(os.environ["CRAWSHRIMP_OFFICE_OUTPUT"])/"same.docx")'
    first, second = jobs.start(tmp_path, "run", code=code), jobs.start(tmp_path, "run", code=code)
    a, b = wait(tmp_path, first["job_id"]), wait(tmp_path, second["job_id"])
    assert a["state"] == b["state"] == "completed"
    assert a["result"]["files"][0] != b["result"]["files"][0]
    with pytest.raises(OfficeError):
        jobs.read(tmp_path / "other-session", first["job_id"])


def test_interrupted_job_is_not_replayed(tmp_path):
    work = tmp_path / ("a" * 32)
    work.mkdir()
    jobs.save(work, {"job_id": work.name, "state": "running"})
    assert jobs.read(tmp_path, work.name)["state"] == "interrupted"


def rendered_fixture(tmp_path):
    from PIL import Image
    work = tmp_path / ("b" * 32)
    work.mkdir()
    document = work / "sample.docx"
    word_template(document)
    image = work / "page.png"
    Image.new("RGB", (20, 20), "white").save(image)
    revision = file_hash(document)
    pages = [{"page": 1, "path": str(image), "sha256": file_hash(image)}]
    jobs.save(work, {"job_id": work.name, "state": "completed", "result": {"document": str(document), "revision": revision, "pages": pages}})
    return work, revision, pages


def test_visual_requires_delivered_page_and_current_hash(tmp_path):
    work, revision, pages = rendered_fixture(tmp_path)
    review = [{"page": 1, "sha256": pages[0]["sha256"], "summary": "页面没有遮挡", "issues": []}]
    with pytest.raises(OfficeError, match="先读取"):
        jobs.review(tmp_path, work.name, revision, review)
    jobs.preview(tmp_path, work.name, revision, 1)
    assert jobs.review(tmp_path, work.name, revision, review)["result"]["visual"]["status"] == "passed"
    (work / "sample.docx").write_bytes(b"changed")
    with pytest.raises(OfficeError, match="已修改"):
        jobs.preview(tmp_path, work.name, revision, 1)


def test_preview_contains_actual_mcp_image(tmp_path, monkeypatch):
    from core.agent import office_tools
    from mcp.types import CallToolResult
    work, revision, _ = rendered_fixture(tmp_path)
    monkeypatch.setattr(office_tools, "root", lambda: tmp_path)
    result = office_tools.office_preview_read(work.name, revision, 1)
    assert isinstance(result, CallToolResult)
    assert result.content[1].type == "image" and result.content[1].data.startswith("iVBOR")


def test_doctor_ignores_noisy_truncated_stdout(tmp_path, monkeypatch):
    from core.agent import office_tools
    from types import SimpleNamespace
    monkeypatch.setattr(office_tools, "root", lambda: tmp_path)
    monkeypatch.setattr(office_tools, "python_executable", lambda: Path(sys.executable))
    monkeypatch.setattr(office_tools, "gateway", lambda: SimpleNamespace(_ok=lambda x: x))
    info = {"ok": True, "libraries": {}, "detail": "中文" * 18000}
    def noisy_execute(argv, work):
        assert argv[-2] == "doctor"
        Path(argv[-1]).write_text(json.dumps(info), encoding="utf-8")
        return {"stdout": "warning: library wrote to stdout\ntruncated JSON"}
    monkeypatch.setattr(office_tools, "execute", noisy_execute)
    assert office_tools.office_runtime_info() == info


def test_doctor_cli_writes_result_separately(tmp_path, monkeypatch, capsys):
    from core.office import cli
    output = tmp_path / "result.json"
    def noisy_inspect():
        print("library warning")
        return {"ok": True}
    monkeypatch.setattr(cli, "inspect_runtime", noisy_inspect)
    monkeypatch.setattr(sys, "argv", ["cli.py", "doctor", str(output)])
    cli.main()
    assert json.loads(output.read_text()) == {"ok": True}
    assert capsys.readouterr().out == "library warning\n"


def test_enqueue_setup_failure_releases_capacity(tmp_path, monkeypatch):
    monkeypatch.setenv("CRAWSHRIMP_PYTHON_EXECUTABLE", sys.executable)
    with pytest.raises(FileNotFoundError):
        jobs.start(tmp_path, "render", document=tmp_path / "missing.docx")
    manifest = next(tmp_path.glob("*/manifest.json"))
    assert json.loads(manifest.read_text())["state"] == "failed"
    assert str(manifest.parent) not in jobs._live


@pytest.mark.skipif(os.name == "nt", reason="POSIX process group regression; Windows uses taskkill /T")
def test_timeout_stops_descendant_processes(tmp_path):
    heartbeat = tmp_path / "heartbeat"
    child = f"import time; from pathlib import Path\nwhile True:\n Path({str(heartbeat)!r}).write_text(str(time.time_ns()))\n time.sleep(.05)"
    parent = f"import subprocess,sys,time; subprocess.Popen([sys.executable, '-c', {child!r}]); time.sleep(30)"
    with pytest.raises(OfficeError, match="超时"):
        execute([sys.executable, "-c", parent], tmp_path, timeout=1)
    assert heartbeat.exists()
    before = heartbeat.read_text()
    time.sleep(.3)
    assert heartbeat.read_text() == before
