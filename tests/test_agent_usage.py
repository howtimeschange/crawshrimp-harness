"""Device activity windows must not count historical or future runs."""
import sqlite3
from datetime import datetime, timedelta, timezone
from core.agent import usage


def test_activity_window_and_status(tmp_path, monkeypatch):
    path = tmp_path / 'activity.db'
    today = datetime.now(timezone.utc).date()
    with sqlite3.connect(path) as conn:
        conn.executescript('CREATE TABLE agent_runs(created_at TEXT, status TEXT); CREATE TABLE agent_sessions(created_at TEXT);')
        for offset, status in [(-13, 'completed'), (0, 'failed'), (0, 'completed'), (-14, 'completed'), (1, 'completed')]:
            date = (today + timedelta(days=offset)).isoformat()
            conn.execute('INSERT INTO agent_runs VALUES (?, ?)', (date, status))
            conn.execute('INSERT INTO agent_sessions VALUES (?)', (date,))
    def connect():
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        return conn
    monkeypatch.setattr(usage.db, '_conn', connect)
    result = usage.activity_summary()
    assert len(result['days']) == 14
    assert (result['sessions'], result['runs'], result['completed']) == (3, 3, 2)
    assert result['days'][0]['runs'] == 1
    assert result['days'][1]['runs'] == 0
    assert result['days'][-1]['runs'] == 2
    assert result['scope'] == 'device'
