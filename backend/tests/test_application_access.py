"""Права на заявки студента.

Регрессия на реальный дефект: прежняя `_can_edit` выглядела как проверка
скоупа, но ею не была —

    if user.role in (admin, mzk_manager, mentor): return True
    return student_id in mentor_ids          # недостижимо для ментора

первая ветка пропускала ЛЮБОГО ментора, поэтому ментор мог править и удалять
заявки любого студента. Здесь проверяется, что теперь скоуп реально работает,
и что сам студент свои заявки читает, но не редактирует.
"""
import unittest
import uuid

from fastapi import HTTPException

from app.api.v1.endpoints.applications import _assert_manage, _assert_read
from app.models.user import UserRole

STUDENT_ID = uuid.uuid4()
OTHER_STUDENT_ID = uuid.uuid4()


class FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def all(self):
        return [(v,) for v in self._value] if self._value else []


class FakeDb:
    """Отдаёт заранее заданные ответы на два запроса, которые делает код:
    поиск student_id по user_id и список подопечных ментора."""

    def __init__(self, *, my_student_id=None, assigned_ids=()):
        self._my_student_id = my_student_id
        self._assigned = list(assigned_ids)
        self.calls = 0

    async def execute(self, stmt):
        self.calls += 1
        text = str(stmt)
        if "mentor_assignments" in text:
            return FakeResult(self._assigned)
        return FakeResult(self._my_student_id)


def user(role, uid=None):
    return type("U", (), {"role": role, "id": uid or uuid.uuid4()})()


class ManageTests(unittest.IsolatedAsyncioTestCase):
    async def test_mentor_may_not_touch_a_student_outside_scope(self):
        """Ровно та дыра, ради которой написан тест."""
        db = FakeDb(assigned_ids=[OTHER_STUDENT_ID])
        with self.assertRaises(HTTPException) as ctx:
            await _assert_manage(db, STUDENT_ID, user(UserRole.mentor))
        self.assertEqual(ctx.exception.status_code, 404)

    async def test_mentor_may_touch_their_own_student(self):
        db = FakeDb(assigned_ids=[STUDENT_ID])
        await _assert_manage(db, STUDENT_ID, user(UserRole.mentor))

    async def test_mentor_with_no_assignments_is_refused(self):
        db = FakeDb(assigned_ids=[])
        with self.assertRaises(HTTPException):
            await _assert_manage(db, STUDENT_ID, user(UserRole.mentor))

    async def test_admin_and_mzk_are_unscoped(self):
        for role in (UserRole.admin, UserRole.mzk_manager):
            with self.subTest(role=role):
                await _assert_manage(FakeDb(), STUDENT_ID, user(role))

    async def test_student_may_not_manage_even_their_own(self):
        """Заявки ведёт персонал: студент их только читает."""
        db = FakeDb(my_student_id=STUDENT_ID)
        with self.assertRaises(HTTPException) as ctx:
            await _assert_manage(db, STUDENT_ID, user(UserRole.student))
        self.assertEqual(ctx.exception.status_code, 403)


class ReadTests(unittest.IsolatedAsyncioTestCase):
    async def test_student_reads_own(self):
        db = FakeDb(my_student_id=STUDENT_ID)
        await _assert_read(db, STUDENT_ID, user(UserRole.student))

    async def test_student_cannot_read_someone_elses(self):
        """404, а не 403 — иначе перебором можно узнать существующие id."""
        db = FakeDb(my_student_id=OTHER_STUDENT_ID)
        with self.assertRaises(HTTPException) as ctx:
            await _assert_read(db, STUDENT_ID, user(UserRole.student))
        self.assertEqual(ctx.exception.status_code, 404)

    async def test_student_without_a_card_cannot_read(self):
        db = FakeDb(my_student_id=None)
        with self.assertRaises(HTTPException):
            await _assert_read(db, STUDENT_ID, user(UserRole.student))

    async def test_mentor_scope_applies_to_reads_too(self):
        db = FakeDb(assigned_ids=[OTHER_STUDENT_ID])
        with self.assertRaises(HTTPException):
            await _assert_read(db, STUDENT_ID, user(UserRole.mentor))

    async def test_admin_reads_anyone(self):
        await _assert_read(FakeDb(), STUDENT_ID, user(UserRole.admin))


if __name__ == "__main__":
    unittest.main()
