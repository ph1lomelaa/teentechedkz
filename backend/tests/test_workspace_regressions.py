from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from app.api.v1.endpoints.note_sessions import _session_source_text
from app.api.v1.endpoints.telegram_chats import _message_to_dict
from app.api.v1.endpoints.workspace import (
    _clean_context_strings,
    _paginate_unified_items,
    _unified_context_markdown,
)
from app.services.student_notes import snapshot_student


class WorkspaceRegressionTests(unittest.IsolatedAsyncioTestCase):
    def test_backup_transcript_is_included_in_ai_source(self) -> None:
        session = SimpleNamespace(backup_transcript_text="восстановленный фрагмент")
        transcripts = [SimpleNamespace(speaker="Ментор", text="основной фрагмент")]

        source = _session_source_text(session, transcripts)

        self.assertIn("[Ментор]: основной фрагмент", source)
        self.assertIn("[Восстановленная аудиозапись]: восстановленный фрагмент", source)

    def test_unified_pagination_is_stable_and_chronological(self) -> None:
        items = [
            {"id": f"{index:02d}", "created_at": f"2026-07-19T10:{index:02d}:00+00:00"}
            for index in range(8)
        ]

        first, first_has_more = _paginate_unified_items(items.copy(), 0, 3)
        second, second_has_more = _paginate_unified_items(items.copy(), 3, 3)
        last, last_has_more = _paginate_unified_items(items.copy(), 6, 3)

        self.assertEqual([item["id"] for item in first], ["05", "06", "07"])
        self.assertEqual([item["id"] for item in second], ["02", "03", "04"])
        self.assertEqual([item["id"] for item in last], ["00", "01"])
        self.assertTrue(first_has_more)
        self.assertTrue(second_has_more)
        self.assertFalse(last_has_more)

    def test_context_values_are_compacted_and_rendered(self) -> None:
        cleaned = _clean_context_strings(["  Проверить   IELTS  ", "", "Создать задачу"])
        markdown = _unified_context_markdown({
            "summary": "Итог",
            "follow_ups": cleaned,
            "document_flags": ["Проверить сертификат"],
        })

        self.assertEqual(cleaned, ["Проверить IELTS", "Создать задачу"])
        self.assertIn("## Следующие действия", markdown)
        self.assertIn("Проверить сертификат", markdown)

    def test_ai_student_snapshot_excludes_credentials_and_secrets(self) -> None:
        student = SimpleNamespace(
            full_name="Студент",
            phone="+77000000000",
            city="Алматы",
            age=17,
            degree_level=None,
            specialty="Computer Science",
            group_direction="STEM",
            additional_sphere=None,
            gpa=4.0,
            achievements_text=None,
            budget_per_year=20_000,
            transcript_resume_url=None,
            intake_year=2027,
            intake_season=None,
            password="must-not-leak",
            credentials=[{"login": "private", "password": "private"}],
            telegram_bot_token="must-not-leak",
        )

        snapshot = snapshot_student(student)

        self.assertFalse({"password", "credentials", "telegram_bot_token"} & snapshot.keys())
        self.assertNotIn("must-not-leak", repr(snapshot))

    async def test_outbound_telegram_message_is_attributed_to_sender(self) -> None:
        sender_id = uuid.uuid4()
        message = SimpleNamespace(
            id=uuid.uuid4(),
            telegram_message_id=42,
            sender_tg_id=None,
            sender_name="Ментор",
            sent_by_user_id=sender_id,
            message_type=SimpleNamespace(value="text"),
            raw_text="Сообщение",
            created_at=datetime.now(timezone.utc),
            attachments=[],
        )

        payload = await _message_to_dict(message, current_user_id=sender_id)

        self.assertTrue(payload["is_current_user"])
        self.assertEqual(payload["sender_role"], "staff")
        self.assertEqual(payload["sender_display_name"], "Ментор")


if __name__ == "__main__":
    unittest.main()
