import json
from datetime import datetime, timezone
from core import product_analytics as analytics

def test_metadata_usage_dedup_and_account_switch(tmp_path, monkeypatch):
    monkeypatch.setattr(analytics.runtime_paths, 'data_root', lambda: tmp_path)
    root = tmp_path / 'product-analytics'
    root.mkdir()
    context = dict(enabled=True,user_id='one',version='test',platform='darwin',environment='test')
    (root/'context.json').write_text(json.dumps(context))
    run = dict(run_id='unique-test',started_at=datetime.now(timezone.utc).isoformat(),created_at='stable',model_id='deepseek-chat')
    analytics.run_transition(run,'running')
    analytics.runtime_event(run,dict(type='step/start',seq=1,data=dict(turn=1,step=1)))
    analytics.runtime_event(run,dict(type='assistant/message',seq=2,data=dict(turn=1,step=1,usage=dict(inputTokens=10,outputTokens=20),message=dict(content='PRIVATE'))))
    entries=[json.loads(p.read_text())['event'] for p in (root/'queue').glob('*.json')]
    calls=[e for e in entries if e['name']=='model_call']
    assert len(calls)==1
    assert calls[0]['input_tokens']==10
    assert 'PRIVATE' not in json.dumps(entries)
    context['user_id']='two';(root/'context.json').write_text(json.dumps(context))
    analytics.run_transition({**run,'finished_at':datetime.now(timezone.utc).isoformat()},'completed')
    assert not any(json.loads(p.read_text())['event']['name']=='task_finished' for p in (root/'queue').glob('*.json'))

def test_disabled_never_queues(tmp_path,monkeypatch):
    monkeypatch.setattr(analytics.runtime_paths,'data_root',lambda:tmp_path)
    analytics.emit('activity',prompt='secret')
    assert not list(tmp_path.rglob('*.json'))
