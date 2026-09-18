"""Opt-in bounded numeric diagnostics, without request bodies or identifiers."""
import asyncio
import os
import time
from collections import OrderedDict, deque
from threading import Lock

_lock = Lock()
_spans = OrderedDict()
_lag = deque(maxlen=120)

def enabled():
    return os.environ.get('CRAWSHRIMP_PERF') == '1'


def request_usage_metrics(usage, seq=0, turn=None, step=None):
    """One reply's disjoint token counts; absent cache data stays unknown."""
    def numeric(value):
        return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None
    return {**{key: numeric(usage.get(key)) for key in (
        'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens',
    )}, 'usage_seq': seq, 'usage_turn': numeric(turn), 'usage_step': numeric(step)}


def observe(name, ms):
    if not enabled():
        return
    with _lock:
        values = _spans.setdefault(name, deque(maxlen=128))
        values.append(round(ms, 3))
        while len(_spans) > 64:
            _spans.popitem(last=False)


def snapshot():
    with _lock:
        return {'enabled': enabled(), 'api_header_ms': {k: list(v) for k, v in _spans.items()}, 'loop_lag_ms': list(_lag)}


async def sample_loop():
    while True:
        start = time.monotonic()
        await asyncio.sleep(1)
        with _lock:
            _lag.append(round(max(0, time.monotonic() - start - 1) * 1000, 3))
