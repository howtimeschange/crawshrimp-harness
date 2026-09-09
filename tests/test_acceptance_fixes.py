"""Regression cases from the real-client acceptance rounds (synthetic data only)."""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from core import data_sink
from core.agent import db, mcp_gateway
from core.agent.service import AgentService
from core.automation_controller import AutomationController


@pytest.fixture
def product_db(monkeypatch, tmp_path):
    monkeypatch.setattr('core.runtime_paths.data_root', lambda: tmp_path)
    data_sink.init_db()
    db.init_agent_db()
    return tmp_path


def test_shadow_answer_provenance_and_stop(product_db):
    async def scenario():
        service = AgentService()
        await service._project_shadow_event('native-test', {'type': 'turn/start', 'data': {}})
        run = service.shadow_runs['native-test']
        assert db.get_run(run['run_id'])['model_id'] == ''
        await service._project_shadow_event('native-test', {'type': 'request/header', 'data': {'header': {'config': {'provider': 'actual-provider', 'model': 'actual-model'}}}})
        assert db.get_run(run['run_id'])['model_id'] == 'actual-model'

        await service._project_shadow_event('native-test', {'type': 'assistant/message', 'data': {
            'message': {'source': {'provider': 'actual-provider', 'model': 'actual-model'},
                        'content': [{'type': 'reasoning', 'text': 'not the answer'}, {'type': 'text', 'text': 'verified answer'}]}}})
        await service._project_shadow_event('native-test', {'type': 'turn/end', 'data': {'reason': {'kind': 'aborted'}}})
        saved = db.get_run(run['run_id'])
        assert (saved['status'], saved['provider_id'], saved['model_id']) == ('canceled', 'actual-provider', 'actual-model')
        texts = [json.loads(m['content_json']).get('text', '') for m in db.list_messages(run['session_id'])]
        assert texts == ['verified answer']
    asyncio.run(scenario())


def test_independent_tabs_persist_and_never_fall_back(product_db, monkeypatch):
    async def scenario():
        created = []
        async def new_tab(url):
            tab = {'id': f'tab-{len(created)}', 'type': 'page', 'url': url, 'webSocketDebuggerUrl': 'ws://fixture'}
            created.append(tab)
            return tab
        bridge = SimpleNamespace(new_tab_async=new_tab, get_tabs=lambda timeout=0: created)
        monkeypatch.setattr('core.cdp_bridge.get_bridge', lambda: bridge)
        service = AgentService()
        for native in ['one', 'two']:
            await service._project_shadow_event(native, {'type': 'turn/start', 'data': {}})
            lease = await service.acquire_mcp_context(native)
            token = mcp_gateway.bind_tool_context(service._mcp_context_leases[lease["lease_id"]])
            try:
                assert mcp_gateway._browser_tab() is None
                result = await mcp_gateway.tool_browser_navigate('https://example.test/')
                assert result['ok'], result
            finally:
                mcp_gateway.reset_tool_context(token)
                service.release_mcp_context(lease['lease_id'])
            await service._project_shadow_event(native, {'type': 'turn/end', 'data': {'reason': {'kind': 'completed'}}})
        assert len(created) == 2
        assert db.get_session_by_runtime('one')['browser_tab_id'] != db.get_session_by_runtime('two')['browser_tab_id']
        await service._project_shadow_event('one', {'type': 'turn/start', 'data': {}})
        run = service.shadow_runs['one']
        assert service.grants_by_run[run['run_id']]['tab_id'] == 'tab-0'
        created.pop(0)
        lease = await service.acquire_mcp_context('one')
        token = mcp_gateway.bind_tool_context(service._mcp_context_leases[lease["lease_id"]])
        try:
            assert mcp_gateway._browser_tab() is None
        finally:
            mcp_gateway.reset_tool_context(token)
            service.release_mcp_context(lease['lease_id'])
    asyncio.run(scenario())


def test_rejected_policy_retry_cannot_drop_or_flip_false():
    token = mcp_gateway.bind_tool_context({'active_run': {'run_id': 'fixture'}})
    try:
        assert mcp_gateway._retain_automation_policy_restrictions({'execution_policy': {'allow_external_messages': False}}) is None
        assert mcp_gateway._retain_automation_policy_restrictions({}, creating=True)['error']['code'] == 'AUTOMATION_PERMISSION_ESCALATION'
        for policy in [{}, {'allow_external_messages': True}]:
            rejected = mcp_gateway._retain_automation_policy_restrictions({'execution_policy': policy})
            assert rejected['error']['code'] == 'AUTOMATION_PERMISSION_ESCALATION'
        assert mcp_gateway._retain_automation_policy_restrictions({'execution_policy': {'allow_external_messages': False, 'toolset': ['browser_observe']}}) is None
    finally:
        mcp_gateway.reset_tool_context(token)


def seed_automation(policy=None):
    return data_sink.create_agent_automation({
        'title': 'acceptance fixture', 'objective_prompt': 'return three records',
        'automation_kind': 'scheduled', 'context_mode': 'isolated', 'enabled': True,
        'schedule': {'kind': 'every', 'interval_seconds': 60, 'timezone': 'Asia/Shanghai'},
        'execution_policy': policy or {},
    })


def test_verification_requires_complete_records_and_audits_correction(product_db):
    async def scenario():
        policy = {'verification_schema': {'type': 'object', 'required': ['records'], 'properties': {'records': {
            'type': 'array', 'minItems': 3, 'maxItems': 3,
            'items': {'type': 'object', 'required': ['text', 'author'], 'properties': {'text': {'type': 'string', 'minLength': 1}}}}}}}
        automation = seed_automation(policy)
        run = data_sink.create_agent_automation_run(automation['automation_uid'], 'scheduled', 'one',
            definition_snapshot=automation, execution_policy_snapshot=policy, status='running')
        controller = AutomationController(SimpleNamespace(), SimpleNamespace())
        partial = {'verified': True, 'records': [{'text': 'only one', 'author': 'a'}]}
        with pytest.raises(ValueError, match='incomplete'):
            await controller.record_verification(run['run_uid'], partial)
        assert data_sink.get_agent_automation_run(run['run_uid'])['status'] == 'running'
        full = {'verified': True, 'records': [{'text': str(i), 'author': 'a'} for i in range(3)]}
        controller._run_schedule_is_current = lambda *_: False
        completed = await controller.record_verification(run['run_uid'], full)
        assert completed['status'] == 'completed'
        revised = {**full, 'user_message': 'all three verified'}
        with pytest.raises(ValueError, match='correction_reason'):
            await controller.record_verification(run['run_uid'], revised)
        corrected = await controller.record_verification(run['run_uid'], revised, correction_reason='add final receipt')
        assert corrected['result_summary']['verification'] == revised
        assert corrected['result_summary']['verification_revisions'][0]['previous'] == full
        assert corrected['finished_at'] == completed['finished_at']
    asyncio.run(scenario())


def test_wait_next_observes_natural_trigger_without_starting_work(product_db):
    async def scenario():
        automation = seed_automation()
        uid = automation['automation_uid']
        baseline = data_sink.create_agent_automation_run(uid, 'scheduled', 'baseline', status='completed')
        controller = AutomationController(SimpleNamespace(), SimpleNamespace())
        controller.run_now = AsyncMock(side_effect=AssertionError('must not create work'))
        async def trigger():
            await asyncio.sleep(.02)
            data_sink.create_agent_automation_run(uid, 'manual', 'manual', status='completed')
            return data_sink.create_agent_automation_run(uid, 'scheduled', 'next', status='running')
        next_task = asyncio.create_task(trigger())
        observed = await controller.wait_for_next_run(uid, after_run_uid=baseline['run_uid'], timeout_seconds=2)
        expected = await next_task
        assert observed['run']['run_uid'] == expected['run_uid']
        assert observed['wait_timed_out'] is False
        assert controller.run_now.await_count == 0
    asyncio.run(scenario())


def test_receipt_contains_accepted_full_records_instead_of_only_a_count():
    result = {'verified': True, 'user_message': '3 records verified', 'records': [
        {'quote_text': 'quote ' + str(i), 'author': 'author ' + str(i), 'source_url': 'https://example.test/', 'observed_at': '2026-09-09T12:00:00+08:00'} for i in range(3)]}
    text = AgentService._automation_receipt_text({'title': 'test'}, 'run', result)
    for record in result['records']:
        assert all(value in text for value in record.values())
    assert text.startswith('3 records verified')
    assert '来源：<https://example.test/>；观察时间：' in text


def test_newer_receipt_waits_for_older_pending_receipt(product_db):
    async def scenario():
        db.create_session('source', 'native-source', 'source')
        automation = seed_automation()
        data_sink.update_agent_automation(automation['automation_uid'], source_session_id='source')
        old = data_sink.create_agent_automation_run(automation['automation_uid'], 'scheduled', 'older',
            status='completed', agent_run_id='old-agent', notification_status='pending_source_receipt')
        new = data_sink.create_agent_automation_run(automation['automation_uid'], 'scheduled', 'newer',
            status='completed', agent_run_id='new-agent', result_summary={'verification': {'verified': True, 'user_message': 'second'}})
        service = AgentService()
        service._project_automation_receipt_to_runtime = AsyncMock(return_value=True)
        service._schedule_automation_receipt_retry = lambda *_args, **_kwargs: None
        args = {'run_id': 'new-agent', 'automation_run_uid': new['run_uid']}
        await service._publish_automation_source_receipt('isolated', args, status='completed')
        assert service._project_automation_receipt_to_runtime.await_count == 0
        assert data_sink.get_agent_automation_run(new['run_uid'])['notification_status'] == 'pending_source_receipt'
        data_sink.update_agent_automation_run(old['run_uid'], notification_status='delivered')
        await service._publish_automation_source_receipt('isolated', args, status='completed')
        service._project_automation_receipt_to_runtime.assert_awaited_once_with('source', 'new-agent:automation-source-receipt', 'second')
    asyncio.run(scenario())


def test_long_source_turn_end_requeues_expired_pending_receipts(product_db):
    async def scenario():
        service = AgentService()
        service.automation_controller = SimpleNamespace()
        await service._project_shadow_event('native-long-source', {'type': 'turn/start', 'data': {}})
        source = db.get_session_by_runtime('native-long-source')
        automation = seed_automation()
        data_sink.update_agent_automation(automation['automation_uid'], source_session_id=source['session_id'])
        run = data_sink.create_agent_automation_run(automation['automation_uid'], 'scheduled', 'expired-delivery',
            status='completed', agent_run_id='background-run', agent_session_id='isolated', notification_status='pending_source_receipt')
        service._project_automation_receipt_to_runtime = AsyncMock(side_effect=AssertionError("must not block Worker reader"))
        calls = []
        service._schedule_automation_receipt_retry = lambda *args, **kwargs: calls.append((args, kwargs))
        await service._project_shadow_event('native-long-source', {'type': 'turn/end', 'data': {'reason': {'kind': 'completed'}}})
        assert len(calls) == 1
        assert calls[0][0][1]['automation_run_uid'] == run['run_uid']
    asyncio.run(scenario())


def test_failed_task_exposes_persisted_error_without_scanning_logs():
    detail = {'status': 'failed', 'current_step': 'config', 'summary': {'error': 'ERR_HTTP2_PROTOCOL_ERROR'}}
    assert mcp_gateway._task_failure_message(detail) == 'ERR_HTTP2_PROTOCOL_ERROR'
    assert 'ERR_HTTP2_PROTOCOL_ERROR' in mcp_gateway._safe_task_summary(detail)
    assert mcp_gateway._task_failure_message({**detail, 'status': 'completed'}) == ''


@pytest.mark.parametrize('provider,native,product', [
    ('crawshrimp-deepseek-official', 'deepseek-v4-flash', 'deepseek-official-v4-flash'),
    ('crawshrimp-deepseek-official', 'deepseek-v4-pro', 'deepseek-official-v4-pro'),
    ('crawshrimp-glm-official', 'glm-5.2', 'glm-official-5.2'),
    ('crawshrimp-domestic-openai', 'deepseek-v4-flash', 'deepseek-v4-flash'),
    ('private-provider', 'deepseek-v4-flash', 'deepseek-v4-flash'),
])
def test_inherited_automation_preserves_native_provider(product_db, monkeypatch, provider, native, product):
    from core.agent.service import _resolve_configured_generation_model
    cfg = {'ai': {'llm': {
        'deepseek_api_key': 'fixture-official', 'domestic_api_key': 'fixture-gateway', 'glm_api_key': 'fixture-glm',
        'custom_providers': [{'id': 'private-provider', 'api_key': 'fixture-custom',
                              'base_url': 'https://private.example.test/v1', 'models': ['deepseek-v4-flash']}],
    }}}
    monkeypatch.setattr('core.agent.service.load_config', lambda: cfg)
    service = AgentService()
    db.create_session('source', 'native-source')
    async def scenario():
        await service._project_shadow_event('native-source', {'type': 'model/selection', 'data': {'provider': provider, 'model': native}})
        receipt = await service.submit_automation_turn(
            {'automation_uid': 'fixture', 'context_mode': 'inherited', 'source_session_id': 'source'},
            {'run_uid': 'fixture-run'}, 'fixture', ['automation_record_verification'])
        service._clear_inherited_automation_wait(receipt['run_id'])
        queued = service.queue.get_nowait()
        assert (queued['model_id'], queued['provider_id']) == (product, provider)
        assert _resolve_configured_generation_model(cfg, provider, queued['model_id']) == (product, provider)
        assert db.get_run(receipt['run_id'])['provider_id'] == provider
    asyncio.run(scenario())


def test_unavailable_native_provider_does_not_borrow_other_key(product_db, monkeypatch):
    from core.agent.service import AgentModelConfigurationError
    monkeypatch.delenv('CRAWSHRIMP_DEEPSEEK_API_KEY', raising=False)
    monkeypatch.setattr('core.agent.service.load_config', lambda: {'ai': {'llm': {'domestic_api_key': 'fixture-gateway'}}})
    db.create_session('source', 'native-source')
    db.update_session('source', provider_id='crawshrimp-deepseek-official', model_id='deepseek-v4-flash')
    service = AgentService()
    with pytest.raises(AgentModelConfigurationError, match='crawshrimp-deepseek-official'):
        asyncio.run(service.submit_turn('source', 'fixture'))
    assert db.list_messages('source') == []
    assert service.queue.empty()
