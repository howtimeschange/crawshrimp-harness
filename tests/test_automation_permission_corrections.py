import asyncio
from unittest.mock import AsyncMock
from core.automation_policy import automation_policy_error
from core.agent import mcp_gateway
from core.agent.cdp import CdpClient


def test_browser_collection_is_not_external_messaging():
    policy = {'allow_external_messages': False, 'allow_network': True,
              'toolset': ['browser_navigate', 'browser_act', 'browser_eval', 'browser_verify', 'fs_write', 'automation_record_verification'],
              'allowed_risks': ['read_only', 'local_write']}
    assert not automation_policy_error(policy)
    assert automation_policy_error({**policy, 'allow_network': False})
    assert automation_policy_error({**policy, 'toolset': ['fs_exec']})


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
