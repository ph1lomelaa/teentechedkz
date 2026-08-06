"""Чистая логика — кто чьи вознаграждения и штрафы имеет право видеть.

Регрессия на реальную дыру: в списках стояла цепочка

    if mentor_id: <фильтр>
    elif role == mentor: <свои>
    else: _require_staff(user)

где проверка прав была только в последней ветке. Достаточно было передать
?mentor_id=<чужой>, чтобы её обойти, — и любой авторизованный, включая
студента, читал чужие суммы и историю штрафов.
"""
import unittest
import uuid

from fastapi import HTTPException

from app.api.v1.endpoints.mentor_rewards import can_contest_penalty, resolve_mentor_scope
from app.models.user import UserRole

ME = uuid.uuid4()
SOMEONE_ELSE = uuid.uuid4()


class MentorScopeTests(unittest.TestCase):
    def test_mentor_cannot_pass_another_mentor_id(self):
        """Ровно та дыра, ради которой написан тест."""
        with self.assertRaises(HTTPException) as ctx:
            resolve_mentor_scope(
                viewer_role=UserRole.mentor,
                viewer_id=ME,
                requested_mentor_id=str(SOMEONE_ELSE),
            )
        self.assertEqual(ctx.exception.status_code, 403)

    def test_mentor_without_param_is_scoped_to_self(self):
        self.assertEqual(
            resolve_mentor_scope(viewer_role=UserRole.mentor, viewer_id=ME, requested_mentor_id=None),
            ME,
        )

    def test_mentor_may_pass_own_id(self):
        self.assertEqual(
            resolve_mentor_scope(viewer_role=UserRole.mentor, viewer_id=ME, requested_mentor_id=str(ME)),
            ME,
        )

    def test_student_is_refused_even_with_mentor_id(self):
        with self.assertRaises(HTTPException) as ctx:
            resolve_mentor_scope(
                viewer_role=UserRole.student,
                viewer_id=ME,
                requested_mentor_id=str(SOMEONE_ELSE),
            )
        self.assertEqual(ctx.exception.status_code, 403)

    def test_student_is_refused_without_param(self):
        with self.assertRaises(HTTPException):
            resolve_mentor_scope(viewer_role=UserRole.student, viewer_id=ME, requested_mentor_id=None)

    def test_staff_may_filter_by_any_mentor(self):
        for role in (UserRole.admin, UserRole.mzk_manager):
            with self.subTest(role=role):
                self.assertEqual(
                    resolve_mentor_scope(
                        viewer_role=role, viewer_id=ME, requested_mentor_id=str(SOMEONE_ELSE)
                    ),
                    SOMEONE_ELSE,
                )

    def test_staff_without_param_sees_everyone(self):
        self.assertIsNone(
            resolve_mentor_scope(viewer_role=UserRole.admin, viewer_id=ME, requested_mentor_id=None)
        )

    def test_malformed_uuid_is_422_not_500(self):
        with self.assertRaises(HTTPException) as ctx:
            resolve_mentor_scope(
                viewer_role=UserRole.admin, viewer_id=ME, requested_mentor_id="мусор"
            )
        self.assertEqual(ctx.exception.status_code, 422)


class ContestPenaltyTests(unittest.TestCase):
    def test_mentor_may_contest_own_penalty(self):
        self.assertTrue(
            can_contest_penalty(viewer_role=UserRole.mentor, viewer_id=ME, penalty_mentor_id=ME)
        )

    def test_mentor_may_not_contest_someone_elses(self):
        self.assertFalse(
            can_contest_penalty(
                viewer_role=UserRole.mentor, viewer_id=ME, penalty_mentor_id=SOMEONE_ELSE
            )
        )

    def test_student_may_not_contest(self):
        """Прежняя проверка отсекала только чужого ментора, а студента пускала."""
        self.assertFalse(
            can_contest_penalty(
                viewer_role=UserRole.student, viewer_id=ME, penalty_mentor_id=SOMEONE_ELSE
            )
        )

    def test_staff_may_contest_on_behalf(self):
        for role in (UserRole.admin, UserRole.mzk_manager):
            with self.subTest(role=role):
                self.assertTrue(
                    can_contest_penalty(
                        viewer_role=role, viewer_id=ME, penalty_mentor_id=SOMEONE_ELSE
                    )
                )


if __name__ == "__main__":
    unittest.main()
