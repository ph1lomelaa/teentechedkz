"""Очередь «Статус»: что из Telegram не должно превращаться в изменение карточки.

Ради чего тест
--------------
Очередь заполнилась мусором, который одним нажатием «Подтвердить» уходил
в профиль студента: код ссылки-приглашения вместо телефона, наша
welcome-ссылка как «транскрипт», одно слово из приветствия как новое ФИО.
Каждый такой случай здесь — отдельная проверка, взятая из реальной очереди.
"""
import unittest

from app.services.student_notes import validate_proposed_changes

SNAPSHOT = {"full_name": "Assetuly Alim Nurlanuly", "phone": "+77775557730", "gpa": "3.9"}


class ValidateProposedChangesTests(unittest.TestCase):
    def _check(self, changes: dict) -> dict:
        return validate_proposed_changes(changes, SNAPSHOT)

    def test_invite_token_is_not_a_phone(self) -> None:
        self.assertEqual(self._check({"phone": "dgUc5AoywU"}), {})
        self.assertEqual(self._check({"phone": "5xaMui8jWp"}), {})

    def test_real_phone_passes_in_any_format(self) -> None:
        for phone in ("+7 707 123 45 67", "87071234567", "8(707)123-45-67"):
            with self.subTest(phone=phone):
                self.assertEqual(self._check({"phone": phone}), {"phone": phone})

    def test_own_links_are_not_a_transcript(self) -> None:
        for url in (
            "https://teenteched.kz/welcome/Lb52F_Aj04WwKD9sNLXelMDwSZ_G4VvDjSfRjPXgW-c",
            "https://t.me/+dgUc5AoywU",
            "новый транскрипт с указанием количества кредитов",
        ):
            with self.subTest(url=url):
                self.assertEqual(self._check({"transcript_resume_url": url}), {})

    def test_document_link_is_a_transcript(self) -> None:
        url = "https://drive.google.com/file/d/abc/view"
        self.assertEqual(self._check({"transcript_resume_url": url}), {"transcript_resume_url": url})

    def test_single_word_does_not_replace_full_name(self) -> None:
        self.assertEqual(self._check({"full_name": "Аймин"}), {})
        self.assertEqual(
            self._check({"full_name": "Асетулы Алим Нурланулы"}),
            {"full_name": "Асетулы Алим Нурланулы"},
        )

    def test_gpa_must_be_a_number(self) -> None:
        self.assertEqual(self._check({"gpa": "4.5"}), {"gpa": "4.5"})
        self.assertEqual(self._check({"gpa": 4.3}), {"gpa": 4.3})
        for bad in ("хороший", "0", "https://example.com"):
            with self.subTest(gpa=bad):
                self.assertEqual(self._check({"gpa": bad}), {})

    def test_links_and_nested_values_never_fill_text_fields(self) -> None:
        self.assertEqual(self._check({"specialty": "https://teenteched.kz/welcome/x"}), {})
        self.assertEqual(self._check({"intake_year": {"value": 2027}}), {})

    def test_unknown_fields_are_dropped(self) -> None:
        self.assertEqual(self._check({"context_note": "текст", "city": "Алматы"}), {"city": "Алматы"})


if __name__ == "__main__":
    unittest.main()
