"""Бот записи в работе: вебхук, обработка событий, сторож тишины, чистка сессий.

БД не нужна: сессия подменяется фейком, внешние вызовы (WS-пуш, очередь,
уведомления) — заглушками. Проверяется поведение, которое ломало бы прод:
поддельный вебхук, дубли событий, вечное «идёт запись» у замолчавшего бота.
"""
import asyncio
import base64
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import mock

from pydantic import ValidationError
from starlette.testclient import TestClient

from app.api.v1.endpoints import meeting_bot_webhooks
from app.core.config import Settings, settings
from app.core.database import get_db
from app.main import app
from app.models.note_session import NoteSessionStatus
from app.services.meeting_bot import service
from app.services.meeting_bot.attendee import sign_attendee_payload
from app.services.meeting_bot.service import (
    NO_EVENTS_FAIL_AFTER,
    NO_EVENTS_WARN_AFTER,
    EventOutcome,
    handle_provider_event,
    silent_bot_change,
)
from app.services.note_session_cleanup import CleanupAction, SessionSnapshot, decide_cleanup

SECRET = base64.b64encode(b"s" * 32).decode()
NOW = datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)


class SilentBotTests(unittest.TestCase):
    def test_short_silence_is_tolerated(self):
        self.assertIsNone(silent_bot_change(idle=NO_EVENTS_WARN_AFTER, had_joined=True))

    def test_long_silence_after_join_keeps_the_text(self):
        change = silent_bot_change(idle=NO_EVENTS_FAIL_AFTER, had_joined=True)
        self.assertEqual((change.bot_status, change.reason, change.finalize),
                         ("processing", "watchdog_no_events", True))

    def test_long_silence_before_join_is_failure(self):
        change = silent_bot_change(idle=NO_EVENTS_FAIL_AFTER + timedelta(minutes=1), had_joined=False)
        self.assertEqual((change.bot_status, change.reason, change.finalize),
                         ("failed", "watchdog_no_events", False))


class CleanupTests(unittest.TestCase):
    def _snapshot(self, **kwargs):
        data = dict(status=NoteSessionStatus.active, has_note=False, has_data=True,
                    last_signal_at=NOW - timedelta(minutes=30))
        data.update(kwargs)
        return SessionSnapshot(**data)

    def test_browser_recording_without_heartbeat_is_interrupted(self):
        self.assertEqual(decide_cleanup(self._snapshot(), NOW), CleanupAction.mark_interrupted)

    def test_bot_and_upload_are_left_to_their_own_watchers(self):
        for mode in ("bot", "upload"):
            with self.subTest(mode=mode):
                self.assertEqual(decide_cleanup(self._snapshot(capture_mode=mode), NOW), CleanupAction.keep)

    def test_failed_session_with_saved_audio_is_kept(self):
        # Сессия без текста, но со звуком — её распознают заново, удалять нельзя.
        snapshot = self._snapshot(status=NoteSessionStatus.failed, last_signal_at=NOW - timedelta(days=3))
        self.assertEqual(decide_cleanup(snapshot, NOW), CleanupAction.keep)


class ProductionGuardTests(unittest.TestCase):
    def test_mock_provider_is_refused_in_production(self):
        with self.assertRaises(ValidationError):
            Settings(ENVIRONMENT="production", MEETING_BOT_PROVIDER="mock")
        Settings(ENVIRONMENT="development", MEETING_BOT_PROVIDER="mock")
        Settings(ENVIRONMENT="production", MEETING_BOT_PROVIDER="attendee")


class WebhookEndpointTests(unittest.TestCase):
    URL = "/api/v1/webhooks/meeting-bot/attendee"
    PAYLOAD = {"idempotency_key": "k1", "bot_id": "bot_1", "trigger": "bot.state_change",
               "data": {"new_state": "joined_recording"}}

    def setUp(self):
        async def _db():
            yield SimpleNamespace()
        app.dependency_overrides[get_db] = _db
        self.addCleanup(app.dependency_overrides.pop, get_db, None)
        self.handled = []

        async def _handle(db, provider_name, payload):
            self.handled.append((provider_name, payload))
            return EventOutcome()

        patcher = mock.patch.object(meeting_bot_webhooks, "handle_provider_event", _handle)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = TestClient(app)

    def _settings(self, **values):
        defaults = dict(MEETING_BOT_ENABLED=True, MEETING_BOT_PROVIDER="attendee", ATTENDEE_WEBHOOK_SECRET=SECRET)
        defaults.update(values)
        return mock.patch.multiple(settings, **defaults)

    def test_disabled_bot_hides_the_endpoint(self):
        with self._settings(MEETING_BOT_ENABLED=False):
            response = self.client.post(self.URL, json=self.PAYLOAD)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.handled, [])

    def test_other_provider_name_is_not_found(self):
        with self._settings():
            response = self.client.post("/api/v1/webhooks/meeting-bot/mock", json=self.PAYLOAD,
                                        headers={"X-Webhook-Signature": "mock"})
        self.assertEqual(response.status_code, 404)

    def test_forged_or_unsigned_webhook_is_rejected(self):
        with self._settings():
            unsigned = self.client.post(self.URL, json=self.PAYLOAD)
            forged = self.client.post(self.URL, json=self.PAYLOAD, headers={"X-Webhook-Signature": "AAAA"})
        self.assertEqual((unsigned.status_code, forged.status_code), (401, 401))
        self.assertEqual(self.handled, [])

    def test_missing_secret_rejects_everything(self):
        signature = sign_attendee_payload(self.PAYLOAD, SECRET)
        with self._settings(ATTENDEE_WEBHOOK_SECRET=""):
            response = self.client.post(self.URL, json=self.PAYLOAD, headers={"X-Webhook-Signature": signature})
        self.assertEqual(response.status_code, 401)

    def test_signed_webhook_reaches_the_handler(self):
        signature = sign_attendee_payload(self.PAYLOAD, SECRET)
        with self._settings():
            response = self.client.post(self.URL, json=self.PAYLOAD, headers={"X-Webhook-Signature": signature})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.handled, [("attendee", self.PAYLOAD)])


class _Db:
    def __init__(self):
        self.commits = 0

    async def commit(self):
        self.commits += 1


class ProviderEventTests(unittest.TestCase):
    def setUp(self):
        self.session = SimpleNamespace(
            id=uuid.uuid4(), bot_status="joining", bot_status_reason=None, bot_joined_at=None,
            bot_last_event_at=None, status=NoteSessionStatus.active, note_id=None, ended_at=None,
            last_heartbeat_at=None, created_by=uuid.uuid4(),
        )
        self.recorded = []
        self.notified_failed = []

        async def _find(db, payload):
            return self.session

        async def _record(db, key, session_id, provider, trigger, payload):
            if key in self.recorded:
                return False
            self.recorded.append(key)
            return True

        async def _failed(db, session):
            self.notified_failed.append(session.id)

        async def _noop(*args, **kwargs):
            return None

        for name, value in (("_find_session", _find), ("_record_event", _record),
                            ("_notify_failed", _failed), ("_push_status", _noop)):
            patcher = mock.patch.object(service, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def _event(self, key, new_state, **data):
        payload = {"idempotency_key": key, "bot_id": "b", "trigger": "bot.state_change",
                   "data": {"new_state": new_state, **data}}
        return asyncio.run(handle_provider_event(_Db(), "attendee", payload))

    def test_recording_state_marks_join_time(self):
        outcome = self._event("e1", "joined_recording")
        self.assertTrue(outcome.status_changed)
        self.assertEqual(self.session.bot_status, "recording")
        self.assertIsNotNone(self.session.bot_joined_at)

    def test_duplicate_delivery_changes_nothing(self):
        self._event("e1", "joined_recording")
        self.session.bot_status = "paused"
        outcome = self._event("e1", "joined_recording")
        self.assertTrue(outcome.duplicate)
        self.assertEqual(self.session.bot_status, "paused")

    def test_not_admitted_fails_and_tells_the_mentor(self):
        outcome = self._event("e2", "ended", event_type="could_not_join_meeting",
                              event_sub_type="waiting_room_timeout_exceeded")
        self.assertTrue(outcome.failed)
        self.assertEqual(self.session.bot_status, "failed")
        self.assertEqual(self.session.bot_status_reason, "waiting_room_timeout_exceeded")
        self.assertEqual(self.notified_failed, [self.session.id])

    def test_done_session_ignores_late_state(self):
        self.session.bot_status = "done"
        outcome = self._event("e3", "joined_recording")
        self.assertFalse(outcome.status_changed)
        self.assertEqual(self.session.bot_status, "done")


if __name__ == "__main__":
    unittest.main()
