import asyncio
from contextlib import suppress

import pytest

from core import api_server, data_sink


@pytest.mark.parametrize("action,initial,expected", [
    ("pause", "running", "pausing"),
    ("resume", "paused", "running"),
    ("stop", "running", "stopping"),
])
def test_agent_control_callback_returns_after_real_control_action(monkeypatch, tmp_path, action, initial, expected):
    monkeypatch.setattr("core.runtime_paths.data_root", lambda: tmp_path)
    data_sink.init_db()
    instance = data_sink.create_task_instance("review", "task", "control regression", {})
    uid = instance["instance_uid"]
    jid = api_server._instance_jid(uid)
    monkeypatch.setattr(api_server, "_run_controls", {})
    monkeypatch.setattr(api_server, "_run_status", {jid: {"status": initial}})
    monkeypatch.setattr(api_server, "_run_logs", {})

    async def scenario():
        task = asyncio.create_task(asyncio.sleep(60))
        control = {"task": task, "resume_event": asyncio.Event()}
        api_server._run_controls[jid] = control
        try:
            result = await api_server._agent_control_task_instance(uid, action)
            assert result == {"ok": True, "status": expected}
            assert api_server._run_status[jid]["status"] == expected
            if action == "stop":
                assert task.cancelling() == 1
            else:
                assert control["pause_requested"] is (action == "pause")
                assert control["resume_event"].is_set() is (action == "resume")
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    asyncio.run(scenario())
