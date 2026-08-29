"""Чтение полей из нетипизированного тела (`app/core/body.py`).

Ради чего: эндпоинты с `body: dict` читали поля напрямую —
`uuid.UUID(body["student_id"])`. Пропущенный ключ давал KeyError, кривая
строка — ValueError, и оба выходили наружу 500-й. На пустом теле так падали
POST /communications, /guardians, /mentor-assignments и /portfolio: сервер
отвечал «внутренняя ошибка» там, где форма прислала неполные данные.
"""
import unittest
import uuid
from datetime import date

from fastapi import HTTPException

from app.core.body import optional_date, optional_uuid, required_uuid


class RequiredUuidTests(unittest.TestCase):
    def test_parses_valid_uuid(self) -> None:
        u = uuid.uuid4()
        self.assertEqual(required_uuid({"student_id": str(u)}, "student_id"), u)

    def test_missing_key_is_422_not_crash(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            required_uuid({}, "student_id")
        self.assertEqual(ctx.exception.status_code, 422)

    def test_missing_key_names_the_field(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            required_uuid({}, "student_id")
        self.assertIn("student_id", ctx.exception.detail)

    def test_empty_string_treated_as_missing(self) -> None:
        # Пустая строка приходит из формы, где поле просто не заполнили.
        with self.assertRaises(HTTPException) as ctx:
            required_uuid({"student_id": ""}, "student_id")
        self.assertEqual(ctx.exception.headers["X-Error-Code"], "FIELD_REQUIRED")

    def test_garbage_is_422_not_crash(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            required_uuid({"student_id": "не-uuid"}, "student_id")
        self.assertEqual(ctx.exception.status_code, 422)
        self.assertEqual(ctx.exception.headers["X-Error-Code"], "FIELD_INVALID")

    def test_wrong_type_is_422_not_crash(self) -> None:
        for value in (123, [], {}, True):
            with self.assertRaises(HTTPException):
                required_uuid({"student_id": value}, "student_id")


class OptionalUuidTests(unittest.TestCase):
    def test_absent_is_none(self) -> None:
        self.assertIsNone(optional_uuid({}, "mentor_id"))

    def test_empty_and_null_are_none(self) -> None:
        self.assertIsNone(optional_uuid({"mentor_id": ""}, "mentor_id"))
        self.assertIsNone(optional_uuid({"mentor_id": None}, "mentor_id"))

    def test_garbage_still_rejected(self) -> None:
        # «Необязательное» — про отсутствие, а не про право прислать мусор.
        with self.assertRaises(HTTPException):
            optional_uuid({"mentor_id": "нет"}, "mentor_id")


class OptionalDateTests(unittest.TestCase):
    def test_parses_iso_date(self) -> None:
        self.assertEqual(optional_date({"d": "2026-08-26"}, "d"), date(2026, 8, 26))

    def test_accepts_full_timestamp(self) -> None:
        # Фронт иногда шлёт полный ISO в поле, которое в модели — date.
        self.assertEqual(optional_date({"d": "2026-08-26T12:30:00Z"}, "d"), date(2026, 8, 26))

    def test_absent_is_none(self) -> None:
        self.assertIsNone(optional_date({}, "d"))
        self.assertIsNone(optional_date({"d": ""}, "d"))

    def test_garbage_is_422_not_crash(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            optional_date({"d": "26.08.2026"}, "d")
        self.assertEqual(ctx.exception.status_code, 422)
