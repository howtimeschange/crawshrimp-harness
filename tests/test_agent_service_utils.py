"""事件投影提取函数回归(assistant/chunk、tool/result 形态)。"""
import os
import sys

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
