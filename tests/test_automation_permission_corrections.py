import asyncio
import copy
import pytest
from unittest.mock import AsyncMock
from core.automation_policy import automation_policy_error
from core.automation_controller import AutomationController, _read_only_policy
from core.agent import mcp_gateway
from core.agent.cdp import CdpClient


def test_browser_collection_is_not_external_messaging():
    policy = {'allow_external_messages': False, 'allow_network': True,
              'toolset': ['browser_navigate', 'browser_act', 'browser_eval', 'browser_verify', 'fs_write', 'automation_record_verification'],
              'allowed_risks': ['read_only', 'local_write']}
    assert not automation_policy_error(policy)
    assert automation_policy_error({**policy, 'allow_network': False})
    assert automation_policy_error({**policy, 'toolset': ['fs_exec']})


def test_browser_act_requires_local_write_risk_even_when_external_messages_are_denied():
    message = automation_policy_error({
        'allow_external_messages': False,
        'allow_network': True,
        'toolset': ['browser_navigate', 'browser_act', 'browser_observe', 'automation_record_verification'],
        'allowed_risks': ['read_only'],
    })

    assert 'browser_act' in message
    assert 'local_write' in message
    assert 'does not authorize external messaging' in message


def test_native_toolset_is_separate_from_mcp_toolset_and_requires_risk_scope():
    assert not automation_policy_error({
        'toolset': ['automation_record_verification'],
        'native_toolset': ['read', 'glob', 'web_fetch', 'crawshrimp_tool_domains', 'enable_tools'],
        'allowed_risks': ['read_only'],
        'allow_network': True,
    })
    assert not automation_policy_error({
        'native_toolset': ['crawshrimp_tool_domains', 'enable_tools'],
        'allowed_risks': ['read_only'],
        'allow_network': False,
    })
    assert automation_policy_error({
        'native_toolset': ['web_fetch'],
        'allowed_risks': ['read_only'],
        'allow_network': False,
    })
    assert automation_policy_error({
        'native_toolset': ['write'],
        'allowed_risks': ['read_only'],
    })


def test_native_shell_requires_broad_flags_and_dual_write_risks():
    ok = {
        'native_toolset': ['bash', 'pwsh'],
        'allowed_risks': ['local_write', 'external_write'],
        'allow_filesystem': True,
        'allow_network': True,
    }
    assert not automation_policy_error(ok)
    assert automation_policy_error({**ok, 'allow_external_messages': False})
    assert automation_policy_error({**ok, 'allowed_risks': ['local_write']})


def test_default_observer_submission_does_not_leak_write_native_tools():
    class Agent:
        def __init__(self):
            self.submitted = None

        async def submit_automation_turn(self, automation, _run, _prompt, _toolset):
            self.submitted = automation
            return {'status': 'queued'}

    agent = Agent()
    controller = AutomationController(agent, None)
    executor = controller._default_executor(action=False)
    automation = {
        'automation_uid': 'auto-native',
        'objective_prompt': 'Observe only',
        'execution_policy': {
            'toolset': ['automation_record_observation'],
            'native_toolset': ['read', 'bash'],
            'allowed_risks': ['read_only', 'local_write', 'external_write'],
            'allow_filesystem': True,
            'allow_network': True,
        },
    }
    observer_policy = {
        'toolset': ['automation_record_observation'],
        'native_toolset': ['read'],
        'allowed_risks': ['read_only'],
    }

    asyncio.run(executor(automation, {'run_uid': 'run-native'}, observer_policy))

    assert agent.submitted['execution_policy']['toolset'] == ['automation_record_observation']
    assert agent.submitted['execution_policy']['native_toolset'] == ['read']


def test_read_only_policy_keeps_browser_navigate_for_authorized_recovery():
    policy = _read_only_policy({
        'toolset': ['browser_navigate', 'browser_observe', 'browser_act', 'automation_record_observation'],
        'native_toolset': ['read', 'bash'],
    })

    assert policy['toolset'] == ['automation_record_observation', 'browser_navigate', 'browser_observe']
    assert policy['native_toolset'] == ['read']


@pytest.mark.parametrize('branch_native, expected', [(None, []), (['read', 'write'], ['read']), (['bash'], ['bash'])])
def test_loop_submission_intersects_branch_native_scope_and_preserves_definition(monkeypatch, tmp_path, branch_native, expected):
    from core import data_sink, scheduler
    monkeypatch.setattr('core.runtime_paths.data_root', lambda: tmp_path)
    data_sink.init_db()

    class Agent:
        def __init__(self):
            self.policies = []

        async def submit_automation_turn(self, automation, _run, _prompt, _toolset):
            self.policies.append(copy.deepcopy(automation['execution_policy']))
            return {'run_id': f'agent-{len(self.policies)}', 'session_id': 'fixed-session', 'status': 'queued'}

    branch = {'id': 'ready', 'when': {'eq': [{'path': 'facts.ready'}, True]},
              'allowed_tools': ['automation_record_verification']}
    if branch_native is not None:
        branch['allowed_native_tools'] = branch_native
    agent = Agent()
    controller = AutomationController(agent, scheduler)
    automation = controller.create({
        'title': '分支授权', 'objective_prompt': '观察后按约定执行',
        'automation_kind': 'loop', 'context_mode': 'isolated', 'enabled': False,
        'program': {'branches': [branch]},
        'execution_policy': {
            'toolset': ['automation_record_observation', 'automation_record_verification'],
            'native_toolset': ['read', 'bash'],
            'allowed_risks': ['read_only', 'local_write', 'external_write'],
            'allow_filesystem': True, 'allow_network': True,
        },
    })
    saved_policy = copy.deepcopy(automation['execution_policy'])

    async def scenario():
        run = await controller.run_now(automation['automation_uid'], request_uid='branch-native')
        return await controller.record_observation(run['run_uid'], {'ready': True}, [])

    result = asyncio.run(scenario())
    assert result['status'] == 'queued'
    assert agent.policies[0]['native_toolset'] == ['read']
    assert agent.policies[1]['native_toolset'] == expected
    assert data_sink.get_agent_automation(automation['automation_uid'])['execution_policy'] == saved_policy


def test_trusted_user_restriction_is_not_dropped():
    token = mcp_gateway.bind_tool_context({'active_run': {'run_id':'one', '_automation_user_restrictions': {'allow_network':False}}})
    try:
        result = mcp_gateway._retain_automation_policy_restrictions({'execution_policy': {'allow_network': True}})
        assert result['error']['code'] == 'AUTOMATION_PERMISSION_ESCALATION'
        assert mcp_gateway._retain_automation_policy_restrictions({'execution_policy': {'allow_network': False}}) is None
    finally:
        mcp_gateway.reset_tool_context(token)


def test_no_message_policy_keeps_local_approval_and_rejects_external_write():
    token = mcp_gateway.bind_tool_context({'automation_policy': {'toolset':['browser_act'], 'allowed_risks':['local_write','external_write'], 'allow_external_messages':False}})
    try:
        assert mcp_gateway._automation_approval_decision({'risk':'local_write'}, {'tool_name':'browser_act'}) == 'approved'
        assert mcp_gateway._automation_approval_decision({'risk':'external_write'}, {'tool_name':'browser_act'}) == 'rejected'
    finally:
        mcp_gateway.reset_tool_context(token)


def test_read_only_cdp_eval_uses_engine_side_effect_guard():
    async def run():
        client = CdpClient('ws://fixture')
        client.send = AsyncMock(return_value={'result': {'value':3}})
        assert await client.evaluate('document.querySelectorAll("tr").length', read_only=True) == 3
        params=client.send.call_args.args[1]
        assert params['throwOnSideEffect'] is True
        assert params['awaitPromise'] is False
        await client.evaluate('1+1')
        assert 'throwOnSideEffect' not in client.send.call_args.args[1]
    asyncio.run(run())


def test_creation_contract_uses_confirmed_scope_not_default_denials():
    description = mcp_gateway.automation_create_tool_description()
    assert '不要为所有任务默认填一组 allow_*=false' in description
    assert '用户已明确要求的操作即为授权' in description
    assert '渠道、收件人和内容' in description
    assert 'browser_act，allowed_risks必须包含local_write' in description
    assert '不等于允许外发' in description
    assert '失败重试时也不得删除或改成 true' not in description


def test_scheduled_csv_write_uses_workspace_and_confirmed_local_risk(tmp_path, monkeypatch):
    monkeypatch.setattr(mcp_gateway.ctx, "workspace_root", tmp_path)
    policy={'toolset':['fs_write'], 'allowed_risks':['local_write'], 'allow_external_messages':False}
    token=mcp_gateway.bind_tool_context({'active_run':{'run_id':'export'}, 'workspace_root':tmp_path, 'automation_policy':policy})
    try:
        result=asyncio.run(mcp_gateway.tool_fs_write('orders.csv', 'id,amount\nQA1001,258\n'))
        assert result['ok'],result
        assert result['data']['verified'] is True
        assert result['data']['line_count'] == 2
        assert (tmp_path/'orders.csv').read_text() == 'id,amount\nQA1001,258\n'
        # An explicitly selected local output path is still local_write.
        absolute=asyncio.run(mcp_gateway.tool_fs_write(str(tmp_path/'chosen.csv'), 'chosen'))
        assert absolute['data']['verified'] is True
    finally:
        mcp_gateway.reset_tool_context(token)


def test_scheduled_write_without_local_authorization_does_not_create_file(tmp_path, monkeypatch):
    monkeypatch.setattr(mcp_gateway.ctx, "workspace_root", tmp_path)
    token=mcp_gateway.bind_tool_context({'active_run':{'run_id':'denied'}, 'automation_policy':{'toolset':['fs_write'],'allowed_risks':['read_only']}})
    try:
        result=asyncio.run(mcp_gateway.tool_fs_write('not-authorized.csv','no'))
        assert result['error']['code'] == 'APPROVAL_REJECTED'
        assert not (tmp_path/'not-authorized.csv').exists()
    finally:
        mcp_gateway.reset_tool_context(token)


def test_csv_write_readback_preserves_bytes_with_windows_text_translation(tmp_path, monkeypatch):
    from pathlib import Path
    import io
    original_open = Path.open
    monkeypatch.setattr(mcp_gateway.ctx, 'workspace_root', tmp_path)
    # Model Windows' text newline translation on any test host. Binary writes
    # and an explicit newline setting retain their real behavior.
    def windows_open(path, mode='r', buffering=-1, encoding=None, errors=None, newline=None):
        if 'w' in mode and 'b' not in mode and newline is None:
            return io.TextIOWrapper(original_open(path, 'wb'), encoding=encoding or 'utf-8', errors=errors, newline='\r\n')
        return original_open(path, mode, buffering, encoding, errors, newline)
    monkeypatch.setattr(Path, 'open', windows_open)
    policy = {'toolset': ['fs_write'], 'allowed_risks': ['local_write']}
    token = mcp_gateway.bind_tool_context({'active_run': {'run_id': 'windows-csv'}, 'workspace_root': tmp_path, 'automation_policy': policy})
    try:
        text = '款号,数量\n202426100106,1\n'
        result = asyncio.run(mcp_gateway.tool_fs_write('中文.csv', text))
        assert result['ok'], result
        assert result['data']['verified'] is True
        assert (tmp_path / '中文.csv').read_bytes() == text.encode('utf-8')
    finally:
        mcp_gateway.reset_tool_context(token)


def test_session_permission_allows_non_permission_controls_only():
    assert automation_policy_error({
        'permission_mode': 'session',
        'timeout_seconds': 300,
        'max_retries': 2,
        'inherited_wait_seconds': 60,
    }) == ''
    assert 'toolset' in automation_policy_error({
        'permission_mode': 'session',
        'toolset': ['automation_record_verification'],
    })
    assert 'native_toolset' in automation_policy_error({
        'permission_mode': 'session',
        'native_toolset': ['read'],
    })
    assert 'allowed_risks' in automation_policy_error({
        'permission_mode': 'session',
        'allowed_risks': ['read_only'],
    })
    assert 'allow_network' in automation_policy_error({
        'permission_mode': 'session',
        'allow_network': True,
    })


def test_legacy_permission_mode_alias_keeps_scoped_policy_validation():
    message = automation_policy_error({
        'permission_mode': 'advanced',
        'toolset': ['browser_act'],
        'allowed_risks': ['read_only'],
    })

    assert 'browser_act' in message
    assert 'local_write' in message


def test_permission_mode_inference_treats_non_permission_controls_as_session():
    from core.automation_policy import infer_automation_permission_mode

    assert infer_automation_permission_mode({"timeout_seconds": 600}) == "session"
    assert infer_automation_permission_mode({
        "max_retries": 2,
        "retry_backoff_seconds": 30,
        "inherited_wait_seconds": 120,
        "verification_schema": {"type": "object"},
    }) == "session"
    assert infer_automation_permission_mode({"toolset": []}) == "scoped"
    assert infer_automation_permission_mode({"native_toolset": []}) == "scoped"
    assert infer_automation_permission_mode({"allowed_risks": []}) == "scoped"
    assert infer_automation_permission_mode({"allow_network": True}) == "scoped"


def test_timeout_only_policy_error_uses_session_semantics_without_rejecting_controls():
    assert automation_policy_error({"timeout_seconds": 600}) == ""
    assert automation_policy_error({"permission_mode": "session", "timeout_seconds": 600}) == ""
    assert automation_policy_error({"permission_mode": "session", "toolset": ["automation_record_verification"]})
