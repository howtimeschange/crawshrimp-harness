from unittest.mock import Mock

import pytest

from core import ai_video_generation_service as video, data_sink


@pytest.mark.parametrize("status", ["completed", "failed", "cancelled", "expired", "needs_config"])
def test_video_wait_returns_real_terminal_status_without_sleep(monkeypatch, status):
    monkeypatch.setattr(data_sink, "get_ai_video_job", lambda _: {"id": "video", "currentRunId": "run"})
    monkeypatch.setattr(data_sink, "get_ai_video_run", lambda _: {"status": status, "error": {"message": "provider reason"}})
    monkeypatch.setattr(video, "public_job", lambda job: job)
    sleep = Mock(side_effect=AssertionError("terminal jobs must not be polled"))
    result = video.wait_video_job("video", sleep_fn=sleep)
    assert result["status"] == status
    assert result["ok"] is (status == "completed")
    assert result["error"] == "provider reason"
    sleep.assert_not_called()
