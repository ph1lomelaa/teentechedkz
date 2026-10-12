"""Team members may share roles and countries; duplicate people remain guarded."""
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


class TeamAdditionTests(unittest.TestCase):
    def test_every_role_allows_assignment_without_country(self):
        for role in ("country", "lead", "career", "ielts", "portfolio"):
            with self.subTest(role=role):
                mentor = _mentor()
                saved = _saved(role)
                saved.mentor = mentor
                session = _Session([mentor, None, None, None, saved])
                result = _call(session, role=role, mentor=mentor)
                self.assertEqual(result["role"], role)
                self.assertEqual(result["mentor_name"], mentor.name)

    def test_duplicate_person_race_returns_clear_conflict(self):
        mentor = _mentor()
        session = _Session([mentor, None, None, None],
            commit_error=IntegrityError("insert", {}, Exception("duplicate key")))
        with self.assertRaises(HTTPException) as caught:
            _call(session, role="lead", mentor=mentor)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn("сотрудник уже назначен", caught.exception.detail)
        self.assertTrue(session.rolled_back)
