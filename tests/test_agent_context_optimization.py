from pathlib import Path
from core.agent.cordis_config import AGENT_PERSONA
from core.performance_metrics import request_usage_metrics


def test_reply_usage_does_not_keep_previous_cache_read_value():
    metrics = request_usage_metrics({'inputTokens': 211, 'cacheReadTokens': 20608}, 1, 1, 1)
    metrics.update(request_usage_metrics({'inputTokens': 100, 'outputTokens': 20}, 2, 1, 2))
    assert metrics['cacheReadTokens'] is None
    assert metrics['inputTokens'] == 100
    assert metrics['usage_seq'] == 2 and metrics['usage_step'] == 2
    assert request_usage_metrics({'inputTokens': 'private', 'outputTokens': True})['inputTokens'] is None


def test_compact_persona_retains_safety_language_and_routes_detailed_guides():
    assert len(AGENT_PERSONA.encode()) < 6500
    for text in ['简体中文', 'description/title', '不展开内部推理', '用户明确禁止项', '审批',
                 '所有网页任务必须使用抓虾 CDP', 'crawshrimp-computer-use/SKILL.md',
                 'office_deliver(job_id,revision)', '不重复提交', 'requires_file_return=false',
                 '不从商品数量推断畅销', '每轮只启动一个业务Task Instance', 'enable_tools']:
        assert text in AGENT_PERSONA
    root = Path(__file__).parents[1] / 'integrations/deepseek-harness/skills/crawshrimp-product-guide'
    assert '3-5' in (root / 'references/introduction.md').read_text()
    assert 'sha256' in (root / 'references/office.md').read_text()
    assert 'reference_attachment_ids' in (root / 'references/media.md').read_text()
    assert '原生确认卡' in (root / 'references/workflow.md').read_text()


def test_relocated_product_guide_is_discoverable_and_all_references_are_readable(monkeypatch, tmp_path):
    import shutil
    from core.agent import mcp_gateway
    source = Path(__file__).parents[1] / 'integrations/deepseek-harness/skills/crawshrimp-product-guide'
    installed = tmp_path / '抓虾 Resources' / 'skills'
    shutil.copytree(source, installed / source.name)
    monkeypatch.setenv('CRAWSHRIMP_SKILL_ROOT', str(installed))
    monkeypatch.setenv('CRAWSHRIMP_GENERATED_SKILL_ROOT', str(tmp_path / 'generated'))
    token = mcp_gateway.bind_tool_context({'active_run': {'run_id': 'context-guide'}})
    try:
        listed = mcp_gateway.tool_skill_list()
        assert listed['ok'] and source.name in listed['data']['packs']
        for file in source.rglob('*.md'):
            relative = source.name + '/' + file.relative_to(source).as_posix()
            result = mcp_gateway.tool_skill_read(relative)
            assert result['ok'], relative
            data = result['data']
            assert not data['truncated']
            assert data['content'] == file.read_text()
            assert Path(data['absolute_path']).is_file()
        assert not mcp_gateway.tool_skill_read('../outside.md')['ok']
    finally:
        mcp_gateway.reset_tool_context(token)
