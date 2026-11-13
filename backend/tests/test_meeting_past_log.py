"""Прошедший созвон, внесённый задним числом: сразу «Завершена», без «Назначена встреча»."""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.api.v1.endpoints import meetings
from app.models.meeting import MeetingStatus
from app.models.notification import Notification
from app.models.user import UserRole
from app.schemas.meeting import MeetingCreate


class _Db:
    def __init__(self):
        self.added = []

    def add(self, row):
        self.added.append(row)

    async def flush(self):
        pass

    async def commit(self):
        pass

    async def refresh(self, _row):
        pass

    async def get(self, _model, _id):
        return SimpleNamespace(user_id=uuid.uuid4())


def _create(monkeypatch, starts_at):
    async def _noop(*_a, **_k):
        return None
    monkeypatch.setattr(meetings, "_assert_staff", _noop)
    monkeypatch.setattr(meetings, "ensure_assignment_exists", _noop)
    queued = []

    async def _queue(_db, meeting, **_k):
        queued.append(meeting)
    import app.services.meeting_telegram as mt
    monkeypatch.setattr(mt, "queue_meeting_notices", _queue)
    monkeypatch.setattr(meetings.settings, "ENABLE_MEETING_TELEGRAM_NOTIFICATIONS", True)
    body = MeetingCreate(student_id=uuid.uuid4(), title="Обсудили Activity List", outcome="Выбрали 8 активностей",
                         starts_at=starts_at, ends_at=starts_at + timedelta(minutes=40))
    user = SimpleNamespace(id=uuid.uuid4(), role=UserRole.mentor)
    db = _Db()
    meeting = asyncio.run(meetings.create_meeting(body, user, db))
    return meeting, db, queued


def test_past_call_is_completed_and_silent(monkeypatch):
    meeting, db, queued = _create(monkeypatch, datetime.now(timezone.utc) - timedelta(days=1))
    assert meeting.status == MeetingStatus.completed
    assert meeting.outcome == "Выбрали 8 активностей"
    assert not any(isinstance(row, Notification) for row in db.added)
    assert queued == []


def test_future_meeting_still_notifies(monkeypatch):
    meeting, db, queued = _create(monkeypatch, datetime.now(timezone.utc) + timedelta(days=1))
    assert meeting.status == MeetingStatus.scheduled
    assert any(isinstance(row, Notification) and row.kind == "meeting_scheduled" for row in db.added)
    assert queued == [meeting]


def test_editing_past_call_does_not_notify(monkeypatch):
    async def _noop(*_a, **_k):
        return None
    monkeypatch.setattr(meetings, "_assert_staff", _noop)
    import app.services.meeting_telegram as mt
    queued = []

    async def _queue(_db, meeting, **_k):
        queued.append(meeting)
    monkeypatch.setattr(mt, "queue_meeting_notices", _queue)
    monkeypatch.setattr(meetings.settings, "ENABLE_MEETING_TELEGRAM_NOTIFICATIONS", True)
    start = datetime.now(timezone.utc) - timedelta(hours=3)
    meeting = SimpleNamespace(student_id=uuid.uuid4(), starts_at=start, ends_at=start + timedelta(hours=1),
                              status=MeetingStatus.scheduled, outcome="", title="Созвон")

    class _EditDb(_Db):
        async def execute(self, _q):
            return SimpleNamespace(scalar_one_or_none=lambda: meeting)
    from app.schemas.meeting import MeetingUpdate
    db = _EditDb()
    body = MeetingUpdate(outcome="Обсудили эссе", status=MeetingStatus.completed, starts_at=start)
    asyncio.run(meetings.update_meeting(uuid.uuid4(), body, SimpleNamespace(id=uuid.uuid4()), db))
    assert meeting.outcome == "Обсудили эссе" and meeting.status == MeetingStatus.completed
    assert not any(isinstance(row, Notification) for row in db.added)
    assert queued == []


def test_follow_up_draft_falls_back_when_ai_fails(monkeypatch):
    async def _noop(*_a, **_k):
        return None

    async def _source(*_a, **_k):
        return "Итог звонка:\nВыбрали 8 активностей"

    async def _boom(*_a, **_k):
        raise RuntimeError("insufficient_quota")
    monkeypatch.setattr(meetings, "_assert_staff", _noop)
    monkeypatch.setattr(meetings, "_meeting_source_text", _source)
    monkeypatch.setattr(meetings, "provider_chain", lambda: ["openai"])
    monkeypatch.setattr(meetings, "complete_with_fallback", _boom)
    meeting = SimpleNamespace(id=uuid.uuid4(), student_id=uuid.uuid4(), title="Созвон", description="",
                              outcome="Выбрали 8 активностей")

    class _DraftDb(_Db):
        async def execute(self, _q):
            return SimpleNamespace(first=lambda: (meeting, "Асель"))
    out = asyncio.run(meetings.create_meeting_follow_up_draft(uuid.uuid4(), SimpleNamespace(id=uuid.uuid4()), _DraftDb()))
    assert "Выбрали 8 активностей" in out["message"] and "Асель" in out["message"]
