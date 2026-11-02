"""Read-only device activity summary; distinct from account billing."""
from contextlib import closing
from datetime import datetime, timedelta, timezone
from core.agent import db


def activity_summary(days=14):
    if not 1 <= days <= 366:
        raise ValueError("days must be between 1 and 366")
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days - 1)
    end = (today + timedelta(days=1)).isoformat()
    with closing(db._conn()) as conn:
        rows = conn.execute(
            "SELECT substr(created_at,1,10) AS day, COUNT(*) AS runs, "
            "SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed "
            "FROM agent_runs WHERE created_at >= ? AND created_at < ? GROUP BY day", (start.isoformat(), end)
        ).fetchall()
        sessions = conn.execute("SELECT COUNT(*) FROM agent_sessions WHERE created_at >= ? AND created_at < ?", (start.isoformat(), end)).fetchone()[0]
    by_day = {row['day']: dict(row) for row in rows}
    daily = [by_day.get((start + timedelta(days=i)).isoformat(),
             {'day': (start + timedelta(days=i)).isoformat(), 'runs': 0, 'completed': 0}) for i in range(days)]
    return {'scope': 'device', 'timezone': 'UTC', 'days': daily, 'sessions': sessions,
            'runs': sum(row['runs'] for row in daily), 'completed': sum(row['completed'] for row in daily)}
