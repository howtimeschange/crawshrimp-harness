"""事件投影提取函数回归(assistant/chunk、tool/result 形态)。"""
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "core"))

from core.agent.service import (  # noqa: E402
    _extract_text,
    _extract_tool_call_id,
    _extract_tool_result_text,
)


def test_chunk_text_delta():
    data = {"turn": 1, "step": 1, "chunk": {"type": "text-delta", "index": 0, "text": "你好"}}
    assert _extract_text(data) == "你好"


def test_chunk_block_end_text():
    data = {"turn": 1, "step": 1, "chunk": {"type": "block-end", "index": 0,
                                             "block": {"type": "text", "text": "完成"}}}
    assert _extract_text(data) == "完成"


def test_chunk_tool_call_delta_not_text():
    data = {"turn": 1, "step": 1, "chunk": {"type": "tool-call-delta", "index": 0,
                                             "id": "c1", "name": "t", "argumentsDelta": '{"'}}
    assert _extract_text(data) == ""


def test_assistant_message_text():
    data = {"turn": 1, "step": 1, "message": {"role": "assistant",
                                              "content": [{"type": "text", "text": "答案"}]}}
    assert _extract_text(data) == "答案"


def test_tool_result_extraction():
    data = {"turn": 1, "step": 1, "message": {
        "source": {"kind": "tool", "callId": "call-42"},
        "content": [{"type": "tool-result", "toolCallId": "call-42",
                     "content": [{"type": "text", "text": '{"ok": true, "status": "ready"}'}],
                     "isError": False}],
    }}
    assert _extract_tool_call_id(data) == "call-42"
    assert '{"ok": true, "status": "ready"}' in _extract_tool_result_text(data)


def test_tool_result_no_call_id():
    assert _extract_tool_call_id({"message": {"source": {"kind": "model"}}}) is None


def test_redact_text_masks_credentials():
    from core.agent.service import redact_text
    assert "***" in redact_text("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123")
    assert "sk-***" in redact_text("openai key is sk-abcdefgh12345678 today")
    assert "***" in redact_text('{"token": "abcdefghijklmnopqrstuvwxyz123456"}')
    # 短值不误伤
    assert redact_text("token: short") == "token: short"


def test_analyze_rows_operations():
    from core.agent.mcp_gateway import _analyze_rows
    header = ["name", "price"]
    rows = [["a", "10"], ["b", "20"], ["c", "30"]]
    desc = _analyze_rows(header, rows, {"op": "describe", "column": "price"})
    assert desc["min"] == 10.0 and desc["max"] == 30.0
    vc = _analyze_rows(header, rows, {"op": "value_counts", "column": "name"})
    assert len(vc) == 3
    gb = _analyze_rows(header, rows, {"op": "groupby", "column": "price", "by": "name"})
    assert gb[0]["count"] == 1 and "sum" in gb[0]
    flt = _analyze_rows(header, rows, {"op": "filter", "column": "price",
                                       "condition": {"column": "price", "op": ">", "value": 15}})
    assert flt["matched"] == 2


def test_risk_heuristic_keywords():
    from core.agent.mcp_gateway import _heuristic_risk
    assert _heuristic_risk("下载图片", "") == "local_write"
    assert _heuristic_risk("查询订单", "") == "read_only"
    assert _heuristic_risk("批量删除商品", "") == "destructive"
    assert _heuristic_risk("上传商品", "") == "external_write"
    assert _heuristic_risk("神秘任务", "") == "local_write"


def test_catalog_includes_all_tasks_and_excludes_destructive(monkeypatch, tmp_path):
    from core import adapter_loader, runtime_paths
    data_root = tmp_path / "data"
    monkeypatch.setenv("CRAWSHRIMP_DATA", str(data_root))
    runtime_paths.reset_runtime_data_root_cache()
    adapter_loader._adapters.clear()
    adapter_loader._adapter_dirs.clear()
    adapter_loader._enabled.clear()
    adapter_loader._install_meta.clear()
    built_in = Path(__file__).resolve().parents[1] / "adapters"
    for adapter_dir in adapter_loader.iter_manifest_dirs(built_in):
        adapter_loader.install_from_dir(str(adapter_dir), install_mode="link")
    from core.agent.mcp_gateway import _agent_task_catalog
    catalog = _agent_task_catalog()
    assert len(catalog) > 50
    assert all(t["risk"] != "destructive" for t in catalog)
    assert not any(t["hidden"] for t in catalog)
    # 森马云盘助手可见(用户诉求)
    assert any(t["adapter_id"] == "semir-cloud-drive" for t in catalog)
