from types import SimpleNamespace


def test_live_snapshot_uses_loaded_catalog_and_current_status(monkeypatch):
    from core import api_server
    manifest = SimpleNamespace(id='demo', tasks=[SimpleNamespace(id='visible', hidden=False), SimpleNamespace(id='hidden', hidden=True)])
    monkeypatch.setattr(api_server.adapter_loader, 'list_all', lambda: [{'id': 'demo'}])
    monkeypatch.setattr(api_server.adapter_loader, 'get_adapter', lambda _: manifest)
    monkeypatch.setattr(api_server.adapter_loader, 'scan_all', lambda: (_ for _ in ()).throw(AssertionError('unexpected manifest scan')))
    monkeypatch.setattr(api_server.data_sink, 'get_latest_runs', lambda keys: {('demo', 'visible'): {'status': 'completed'}})
    monkeypatch.setattr(api_server, '_run_status', {'demo::visible': {'status': 'running', 'records': 3}})
    assert api_server.live_task_summaries() == [{
        'adapter_id': 'demo', 'task_id': 'visible',
        'last_run': {'status': 'completed'}, 'live': {'status': 'running', 'records': 3},
    }]
