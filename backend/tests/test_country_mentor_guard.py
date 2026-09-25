"""Добавление второго ментора по стране: почему страна обязательна.

Ради чего тест
--------------
Ментор по стране — единственная роль, где у ученика может быть несколько
активных ответственных: он подаётся в несколько стран, и каждую ведёт свой
человек. Различает строки только `country_scope`.

Отсюда два правила, которые легко потерять:

* **со второго ответственного страна обязательна.** Без неё в карточке две
  одинаковые строки, и непонятно, кто какую страну ведёт. Первого пускаем без
  страны: на старте она часто ещё не выбрана, и требовать её сразу значило бы
  блокировать обычное назначение;
* **на одну страну — один ментор.** Это ловит уникальный индекс
  (`uq_mentor_assignment_active_country`), а ручка обязана превратить его
  `IntegrityError` в понятный отказ, а не в 500.

Ручка целиком здесь не поднимается (фикстур с БД в проекте нет): сессия
подменена, и проверяются ровно эти два ветвления.
"""
import asyncio
import unittest
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.api.v1.endpoints.mentor_assignments import create_assignment
from app.models.mentor_assignment import MentorAssignment, MentorRole
from app.models.user import User, UserRole


class _Result:
    def __init__(self, row):
        self._row = row

    def scalar_one_or_none(self):
        return self._row

    def scalar(self):
        # Зовёт `has_pending_agreement_signature`: ручка спрашивает, подписан ли
        # регламент, прежде чем решить статус назначения.
        return self._row

    def scalar_one(self):
        # Финальная перечитка назначения перед ответом ручки.
        return self._row

    def scalars(self):
        return self

    def first(self):
        return self._row

    def all(self):
        if isinstance(self._row, list):
            return self._row
        return [self._row] if self._row is not None else []


class _Session:
    """Сессия, отвечающая по очереди. `commit_error` — что случится на commit."""

    def __init__(self, answers, commit_error=None):
        self._answers = list(answers)
        self._commit_error = commit_error
        self.added = []
        self.rolled_back = False

    async def execute(self, _query):
        return _Result(self._answers.pop(0) if self._answers else None)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass

    async def commit(self):
        if self._commit_error:
            raise self._commit_error

    async def rollback(self):
        self.rolled_back = True


def _mentor() -> User:
    return User(
        id=uuid.uuid4(),
        name="Айана",
        email=f"{uuid.uuid4().hex[:6]}@example.kz",
        role=UserRole.mentor,
        is_active=True,
    )


def _admin() -> User:
    return User(
        id=uuid.uuid4(),
        name="Админ",
        email=f"{uuid.uuid4().hex[:6]}@example.kz",
        role=UserRole.admin,
        is_active=True,
    )


def _saved(role: str) -> MentorAssignment:
    """Чем отвечает последняя перечитка: ручка сериализует её в ответ."""
    return MentorAssignment(
        id=uuid.uuid4(),
        student_id=uuid.uuid4(),
        mentor_id=uuid.uuid4(),
        role=MentorRole(role),
        is_active=True,
        assignment_status="active",
        assigned_at=datetime.now(timezone.utc),
    )


def _call(session, *, role: str, country_scope=None, mentor: User | None = None):
    body = {
        "student_id": str(uuid.uuid4()),
        "mentor_id": str((mentor or _mentor()).id),
        "role": role,
    }
    if country_scope is not None:
        body["country_scope"] = country_scope
    return asyncio.run(create_assignment(body, session, _admin()))


class CountryIsRequiredForTheSecondTests(unittest.TestCase):
    def test_the_second_country_mentor_without_a_country_is_refused(self) -> None:
        mentor = _mentor()
        # Ответы по порядку: сотрудник для _load_assignable_mentor, затем
        # «роль уже кем-то занята» — та самая ветка, которая требует страну.
        occupied = MentorAssignment(
            id=uuid.uuid4(), student_id=uuid.uuid4(), mentor_id=uuid.uuid4(),
            role=MentorRole.country, is_active=True, assignment_status="active",
        )
        session = _Session([mentor, occupied.id])

        with self.assertRaises(HTTPException) as caught:
            _call(session, role="country", mentor=mentor)

        self.assertEqual(caught.exception.status_code, 422)
        self.assertIn("страну", caught.exception.detail)

    def test_the_first_country_mentor_needs_no_country(self) -> None:
        # Страна часто ещё не выбрана, и требовать её у первого означало бы
        # запретить обычное назначение.
        mentor = _mentor()
        session = _Session([mentor, None, None, None, None, _saved("country")])

        try:
            _call(session, role="country", mentor=mentor)
        except HTTPException as exc:  # pragma: no cover — диагностика
            self.fail(f"первое назначение отклонено: {exc.detail}")

    def test_a_single_role_never_asks_for_a_country(self) -> None:
        # Страховка от расползания правила: у ментора по УП страны нет вовсе.
        mentor = _mentor()
        session = _Session([mentor, None, None, None, None, _saved("lead")])

        try:
            _call(session, role="lead", mentor=mentor)
        except HTTPException as exc:  # pragma: no cover — диагностика
            self.fail(f"одиночная роль потребовала страну: {exc.detail}")


class DuplicateCountryTests(unittest.TestCase):
    def test_the_same_country_twice_is_a_clear_refusal(self) -> None:
        """Отказ индекса обязан читаться как «эта страна занята», а не как 500.

        И не как «роль занял другой сотрудник»: при добавлении второй страны
        такой текст выглядел бы ошибкой системы, а не подсказкой.
        """
        mentor = _mentor()
        session = _Session(
            [mentor, None, None, None, None, None],
            commit_error=IntegrityError("insert", {}, Exception("duplicate key")),
        )

        with self.assertRaises(HTTPException) as caught:
            _call(session, role="country", country_scope="США", mentor=mentor)

        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn("США", caught.exception.detail)
        self.assertTrue(session.rolled_back, "транзакция осталась незакрытой")

    def test_a_single_role_keeps_the_race_wording(self) -> None:
        # Для одиночной роли тот же индекс означает другое: роль заняли, пока
        # шёл запрос. Тексты не должны схлопнуться в один.
        mentor = _mentor()
        session = _Session(
            [mentor, None, None, None, None, None],
            commit_error=IntegrityError("insert", {}, Exception("duplicate key")),
        )

        with self.assertRaises(HTTPException) as caught:
            _call(session, role="lead", mentor=mentor)

        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn("другой сотрудник", caught.exception.detail)
