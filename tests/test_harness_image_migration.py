"""Migration contracts exercised against the Harness executor and persistence."""
import copy
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import pytest
from core import ai_image_service as service, data_sink
from tests.test_ai_image_service import PNG_1X1
from tests.test_tmall_ai_image_chain_script import load_script


@pytest.fixture
def database(tmp_path):
    with patch('core.runtime_paths.data_root', return_value=tmp_path):
        data_sink.init_db()
        yield tmp_path


def test_round_snapshot_survives_new_draft_and_replays_order(database):
    paths = []
    for i in range(3):
        path = database / f'{i}.png'; path.write_bytes(PNG_1X1); paths.append(str(path))
    original = {'prompt': 'old draft', 'model_key': 'gpt-image-2', 'params': {}}
    job = data_sink.create_ai_image_job(original)
    submitted = {'prompt': 'this round', 'model_key': 'gpt-image-2', 'params': {
        'size': '1024x1024', 'n': 1, 'input_assets': [
            {'role': 'reference', 'path': paths[2]}, {'role': 'main', 'path': paths[1]}, {'role': 'main', 'path': paths[0]}]}}
    def runner(client, payload, **kwargs):
        assert payload['prompt'].startswith('this round')
        assert '图 1：主图' in payload['prompt'] and '图 3：参考图' in payload['prompt']
        data_sink.update_ai_image_job(job['job_uid'], {'prompt': 'new draft', 'params': {'main_image_path': paths[2]}})
        return {'ok': True, 'image_urls': ['https://example.invalid/result.png']}
    result = service.run_job_with_one_xm(job['job_uid'], settings={'2k': 'test-only'}, input_snapshot=submitted, runner=runner)
    stored = data_sink.get_ai_image_job(job['job_uid'])
    assert stored['prompt'] == 'new draft'
    run = result['summary']['runs'][0]
    snapshot = run['generation_snapshot']
    assert snapshot['prompt'] == 'this round'
    assert [a['path'] for a in snapshot['params']['input_assets']] == [paths[1], paths[0], paths[2]]
    assert 'test-only' not in json.dumps(snapshot)
    replay = service._workbench_retry_payload(stored, run)
    assert replay['prompt'].startswith('this round') and len(replay['image']) == 3


def test_model_config_change_rejected_before_provider(database):
    job = data_sink.create_ai_image_job({'prompt': 'test', 'params': {'expected_connection_version': 'old-version'}})
    with patch.object(service, 'create_image_client') as client:
        with pytest.raises(ValueError, match='连接配置已变化'):
            service.run_job_with_one_xm(job['job_uid'], settings={'2k': 'test-only'})
        client.assert_not_called()


def test_approval_parallel_stale_decisions_preserve_both_updates(tmp_path):
    m = load_script()
    batch = {'json_path': str(tmp_path / 'batch.json'), 'items': [{'assets': [
        {'id': 'a', 'status': 'pending'}, {'id': 'b', 'status': 'pending'}]}]}
    m.save_approval_batch(batch)
    barrier = threading.Barrier(2)
    def approve(asset):
        stale = copy.deepcopy(batch)
        barrier.wait()
        m.update_approval_decisions(stale, {asset: {'status': 'approved'}})
    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(approve, ['a', 'b']))
    current = json.loads(Path(batch['json_path']).read_text())
    assert [a['status'] for a in current['items'][0]['assets']] == ['approved', 'approved']


def test_tmall_generation_confirmation_is_visible_in_current_and_pending(database):
    instance = data_sink.create_task_instance('tmall-ops-assistant', 'tmall_ai_image_test_chain', 'confirmation')
    data_sink.update_task_instance(instance['instance_uid'], status='waiting_generation_confirmation')
    for group in ('current', 'pending'):
        assert instance['instance_uid'] in {row['instance_uid'] for row in data_sink.list_task_instances(status_group=group)}


def test_failed_round_does_not_reuse_previous_success(database):
    job = data_sink.create_ai_image_job({'prompt': 'rounds', 'params': {}})
    uid = job['job_uid']
    good = service.run_job_with_one_xm(uid, settings={'2k': 'test-only'},
        runner=lambda *a, **k: {'ok': True, 'image_urls': ['https://example.invalid/old.png']})
    assert good['ok']
    failed = service.run_job_with_one_xm(uid, settings={'2k': 'test-only'},
        runner=lambda *a, **k: {'ok': False, 'error': 'injected explicit rejection'})
    assert failed['ok'] is False
    assert len(failed['summary']['runs']) == 2
    assert failed['summary']['runs'][-1]['status'] == 'failed'
    assert 'https://example.invalid/old.png' in failed['summary']['image_urls']


def test_concurrent_round_completions_preserve_each_result(database):
    job = data_sink.create_ai_image_job({'prompt': 'concurrent', 'params': {}})
    barrier = threading.Barrier(2)
    def generate(index):
        def runner(*a, **k):
            barrier.wait(timeout=10)
            return {'ok': True, 'image_urls': [f'https://example.invalid/{index}.png']}
        return service.run_job_with_one_xm(job['job_uid'], settings={'2k': 'test-only'}, runner=runner)
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(generate, range(2)))
    assert all(r['ok'] for r in results)
    summary = data_sink.get_ai_image_job(job['job_uid'])['summary']
    assert len(summary['runs']) == 2
    assert set(summary['image_urls']) == {'https://example.invalid/0.png', 'https://example.invalid/1.png'}


def test_tmall_sync_multi_image_keeps_success_and_unknown_failure():
    from core import api_server
    from types import SimpleNamespace
    calls = []
    def run(client, payload, **kwargs):
        calls.append(payload['n'])
        if len(calls) == 1:
            return {'ok': True, 'image_urls': ['https://example.invalid/kept.png']}
        raise TimeoutError('injected lost response')
    row = {'__1xm_payload': {'model': 'woka/gemini-3.1-flash-image-preview', 'prompt': 'test', 'n': 2}}
    with patch.object(api_server, 'create_image_client', return_value=SimpleNamespace(manages_submission_retries=True)), \
         patch.object(api_server, 'run_image_task_until_done', side_effect=run):
        result = api_server._run_one_xm_generation_row(row, {}, {'ai.woka.api_key': 'test-only'})
    assert calls == [1, 1]
    assert result['生成图数量'] == 1
    assert result['__image_partial_success'] is True
    assert result['__image_error_code'] == 'UNKNOWN_SUBMIT_RESULT'
    assert result['生成图URL'] == 'https://example.invalid/kept.png'


def test_tmall_unknown_receipt_blocks_resubmit():
    import asyncio
    from core import api_server
    batch = {'token': 'test-token', 'items': [{'generation_prompts': [{'error_code': 'UNKNOWN_SUBMIT_RESULT'}]}]}
    with patch.object(api_server, '_load_tmall_approval_batch', return_value=batch), \
         patch.object(api_server, '_load_tmall_ai_image_chain_module') as loader:
        with pytest.raises(api_server.HTTPException) as error:
            asyncio.run(api_server.submit_tmall_ai_image_generation_confirmation('batch', api_server.TmallApprovalGenerationConfirmRequest(), 'test-token'))
        assert error.value.status_code == 409
        loader.assert_not_called()


def test_batch_lookup_uses_runtime_and_caches_without_scanning_checkout(tmp_path):
    from core import api_server
    runtime = tmp_path/'runtime'; runtime.mkdir()
    path = runtime/'tmall-ai-image-approval-batch-test.json'; path.write_text('{}')
    original = Path.rglob
    scans = []
    def scan(root, pattern):
        scans.append(root)
        return original(root, pattern)
    with patch.object(api_server.runtime_paths, 'data_root', return_value=runtime), patch.object(Path, 'rglob', scan):
        assert api_server._find_tmall_approval_batch_path('test') == path
        assert api_server._find_tmall_approval_batch_path('test') == path
    assert scans == [runtime]


def test_concurrent_face_swaps_append_and_keep_approval_during_generation(tmp_path):
    from core import bala_ai_model_library
    m = load_script()
    source = tmp_path/'source.png'; source.write_bytes(PNG_1X1)
    batch = {'json_path': str(tmp_path/'batch.json'), 'items': [{'id': 'item', 'assets': [
        {'id': 'source', 'kind': 'ai', 'path': str(source), 'status': 'pending'}]}]}
    m.save_approval_batch(batch)
    barrier = threading.Barrier(3)
    def generated(*args, **kwargs):
        barrier.wait(timeout=10)
        barrier.wait(timeout=10)
        return {'id': threading.current_thread().name, 'updated_at': 'now', 'status': 'pending'}
    with patch.object(bala_ai_model_library, 'load_model_library', return_value={'items': [{'id': 'm'}]}), \
         patch.object(bala_ai_model_library, 'resolve_model_image_path', return_value=source), \
         patch.object(m, 'generate_approval_asset_for_item', side_effect=generated):
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(m.face_swap_approval_asset, copy.deepcopy(batch), 'source', 'm') for _ in range(2)]
            barrier.wait(timeout=10)
            m.update_approval_decisions(batch, {'source': {'status': 'approved'}})
            barrier.wait(timeout=10)
            for future in futures: future.result(timeout=10)
    saved = json.loads(Path(batch['json_path']).read_text())['items'][0]['assets']
    assert len(saved) == 3
    assert saved[0]['status'] == 'approved'
    assert all(a['status'] == 'pending' and a['source_asset_id'] == 'source' for a in saved[1:])
