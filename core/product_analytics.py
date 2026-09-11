"""Best-effort metadata-only local outbox. Electron owns identity and upload."""
import json
import re
import uuid
from datetime import datetime, timezone
from core import runtime_paths
from core.atomic_file import atomic_write_json

FEATURES = {'agent', 'skill', 'file_preview', 'browser', 'automation', 'settings', 'app'}
NAMES = {'activity', 'feature_used', 'model_configured', 'task_started', 'task_finished', 'model_call', 'app_error'}

def emit(name, *, key=None, expected_user=None, **fields):
    try:
        if name not in NAMES:
            return
        root = runtime_paths.data_root() / 'product-analytics'
        context = json.loads((root / 'context.json').read_text())
        if not context.get('enabled') or not context.get('user_id') or (expected_user is not None and expected_user != context.get('user_id')):
            return
        queue = root / 'queue'
        queue.mkdir(parents=True, exist_ok=True)
        if len(list(queue.glob('*.json'))) >= 5000:
            return
        event_id = str(uuid.uuid5(uuid.NAMESPACE_URL, context['user_id'] + ':' + key)) if key else str(uuid.uuid4())
        event = dict(name=name, event_id=event_id, occurred_at=datetime.now(timezone.utc).isoformat(), **{k: context[k] for k in ('version', 'platform', 'environment')})
        if fields.get('feature') in FEATURES:
            event['feature'] = fields['feature']
        if fields.get('outcome') in {'succeeded', 'failed', 'canceled', 'unknown'}:
            event['outcome'] = fields['outcome']
        for k, pattern in [('model', r'[A-Za-z0-9_.:/-]{1,100}'), ('error_code', r'[A-Za-z0-9_.:-]{1,80}')]:
            if isinstance(fields.get(k), str) and re.fullmatch(pattern, fields[k]):
                event[k] = fields[k]
        for k in ('duration_ms', 'input_tokens', 'output_tokens'):
            v = fields.get(k)
            if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 10000000000:
                event[k] = v
        atomic_write_json(queue / (event_id + '.json'), {'user_id': context['user_id'], 'event': event})
    except Exception:
        pass  # Analytics must never interrupt a user task.

# Pin each task to the identity present when it starts. Never attribute an old
# task to a newly signed-in account; bounded in-memory state is metadata only.
_run_users = {}

def _task_user(key, start=False):
    try:
        if start and key not in _run_users:
            context = json.loads((runtime_paths.data_root() / 'product-analytics/context.json').read_text())
            _run_users[key] = context.get('user_id') if context.get('enabled') else ''
            if len(_run_users) > 10000:
                _run_users.pop(next(iter(_run_users)))
        return _run_users.get(key, '')
    except Exception:
        return ''

def run_transition(run, status, feature='agent'):
    key = f"{feature}:{run.get('run_id', run.get('id'))}:{run.get('created_at', run.get('started_at', ''))}"
    actor_key = f"{feature}:{run.get('run_id', run.get('id'))}"
    owner = _task_user(actor_key, status in ('starting', 'running'))
    if not owner:
        return
    if status in ('starting', 'running'):
        emit('task_started', key=key+':start', expected_user=owner, feature=feature)
        emit('feature_used', key=key+':feature', expected_user=owner, feature=feature)
    elif status in ('completed', 'success', 'succeeded', 'failed', 'canceled', 'cancelled', 'stopped'):
        outcome = 'succeeded' if status in ('completed', 'success', 'succeeded') else 'failed' if status == 'failed' else 'canceled'
        duration = None
        try:
            duration = max(0, int((datetime.fromisoformat(run['finished_at']) - datetime.fromisoformat(run['started_at'])).total_seconds()*1000))
        except (ValueError, KeyError, TypeError):
            pass
        emit('task_finished', key=key+':finish', expected_user=owner, feature=feature, outcome=outcome, duration_ms=duration, model=run.get('model_id'), error_code=run.get('error_code') or ('task_failed' if outcome=='failed' else None))

def runtime_event(run, event):
    owner = _task_user(f"agent:{run['run_id']}")
    if not owner:
        return
    data = event.get('data') or {}
    kind = event.get('type')
    key = f"runtime:{run['run_id']}:{event.get('seq')}"
    if kind in ('step/start', 'assistant/message'):
        if ((data.get('message') or {}).get('source') or {}).get('provider') == 'crawshrimp-automation':
            return
        usage = data.get('usage') or {}
        source = (data.get('message') or {}).get('source') or {}
        call_key = f"model:{run['run_id']}:{data.get('turn')}:{data.get('step')}"
        emit('model_call', key=call_key, expected_user=owner, feature='agent', model=source.get('model') or run.get('model_id'), input_tokens=usage.get('inputTokens'), output_tokens=usage.get('outputTokens'))
    elif kind == 'tool/call':
        name = str(data.get('name') or '')
        feature = 'browser' if 'browser_' in name else 'skill' if 'skill' in name else None
        if feature:
            emit('feature_used', key=key, expected_user=owner, feature=feature)


def current_user():
    try:
        context = json.loads((runtime_paths.data_root() / 'product-analytics/context.json').read_text())
        return context.get('user_id', '') if context.get('enabled') else ''
    except Exception:
        return ''
