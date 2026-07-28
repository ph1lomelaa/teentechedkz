from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from app.api.v1.endpoints.telegram_chats import _pairing_candidate_response
from app.models.student import Student
from app.models.telegram_chat import TelegramChat, TelegramChatStatus, TelegramChatType
from app.services.telegram_bot import consume_pairing_code, consume_pairing_for_adder


class FakeTelegramDb:
    def __init__(self, *, results=(), objects=None):
        self.results = list(results)
        self.objects = objects or {}
        self.flush_count = 0

    async def execute(self, _query):
        value = self.results.pop(0) if self.results else None
        return SimpleNamespace(scalar_one_or_none=lambda: value)

    async def get(self, model, object_id):
        return self.objects.get((model, object_id))

    async def flush(self):
        self.flush_count += 1


class TelegramPairingConfirmationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.now = datetime(2026, 7, 29, 10, 0, tzinfo=timezone.utc)

    async def test_adder_detection_keeps_group_unbound_until_confirmation(self) -> None:
        staff_id = uuid.uuid4()
        student_id = uuid.uuid4()
        chat_id = uuid.uuid4()
        adder = SimpleNamespace(id=staff_id)
        student = SimpleNamespace(id=student_id, full_name="Алина Садыкова")
        pairing = SimpleNamespace(
            student_id=student_id,
            candidate_chat_id=None,
            candidate_detected_at=None,
            used_at=None,
        )
        chat = SimpleNamespace(
            id=chat_id,
            chat_id=-1001234567890,
            status=TelegramChatStatus.unbound,
        )
        db = FakeTelegramDb(
            results=(adder, pairing),
            objects={(Student, student_id): student},
        )

        detected_student = await consume_pairing_for_adder(
            db,
            chat,
            adder_tg_user_id=777,
            now=self.now,
        )

        self.assertIs(detected_student, student)
        self.assertEqual(pairing.candidate_chat_id, chat_id)
        self.assertEqual(pairing.candidate_detected_at, self.now)
        self.assertIsNone(pairing.used_at)
        self.assertEqual(chat.status, TelegramChatStatus.unbound)
        self.assertEqual(db.flush_count, 1)

    async def test_cancelled_exact_code_cannot_bind_group(self) -> None:
        pairing = SimpleNamespace(
            used_at=None,
            cancelled_at=self.now,
            expires_at=datetime(2030, 1, 1, tzinfo=timezone.utc),
        )
        chat = SimpleNamespace(chat_id=-1001234567890)
        db = FakeTelegramDb(results=(pairing,))

        result = await consume_pairing_code(db, "cancelled-code", chat, now=self.now)

        self.assertIsNone(result)
        self.assertEqual(db.flush_count, 0)

    async def test_candidate_response_contains_exact_group_for_confirmation(self) -> None:
        student_id = uuid.uuid4()
        chat_id = uuid.uuid4()
        pairing = SimpleNamespace(
            code="candidate-code",
            student_id=student_id,
            candidate_chat_id=chat_id,
            candidate_detected_at=self.now,
            used_at=None,
            cancelled_at=None,
            expires_at=datetime(2030, 1, 1, tzinfo=timezone.utc),
        )
        student = SimpleNamespace(id=student_id, full_name="Алина Садыкова")
        chat = SimpleNamespace(
            id=chat_id,
            chat_id=-1001234567890,
            title="Алина — Казахстан — 2027",
            chat_type=TelegramChatType.supergroup,
        )
        db = FakeTelegramDb(
            objects={
                (Student, student_id): student,
                (TelegramChat, chat_id): chat,
            },
        )

        response = await _pairing_candidate_response(db, pairing)

        self.assertEqual(response["status"], "detected")
        self.assertEqual(response["student_name"], "Алина Садыкова")
        self.assertEqual(response["candidate"]["telegram_chat_id"], -1001234567890)
        self.assertEqual(response["candidate"]["title"], "Алина — Казахстан — 2027")


if __name__ == "__main__":
    unittest.main()
