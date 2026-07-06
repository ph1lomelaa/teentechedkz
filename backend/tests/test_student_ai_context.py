import unittest

import app.services.note_sessions as note_sessions
import app.services.student_context_ai as student_context_ai
from app.services.note_sessions import generate_note_draft
from app.services.student_context_ai import generate_context_review_draft
from app.services.student_notes import detect_quality_warnings, remove_quality_risky_notes


class StudentAiQualityTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._note_provider_chain = note_sessions.provider_chain
        self._context_provider_chain = student_context_ai.provider_chain
        note_sessions.provider_chain = lambda: []
        student_context_ai.provider_chain = lambda: []

    def tearDown(self):
        note_sessions.provider_chain = self._note_provider_chain
        student_context_ai.provider_chain = self._context_provider_chain

    def test_detects_ielts_zero_quality_warning(self):
        warnings = detect_quality_warnings("Абылай поднял IELTS до нуля.")
        self.assertTrue(warnings)

    def test_removes_ielts_zero_from_profile_notes(self):
        kept, warnings = remove_quality_risky_notes([
            "Абылай поднял IELTS до нуля.",
            "Отец Абылая ориентирует его на стоматологию.",
        ])
        self.assertEqual(kept, ["Отец Абылая ориентирует его на стоматологию."])
        self.assertTrue(warnings)

    async def test_note_draft_fallback_scrubs_ielts_zero(self):
        draft = await generate_note_draft(
            transcript="Абылай поднял IELTS до нуля.",
            title="Конспект Абылай Кожикенов",
            snapshot={},
            student_name="Абылай Кожикенов",
        )
        self.assertNotIn("поднял IELTS до нуля", draft["summary_markdown"])
        self.assertIn("Требует проверки качества", draft["summary_markdown"])

    async def test_telegram_context_fallback_groups_dialog(self):
        draft = await generate_context_review_draft(
            source_text=(
                "Я хочу поступить ближе к осени\n"
                "Посмотрим по срокам\n"
                "Документы еще не сдал\n"
                "Вот сертификат\n"
                "Ielts сдам 20 октября"
            ),
            snapshot={"full_name": "Абылай Кожикенов"},
            attachments=[{"file_name": "certificate.jpg", "mime_type": "image/jpeg", "status": "downloaded"}],
        )
        combined = "\n".join([
            *draft["profile_notes"],
            *draft["follow_ups"],
            *draft["document_flags"],
        ]).lower()
        self.assertIn("ielts", combined)
        self.assertIn("документ", combined)
        self.assertIn("certificate.jpg", combined)
        self.assertEqual(draft["profile_updates"], [])


if __name__ == "__main__":
    unittest.main()
