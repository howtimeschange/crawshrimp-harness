import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from core.agent import api, db, mcp_gateway as gw, office_tools
from core.office import jobs
from core.office.runtime import file_hash
from test_session_resources import resource_db


@pytest.mark.parametrize('text,rows', [
    ('sku,amount\n00123,12.5\n00456,-2.5\n', [['00123', '12.5'], ['00456', '-2.5']]),
    ('name,value\n"中文,字段",\n"跨\n行","a""b"\n', [['中文,字段', ''], ['跨\n行', 'a"b']]),
])
def test_csv_fields(text, rows):
    result = gw._build_text_preview(text, 'fixture.csv', 0)['data']
    assert result['rows'] == rows
    assert not result['truncated']


def test_csv_record_limit_and_sensitive_field_masking():
    result = gw._build_text_preview('sku,password\n00123,secret\n', 'x.csv', 0)['data']
    assert result['rows'][0][0] == '00123'
    assert 'secret' not in str(result)
    result = gw._build_text_preview('a\n' + 'v\n' * 201, 'x.csv', 0)['data']
    assert result['row_count'] == 200 and result['truncated']


def test_ui_pages_bind_next_turn_and_reject_foreign_or_closed(resource_db, monkeypatch):
    service = SimpleNamespace(broadcast=AsyncMock())
    bridge = SimpleNamespace(new_tab=lambda _: {'id': 'created', 'url': 'about:blank'}, get_tabs=lambda: [{'id': 'created'}])
    monkeypatch.setattr(api, 'get_agent_service', lambda: service)
    monkeypatch.setattr('core.cdp_bridge.get_bridge', lambda: bridge)
    asyncio.run(api.create_session_page(api.SessionPageRequest(runtime_session_id='runtime-a')))
    assert db.get_session('a')['browser_tab_id'] == 'created'
    db.append_event('a', None, 'browser.activity', {'tabs': [{'id': 'created'}]})
    asyncio.run(api.select_session_page('created', api.SessionPageRequest(runtime_session_id='runtime-a')))
    with pytest.raises(api.HTTPException):
        asyncio.run(api.select_session_page('created', api.SessionPageRequest(runtime_session_id='runtime-b')))
    bridge.get_tabs = lambda: []
    with pytest.raises(api.HTTPException):
        asyncio.run(api.select_session_page('created', api.SessionPageRequest(runtime_session_id='runtime-a')))
    assert db.get_session('a')['browser_tab_id'] == 'created'  # keep closed binding fail-closed


def test_office_delivery_is_revision_fenced(tmp_path, monkeypatch):
    job_id = 'a' * 32
    work = tmp_path / job_id
    work.mkdir()
    doc = work / 'book.xlsx'
    doc.write_bytes(b'verified bytes')
    sha = file_hash(doc)
    data = {'job_id': job_id, 'state': 'completed', 'result': {'document': str(doc), 'revision': sha,
            'validation': {'status': 'passed', 'revision': sha}, 'visual': {'status': 'passed'}, 'pages': [{'page': 1}]}}
    jobs.save(work, data)
    monkeypatch.setattr(office_tools, 'root', lambda: tmp_path)
    published = []
    monkeypatch.setattr(office_tools, 'publish', lambda data: (published.append(data), ['artifact'])[1])
    monkeypatch.setattr(jobs, 'preview', lambda *args: {})
    assert not office_tools.office_deliver(job_id, 'wrong')['ok']
    result = office_tools.office_deliver(job_id, sha)
    assert result['data']['sha256'] == sha
    assert result['data']['path'] == str(doc)
    assert published[-1]['result']['delivery']['status'] == 'final'
    doc.write_bytes(b'modified after verification')
    assert not office_tools.office_deliver(job_id, sha)['ok']
    assert len(published) == 1
