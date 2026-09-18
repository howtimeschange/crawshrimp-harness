import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

from core.agent.worker import AgentWorker
from core.office import render_cache
from core.log_writer import LogWriter


def test_control_response_does_not_wait_for_slow_projection():
    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        async def project(method, params):
            entered.set()
            await release.wait()
        worker = AgentWorker(runtime_root='.', data_root='.', mcp_url='', session_root='', on_notification=project, on_exit=AsyncMock())
        stdout = asyncio.StreamReader()
        worker.proc = SimpleNamespace(stdout=stdout, stderr=asyncio.StreamReader(), returncode=None)
        worker._terminate_process = AsyncMock()
        pending = asyncio.get_running_loop().create_future(); worker._pending[1] = pending
        reader = asyncio.create_task(worker._read_loop())
        stdout.feed_data(b'{"method":"harness.notification","params":{}}\n{"id":1,"result":{"ok":true}}\n')
        try:
            await asyncio.wait_for(entered.wait(), 1)
            assert await asyncio.wait_for(pending, 1) == {'ok': True}
            assert not release.is_set()
        finally:
            release.set(); stdout.feed_eof(); await reader
    asyncio.run(scenario())


def test_log_batch_barrier_keeps_exact_records(tmp_path):
    writer = LogWriter(); dest = tmp_path / 'log.jsonl'
    for i in range(5000):
        writer.append(dest, (str(i) + '\n').encode())
    writer.flush()
    assert dest.read_text().splitlines() == [str(i) for i in range(5000)]


def test_log_failure_isolated_from_healthy_path_and_terminal_barrier(tmp_path):
    import pytest
    writer = LogWriter()
    broken = tmp_path / 'missing' / 'bad.jsonl'
    good = tmp_path / 'good.jsonl'
    writer.queue.put((broken, b'failed\n', None))
    writer.flush()
    writer.append(good, b'healthy\n')
    writer.flush(good)
    assert good.read_bytes() == b'healthy\n'
    with pytest.raises(OSError, match='日志写入失败'):
        writer.flush(broken)
    with pytest.raises(OSError, match='日志写入失败'):
        writer.append(broken, b'cannot silently resume after data loss\n')


def test_office_cached_preview_resets_approval_and_verifies_all_files(tmp_path):
    old, new = tmp_path / 'old', tmp_path / 'new'
    old.mkdir(); new.mkdir()
    files = {}
    for name in ('doc.docx', 'doc.pdf', 'sheet.png', 'page.png'):
        p = old / name; p.write_bytes(name.encode()); files[name] = str(p)
    from core.office.runtime import file_hash
    result = {'document': files['doc.docx'], 'revision': file_hash(Path(files['doc.docx'])), 'pdf': files['doc.pdf'], 'contact_sheet': files['sheet.png'],
              'pages': [{'page': 1, 'path': files['page.png'], 'sha256': file_hash(Path(files['page.png']))}], 'visual': {'status': 'passed'}, 'validation': {'status': 'passed'}}
    data = {'state': 'completed', 'render_cache_key': 'key', 'render_cache_files': render_cache.file_digests(old, result), 'result': result}
    (old / 'manifest.json').write_text(json.dumps(data))
    restored = render_cache.restore(tmp_path, new, 'key')
    assert restored['cache_hit'] and restored['visual']['status'] == 'not_run'
    assert Path(restored['document']).parent == new
    Path(files['doc.pdf']).write_bytes(b'changed')
    assert render_cache.restore(tmp_path, new, 'key') is None


def test_cold_log_archive_is_lossless_and_skips_active_buffer(tmp_path, monkeypatch):
    import os, time, hashlib
    from core.log_archive import archive_cold_logs
    from core.run_logs import RunLogRegistry, buffer_for, RunLogBuffer
    monkeypatch.setenv('CRAWSHRIMP_DATA', str(tmp_path))
    root = tmp_path / 'logs/tasks'; root.mkdir(parents=True)
    path = root / (hashlib.sha256(b'old').hexdigest() + '.jsonl')
    raw = b''.join((json.dumps({'line': 'value-' + str(i), 'cursor': i}) + '\n').encode() for i in range(3000))
    path.write_bytes(raw); old = time.time() - 40 * 86400; os.utime(path, (old, old))
    registry = RunLogRegistry(); live = buffer_for(registry, 'live'); live.append('current')
    from core.log_writer import flush_logs
    flush_logs(); os.utime(live.path, (old, old))
    stats = archive_cold_logs(root)
    assert stats['archived'] == 1 and live.path.exists()
    assert not path.exists() and path.with_suffix('.jsonl.gz').exists()
    restored = RunLogBuffer('old')
    assert restored.next_cursor == 3000 and path.read_bytes() == raw
    assert len(b''.join(restored.stream_text()).splitlines()) == 3000


def test_cancelled_event_commit_still_publishes_before_next_sequence(monkeypatch):
    import threading
    from core.agent.service import AgentService
    from core.agent import db
    entered, release = threading.Event(), threading.Event()
    seq = 0
    def append(session_id, kind, payload):
        nonlocal seq
        if kind == 'first':
            entered.set(); release.wait(3)
        seq += 1
        return seq, payload
    monkeypatch.setattr(db, 'append_session_event', append)
    async def scenario():
        service = AgentService(); messages = service.subscribe_all()
        first = asyncio.create_task(service.broadcast('s', 0, 'first', {}))
        await asyncio.to_thread(entered.wait, 1)
        first.cancel()
        second = asyncio.create_task(service.broadcast('s', 0, 'second', {}))
        release.set()
        results = await asyncio.gather(first, second, return_exceptions=True)
        assert isinstance(results[0], asyncio.CancelledError)
        assert [(await messages.get())['seq'], (await messages.get())['seq']] == [1, 2]
    asyncio.run(scenario())


def test_office_cache_disappearing_history_falls_back_to_render(tmp_path, monkeypatch):
    old, new = tmp_path / 'removed-history', tmp_path / 'new'
    old.mkdir(); new.mkdir()
    original_stat = Path.stat
    calls = 0
    def disappearing_stat(path, *args, **kwargs):
        nonlocal calls
        if path == old:
            calls += 1
            if calls > 1:
                raise FileNotFoundError('history removed while sorting')
        return original_stat(path, *args, **kwargs)
    monkeypatch.setattr(Path, 'stat', disappearing_stat)
    assert render_cache.restore(tmp_path, new, 'key') is None
