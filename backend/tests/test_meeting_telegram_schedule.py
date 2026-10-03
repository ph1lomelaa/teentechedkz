"""Уведомления о встрече: одно сообщение на событие, напоминание идёт за текущим временем."""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.models.meeting import MeetingStatus
from app.schemas.meeting import MeetingCreate, MeetingUpdate
from app.services import meeting_telegram
from app.services.meeting_telegram import queue_meeting_notices, send_due_notices


class _Session:
    def __init__(self):
        self.rows = []

    async def execute(self, _query):
        return SimpleNamespace(scalars=lambda: iter(self.rows))

    def add(self, row):
        self.rows.append(row)


def _meeting(**overrides):
    data = dict(id=uuid.uuid4(), student_id=uuid.uuid4(), mentor_id=uuid.uuid4(), created_by=None,
                starts_at=datetime.now(timezone.utc) + timedelta(days=1), status=MeetingStatus.scheduled,
                title="Эссе", meeting_link="https://meet.google.com/abc-defg-hij")
    data.update(overrides)
    return SimpleNamespace(**data)


def _row(db, kind):
    return next(row for row in db.rows if row.kind == kind)


def _queue(db, meeting, **kwargs):
    asyncio.run(queue_meeting_notices(db, meeting, **kwargs))


def test_create_queues_notice_and_both_reminders():
    db, meeting = _Session(), _meeting()
    _queue(db, meeting)
    assert {row.kind for row in db.rows} == {"scheduled", "reminder", "mentor_reminder"}
    assert _row(db, "reminder").due_at == meeting.starts_at - timedelta(hours=1)


def test_meeting_within_an_hour_skips_reminders():
    db, meeting = _Session(), _meeting(starts_at=datetime.now(timezone.utc) + timedelta(minutes=30))
    _queue(db, meeting)
    assert _row(db, "reminder").state == "skipped"
    assert _row(db, "mentor_reminder").state == "skipped"


def test_edit_does_not_requeue_sent_reminder():
    db, meeting = _Session(), _meeting()
    _queue(db, meeting)
    reminder = _row(db, "reminder")
    reminder.state = "sent"
    original_due = reminder.due_at
    _queue(db, meeting)
    assert len(db.rows) == 3
    assert (reminder.state, reminder.due_at) == ("sent", original_due)


def test_reschedule_after_notice_sends_one_notice_and_rearms_reminder():
    db, meeting = _Session(), _meeting()
    _queue(db, meeting)
    _row(db, "scheduled").state = "sent"
    reminder = _row(db, "reminder")
    reminder.state = "sent"
    meeting.starts_at += timedelta(days=1)
    _queue(db, meeting, rescheduled=True)
    _queue(db, meeting, rescheduled=True)
    assert reminder.state == "pending"
    assert reminder.due_at == meeting.starts_at - timedelta(hours=1)
    assert sum(row.kind.startswith("rescheduled:") for row in db.rows) == 1


def test_reschedule_before_first_notice_sends_single_message():
    # Правка сразу после создания: «назначена» ещё не ушла — новое время
    # попадает в неё, второго сообщения «перенесена» нет.
    db, meeting = _Session(), _meeting()
    _queue(db, meeting)
    meeting.starts_at += timedelta(hours=3)
    _queue(db, meeting, rescheduled=True)
    assert not any(row.kind.startswith("rescheduled:") for row in db.rows)
    assert _row(db, "scheduled").state == "pending"


def test_failed_reminder_is_rearmed_on_reschedule():
    db, meeting = _Session(), _meeting()
    _queue(db, meeting)
    _row(db, "scheduled").state = "sent"
    _row(db, "reminder").state = "failed"
    meeting.starts_at += timedelta(days=1)
    _queue(db, meeting, rescheduled=True)
    assert _row(db, "reminder").state == "pending"


def test_link_added_after_notice_sends_link_message():
    db, meeting = _Session(), _meeting(meeting_link="")
    _queue(db, meeting)
    _row(db, "scheduled").state = "sent"
    meeting.meeting_link = "https://zoom.us/j/123"
    _queue(db, meeting, link_changed=True)
    assert sum(row.kind.startswith("link:") for row in db.rows) == 1


def test_failed_notice_is_retried_when_meeting_is_edited():
    db, meeting = _Session(), _meeting()
    _queue(db, meeting)
    scheduled = _row(db, "scheduled")
    scheduled.state, scheduled.error = "failed", "нет группы"
    _queue(db, meeting, link_changed=True)
    assert (scheduled.state, scheduled.error) == ("pending", None)


def test_cancel_prevents_pending_notice():
    db, meeting = _Session(), _meeting()
    _queue(db, meeting)
    meeting.status = MeetingStatus.cancelled
    _queue(db, meeting)
    assert all(row.state == "cancelled" for row in db.rows)


def test_cancel_sends_one_notice_if_group_was_already_notified():
    db, meeting = _Session(), _meeting()
    _queue(db, meeting)
    _row(db, "scheduled").state = "sent"
    meeting.status = MeetingStatus.cancelled
    _queue(db, meeting)
    _queue(db, meeting)
    assert sum(row.kind == "cancelled" for row in db.rows) == 1
    assert _row(db, "reminder").state == "cancelled"


def test_uncancel_restores_reminder_and_tells_the_group():
    db, meeting = _Session(), _meeting()
    _queue(db, meeting)
    _row(db, "scheduled").state = "sent"
    meeting.status = MeetingStatus.cancelled
    _queue(db, meeting)
    _row(db, "cancelled").state = "sent"
    meeting.status = MeetingStatus.scheduled
    _queue(db, meeting)
    assert _row(db, "reminder").state == "pending"
    assert _row(db, "mentor_reminder").state == "pending"
    assert sum(row.kind.startswith("restored:") for row in db.rows) == 1
    # Ключ "cancelled" свободен: повторная отмена снова оповестит группу.
    assert not any(row.kind == "cancelled" for row in db.rows)


def test_group_message_without_link_says_it_will_come_later():
    text = meeting_telegram._group_message("scheduled", _meeting(meeting_link=""), None)
    assert "пришлёт отдельно" in text
    assert "Ментор: не указан" in text


def test_meeting_times_must_carry_timezone():
    base = dict(student_id=uuid.uuid4(), title="t", starts_at="2026-10-05T10:00:00", ends_at="2026-10-05T11:00:00")
    with pytest.raises(ValidationError):
        MeetingCreate(**base)
    with pytest.raises(ValidationError):
        MeetingUpdate(starts_at="2026-10-05T10:00:00")
    MeetingCreate(**{**base, "starts_at": "2026-10-05T10:00:00Z", "ends_at": "2026-10-05T11:00:00+05:00"})


# ---------------------------------------------------------------- отправка


class _SendSession:
    """Фейк сессии для send_due_notices: одна выборка due-строк, get по id."""

    def __init__(self, deliveries, meetings, users=()):
        self.deliveries = deliveries
        self.objects = {m.id: m for m in meetings} | {u.id: u for u in users}
        self.added = []
        self.commits = 0

    async def execute(self, _query):
        return SimpleNamespace(scalars=lambda: iter(list(self.deliveries)))

    async def get(self, _model, ident):
        return self.objects.get(ident)

    def add(self, row):
        self.added.append(row)

    async def commit(self):
        self.commits += 1


def _delivery(meeting, kind):
    return SimpleNamespace(id=uuid.uuid4(), meeting_id=meeting.id, kind=kind, state="pending",
                           due_at=datetime.now(timezone.utc), chat_id=None, telegram_message_id=None,
                           error=None, updated_at=None)


@pytest.fixture
def telegram(monkeypatch):
    sent = []

    class _Bot:
        async def send_message(self, chat_id, text):
            sent.append((chat_id, text))
            return SimpleNamespace(message_id=len(sent))

    async def _no_stuck(db, now):
        return None

    async def _never_sent(*args, **kwargs):
        return False

    monkeypatch.setattr(meeting_telegram, "get_bot", lambda: _Bot())
    monkeypatch.setattr(meeting_telegram, "_release_stuck", _no_stuck)
    monkeypatch.setattr(meeting_telegram, "was_sent", _never_sent)
    return sent


def _with_group(monkeypatch, chat_id):
    async def _group(db, student_id):
        return SimpleNamespace(chat_id=chat_id) if chat_id else None
    monkeypatch.setattr(meeting_telegram, "_group_for_student", _group)


def test_send_delivers_to_group_in_almaty_time(monkeypatch, telegram):
    meeting = _meeting(starts_at=datetime(2026, 10, 5, 5, 0, tzinfo=timezone.utc))
    delivery = _delivery(meeting, "scheduled")
    _with_group(monkeypatch, -100500)
    count = asyncio.run(send_due_notices(_SendSession([delivery], [meeting])))
    assert count == 1 and delivery.state == "sent" and delivery.chat_id == -100500
    assert "05.10.2026 в 10:00 (Алматы)" in telegram[0][1]
    assert meeting.meeting_link in telegram[0][1]


def test_send_without_group_fails_and_warns_mentor(monkeypatch, telegram):
    meeting = _meeting()
    delivery = _delivery(meeting, "scheduled")
    _with_group(monkeypatch, None)
    db = _SendSession([delivery], [meeting])
    asyncio.run(send_due_notices(db))
    assert delivery.state == "failed" and telegram == []
    warning = next(n for n in db.added if n.kind == "meeting_telegram_failed")
    assert warning.user_id == meeting.mentor_id


def test_mentor_reminder_goes_to_bell_not_telegram(monkeypatch, telegram):
    meeting = _meeting(starts_at=datetime.now(timezone.utc) + timedelta(minutes=59))
    delivery = _delivery(meeting, "mentor_reminder")
    _with_group(monkeypatch, -1)
    db = _SendSession([delivery], [meeting])
    asyncio.run(send_due_notices(db))
    assert delivery.state == "sent" and telegram == []
    assert [n.kind for n in db.added] == ["meeting_reminder"]
    assert db.added[0].user_id == meeting.mentor_id


def test_reminder_for_started_or_cancelled_meeting_is_dropped(monkeypatch, telegram):
    started = _meeting(starts_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    cancelled = _meeting(status=MeetingStatus.cancelled)
    rows = [_delivery(started, "reminder"), _delivery(cancelled, "scheduled")]
    _with_group(monkeypatch, -1)
    asyncio.run(send_due_notices(_SendSession(rows, [started, cancelled])))
    assert [r.state for r in rows] == ["cancelled", "cancelled"] and telegram == []


def test_telegram_error_marks_failed(monkeypatch, telegram):
    class _Broken:
        async def send_message(self, chat_id, text):
            raise RuntimeError("chat not found")

    monkeypatch.setattr(meeting_telegram, "get_bot", lambda: _Broken())
    meeting = _meeting()
    delivery = _delivery(meeting, "scheduled")
    _with_group(monkeypatch, -1)
    asyncio.run(send_due_notices(_SendSession([delivery], [meeting])))
    assert delivery.state == "failed" and "chat not found" in delivery.error
