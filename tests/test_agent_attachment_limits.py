"""会话附件绑定、内容识别与 Excel 资源上限回归。"""
from __future__ import annotations

import json
import zipfile
from pathlib import Path

import openpyxl
import pytest
import xlrd
from fastapi import HTTPException

from core import api_server
from core.agent import api, mcp_gateway


def _request(path: Path, **overrides):
    values = {
        "name": path.name,
        "path": str(path),
        "mime": "text/plain",
        "size": 1,
        "session_id": "",
        "runtime_session_id": "",
    }
    values.update(overrides)
    return api.AttachmentCreateRequest(**values)


def test_attachment_uses_actual_size_not_claimed_size(tmp_path, monkeypatch):
    source = tmp_path / "large.txt"
    source.write_bytes(b"x" * 11)
    monkeypatch.setattr(api, "MAX_AGENT_ATTACHMENT_BYTES", 10)
    with pytest.raises(HTTPException) as raised:
        api._register_attachment("session", _request(source, size=1))
    assert raised.value.status_code == 413


def test_inbox_requires_explicit_session_and_never_falls_back(monkeypatch, tmp_path):
    source = tmp_path / "file.txt"
    source.write_text("data", encoding="utf-8")
    monkeypatch.setattr(api.db, "get_session", lambda *_args: pytest.fail("不应回退最近会话"))
    monkeypatch.setattr(api.db, "get_session_by_runtime", lambda *_args: pytest.fail("没有 runtime id 不应查询"))
    with pytest.raises(HTTPException) as raised:
        api.create_inbox_attachment(_request(source))
    assert raised.value.status_code == 409


def test_archived_session_cannot_receive_attachment(monkeypatch, tmp_path):
    source = tmp_path / "file.txt"
    source.write_text("data", encoding="utf-8")
    monkeypatch.setattr(api.db, "get_session", lambda _sid: {"session_id": "archived", "archived_at": "now"})
    with pytest.raises(HTTPException) as raised:
        api.create_inbox_attachment(_request(source, session_id="archived"))
    assert raised.value.status_code == 409


def test_fake_image_extension_and_renamed_executable_are_rejected(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    monkeypatch.setattr("core.agent.service._data_root", lambda: data_root)
    monkeypatch.setattr(api.db, "create_attachment", lambda *_args: pytest.fail("非法附件不得入库"))

    fake_image = tmp_path / "fake.png"
    fake_image.write_text("not an image", encoding="utf-8")
    with pytest.raises(HTTPException) as image_error:
        api._register_attachment("session", _request(fake_image, mime="image/png"))
    assert image_error.value.status_code == 415

    executable = tmp_path / "notes.txt"
    executable.write_bytes(b"MZ" + b"\0" * 20)
    with pytest.raises(HTTPException) as executable_error:
        api._register_attachment("session", _request(executable, mime="text/plain"))
    assert executable_error.value.status_code == 415


def test_attachment_read_rejects_cross_session(monkeypatch):
    previous_run = mcp_gateway.ctx.active_run
    mcp_gateway.ctx.active_run = {"run_id": "run-a", "session_id": "session-a"}
    monkeypatch.setattr(
        mcp_gateway.db,
        "get_attachment",
        lambda _aid: {"attachment_id": "att", "session_id": "session-b", "filename": "x.txt"},
    )
    try:
        result = mcp_gateway.tool_attachment_read("att")
    finally:
        mcp_gateway.ctx.active_run = previous_run
    assert result["error"]["code"] == "ATTACHMENT_SESSION_MISMATCH"


def test_attachment_read_checks_actual_parse_size(tmp_path, monkeypatch):
    path = tmp_path / "large.txt"
    path.write_bytes(b"x" * 11)
    previous_run = mcp_gateway.ctx.active_run
    mcp_gateway.ctx.active_run = {"run_id": "run", "session_id": "session"}
    monkeypatch.setattr(
        mcp_gateway.db,
        "get_attachment",
        lambda _aid: {"attachment_id": "att", "session_id": "session", "filename": "large.txt",
                      "path": str(path), "mime": "text/plain", "size": 1},
    )
    original_stat = Path.stat

    class _Stat:
        st_size = 50 * 1024 * 1024 + 1

    monkeypatch.setattr(Path, "stat", lambda self: _Stat() if self == path else original_stat(self))
    try:
        result = mcp_gateway.tool_attachment_read("att")
    finally:
        mcp_gateway.ctx.active_run = previous_run
    assert result["error"]["code"] == "PREVIEW_TOO_LARGE"


def test_excel_zip_uncompressed_and_entry_limits(tmp_path, monkeypatch):
    path = tmp_path / "bomb.xlsx"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("a.xml", b"x" * 32)
        archive.writestr("b.xml", b"y")

    monkeypatch.setattr(api_server, "MAX_EXCEL_UNCOMPRESSED_BYTES", 16)
    result = api_server._read_local_excel(str(path))
    assert "解压后超过" in result["error"]

    monkeypatch.setattr(api_server, "MAX_EXCEL_UNCOMPRESSED_BYTES", 1024)
    monkeypatch.setattr(api_server, "MAX_EXCEL_ZIP_ENTRIES", 1)
    result = api_server._read_local_excel(str(path))
    assert "压缩条目超过" in result["error"]


def test_excel_sheet_row_and_column_limits(tmp_path, monkeypatch):
    path = tmp_path / "limits.xlsx"
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["a", "b"])
    ws.append(["1", "2"])
    wb.create_sheet("Second")
    wb.save(path)
    wb.close()

    monkeypatch.setattr(api_server, "MAX_EXCEL_SHEETS", 1)
    assert "工作表数量超过" in api_server._read_local_excel(str(path))["error"]

    monkeypatch.setattr(api_server, "MAX_EXCEL_SHEETS", 32)
    monkeypatch.setattr(api_server, "MAX_EXCEL_ROWS", 1)
    assert "总行数超过" in api_server._read_local_excel(str(path))["error"]

    monkeypatch.setattr(api_server, "MAX_EXCEL_ROWS", 100)
    monkeypatch.setattr(api_server, "MAX_EXCEL_COLUMNS", 1)
    assert "超过 1 列" in api_server._read_local_excel(str(path))["error"]

    monkeypatch.setattr(api_server, "MAX_EXCEL_COLUMNS", 512)
    monkeypatch.setattr(api_server, "MAX_EXCEL_CELLS", 3)
    assert "总单元格数超过" in api_server._read_local_excel(str(path))["error"]


def test_legacy_xls_uses_bounded_xlrd_reader(tmp_path, monkeypatch):
    path = tmp_path / "legacy.xls"
    path.write_bytes(b"legacy-test-placeholder")

    class Sheet:
        name = "Sheet1"
        nrows = 2
        ncols = 2

        @staticmethod
        def row_values(index):
            return [["name", "value"], ["one", 1]][index]

    class Book:
        nsheets = 1

        @staticmethod
        def sheet_names():
            return ["Sheet1"]

        @staticmethod
        def sheet_by_name(_name):
            return Sheet()

        @staticmethod
        def release_resources():
            return None

    monkeypatch.setattr(xlrd, "open_workbook", lambda *_args, **_kwargs: Book())
    result = api_server._read_local_excel(str(path))
    assert result["headers"] == ["name", "value"]
    assert result["rows"] == [{"name": "one", "value": "1"}]
