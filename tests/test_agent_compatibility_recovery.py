"""Behavior regressions for desktop compatibility and runtime failure recovery."""
import asyncio
import ctypes
import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from core import runtime_paths
from core.agent import db, service as service_module
from core.agent.service import AgentService
from core.agent.worker import AgentWorker, WorkerProtocolError
from core.agent import worker as worker_module


def test_windows_worker_cleanup_terminates_owned_tree(monkeypatch):
    async def scenario():
        proc = SimpleNamespace(pid=12345, returncode=None, wait=AsyncMock(return_value=0),
                               terminate=Mock(), kill=Mock())
        kill_tree = Mock(return_value=SimpleNamespace(returncode=0))
        monkeypatch.setattr(sys, 'platform', 'win32')
        monkeypatch.setattr(worker_module.subprocess, 'run', kill_tree)
        await AgentWorker._terminate_process(proc)
        assert kill_tree.call_args.args[0] == ['taskkill', '/F', '/T', '/PID', '12345']
        assert kill_tree.call_args.kwargs['timeout'] == 5
        proc.terminate.assert_not_called()
        proc.wait.assert_awaited_once()
    asyncio.run(scenario())


def test_failed_worker_cleanup_keeps_ownership_and_blocks_replacement():
    async def scenario():
        service = AgentService()
        worker = SimpleNamespace(proc=SimpleNamespace(returncode=None))
        service.worker = worker
        await service._on_worker_exit(worker, 'cleanup failed', True)
        assert service.worker is worker
        assert service.runtime_state == 'disabled_until_manual_restart'
        assert service.runtime_error_code == 'WORKER_STOP_FAILED'
        assert not await service.start_generation()
    asyncio.run(scenario())


@pytest.mark.parametrize('handle,wait_result,last_error,expected', [
    (123, 258, 0, True),  # running
    (123, 0, 0, False),   # signaled process handle
    (0, 0, 87, False),   # PID does not exist
    (0, 0, 5, True),     # access denied is not proof of exit
    (123, 0xffffffff, 5, True),
])
def test_windows_liveness_never_sends_control_events(monkeypatch, handle, wait_result, last_error, expected):
    kernel = SimpleNamespace(OpenProcess=Mock(return_value=handle),
                             WaitForSingleObject=Mock(return_value=wait_result), CloseHandle=Mock())
    monkeypatch.setattr(ctypes, 'WinDLL', Mock(return_value=kernel), raising=False)
    monkeypatch.setattr(ctypes, 'get_last_error', lambda: last_error, raising=False)
    kill = Mock(side_effect=AssertionError('liveness must not signal a process'))
    monkeypatch.setattr(os, 'kill', kill)
    # Restore immediately: pathlib must keep the real host platform.
    with monkeypatch.context() as win:
        win.setattr(os, 'name', 'nt')
        result = service_module._process_is_alive(4321)
    assert result is expected
    kill.assert_not_called()
    kernel.OpenProcess.assert_called_once_with(0x00100000, False, 4321)
    assert kernel.CloseHandle.call_count == bool(handle)


def _service_with_runs(monkeypatch, tmp_path):
    monkeypatch.setenv('CRAWSHRIMP_DATA', str(tmp_path))
    runtime_paths.reset_runtime_data_root_cache()
    db.init_agent_db()
    db.create_session('source', 'native-source')
    db.create_turn('user-turn', 'source', 1, 'user-message')
    user = db.create_run('user-run', 'source', 'user-turn', 'provider', 'model')
    db.update_run('user-run', status='running')
    db.create_turn('auto-turn', 'source', 2, 'auto-message')
    db.create_run('auto-run', 'source', 'auto-turn', 'provider', 'model')
    service = AgentService()
    service.shadow_runs['native-source'] = user
    service.register_run_context('native-source', user)
    service.worker = SimpleNamespace(request=AsyncMock(return_value={'summary': {'status': 'completed'}}))
    service.runtime_state = 'ready'
    service.generation_model = 'model'
    service.generation_model_provider = 'provider'
    service._grant_for_run = lambda item: None
    service.broadcast = AsyncMock()
    service._broadcast_run_artifacts = AsyncMock()
    service._project_automation_agent_terminal = AsyncMock(return_value={})
    service._publish_automation_source_receipt = AsyncMock()
    item = dict(run_id='auto-run', session_id='source', turn_id='auto-turn', text='fixture',
                provider_id='provider', model_id='model', automation_run_uid='automation-run',
                automation_policy={'execution_policy': {}, 'toolset': []})
    return service, item


def test_inherited_turn_waits_without_overwriting_native_context(monkeypatch, tmp_path):
    async def scenario():
        service, item = _service_with_runs(monkeypatch, tmp_path)
        service._inherited_automation_waits['auto-run'] = {'wait_seconds': 1}
        await service._run_one(item)
        service.worker.request.assert_not_awaited()
        assert db.get_run('auto-run')['status'] == 'queued'
        assert service.active_runs_by_runtime['native-source']['run_id'] == 'user-run'
        assert 'auto-run' in service._inherited_automation_waits
        assert await service.queue.get() == item
        service.shadow_runs.clear()
        service.unregister_run_context('native-source', 'user-run')
        await service._run_one(item)
        assert db.get_run('auto-run')['status'] == 'completed'
        assert 'auto-run' not in service._inherited_automation_waits
    asyncio.run(scenario())


def test_model_restart_waits_for_other_native_sessions(monkeypatch, tmp_path):
    async def scenario():
        service, item = _service_with_runs(monkeypatch, tmp_path)
        db.create_session('other', 'native-other')
        item['session_id'] = 'other'
        item['model_id'] = 'different-model'
        service.start_generation = AsyncMock(return_value=True)
        await service._run_one(item)
        service.start_generation.assert_not_awaited()
        assert db.get_run('auto-run')['status'] == 'queued'
        assert 'native-source' in service.active_runs_by_runtime
    asyncio.run(scenario())


def test_crash_circuit_blocks_queue_and_start_entry_until_manual_reset():
    async def scenario():
        service = AgentService()
        for _ in range(3):
            service._note_crash('fixture crash')
        service._start_generation_unlocked = AsyncMock(return_value=True)
        assert not await service._ensure_generation({'provider_id': 'p', 'model_id': 'm'})
        assert not await service.start_generation()
        service._start_generation_unlocked.assert_not_awaited()
        assert (await service.restart_runtime())['ok'] is True
        service._start_generation_unlocked.assert_awaited_once()
        assert service.crash_budget == []
    asyncio.run(scenario())


@pytest.mark.parametrize('frame', ['bad-json', '{"method":"event","params":{}}'])
def test_broken_protocol_stops_child_and_reports_exit(monkeypatch, frame):
    async def scenario():
        exits = []
        async def failed_notification(*args):
            raise RuntimeError('projection failed')
        async def on_exit(message, unexpected):
            exits.append((message, unexpected))
        worker = AgentWorker(runtime_root='.', data_root='.', mcp_url='', session_root='',
                             on_notification=failed_notification, on_exit=on_exit)
        worker.proc = await asyncio.create_subprocess_exec(
            sys.executable, '-u', '-c', f'import time; print({frame!r}); time.sleep(60)',
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        proc = worker.proc
        reader = asyncio.create_task(worker._read_loop())
        try:
            await asyncio.wait_for(asyncio.shield(reader), 6)
            assert proc.returncode is not None
            assert len(exits) == 1 and exits[0][1] is True
            with pytest.raises(WorkerProtocolError):
                await worker.request('worker.health', timeout=.1)
        finally:
            if proc.returncode is None:
                proc.kill()
            await proc.wait()
            await reader
    asyncio.run(scenario())


def test_failed_cancel_response_does_not_mark_run_canceled(monkeypatch, tmp_path):
    async def scenario():
        service, item = _service_with_runs(monkeypatch, tmp_path)
        db.update_run('auto-run', status='running')
        service.active_run = db.get_run('auto-run')
        service.worker.request = AsyncMock(return_value={'ok': False, 'canceled': False,
                                                         'error': {'code': 'CANCEL_FAILED'}})
        result = await service.cancel_run('auto-run')
        assert result['ok'] is False
        assert db.get_run('auto-run')['status'] == 'running'
    asyncio.run(scenario())


def test_cancel_racing_with_completion_returns_durable_terminal(monkeypatch, tmp_path):
    async def scenario():
        service, _ = _service_with_runs(monkeypatch, tmp_path)
        db.update_run('auto-run', status='running')
        service.active_run = db.get_run('auto-run')
        async def complete(*args, **kwargs):
            db.update_run('auto-run', status='completed')
            return {'ok': True, 'canceled': False, 'status': 'completed'}
        service.worker.request = complete
        result = await service.cancel_run('auto-run')
        assert result == {'ok': True, 'status': 'completed'}
        assert db.get_run('auto-run')['status'] == 'completed'
    asyncio.run(scenario())


def test_native_turn_starting_during_cdp_lookup_preserves_queued_automation(monkeypatch, tmp_path):
    async def scenario():
        service, item = _service_with_runs(monkeypatch, tmp_path)
        user = service.shadow_runs.pop('native-source')
        service.unregister_run_context('native-source', 'user-run')
        async def concurrent_projection(fn, *args):
            service.shadow_runs['native-source'] = user
            service.register_run_context('native-source', user)
            return None
        monkeypatch.setattr(asyncio, 'to_thread', concurrent_projection)
        await service._run_one(item)
        assert db.get_run('auto-run')['status'] == 'queued'
        assert service.active_runs_by_runtime['native-source']['run_id'] == 'user-run'
        service.worker.request.assert_not_awaited()
    asyncio.run(scenario())


@pytest.mark.parametrize('response', [None, {'ok': False}, {'ok': True, 'canceled': False}])
def test_uncertain_automation_cancellation_stops_worker_before_releasing_tasks(response):
    async def scenario():
        service = AgentService()
        order = []
        service.worker = SimpleNamespace(request=AsyncMock(return_value=response))
        async def stop_worker(): order.append('stopped')
        async def cancel_tasks(uid):
            assert uid == 'automation'
            order.append('tasks')
        service._stop_worker = stop_worker
        service._cancel_automation_task_instances = cancel_tasks
        await service._stop_timed_out_automation('run', 'automation')
        assert order == ['stopped', 'tasks']
    asyncio.run(scenario())
