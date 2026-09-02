"""Самозапись: когда человека пускают без админа, а когда — нет.

Ради чего тест
--------------
Авто-привязка выдаёт кабинет чужой карточки молча. Ошибка здесь не роняет
запрос и не пишет в лог ничего подозрительного — она просто отдаёт человеку
чужие документы, и обнаруживается жалобой. Это ровно тот случай, где решение
обязано быть отделено от базы и покрыто явно.

Проверяются три условия авто-привязки, каждое по отдельности: совпадение
именно по телефону, свободная карточка и уникальность номера в базе. Матчинг
(`fuzzy_match`) сам по себе не тестируется — он старше этого кода и покрыт
своим местом; здесь проверяется наш вердикт поверх него.
"""
import unittest
import uuid
from unittest import mock

from app.api.v1.endpoints.public import _mentor_code_matches
from app.services.access_requests import suggest_student

FREE_CARD = uuid.uuid4()
TAKEN_CARD = uuid.uuid4()
TWIN_A = uuid.uuid4()
TWIN_B = uuid.uuid4()

PHONE = "+7 707 123 45 67"
OTHER_PHONE = "+7 701 000 11 22"


def _index(*rows: dict) -> list[dict]:
    return list(rows)


def _card(card_id, name, phone, user_id=None, year=2027) -> dict:
    return {
        "id": card_id,
        "full_name": name,
        "phone": phone,
        "intake_year": year,
        "user_id": user_id,
    }


class AutoLinkTests(unittest.TestCase):
    def test_exact_phone_on_free_card_is_auto_linkable(self) -> None:
        index = _index(_card(FREE_CARD, "Иванов Иван", PHONE))
        s = suggest_student("Иванов Иван", PHONE, index)
        self.assertTrue(s.auto_linkable)
        self.assertEqual(s.student_id, FREE_CARD)
        self.assertEqual(s.method, "phone_exact")

    def test_phone_format_does_not_matter(self) -> None:
        # Человек вводит номер как привык. Совпадение считается по цифрам,
        # иначе «8 707…» и «+7 707…» — это два разных человека.
        index = _index(_card(FREE_CARD, "Иванов Иван", "+7 707 123 45 67"))
        for typed in ("8 707 123 45 67", "77071234567", "8(707)123-45-67", "+7 707 123 45 67"):
            with self.subTest(typed=typed):
                s = suggest_student("Иванов Иван", typed, index)
                self.assertTrue(s.auto_linkable)
                self.assertEqual(s.student_id, FREE_CARD)

    def test_taken_card_is_suggested_but_not_auto_linked(self) -> None:
        # У карточки уже есть кабинет: второй аккаунт на неё вешать нельзя,
        # но админу показать совпадение стоит — вероятно, человек завёл второй
        # Google-аккаунт.
        index = _index(_card(TAKEN_CARD, "Иванов Иван", PHONE, user_id=uuid.uuid4()))
        s = suggest_student("Иванов Иван", PHONE, index)
        self.assertFalse(s.auto_linkable)
        self.assertEqual(s.blocked_reason, "card_taken")
        self.assertEqual(s.student_id, TAKEN_CARD)

    def test_duplicate_phone_never_auto_links(self) -> None:
        # Один номер на двух карточках (брат и сестра, семейный телефон).
        # fuzzy_match вернёт ту, что попалась первой, — и это ровно тот случай,
        # где «привязали к чужой» происходит без единого признака ошибки.
        index = _index(
            _card(TWIN_A, "Иванов Иван", PHONE),
            _card(TWIN_B, "Иванова Мария", PHONE),
        )
        s = suggest_student("Иванов Иван", PHONE, index)
        self.assertFalse(s.auto_linkable)
        self.assertEqual(s.blocked_reason, "duplicate_phone")

    def test_name_match_alone_is_only_a_hint(self) -> None:
        # Полный тёзка — обычное дело. Пускать по имени нельзя ни при какой
        # уверенности матчинга; это подсказка админу, не решение.
        index = _index(_card(FREE_CARD, "Иванов Иван", OTHER_PHONE))
        s = suggest_student("Иванов Иван", PHONE, index)
        self.assertFalse(s.auto_linkable)
        self.assertEqual(s.blocked_reason, "not_phone_exact")
        self.assertEqual(s.student_id, FREE_CARD)

    def test_no_match_leaves_no_suggestion(self) -> None:
        index = _index(_card(FREE_CARD, "Петров Пётр", OTHER_PHONE))
        s = suggest_student("Сидоров Сидор", "+7 777 999 88 77", index)
        self.assertFalse(s.auto_linkable)
        self.assertEqual(s.blocked_reason, "no_match")
        self.assertIsNone(s.student_id)

    def test_empty_index_is_not_a_crash(self) -> None:
        s = suggest_student("Иванов Иван", PHONE, [])
        self.assertFalse(s.auto_linkable)
        self.assertIsNone(s.student_id)


class MentorCodeTests(unittest.TestCase):
    """Код — единственное, что отделяет ментора от очереди, поэтому «выключено»
    обязано означать «никого», а не «подходит пустая строка»."""

    def test_unset_code_lets_nobody_through(self) -> None:
        with mock.patch("app.api.v1.endpoints.public.settings") as s:
            s.JOIN_MENTOR_CODE = ""
            for attempt in ("", None, "mentors2026", " "):
                with self.subTest(attempt=attempt):
                    self.assertFalse(_mentor_code_matches(attempt))

    def test_correct_code_matches_and_others_do_not(self) -> None:
        with mock.patch("app.api.v1.endpoints.public.settings") as s:
            s.JOIN_MENTOR_CODE = "mentors2026"
            self.assertTrue(_mentor_code_matches("mentors2026"))
            for attempt in ("", None, "mentors2025", "Mentors2026", "mentors2026 "):
                with self.subTest(attempt=attempt):
                    self.assertFalse(_mentor_code_matches(attempt))


if __name__ == "__main__":
    unittest.main()
