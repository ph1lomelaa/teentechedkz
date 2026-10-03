"""Жизненный цикл сессии конспекта: очистка пустых попыток, прерванные записи,
токен Deepgram без утечки постоянного ключа, пустой текст перед конспектом."""
import os
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.api.v1.endpoints.integrations import deepgram_token
from app.api.v1.endpoints.note_sessions import _session_source_text
from app.models.note_session import NoteSessionStatus
from app.models.user import UserRole
from app.services.note_session_cleanup import (
    EMPTY_TTL,
    STALE_AFTER,
    CleanupAction,
    SessionSnapshot,
    decide_cleanup,
)

NOW = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)


def snap(status, *, has_data=False, has_note=False, idle=timedelta(0)):
    return SessionSnapshot(status=status, has_note=has_note, has_data=has_data, last_signal_at=NOW - idle)


class EmptySessionTests(unittest.TestCase):
    def test_fresh_draft_is_kept(self):
        """Ментор ещё на экране подготовки — черновик не трогаем."""
        self.assertEqual(decide_cleanup(snap(NoteSessionStatus.draft, idle=timedelta(hours=2)), NOW), CleanupAction.keep)

    def test_old_empty_draft_is_deleted(self):
        self.assertEqual(decide_cleanup(snap(NoteSessionStatus.draft, idle=EMPTY_TTL), NOW), CleanupAction.delete)

    def test_old_empty_active_is_deleted(self):
        """Старый поток: сессия active без единого фрагмента — неудачная попытка."""
        self.assertEqual(decide_cleanup(snap(NoteSessionStatus.active, idle=EMPTY_TTL), NOW), CleanupAction.delete)

    def test_legacy_completed_without_note_and_text_is_deleted(self):
        self.assertEqual(decide_cleanup(snap(NoteSessionStatus.completed, idle=EMPTY_TTL), NOW), CleanupAction.delete)

    def test_session_with_note_is_never_touched(self):
        self.assertEqual(
            decide_cleanup(snap(NoteSessionStatus.completed, has_note=True, idle=EMPTY_TTL * 10), NOW),
            CleanupAction.keep,
        )

    def test_cancelled_is_never_touched(self):
        self.assertEqual(decide_cleanup(snap(NoteSessionStatus.cancelled, idle=EMPTY_TTL * 10), NOW), CleanupAction.keep)


class InterruptedTests(unittest.TestCase):
    def test_active_with_data_and_heartbeat_is_kept(self):
        self.assertEqual(
            decide_cleanup(snap(NoteSessionStatus.active, has_data=True, idle=timedelta(minutes=1)), NOW),
            CleanupAction.keep,
        )

    def test_stale_active_with_data_becomes_interrupted(self):
        self.assertEqual(
            decide_cleanup(snap(NoteSessionStatus.active, has_data=True, idle=STALE_AFTER), NOW),
            CleanupAction.mark_interrupted,
        )

    def test_data_is_never_deleted_even_when_old(self):
        """Текст или аудио есть — удалять нельзя, даже через неделю."""
        self.assertEqual(
            decide_cleanup(snap(NoteSessionStatus.interrupted, has_data=True, idle=timedelta(days=7)), NOW),
            CleanupAction.keep,
        )


class SourceTextTests(unittest.TestCase):
    def test_blank_transcripts_give_empty_source(self):
        """finalize отвечает 409, а не создаёт пустой конспект «ждёт проверки»."""
        session = SimpleNamespace(backup_transcript_text="  ")
        rows = [SimpleNamespace(speaker=None, text="  ")]
        self.assertEqual(_session_source_text(session, rows), "")

    def test_backup_text_counts_as_source(self):
        session = SimpleNamespace(backup_transcript_text="восстановленный текст")
        self.assertIn("восстановленный текст", _session_source_text(session, []))


class _FailingClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, *args, **kwargs):
        raise RuntimeError("403 Insufficient permissions")


class DeepgramTokenTests(unittest.IsolatedAsyncioTestCase):
    mentor = SimpleNamespace(role=UserRole.mentor, permission_grants=[])

    async def test_failed_grant_never_leaks_permanent_key(self):
        with patch.dict(os.environ, {"DEEPGRAM_API_KEY": "permanent-test-key"}), patch(
            "app.api.v1.endpoints.integrations.httpx.AsyncClient", _FailingClient
        ):
            with self.assertRaises(HTTPException) as ctx:
                await deepgram_token(self.mentor)
        self.assertEqual(ctx.exception.status_code, 503)
        self.assertEqual(ctx.exception.headers["X-Error-Code"], "DEEPGRAM_TOKEN_UNAVAILABLE")
        self.assertNotIn("permanent-test-key", str(ctx.exception.detail))

    async def test_missing_key_has_its_own_code(self):
        with patch.dict(os.environ, {"DEEPGRAM_API_KEY": ""}):
            with self.assertRaises(HTTPException) as ctx:
                await deepgram_token(self.mentor)
        self.assertEqual(ctx.exception.headers["X-Error-Code"], "DEEPGRAM_NOT_CONFIGURED")


class StatusEnumTests(unittest.TestCase):
    def test_lifecycle_statuses_exist(self):
        for value in ("draft", "active", "interrupted", "failed", "completed", "cancelled"):
            NoteSessionStatus(value)


if __name__ == "__main__":
    unittest.main()
