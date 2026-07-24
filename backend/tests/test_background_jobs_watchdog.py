from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services.background_jobs import _last_activity


def _job(started_at, events=None):
    return SimpleNamespace(started_at=started_at, events=events or [])


def test_last_activity_falls_back_to_started_at_without_events():
    started = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert _last_activity(_job(started)) == started


def test_last_activity_uses_latest_event_timestamp():
    started = datetime(2026, 1, 1, tzinfo=timezone.utc)
    last_event_at = started + timedelta(minutes=5)
    job = _job(
        started,
        events=[
            {"at": started.isoformat(), "message": "block 1"},
            {"at": last_event_at.isoformat(), "message": "block 2"},
        ],
    )
    assert _last_activity(job) == last_event_at


def test_last_activity_ignores_malformed_event_timestamp():
    started = datetime(2026, 1, 1, tzinfo=timezone.utc)
    job = _job(started, events=[{"message": "no timestamp"}])
    assert _last_activity(job) == started
