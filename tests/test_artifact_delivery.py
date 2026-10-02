import asyncio
import json
import pytest
from pathlib import Path
from core.agent.artifact_delivery import collect_tool_deliveries, verified_artifact
from core.agent import mcp_gateway as gw
from core.agent.service import _extract_tool_result_text


def test_shell_manifest_requires_existing_file_and_success(tmp_path):
    file = tmp_path / '中文销售.csv'; file.write_text('品名,金额\n童装,3015\n')
    call = {'tool_name': 'mcp__crawshrimp__fs_exec', 'run_id': 'run', 'tool_call_id': 'call'}
    envelope = {'ok': True, 'data': {'exit_code': 0, 'stdout': json.dumps({'artifacts': [{'path': str(file)}, {'path': str(file)}, {'path': str(tmp_path / 'missing')}]})}}
    rows = collect_tool_deliveries(call, json.dumps(envelope))
    assert len(rows) == 1
    assert rows[0]['source'] == 'shell' and rows[0]['verified'] and rows[0]['run_id'] == 'run'
    envelope['data']['exit_code'] = 1
    assert collect_tool_deliveries(call, json.dumps(envelope)) == []
    assert collect_tool_deliveries(call, '模型说文件已完成') == []
    assert collect_tool_deliveries(call, json.dumps({'data': {'path': str(file)}})) == []


def test_write_and_adapter_structured_output(tmp_path):
    file = tmp_path / 'result.md'; file.write_text('# 交付')
    write = collect_tool_deliveries({'tool_name': 'fs_write'}, json.dumps({'ok': True, 'data': {'path': str(file)}}))
    assert write[0]['source'] == 'shell'
    adapter = collect_tool_deliveries({'tool_name': 'task_run'}, json.dumps({'ok': True, 'data': {'artifacts': [{'path': str(file)}]}}))
    assert adapter[0]['source'] == 'adapter'
    assert verified_artifact('result.md', source='shell', workspace=tmp_path)['path'] == str(file)
    assert verified_artifact(str(tmp_path), source='shell') is None
    assert collect_tool_deliveries({'tool_name':'fs_write'}, json.dumps({'ok':False, 'data':{'path':str(file)}})) == []


def test_native_bash_direct_manifest_from_tool_result(tmp_path):
    file = tmp_path / 'native-bash.csv'; file.write_text('id\n1\n')
    # The native bash renderer returns stdout as text, without an fs_exec envelope.
    stdout = json.dumps({'artifacts': [{'path': 'native-bash.csv'}]})
    event = {'message': {'content': [{'type': 'tool-result', 'content': [{'type': 'text', 'text': stdout}]}]}}
    rows = collect_tool_deliveries({'tool_name': 'bash', 'tool_call_id': 'native'}, _extract_tool_result_text(event), tmp_path)
    assert len(rows) == 1
    assert rows[0]['path'] == str(file.resolve()) and rows[0]['source'] == 'shell'
    assert rows[0]['tool_call_id'] == 'native'
    for marker in ('[exit code: 1]', '[stderr]\nvalidation failed', '[timed out after 1ms]'):
        assert collect_tool_deliveries({'tool_name': 'bash'}, stdout + '\n' + marker, tmp_path) == []


@pytest.mark.parametrize('failure', [{'status': 'failed'}, {'status': 'rejected'}, {'status': 'canceled'}, {'ok': False}, {'exit_code': 1}, {'exitCode': 1}])
@pytest.mark.parametrize('layer', ['envelope', 'data', 'stdout', 'native-bash'])
def test_failure_at_any_manifest_layer_rejects_existing_partial_output(tmp_path, failure, layer):
    file = tmp_path / 'partial.csv'; file.write_text('id\n1\n')
    manifest = {'artifacts': [{'path': str(file)}]}
    name = 'fs_exec'
    if layer == 'envelope':
        result = {'ok': True, 'data': {'exit_code': 0, 'stdout': json.dumps(manifest)}, **failure}
    elif layer == 'data':
        result = {'ok': True, 'data': {'exit_code': 0, 'stdout': json.dumps(manifest), **failure}}
    elif layer == 'stdout':
        result = {'ok': True, 'data': {'exit_code': 0, 'stdout': json.dumps({**manifest, **failure})}}
    else:
        name = 'bash'; result = {**manifest, **failure}
    assert collect_tool_deliveries({'tool_name': name}, json.dumps(result)) == []


def test_explicit_present_registers_only_readback_outputs(monkeypatch, tmp_path):
    file = tmp_path / 'shell-report.txt'; file.write_text('shell output')
    events = []
    previous = (gw.ctx.active_run, gw.ctx.emit_event)
    gw.ctx.active_run = {'run_id':'run-shell', 'session_id':'session'}
    gw.ctx.emit_event = lambda event, data: events.append((event, data))
    try:
        result = gw.tool_artifact_present([str(file), str(tmp_path/'missing')])
    finally:
        gw.ctx.active_run, gw.ctx.emit_event = previous
    assert result['ok'] and len(result['data']['artifacts']) == 1
    assert events[0][0] == 'artifact.created'
    assert events[0][1]['verification']['status'] == 'exists'
    assert len(result['data']['missing']) == 1
